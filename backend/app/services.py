from __future__ import annotations

from datetime import date, datetime, time, timedelta, timezone
from io import BytesIO
from pathlib import Path
from threading import Lock
from typing import Any

import numpy as np
import pandas as pd
from sqlalchemy import delete, select
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.orm import Session

from .config import get_settings
from .data_sources import NSEOfficialSource, SYMBOLS, YahooChartSource, validate_frame
from .features import build_feature_frame, classify_regime
from .ml import (edge_diagnostics, explain_linear, forecast_distribution, load_model, predict_returns,
                 signal_label, train_final, walk_forward)
from .models import (BacktestResult, DataQualityLog, FlowDaily, MarketBreadth,
                     MarketDaily, ModelVersion, OptionEOD, ParticipantOI, Prediction)

IST = timezone(timedelta(hours=5, minutes=30))
AUTO_REFRESH_LOCK = Lock()


def next_weekday(day: date) -> date:
    nxt = day + timedelta(days=1)
    while nxt.weekday() >= 5:
        nxt += timedelta(days=1)
    return nxt


def upsert_market(db: Session, frame: pd.DataFrame) -> int:
    rows = []
    for item in frame.to_dict("records"):
        rows.append({
            "symbol": item["symbol"], "date": item["date"], "open": item["open"],
            "high": item["high"], "low": item["low"], "close": item["close"],
            "prev_close": _optional(item.get("prev_close")), "volume": _optional(item.get("volume")),
            "source": item.get("source", "unknown"), "available_at": pd.Timestamp(item["available_at"]).to_pydatetime(),
        })
    if not rows:
        return 0
    dialect = db.bind.dialect.name
    if dialect == "sqlite":
        # Stay below SQLite's host-parameter limit even for decade-long series.
        for offset in range(0, len(rows), 250):
            stmt = sqlite_insert(MarketDaily).values(rows[offset:offset + 250])
            stmt = stmt.on_conflict_do_update(index_elements=["symbol", "date"], set_={
                key: getattr(stmt.excluded, key) for key in ("open", "high", "low", "close", "prev_close", "volume", "source", "available_at")
            })
            db.execute(stmt)
    else:
        for row in rows:
            existing = db.scalar(select(MarketDaily).where(MarketDaily.symbol == row["symbol"], MarketDaily.date == row["date"]))
            if existing:
                for key, value in row.items():
                    setattr(existing, key, value)
            else:
                db.add(MarketDaily(**row))
    db.commit()
    return len(rows)


def upsert_flows(db: Session, frame: pd.DataFrame) -> int:
    for row in frame.to_dict("records"):
        entity = db.get(FlowDaily, row["date"]) or FlowDaily(date=row["date"], available_at=row["available_at"])
        for col in ("fii_buy", "fii_sell", "fii_net", "dii_buy", "dii_sell", "dii_net"):
            setattr(entity, col, _optional(row[col]))
        entity.source = row.get("source", "unknown")
        entity.available_at = row["available_at"]
        db.add(entity)
    db.commit()
    return len(frame)


def upsert_participant_oi(db: Session, frame: pd.DataFrame) -> int:
    for row in frame.to_dict("records"):
        entity = db.scalar(select(ParticipantOI).where(
            ParticipantOI.date == row["date"], ParticipantOI.participant == str(row["participant"])))
        entity = entity or ParticipantOI(date=row["date"], participant=str(row["participant"]), available_at=row["available_at"])
        for col in ("index_futures_long", "index_futures_short", "index_call_long", "index_call_short", "index_put_long", "index_put_short"):
            setattr(entity, col, _optional(row[col]))
        entity.source = row.get("source", "unknown")
        entity.available_at = row["available_at"]
        db.add(entity)
    db.commit()
    return len(frame)


def upsert_options(db: Session, frame: pd.DataFrame) -> int:
    for row in frame.to_dict("records"):
        entity = db.scalar(select(OptionEOD).where(
            OptionEOD.date == row["date"], OptionEOD.expiry == row["expiry"], OptionEOD.strike == float(row["strike"])))
        entity = entity or OptionEOD(date=row["date"], expiry=row["expiry"], strike=float(row["strike"]), spot=float(row["spot"]))
        entity.spot = float(row["spot"])
        for col in ("ce_oi", "ce_change_oi", "ce_volume", "ce_iv", "ce_ltp", "pe_oi", "pe_change_oi", "pe_volume", "pe_iv", "pe_ltp"):
            setattr(entity, col, _optional(row.get(col)))
        entity.source = row.get("source", "unknown")
        db.add(entity)
    db.commit()
    return len(frame)


