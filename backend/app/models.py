from datetime import date, datetime, timezone

from sqlalchemy import JSON, Date, DateTime, Float, Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from .database import Base


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class MarketDaily(Base):
    __tablename__ = "market_daily"
    __table_args__ = (UniqueConstraint("symbol", "date"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    symbol: Mapped[str] = mapped_column(String(32), index=True)
    date: Mapped[date] = mapped_column(Date, index=True)
    open: Mapped[float] = mapped_column(Float)
    high: Mapped[float] = mapped_column(Float)
    low: Mapped[float] = mapped_column(Float)
    close: Mapped[float] = mapped_column(Float)
    prev_close: Mapped[float | None] = mapped_column(Float, nullable=True)
    volume: Mapped[float | None] = mapped_column(Float, nullable=True)
    source: Mapped[str] = mapped_column(String(48), default="unknown")
    available_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class FlowDaily(Base):
    __tablename__ = "flow_daily"
    date: Mapped[date] = mapped_column(Date, primary_key=True)
    fii_buy: Mapped[float | None] = mapped_column(Float, nullable=True)
    fii_sell: Mapped[float | None] = mapped_column(Float, nullable=True)
    fii_net: Mapped[float | None] = mapped_column(Float, nullable=True)
    dii_buy: Mapped[float | None] = mapped_column(Float, nullable=True)
    dii_sell: Mapped[float | None] = mapped_column(Float, nullable=True)
    dii_net: Mapped[float | None] = mapped_column(Float, nullable=True)
    source: Mapped[str] = mapped_column(String(48), default="manual_upload")
    available_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class ParticipantOI(Base):
    __tablename__ = "participant_oi_daily"
    __table_args__ = (UniqueConstraint("date", "participant"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    date: Mapped[date] = mapped_column(Date, index=True)
    participant: Mapped[str] = mapped_column(String(24))
    index_futures_long: Mapped[float | None] = mapped_column(Float, nullable=True)
    index_futures_short: Mapped[float | None] = mapped_column(Float, nullable=True)
    index_call_long: Mapped[float | None] = mapped_column(Float, nullable=True)
    index_call_short: Mapped[float | None] = mapped_column(Float, nullable=True)
    index_put_long: Mapped[float | None] = mapped_column(Float, nullable=True)
    index_put_short: Mapped[float | None] = mapped_column(Float, nullable=True)
    source: Mapped[str] = mapped_column(String(48), default="manual_upload")
    available_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class OptionEOD(Base):
    __tablename__ = "options_chain_eod"
    __table_args__ = (UniqueConstraint("date", "expiry", "strike"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    date: Mapped[date] = mapped_column(Date, index=True)
    expiry: Mapped[date] = mapped_column(Date)
    strike: Mapped[float] = mapped_column(Float)
    spot: Mapped[float] = mapped_column(Float)
    ce_oi: Mapped[float | None] = mapped_column(Float, nullable=True)
    ce_change_oi: Mapped[float | None] = mapped_column(Float, nullable=True)
    ce_volume: Mapped[float | None] = mapped_column(Float, nullable=True)
    ce_iv: Mapped[float | None] = mapped_column(Float, nullable=True)
    ce_ltp: Mapped[float | None] = mapped_column(Float, nullable=True)
    pe_oi: Mapped[float | None] = mapped_column(Float, nullable=True)
    pe_change_oi: Mapped[float | None] = mapped_column(Float, nullable=True)
    pe_volume: Mapped[float | None] = mapped_column(Float, nullable=True)
    pe_iv: Mapped[float | None] = mapped_column(Float, nullable=True)
    pe_ltp: Mapped[float | None] = mapped_column(Float, nullable=True)
    source: Mapped[str] = mapped_column(String(48), default="manual_upload")


class Prediction(Base):
    __tablename__ = "model_predictions"
    id: Mapped[int] = mapped_column(primary_key=True)
    date: Mapped[date] = mapped_column(Date, index=True)
    next_trading_day: Mapped[date] = mapped_column(Date)
    model_version: Mapped[str] = mapped_column(String(64), index=True)
    nifty_close: Mapped[float] = mapped_column(Float)
    india_vix: Mapped[float | None] = mapped_column(Float, nullable=True)
    probability_up: Mapped[float] = mapped_column(Float)
    probability_down: Mapped[float] = mapped_column(Float)
    expected_return: Mapped[float] = mapped_column(Float)
    expected_upper_range: Mapped[float] = mapped_column(Float)
    expected_lower_range: Mapped[float] = mapped_column(Float)
    signal: Mapped[str] = mapped_column(String(32))
    regime: Mapped[str] = mapped_column(String(48))
    confidence: Mapped[str] = mapped_column(String(24))
    data_quality: Mapped[str] = mapped_column(String(24))
    completeness: Mapped[float] = mapped_column(Float)
    bullish_factors: Mapped[list] = mapped_column(JSON, default=list)
    bearish_factors: Mapped[list] = mapped_column(JSON, default=list)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class ModelVersion(Base):
    __tablename__ = "model_versions"
    version: Mapped[str] = mapped_column(String(64), primary_key=True)
    algorithm: Mapped[str] = mapped_column(String(64))
    training_start: Mapped[date] = mapped_column(Date)
    training_end: Mapped[date] = mapped_column(Date)
    feature_set_version: Mapped[str] = mapped_column(String(32))
    calibration_method: Mapped[str] = mapped_column(String(32))
    hyperparameters: Mapped[dict] = mapped_column(JSON)
    metrics: Mapped[dict] = mapped_column(JSON)
    artifact_path: Mapped[str] = mapped_column(String(256))
    status: Mapped[str] = mapped_column(String(24), default="candidate")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class BacktestResult(Base):
    __tablename__ = "backtest_results"
    id: Mapped[int] = mapped_column(primary_key=True)
    model_version: Mapped[str] = mapped_column(String(64), index=True)
    start_date: Mapped[date] = mapped_column(Date)
    end_date: Mapped[date] = mapped_column(Date)
    metrics: Mapped[dict] = mapped_column(JSON)
    equity_curve: Mapped[list] = mapped_column(JSON)
    calibration: Mapped[list] = mapped_column(JSON)
    threshold_analysis: Mapped[list] = mapped_column(JSON)


class DataQualityLog(Base):
    __tablename__ = "data_quality_log"
    id: Mapped[int] = mapped_column(primary_key=True)
    date: Mapped[date] = mapped_column(Date, index=True)
    dataset: Mapped[str] = mapped_column(String(64))
    status: Mapped[str] = mapped_column(String(24))
    missing_fields: Mapped[list] = mapped_column(JSON, default=list)
    warnings: Mapped[list] = mapped_column(JSON, default=list)
    source_status: Mapped[dict] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class EventFlag(Base):
    __tablename__ = "event_flags"
    id: Mapped[int] = mapped_column(primary_key=True)
    date: Mapped[date] = mapped_column(Date, index=True)
    event_type: Mapped[str] = mapped_column(String(32))
    label: Mapped[str] = mapped_column(String(128))
    severity: Mapped[int] = mapped_column(Integer, default=1)


class MarketBreadth(Base):
    __tablename__ = "market_breadth_daily"
    date: Mapped[date] = mapped_column(Date, primary_key=True)
    advances: Mapped[float | None] = mapped_column(Float, nullable=True)
    declines: Mapped[float | None] = mapped_column(Float, nullable=True)
    unchanged: Mapped[float | None] = mapped_column(Float, nullable=True)
    stocks_above_20dma: Mapped[float | None] = mapped_column(Float, nullable=True)
    stocks_above_50dma: Mapped[float | None] = mapped_column(Float, nullable=True)
    stocks_above_200dma: Mapped[float | None] = mapped_column(Float, nullable=True)
    new_highs: Mapped[float | None] = mapped_column(Float, nullable=True)
    new_lows: Mapped[float | None] = mapped_column(Float, nullable=True)
    source: Mapped[str] = mapped_column(String(48), default="manual_upload")
    available_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
