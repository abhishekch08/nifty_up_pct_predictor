from datetime import date
import secrets

from fastapi import APIRouter, Depends, File, Header, HTTPException, Query, UploadFile
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from .config import get_settings
from .database import get_db
from .data_sources import SYMBOLS
from .models import (BacktestResult, DataQualityLog, EventFlag, FlowDaily,
                     MarketDaily, ModelVersion, ParticipantOI, Prediction)
from .ml import load_model, predict_returns
from .services import (assembled_features, auto_refresh, deploy_model, fetch_market_data,
                       generate_prediction, parse_upload, retrain,
                       serialize_prediction)
from .strategy import strategy_history, strategy_report

router = APIRouter(prefix="/api")


def admin_guard(x_admin_key: str | None = Header(default=None)) -> None:
    if not x_admin_key or not secrets.compare_digest(x_admin_key, get_settings().admin_api_key):
        raise HTTPException(401, "Invalid admin API key")


class DeployRequest(BaseModel):
    model_version: str
    force: bool = False


class EventRequest(BaseModel):
    date: date
    event_type: str = Field(pattern="^(budget|rbi|fed|election|special)$")
    label: str
    severity: int = Field(default=1, ge=1, le=3)


@router.get("/health")
def health() -> dict:
    return {"status": "ok", "service": "nifty-probability-terminal", "environment": get_settings().app_env}


@router.post("/auto-refresh")
def auto_refresh_endpoint(force: bool = Query(default=False), db: Session = Depends(get_db)) -> dict:
    try:
        return auto_refresh(db, force=force)
    except Exception as exc:
        return {"status": "error", "message": str(exc)}


@router.get("/latest-prediction")
def latest_prediction(db: Session = Depends(get_db)) -> dict:
    row = db.scalar(select(Prediction).order_by(Prediction.created_at.desc()))
    if not row:
        raise HTTPException(404, "No prediction available. Fetch data, retrain, and deploy a model.")
    return serialize_prediction(row)


@router.get("/predictions/history")
def prediction_history(limit: int = Query(default=90, ge=1, le=1000), db: Session = Depends(get_db)) -> list[dict]:
    rows = db.scalars(select(Prediction).order_by(Prediction.date.desc()).limit(limit)).all()
    return [serialize_prediction(row) for row in rows]


@router.get("/data-status")
def data_status(db: Session = Depends(get_db)) -> dict:
    logs = db.scalars(select(DataQualityLog).order_by(DataQualityLog.created_at.desc()).limit(50)).all()
    items = [{"date": r.date, "dataset": r.dataset, "status": r.status, "missing_fields": r.missing_fields,
              "warnings": r.warnings, "source_status": r.source_status, "created_at": r.created_at} for r in logs]
    overall = "complete" if items and all(x["status"] == "complete" for x in items[:11]) else "partial" if items else "unsafe"
    return {"overall": overall, "datasets": items}


@router.get("/fii-dii/latest")
def fii_dii_latest(db: Session = Depends(get_db)) -> dict:
    row = db.scalar(select(FlowDaily).order_by(FlowDaily.date.desc()))
    if not row:
        raise HTTPException(404, "No FII/DII data available")
    return {c: getattr(row, c) for c in ("date", "fii_buy", "fii_sell", "fii_net", "dii_buy", "dii_sell", "dii_net", "source")}


@router.get("/fii-dii/history")
def fii_dii_history(limit: int = Query(default=90, ge=1, le=1000), db: Session = Depends(get_db)) -> list[dict]:
    rows = db.scalars(select(FlowDaily).order_by(FlowDaily.date.desc()).limit(limit)).all()
    return [{c: getattr(r, c) for c in ("date", "fii_buy", "fii_sell", "fii_net", "dii_buy", "dii_sell", "dii_net", "source")} for r in rows]


@router.get("/fno/latest")
def fno_latest(db: Session = Depends(get_db)) -> list[dict]:
    latest = db.scalar(select(ParticipantOI.date).order_by(ParticipantOI.date.desc()))
    if not latest:
        return []
    rows = db.scalars(select(ParticipantOI).where(ParticipantOI.date == latest)).all()
    return [{"date": r.date, "participant": r.participant,
             "index_futures_net": (r.index_futures_long or 0) - (r.index_futures_short or 0),
             "index_futures_long": r.index_futures_long, "index_futures_short": r.index_futures_short} for r in rows]


