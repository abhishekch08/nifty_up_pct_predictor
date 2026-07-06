from datetime import date, timedelta
from unittest.mock import Mock
import json
import pandas as pd

from app.data_sources import YahooChartSource, validate_frame
from app.services import upsert_market


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