def _now_ist() -> datetime:
    return datetime.now(IST)


def _today_ist() -> date:
    return _now_ist().date()


def _previous_weekday(day: date) -> date:
    item = day - timedelta(days=1)
    while item.weekday() >= 5:
        item -= timedelta(days=1)
    return item


def _expected_eod_date(now: datetime | None = None) -> date:
    now = now or _now_ist()
    if now.weekday() >= 5 or now.time() < time(17, 30):
        return _previous_weekday(now.date())
    return now.date()


def fetch_market_data(db: Session, years: int = 12, cache_hours: int = 6) -> dict:
    source = YahooChartSource(cache_hours=cache_hours)
    now = _now_ist()
    end, start = now.date(), now.date() - timedelta(days=365 * years)
    statuses = []
    fetched = 0
    for label, ticker in SYMBOLS.items():
        try:
            frame = source.history(ticker, start, end)
            before_filter = len(frame)
            frame = _known_market_rows(frame, now)
            quality = validate_frame(frame, {"date", "open", "high", "low", "close"}, label)
            if len(frame) < before_filter:
                quality["warnings"].append(
                    f"ignored {before_filter - len(frame)} not-yet-final daily row(s) based on availability timestamp"
                )
            fetched += upsert_market(db, frame)
            statuses.append({**quality, "symbol": label, "source": "yahoo_chart"})
        except Exception as exc:  # source failures must be visible and non-fatal
            db.rollback()
            statuses.append({"dataset": label, "symbol": label, "status": "degraded", "rows": 0,
                             "missing_fields": [], "warnings": [str(exc)], "source": "yahoo_chart"})
    official = NSEOfficialSource()
    official_date = None
    try:
        snapshot, official_date = official.index_snapshot()
        count = upsert_market(db, snapshot)
        fetched += count
        statuses.append({"dataset": "NSE_OFFICIAL_EOD", "symbol": "NIFTY/VIX", "status": "complete", "rows": count,
                         "missing_fields": [], "warnings": [], "source": "nse_official"})
    except Exception as exc:
        db.rollback()
        statuses.append({"dataset": "NSE_OFFICIAL_EOD", "symbol": "NIFTY/VIX", "status": "degraded", "rows": 0,
                         "missing_fields": [], "warnings": [str(exc)], "source": "nse_official"})
    if official_date:
        official_fetches = [
            ("FII_DII", official.fii_dii, upsert_flows, "nse_official"),
            ("PARTICIPANT_OI", official.participant_oi, upsert_participant_oi, "nse_official_archive"),
            ("OPTIONS_EOD", official.nifty_options_eod, upsert_options, "nse_official_bhavcopy"),
        ]
        for dataset, loader, writer, provenance in official_fetches:
            try:
                frame = loader(official_date)
                count = writer(db, frame)
                fetched += count
                statuses.append({"dataset": dataset, "symbol": dataset, "status": "complete", "rows": count,
                                 "missing_fields": [], "warnings": [], "source": provenance})
            except Exception as exc:
                db.rollback()
                statuses.append({"dataset": dataset, "symbol": dataset, "status": "degraded", "rows": 0,
                                 "missing_fields": [], "warnings": [str(exc)], "source": provenance})
    today = _today_ist()
    for status in statuses:
        db.add(DataQualityLog(date=today, dataset=status["dataset"], status=status["status"],
                              missing_fields=status["missing_fields"], warnings=status["warnings"],
                              source_status={"source": status["source"], "rows": status["rows"]}))
    db.commit()
    critical = {"NIFTY", "INDIA_VIX", "NSE_OFFICIAL_EOD", "FII_DII", "PARTICIPANT_OI", "OPTIONS_EOD"}
    critical_ok = all(s["status"] != "degraded" for s in statuses if s["dataset"] in critical)
    return {"rows_processed": fetched, "sources": statuses, "official_trading_date": official_date,
            "status": "complete" if critical_ok else "partial"}


