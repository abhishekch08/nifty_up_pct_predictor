"""Internet data adapters with retries, caching, and explicit provenance.

Yahoo's public chart endpoint is the resilient baseline for price series. NSE
datasets are deliberately isolated behind adapters because anti-bot policies can
change; manual CSV ingestion remains a first-class fallback for every dataset.
"""
from datetime import date, datetime, time, timedelta, timezone
from pathlib import Path
import json

import httpx
import pandas as pd
from tenacity import retry, stop_after_attempt, wait_exponential

from .config import get_settings

UTC = timezone.utc
IST = timezone(timedelta(hours=5, minutes=30))
SYMBOLS = {
    "NIFTY": "^NSEI",
    "INDIA_VIX": "^INDIAVIX",
    "SP500": "^GSPC",
    "NASDAQ100": "^NDX",
    "DOW": "^DJI",
    "NIKKEI": "^N225",
    "HANGSENG": "^HSI",
    "DXY": "DX-Y.NYB",
    "BRENT": "BZ=F",
    "USDINR": "INR=X",
    "US10Y": "^TNX",
}


class SourceUnavailable(RuntimeError):
    pass


class YahooChartSource:
    base_url = "https://query1.finance.yahoo.com/v8/finance/chart/{symbol}"

    def __init__(self, cache_hours: int = 6):
        self.cache_dir = Path(get_settings().data_dir) / "cache"
        self.cache_dir.mkdir(parents=True, exist_ok=True)
        self.cache_hours = cache_hours

    def _cache_path(self, symbol: str, start: date, end: date) -> Path:
        safe = symbol.replace("^", "index_").replace("=", "_")
        return self.cache_dir / f"{safe}_{start}_{end}.json"

    @retry(stop=stop_after_attempt(3), wait=wait_exponential(min=1, max=8), reraise=True)
    def _fetch(self, symbol: str, start: date, end: date) -> dict:
        params = {
            "period1": int(datetime.combine(start, time.min, UTC).timestamp()),
            "period2": int(datetime.combine(end + timedelta(days=1), time.min, UTC).timestamp()),
            "interval": "1d",
            "events": "history",
        }
        with httpx.Client(timeout=20, headers={"User-Agent": "nifty-probability-terminal/1.0"}) as client:
            response = client.get(self.base_url.format(symbol=symbol), params=params)
            response.raise_for_status()
            return response.json()

    def history(self, symbol: str, start: date, end: date, allow_stale: bool = True) -> pd.DataFrame:
        cache = self._cache_path(symbol, start, end)
        payload = None
        if cache.exists() and datetime.now().timestamp() - cache.stat().st_mtime < self.cache_hours * 3600:
            payload = json.loads(cache.read_text(encoding="utf-8"))
        else:
            try:
                payload = self._fetch(symbol, start, end)
                cache.write_text(json.dumps(payload), encoding="utf-8")
            except (httpx.HTTPError, ValueError) as exc:
                if allow_stale and cache.exists():
                    payload = json.loads(cache.read_text(encoding="utf-8"))
                else:
                    raise SourceUnavailable(f"Yahoo chart unavailable for {symbol}: {exc}") from exc

        try:
            result = payload["chart"]["result"][0]
            quote = result["indicators"]["quote"][0]
            adjusted = result["indicators"].get("adjclose", [{}])[0].get("adjclose", quote["close"])
            frame = pd.DataFrame({
                "date": pd.to_datetime(result["timestamp"], unit="s", utc=True).date,
                "open": quote["open"], "high": quote["high"], "low": quote["low"],
                "close": adjusted, "volume": quote.get("volume"),
            }).dropna(subset=["close"])
        except (KeyError, IndexError, TypeError) as exc:
            raise SourceUnavailable(f"Malformed Yahoo response for {symbol}") from exc
        frame["prev_close"] = frame["close"].shift(1)
        frame["symbol"] = symbol
        frame["source"] = "yahoo_chart"
        # Conservative first-known times in IST. US and commodity closes roll
        # into the next calendar morning but are known before the Nifty open.
        next_morning = symbol in {"^GSPC", "^NDX", "^DJI", "DX-Y.NYB", "BZ=F", "^TNX"}
        clock = " 03:30:00+05:30" if next_morning else " 13:30:00+05:30" if symbol in {"^N225", "^HSI"} else " 18:00:00+05:30"
        available_dates = pd.to_datetime(frame["date"].astype(str)) + (pd.Timedelta(days=1) if next_morning else pd.Timedelta(0))
        frame["available_at"] = pd.to_datetime(available_dates.dt.strftime("%Y-%m-%d") + clock, utc=True)
        return frame


def validate_frame(frame: pd.DataFrame, required: set[str], dataset: str) -> dict:
    missing_columns = sorted(required - set(frame.columns))
    warnings: list[str] = []
    if "date" in frame and frame["date"].duplicated().any():
        warnings.append("duplicate dates detected")
    numeric = [c for c in ("open", "high", "low", "close") if c in frame]
    if numeric and frame[numeric].isna().any().any():
        warnings.append("missing OHLC values detected")
    if "close" in frame and len(frame) > 2:
        moves = pd.to_numeric(frame["close"], errors="coerce").pct_change().abs()
        if (moves > 0.2).any():
            warnings.append("extreme daily move above 20% detected")
    return {
        "dataset": dataset,
        "status": "unsafe" if missing_columns else ("partial" if warnings else "complete"),
        "missing_fields": missing_columns,
        "warnings": warnings,
        "rows": int(len(frame)),
    }


def assert_asof_availability(frame: pd.DataFrame, prediction_cutoff: pd.Series) -> None:
    """Raise when any feature was not known at its prediction cutoff."""
    if "available_at" not in frame:
        raise ValueError("available_at is required for leakage validation")
    available = pd.to_datetime(frame["available_at"], utc=True)
    cutoff = pd.to_datetime(prediction_cutoff, utc=True)
    if (available > cutoff).any():
        bad = frame.loc[available > cutoff, [c for c in ("date", "symbol") if c in frame]].head()
        raise ValueError(f"look-ahead data detected: {bad.to_dict('records')}")
