from datetime import date, datetime, timedelta, timezone
from unittest.mock import Mock
import json
import pandas as pd

import httpx

from app.data_sources import NSEOfficialSource, YahooChartSource, validate_frame
from app.services import _known_market_rows, upsert_market


def test_yahoo_parser_with_mocked_payload(tmp_path, monkeypatch):
    source = YahooChartSource(); source.cache_dir = tmp_path
    payload = {"chart":{"result":[{"timestamp":[1704067200,1704153600],"indicators":{"quote":[{
        "open":[100,101],"high":[102,103],"low":[99,100],"close":[101,102],"volume":[10,11]}],
        "adjclose":[{"adjclose":[101,102]}]}}]}}
    monkeypatch.setattr(source, "_fetch", Mock(return_value=payload))
    frame = source.history("^NSEI", date(2024,1,1), date(2024,1,2))
    assert len(frame) == 2
    assert frame.close.iloc[-1] == 102
    assert validate_frame(frame, {"date","open","high","low","close"}, "nifty")["status"] == "complete"


def test_large_market_upsert_is_chunked_for_sqlite(db):
    days = 700
    frame = pd.DataFrame({
        "date": [date(2020, 1, 1) + timedelta(days=i) for i in range(days)],
        "open": [100.] * days, "high": [101.] * days, "low": [99.] * days,
        "close": [100.] * days, "volume": [1000.] * days, "prev_close": [100.] * days,
        "symbol": ["^NSEI"] * days, "source": ["test"] * days,
        "available_at": pd.to_datetime(["2020-01-01T12:00:00Z"] * days),
    })
    assert upsert_market(db, frame) == days


def test_known_market_rows_drop_future_availability():
    frame = pd.DataFrame({
        "date": [date(2026, 7, 17), date(2026, 7, 20)],
        "open": [100., 101.], "high": [101., 102.], "low": [99., 100.],
        "close": [100., 101.], "volume": [1000., 1000.], "prev_close": [99., 100.],
        "symbol": ["^NSEI", "^NSEI"], "source": ["yahoo_chart", "yahoo_chart"],
        "available_at": pd.to_datetime(["2026-07-17T12:30:00Z", "2026-07-20T12:30:00Z"]),
    })
    now = datetime(2026, 7, 20, 9, 30, tzinfo=timezone.utc)
    filtered = _known_market_rows(frame, now)
    assert filtered.date.tolist() == [date(2026, 7, 17)]


def test_official_nse_snapshot_and_fii_dii_are_date_matched(monkeypatch):
    source = NSEOfficialSource()
    indices = {"timestamp": "06-Jul-2026 15:30", "data": [
        {"index": "NIFTY 50", "open": 24306.85, "high": 24458.65, "low": 24287.1, "last": 24430.35, "previousClose": 24270.85},
        {"index": "INDIA VIX", "open": 11.8, "high": 12.36, "low": 11.7, "last": 11.82, "previousClose": 11.8},
    ]}
    flows = [
        {"buyValue": "19727.56", "category": "DII", "date": "06-Jul-2026", "netValue": "3791.42", "sellValue": "15936.14"},
        {"buyValue": "11686.1", "category": "FII/FPI", "date": "06-Jul-2026", "netValue": "243.03", "sellValue": "11443.07"},
    ]
    def fake_get(url):
        payload = indices if url.endswith("allIndices") else flows
        return httpx.Response(200, json=payload, request=httpx.Request("GET", url))
    monkeypatch.setattr(source, "_get", fake_get)
    snapshot, trading_date = source.index_snapshot()
    cash = source.fii_dii(trading_date)
    assert trading_date == date(2026, 7, 6)
    assert snapshot.loc[snapshot.symbol == "^NSEI", "close"].iloc[0] == 24430.35
    assert cash.fii_net.iloc[0] == 243.03