def _known_market_rows(frame: pd.DataFrame, now: datetime) -> pd.DataFrame:
    """Drop daily bars whose conservative first-known time is still in the future.

    Yahoo can expose an in-progress daily candle while the exchange session is
    open. That is useful for live charts, but not for this EOD prediction model:
    using it would convert yesterday's target into today's unfinished return.
    """
    if frame.empty or "available_at" not in frame:
        return frame
    available = pd.to_datetime(frame["available_at"], utc=True, errors="coerce")
    cutoff = now.astimezone(timezone.utc)
    return frame.loc[available <= cutoff].copy()


def market_frame(db: Session, ticker: str) -> pd.DataFrame:
    records = db.scalars(select(MarketDaily).where(MarketDaily.symbol == ticker).order_by(MarketDaily.date)).all()
    frame = pd.DataFrame([{
        "date": r.date, "open": r.open, "high": r.high, "low": r.low, "close": r.close,
        "prev_close": r.prev_close, "volume": r.volume, "symbol": r.symbol,
        "source": r.source, "available_at": r.available_at,
    } for r in records])
    return _known_market_rows(frame, _now_ist())


def flow_frame(db: Session) -> pd.DataFrame:
    records = db.scalars(select(FlowDaily).order_by(FlowDaily.date)).all()
    return pd.DataFrame([{c: getattr(r, c) for c in ("date", "fii_buy", "fii_sell", "fii_net", "dii_buy", "dii_sell", "dii_net", "source", "available_at")} for r in records])


def participant_frame(db: Session) -> pd.DataFrame:
    rows = db.scalars(select(ParticipantOI).order_by(ParticipantOI.date)).all()
    columns = ("date", "participant", "index_futures_long", "index_futures_short", "index_call_long",
               "index_call_short", "index_put_long", "index_put_short")
    return pd.DataFrame([{c: getattr(row, c) for c in columns} for row in rows])


def options_frame(db: Session) -> pd.DataFrame:
    rows = db.scalars(select(OptionEOD).order_by(OptionEOD.date, OptionEOD.expiry, OptionEOD.strike)).all()
    columns = ("date", "expiry", "strike", "spot", "ce_oi", "ce_iv", "ce_ltp", "pe_oi", "pe_iv", "pe_ltp")
    return pd.DataFrame([{c: getattr(row, c) for c in columns} for row in rows])


def breadth_frame(db: Session) -> pd.DataFrame:
    rows = db.scalars(select(MarketBreadth).order_by(MarketBreadth.date)).all()
    columns = ("date", "advances", "declines", "unchanged", "stocks_above_20dma", "stocks_above_50dma",
               "stocks_above_200dma", "new_highs", "new_lows", "source", "available_at")
    return pd.DataFrame([{c: getattr(row, c) for c in columns} for row in rows])


def assembled_features(db: Session) -> pd.DataFrame:
    nifty = market_frame(db, SYMBOLS["NIFTY"])
    if nifty.empty:
        raise ValueError("No Nifty history. Run data fetch or upload Nifty OHLC first.")
    external = {label: market_frame(db, ticker) for label, ticker in SYMBOLS.items() if label not in {"NIFTY", "INDIA_VIX"}}
    return build_feature_frame(nifty, market_frame(db, SYMBOLS["INDIA_VIX"]), flow_frame(db), external,
                               participant_frame(db), options_frame(db), breadth_frame(db))


def auto_refresh(db: Session, force: bool = False) -> dict:
    settings = get_settings()
    if not settings.auto_refresh_enabled and not force:
        return {"status": "disabled", "message": "Automatic refresh is disabled on this server."}
    if not AUTO_REFRESH_LOCK.acquire(blocking=force):
        return {
            "status": "refreshing",
            "message": "A market-data refresh is already running; showing the latest saved dashboard state.",
        }
    try:
        return _auto_refresh_locked(db, force)
    finally:
        AUTO_REFRESH_LOCK.release()