@router.get("/options/latest")
def options_latest(db: Session = Depends(get_db)) -> dict:
    # Aggregation endpoint intentionally returns an explicit empty state until official EOD or manual data is present.
    from .models import OptionEOD
    latest = db.scalar(select(OptionEOD.date).order_by(OptionEOD.date.desc()))
    if not latest:
        return {"status": "unavailable", "warning": "No options EOD data; use manual CSV fallback."}
    rows = db.scalars(select(OptionEOD).where(OptionEOD.date == latest)).all()
    calls = sum(r.ce_oi or 0 for r in rows); puts = sum(r.pe_oi or 0 for r in rows)
    call_wall = max(rows, key=lambda r: r.ce_oi or 0).strike; put_wall = max(rows, key=lambda r: r.pe_oi or 0).strike
    return {"date": latest, "spot": rows[0].spot, "total_call_oi": calls, "total_put_oi": puts,
            "pcr_oi": puts / calls if calls else None, "call_wall": call_wall, "put_wall": put_wall}


@router.get("/strategy/tomorrow")
def strategy_tomorrow(expiry: date | None = Query(default=None), db: Session = Depends(get_db)) -> dict:
    return strategy_report(db, expiry)


@router.get("/strategy/history")
def strategy_history_endpoint(limit: int = Query(default=14, ge=1, le=250), db: Session = Depends(get_db)) -> list[dict]:
    return strategy_history(db, limit)


@router.get("/backtest/latest")
def backtest_latest(db: Session = Depends(get_db)) -> dict:
    row = db.scalar(select(BacktestResult).order_by(BacktestResult.id.desc()))
    if not row:
        raise HTTPException(404, "No backtest available")
    return _backtest_dict(row, db)


@router.get("/backtest/model/{model_version}")
def backtest_model(model_version: str, db: Session = Depends(get_db)) -> dict:
    row = db.scalar(select(BacktestResult).where(BacktestResult.model_version == model_version).order_by(BacktestResult.id.desc()))
    if not row:
        raise HTTPException(404, "Backtest not found")
    return _backtest_dict(row, db)


@router.get("/calibration/latest")
def calibration_latest(db: Session = Depends(get_db)) -> dict:
    row = db.scalar(select(BacktestResult).order_by(BacktestResult.id.desc()))
    if not row:
        raise HTTPException(404, "No calibration report available")
    warning = "Calibration needs review" if row.metrics.get("brier_score", 1) >= 0.25 else None
    return {"model_version": row.model_version, "brier_score": row.metrics.get("brier_score"),
            "log_loss": row.metrics.get("log_loss"), "buckets": row.calibration, "warning": warning}


@router.get("/calibration/recent")
def calibration_recent(limit: int = Query(default=7, ge=1, le=30), db: Session = Depends(get_db)) -> list[dict]:
    limit_value = int(limit) if isinstance(limit, int) else 7
    rows = db.scalars(select(Prediction).order_by(Prediction.date.desc(), Prediction.created_at.desc()).limit(limit_value * 8)).all()
    live_by_date: dict[date, Prediction] = {}
    for row in rows:
        if row.date in live_by_date:
            continue
        next_close = db.scalar(select(MarketDaily.close).where(
            MarketDaily.symbol == SYMBOLS["NIFTY"], MarketDaily.date == row.next_trading_day))
        if next_close is None:
            continue
        live_by_date[row.date] = row

    output: list[dict] = []
    try:
        model = db.scalar(select(ModelVersion).where(ModelVersion.status == "deployed").order_by(ModelVersion.created_at.desc()))
        if not model:
            raise ValueError("No deployed model")
        artifact = load_model(model.artifact_path)
        frame = assembled_features(db).sort_values("date").copy()
        frame["next_trading_day"] = frame["date"].shift(-1)
        clean = frame.dropna(subset=["target_next_day_return", "next_trading_day"]).tail(limit_value)
        expected_returns = predict_returns(artifact, clean) if len(clean) else []
        for (_, item), expected_return in zip(clean.iterrows(), expected_returns):
            day = item["date"]
            if hasattr(day, "date"):
                day = day.date()
            next_day = item["next_trading_day"]
            if hasattr(next_day, "date"):
                next_day = next_day.date()
            live = live_by_date.get(day)
            predicted_return = live.expected_return if live else float(expected_return)
            nifty_close = live.nifty_close if live else float(item["close"])
            actual_return = float(item["target_next_day_return"])
            output.append({
                "date": day.isoformat(),
                "next_trading_day": next_day.isoformat(),
                "predicted_return": predicted_return,
                "actual_return": actual_return,
                "predicted_percent": predicted_return * 100,
                "actual_percent": actual_return * 100,
                "nifty_close": nifty_close,
                "next_close": nifty_close * (1 + actual_return),
            })
    except Exception:
        for row in live_by_date.values():
            next_close = db.scalar(select(MarketDaily.close).where(
                MarketDaily.symbol == SYMBOLS["NIFTY"], MarketDaily.date == row.next_trading_day))
            if next_close is None:
                continue
            actual_return = float(next_close) / float(row.nifty_close) - 1
            output.append({
                "date": row.date.isoformat(),
                "next_trading_day": row.next_trading_day.isoformat(),
                "predicted_return": row.expected_return,
                "actual_return": actual_return,
                "predicted_percent": row.expected_return * 100,
                "actual_percent": actual_return * 100,
                "nifty_close": row.nifty_close,
                "next_close": float(next_close),
            })
    return output[-limit_value:]


