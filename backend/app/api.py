from datetime import date
import secrets

from fastapi import APIRouter, Depends, File, Header, HTTPException, Query, UploadFile
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from .config import get_settings
from .database import get_db
from .models import (BacktestResult, DataQualityLog, EventFlag, FlowDaily,
                     ModelVersion, ParticipantOI, Prediction)
from .services import (deploy_model, fetch_market_data, generate_prediction,
                       parse_upload, retrain, serialize_prediction)

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


@router.get("/backtest/latest")
def backtest_latest(db: Session = Depends(get_db)) -> dict:
    row = db.scalar(select(BacktestResult).order_by(BacktestResult.id.desc()))
    if not row:
        raise HTTPException(404, "No backtest available")
    return _backtest_dict(row)


@router.get("/backtest/model/{model_version}")
def backtest_model(model_version: str, db: Session = Depends(get_db)) -> dict:
    row = db.scalar(select(BacktestResult).where(BacktestResult.model_version == model_version).order_by(BacktestResult.id.desc()))
    if not row:
        raise HTTPException(404, "Backtest not found")
    return _backtest_dict(row)


@router.get("/calibration/latest")
def calibration_latest(db: Session = Depends(get_db)) -> dict:
    row = db.scalar(select(BacktestResult).order_by(BacktestResult.id.desc()))
    if not row:
        raise HTTPException(404, "No calibration report available")
    warning = "Calibration needs review" if row.metrics.get("brier_score", 1) >= 0.25 else None
    return {"model_version": row.model_version, "brier_score": row.metrics.get("brier_score"),
            "log_loss": row.metrics.get("log_loss"), "buckets": row.calibration, "warning": warning}


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


def _backtest_dict(row: BacktestResult) -> dict:
    return {"model_version": row.model_version, "start_date": row.start_date, "end_date": row.end_date,
            "metrics": row.metrics, "equity_curve": row.equity_curve, "calibration": row.calibration,
            "threshold_analysis": row.threshold_analysis}