def _auto_refresh_locked(db: Session, force: bool = False) -> dict:
    settings = get_settings()
    now = _now_ist()
    target_date = _expected_eod_date(now)
    before_market_date = _latest_market_date(db)
    before_prediction = _latest_prediction_row(db)
    deployed = _deployed_model(db)
    if not force and _is_prediction_current(before_market_date, before_prediction, target_date):
        return _refresh_payload("fresh", target_date, before_market_date, before_prediction, deployed,
                                message="Already current for the latest completed EOD window.")

    local_prediction_stale = bool(before_market_date and (not before_prediction or before_prediction.date < before_market_date))
    if not force and not local_prediction_stale and _recent_refresh_attempt(db, minutes=settings.auto_refresh_min_minutes):
        return _refresh_payload("throttled", target_date, before_market_date, before_prediction, deployed,
                                message=f"Refresh was attempted recently; waiting {settings.auto_refresh_min_minutes} minutes before retrying sources.")

    result: dict[str, Any] = {"actions": []}
    fetched = fetch_market_data(db, years=3 if before_market_date else 12, cache_hours=1)
    result["actions"].append("fetch")
    result["fetch"] = fetched

    after_market_date = _latest_market_date(db)
    deployed = _deployed_model(db)
    latest_trainable = _latest_trainable_date(db)
    artifact_exists = _artifact_available(deployed)
    prediction: dict | None = None

    if not deployed or not artifact_exists:
        trained = retrain(db)
        result["actions"].append("retrain")
        result["trained"] = {"model_version": trained["model_version"], "status": trained["status"]}
        if trained["status"] == "eligible":
            deployed_result = deploy_model(db, trained["model_version"])
            result["actions"].append("deploy")
            prediction = deployed_result["prediction"]
        else:
            raise ValueError("No deployable model is available after automatic retraining.")
    elif settings.auto_retrain_on_refresh and latest_trainable and deployed.training_end < latest_trainable:
        trained = retrain(db)
        result["actions"].append("retrain")
        result["trained"] = {"model_version": trained["model_version"], "status": trained["status"]}
        if trained["status"] == "eligible":
            deployed_result = deploy_model(db, trained["model_version"])
            result["actions"].append("deploy")
            prediction = deployed_result["prediction"]
        else:
            prediction = generate_prediction(db, deployed)
            result["actions"].append("predict_existing_model")
    elif not before_prediction or (after_market_date and before_prediction.date < after_market_date):
        prediction = generate_prediction(db, deployed)
        result["actions"].append("predict")

    after_prediction = _latest_prediction_row(db)
    status = "updated" if result["actions"] else "checked"
    return {**_refresh_payload(status, target_date, after_market_date, after_prediction, _deployed_model(db)),
            **result, "prediction": prediction or (serialize_prediction(after_prediction) if after_prediction else None)}


def _latest_market_date(db: Session) -> date | None:
    frame = market_frame(db, SYMBOLS["NIFTY"])
    if frame.empty:
        return None
    value = frame.date.iloc[-1]
    return value.date() if hasattr(value, "date") else value


def _latest_prediction_row(db: Session) -> Prediction | None:
    return db.scalar(select(Prediction).order_by(Prediction.created_at.desc()))


def _deployed_model(db: Session) -> ModelVersion | None:
    return db.scalar(select(ModelVersion).where(ModelVersion.status == "deployed").order_by(ModelVersion.created_at.desc()))


def _latest_trainable_date(db: Session) -> date | None:
    frame = assembled_features(db)
    trainable = frame.dropna(subset=["target_next_day_up"])
    if trainable.empty:
        return None
    value = trainable.date.iloc[-1]
    return value.date() if hasattr(value, "date") else value


def _artifact_available(model: ModelVersion | None) -> bool:
    if not model:
        return False
    try:
        load_model(model.artifact_path)
        return True
    except FileNotFoundError:
        return False


def _is_prediction_current(market_date: date | None, prediction: Prediction | None, target_date: date) -> bool:
    return bool(market_date and prediction and prediction.date >= market_date and market_date >= target_date)


def _recent_refresh_attempt(db: Session, minutes: int) -> bool:
    latest = db.scalar(select(DataQualityLog.created_at).order_by(DataQualityLog.created_at.desc()))
    if not latest:
        return False
    if latest.tzinfo is None:
        latest = latest.replace(tzinfo=timezone.utc)
    return datetime.now(timezone.utc) - latest.astimezone(timezone.utc) < timedelta(minutes=minutes)