@router.get("/models")
def models(db: Session = Depends(get_db)) -> list[dict]:
    rows = db.scalars(select(ModelVersion).order_by(ModelVersion.created_at.desc())).all()
    return [{"version": r.version, "algorithm": r.algorithm, "training_start": r.training_start,
             "training_end": r.training_end, "calibration_method": r.calibration_method,
             "metrics": r.metrics, "status": r.status, "created_at": r.created_at} for r in rows]


@router.post("/admin/fetch-data", dependencies=[Depends(admin_guard)])
def admin_fetch(db: Session = Depends(get_db)) -> dict:
    return fetch_market_data(db)


@router.post("/admin/retrain-model", dependencies=[Depends(admin_guard)])
def admin_retrain(db: Session = Depends(get_db)) -> dict:
    try:
        return retrain(db)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc


@router.post("/admin/deploy-model", dependencies=[Depends(admin_guard)])
def admin_deploy(payload: DeployRequest, db: Session = Depends(get_db)) -> dict:
    try:
        return deploy_model(db, payload.model_version, payload.force)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc


@router.post("/admin/run-prediction", dependencies=[Depends(admin_guard)])
def admin_predict(db: Session = Depends(get_db)) -> dict:
    try:
        return generate_prediction(db)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc


@router.post("/admin/upload-csv", dependencies=[Depends(admin_guard)])
async def upload_csv(dataset: str, file: UploadFile = File(...), db: Session = Depends(get_db)) -> dict:
    if not file.filename or not file.filename.lower().endswith(".csv"):
        raise HTTPException(415, "Upload must be a CSV file")
    try:
        return parse_upload(dataset, await file.read(), db)
    except (ValueError, UnicodeDecodeError) as exc:
        raise HTTPException(422, str(exc)) from exc


@router.post("/admin/add-event-flag", dependencies=[Depends(admin_guard)])
def add_event(payload: EventRequest, db: Session = Depends(get_db)) -> dict:
    row = EventFlag(**payload.model_dump())
    db.add(row); db.commit(); db.refresh(row)
    return {"id": row.id, **payload.model_dump()}


def _backtest_dict(row: BacktestResult, db: Session) -> dict:
    return {"model_version": row.model_version, "start_date": row.start_date, "end_date": row.end_date,
            "metrics": row.metrics, "equity_curve": row.equity_curve, "calibration": row.calibration,
            "threshold_analysis": row.threshold_analysis, "price_curve": _price_curve(row, db)}


def _price_curve(row: BacktestResult, db: Session) -> list[dict]:
    if not row.equity_curve:
        return []
    dates = [date.fromisoformat(item.get("date")) for item in row.equity_curve if item.get("date")]
    market_rows = db.scalars(select(MarketDaily).where(
        MarketDaily.symbol == SYMBOLS["NIFTY"], MarketDaily.date.in_(dates))).all()
    closes = {r.date.isoformat(): r.close for r in market_rows}
    entries = []
    for item in row.equity_curve:
        day = item.get("date")
        close = closes.get(day)
        equity = item.get("equity")
        if close is not None and equity is not None:
            entries.append({"date": day, "close": float(close), "equity": float(equity)})
    if not entries:
        return []
    first_equity = entries[0]["equity"] or 1
    first_close = entries[0]["close"]
    last_equity_norm = entries[-1]["equity"] / first_equity - 1
    price_span = entries[-1]["close"] - first_close
    scale = price_span / last_equity_norm if abs(last_equity_norm) > 1e-9 else 0
    output = []
    for item in entries:
        model_norm = first_close + (item["equity"] / first_equity - 1) * scale
        output.append({"date": item["date"], "nifty_close": item["close"],
                       "model_strategy_close": model_norm})
    return output