def _refresh_payload(status: str, target_date: date, market_date: date | None, prediction: Prediction | None,
                     model: ModelVersion | None, message: str | None = None) -> dict:
    return {
        "status": status,
        "message": message,
        "target_eod_date": target_date.isoformat(),
        "latest_market_date": market_date.isoformat() if market_date else None,
        "latest_prediction_date": prediction.date.isoformat() if prediction else None,
        "model_version": model.version if model else None,
    }


def retrain(db: Session) -> dict:
    settings = get_settings()
    frame = assembled_features(db)
    result = walk_forward(frame)
    version, artifact, meta = train_final(frame, settings.model_artifact_dir)
    clean = frame.dropna(subset=["target_next_day_up"])
    majority = max(clean.target_next_day_up.mean(), 1 - clean.target_next_day_up.mean())
    gates = {
        "beats_majority_baseline": bool(result.metrics["accuracy"] > majority),
        "acceptable_brier": bool(result.metrics["brier_score"] < 0.25),
        "minimum_backtest_samples": bool(result.metrics["samples"] >= 252),
    }
    status = "eligible" if all(gates.values()) else "candidate"
    metrics = {**result.metrics, "majority_baseline_accuracy": float(majority), "deployment_gates": gates}
    db.add(ModelVersion(version=version, algorithm=meta["algorithm"], training_start=clean.date.iloc[0],
                        training_end=clean.date.iloc[-1], feature_set_version="v1", calibration_method="platt_sigmoid",
                        hyperparameters={"classifier_C": 0.25, "ridge_alpha": 5.0, "hgb_max_iter": 180,
                                         "hgb_learning_rate": 0.04, "hgb_max_leaf_nodes": 15,
                                         "return_bias": meta.get("return_bias", 0.0),
                                         "residual_quantiles": meta.get("residual_quantiles", {})}, metrics=metrics,
                        artifact_path=meta["artifact_path"], status=status))
    equity = _equity_curve(result.predictions)
    db.add(BacktestResult(model_version=version, start_date=result.predictions.date.iloc[0],
                          end_date=result.predictions.date.iloc[-1], metrics=metrics, equity_curve=equity,
                          calibration=result.calibration, threshold_analysis=result.threshold_analysis))
    db.commit()
    return {"model_version": version, "status": status, "metrics": metrics,
            "calibration": result.calibration, "threshold_analysis": result.threshold_analysis}


def deploy_model(db: Session, version: str, force: bool = False) -> dict:
    model = db.get(ModelVersion, version)
    if not model:
        raise ValueError("Unknown model version")
    gates = model.metrics.get("deployment_gates", {})
    if not force and not all(gates.values()):
        raise ValueError(f"Model failed deployment gates: {gates}")
    for deployed in db.scalars(select(ModelVersion).where(ModelVersion.status == "deployed")):
        deployed.status = "retired"
    model.status = "deployed"
    db.commit()
    prediction = generate_prediction(db, model)
    return {"model_version": version, "status": "deployed", "prediction": prediction}


def generate_prediction(db: Session, model: ModelVersion | None = None) -> dict:
    model = model or db.scalar(select(ModelVersion).where(ModelVersion.status == "deployed").order_by(ModelVersion.created_at.desc()))
    if not model:
        raise ValueError("No deployed model. Retrain and deploy a model first.")
    artifact = load_model(model.artifact_path)
    frame = assembled_features(db)
    latest = frame.iloc[[-1]].copy()
    cols = artifact["features"]
    probability = float(artifact["classifier"].predict_proba(latest[cols])[:, 1][0])
    expected_return = float(predict_returns(artifact, latest)[0])
    close = float(latest.close.iloc[0])
    vix = _optional(latest.get("vix_close", pd.Series([np.nan])).iloc[0])
    hist_move = float(latest.get("realized_vol_20d", pd.Series([0.16])).iloc[0] / np.sqrt(252))
    vix_move = (vix / 100 / np.sqrt(365)) if vix else hist_move
    implied_move = max(abs(expected_return) + model.metrics.get("mae_return", 0.006), (hist_move + vix_move) / 2)
    completeness = float(latest[cols].notna().mean(axis=1).iloc[0])
    quality = "Complete" if completeness >= 0.9 else "Partial" if completeness >= 0.75 else "Degraded" if completeness >= 0.55 else "Unsafe"
    bullish, bearish = explain_linear(artifact, latest)
    prediction_date = latest.date.iloc[0]
    entity = Prediction(date=prediction_date, next_trading_day=next_weekday(prediction_date), model_version=model.version,
                        nifty_close=close, india_vix=vix, probability_up=probability, probability_down=1 - probability,
                        expected_return=expected_return, expected_upper_range=close * (1 + implied_move),
                        expected_lower_range=close * (1 - implied_move), signal=signal_label(probability, expected_return),
                        regime=classify_regime(latest.iloc[0]), confidence=_confidence(probability, completeness),
                        data_quality=quality, completeness=completeness, bullish_factors=bullish, bearish_factors=bearish)
    db.add(entity)
    db.commit()
    db.refresh(entity)
    return serialize_prediction(entity, model.metrics, artifact)


def parse_upload(dataset: str, content: bytes, db: Session) -> dict:
    frame = pd.read_csv(BytesIO(content))
    frame.columns = [c.strip().lower().replace(" ", "_").replace("%", "pct") for c in frame.columns]
    aliases = {"timestamp": "date", "datetime": "date", "ltp": "close", "adj_close": "close",
               "fii_net_value": "fii_net", "dii_net_value": "dii_net"}
    frame = frame.rename(columns={c: aliases[c] for c in frame.columns if c in aliases})
    if "date" not in frame:
        raise ValueError("CSV requires a date column")
    frame["date"] = pd.to_datetime(frame.date, dayfirst=False, errors="raise").dt.date
    if dataset in {"nifty", "india_vix", "global", "macro"}:
        required = {"date", "open", "high", "low", "close"}
        missing = required - set(frame.columns)
        if missing:
            raise ValueError(f"Missing columns: {sorted(missing)}")
        symbol = SYMBOLS["NIFTY"] if dataset == "nifty" else SYMBOLS["INDIA_VIX"] if dataset == "india_vix" else None
        if not symbol and "symbol" not in frame:
            raise ValueError("Global/macro CSV requires a symbol column")
        if symbol:
            frame["symbol"] = symbol
        frame["source"] = "manual_upload"
        frame["available_at"] = pd.to_datetime(frame.date.astype(str) + " 16:00:00+05:30", utc=True)
        frame["prev_close"] = frame.get("prev_close", frame.groupby("symbol").close.shift(1))
        count = upsert_market(db, frame)
    elif dataset == "fii_dii":
        required = {"date", "fii_buy", "fii_sell", "fii_net", "dii_buy", "dii_sell", "dii_net"}
        missing = required - set(frame.columns)
        if missing:
            raise ValueError(f"Missing columns: {sorted(missing)}")
        count = 0
        for row in frame.to_dict("records"):
            entity = db.get(FlowDaily, row["date"]) or FlowDaily(date=row["date"], available_at=datetime.combine(row["date"], time(18), IST))
            for col in required - {"date"}:
                setattr(entity, col, _optional(row[col]))
            entity.source = "manual_upload"
            db.add(entity); count += 1
        db.commit()
    elif dataset == "participant_oi":
        required = {"date", "participant", "index_futures_long", "index_futures_short", "index_call_long",
                    "index_call_short", "index_put_long", "index_put_short"}
        missing = required - set(frame.columns)
        if missing:
            raise ValueError(f"Missing columns: {sorted(missing)}")
        count = 0
        for row in frame.to_dict("records"):
            entity = db.scalar(select(ParticipantOI).where(ParticipantOI.date == row["date"], ParticipantOI.participant == str(row["participant"])))
            entity = entity or ParticipantOI(date=row["date"], participant=str(row["participant"]), available_at=datetime.combine(row["date"], time(18), IST))
            for col in required - {"date", "participant"}:
                setattr(entity, col, _optional(row[col]))
            entity.source = "manual_upload"; db.add(entity); count += 1
        db.commit()
    elif dataset == "options":
        required = {"date", "expiry", "strike", "spot", "ce_oi", "ce_change_oi", "ce_volume", "ce_iv", "ce_ltp",
                    "pe_oi", "pe_change_oi", "pe_volume", "pe_iv", "pe_ltp"}
        missing = required - set(frame.columns)
        if missing:
            raise ValueError(f"Missing columns: {sorted(missing)}")
        frame["expiry"] = pd.to_datetime(frame.expiry, errors="raise").dt.date
        count = 0
        for row in frame.to_dict("records"):
            entity = db.scalar(select(OptionEOD).where(OptionEOD.date == row["date"], OptionEOD.expiry == row["expiry"], OptionEOD.strike == row["strike"]))
            entity = entity or OptionEOD(date=row["date"], expiry=row["expiry"], strike=float(row["strike"]), spot=float(row["spot"]))
            for col in required - {"date", "expiry", "strike", "spot"}:
                setattr(entity, col, _optional(row[col]))
            entity.source = "manual_upload"; db.add(entity); count += 1
        db.commit()
    elif dataset == "breadth":
        required = {"date", "advances", "declines", "unchanged"}
        optional = {"stocks_above_20dma", "stocks_above_50dma", "stocks_above_200dma", "new_highs", "new_lows"}
        missing = required - set(frame.columns)
        if missing:
            raise ValueError(f"Missing columns: {sorted(missing)}")
        count = 0
        for row in frame.to_dict("records"):
            entity = db.get(MarketBreadth, row["date"]) or MarketBreadth(date=row["date"], available_at=datetime.combine(row["date"], time(18), IST))
            for col in (required - {"date"}) | (optional & set(frame.columns)):
                setattr(entity, col, _optional(row[col]))
            entity.source = "manual_upload"; db.add(entity); count += 1
        db.commit()
    else:
        raise ValueError(f"Unsupported upload type: {dataset}")
    return {"dataset": dataset, "rows": count, "columns": list(frame.columns), "preview": frame.head(5).replace({np.nan: None}).to_dict("records")}


def serialize_prediction(row: Prediction, metrics: dict | None = None, artifact: dict | None = None) -> dict:
    close = float(row.nifty_close or 0)
    range_sigma = abs(float(row.expected_upper_range or 0) - float(row.expected_lower_range or 0)) / (2 * close) if close else 0.006
    decision = edge_diagnostics(row.probability_up, row.expected_return, metrics, row.completeness, row.data_quality)
    distribution = forecast_distribution(row.expected_return, range_sigma, metrics,
                                         (artifact or {}).get("residual_quantiles", {}))
    return {"date": row.date.isoformat(), "next_trading_day": row.next_trading_day.isoformat(),
            "nifty_close": row.nifty_close, "india_vix": row.india_vix,
            "probability_up": row.probability_up, "probability_down": row.probability_down,
            "expected_return": row.expected_return, "expected_upper_range": row.expected_upper_range,
            "expected_lower_range": row.expected_lower_range, "signal": row.signal, "regime": row.regime,
            "confidence": row.confidence, "data_quality": row.data_quality, "data_completeness": row.completeness,
            "top_bullish_factors": row.bullish_factors, "top_bearish_factors": row.bearish_factors,
            "model_version": row.model_version, "last_updated": row.created_at.isoformat(),
            "decision": decision, "forecast_distribution": distribution,
            "prediction_quality": decision["edge_label"], "trade_action": decision["trade_action"],
            "signal_strength": decision["signal_strength"], "recent_error": decision["recent_error"],
            "position_size": decision["position_size"]}


def _equity_curve(pred: pd.DataFrame) -> list[dict]:
    direction = np.where(pred.probability_up >= 0.55, 1, np.where(pred.probability_up <= 0.45, -1, 0))
    returns = direction * pred.target_next_day_return - (direction != 0) * 0.0003
    equity = (1 + returns).cumprod()
    return [{"date": str(day), "equity": float(value), "drawdown": float(value / equity.cummax().iloc[i] - 1)}
            for i, (day, value) in enumerate(zip(pred.date, equity))]


def _confidence(probability: float, completeness: float) -> str:
    edge = abs(probability - 0.5)
    if completeness < 0.75:
        return "Low"
    return "High" if edge >= 0.15 and completeness >= 0.9 else "Medium" if edge >= 0.075 else "Low"


def _optional(value: Any):
    return None if value is None or pd.isna(value) else float(value)
