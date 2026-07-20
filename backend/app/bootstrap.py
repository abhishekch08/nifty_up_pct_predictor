"""First-run and daily local bootstrap: fetch, validate, train, deploy, predict."""
from datetime import date, datetime, time, timedelta, timezone
from pathlib import Path
import json

from sqlalchemy import select

from .database import Base, SessionLocal, engine
from .data_sources import SYMBOLS
from .models import ModelVersion
from .services import assembled_features, deploy_model, fetch_market_data, generate_prediction, market_frame, retrain

IST = timezone(timedelta(hours=5, minutes=30))


def _expected_eod_date(now: datetime) -> date:
    if now.weekday() >= 5 or now.time() < time(17, 30):
        day = now.date() - timedelta(days=1)
        while day.weekday() >= 5:
            day -= timedelta(days=1)
        return day
    return now.date()


def _fresh_enough(actual: date | None, target: date) -> bool:
    return bool(actual and actual >= target - timedelta(days=4))


def _latest_market_date(db) -> date | None:
    frame = market_frame(db, SYMBOLS["NIFTY"])
    if frame.empty:
        return None
    value = frame.date.iloc[-1]
    return value.date() if hasattr(value, "date") else value


def main() -> None:
    Base.metadata.create_all(engine)
    with SessionLocal() as db:
        print("[1/3] Fetching 12-year history and official NSE EOD overlays...", flush=True)
        fetched = fetch_market_data(db)
        for source in fetched["sources"]:
            marker = "OK" if source["status"] != "degraded" else "FAILED"
            print(f"  {marker:6} {source['dataset']:<20} {source['rows']:>6} rows", flush=True)
            for warning in source.get("warnings", []):
                print(f"         {warning}", flush=True)

        official_date = fetched.get("official_trading_date")
        target_eod_date = _expected_eod_date(datetime.now(IST))
        latest_market_date = _latest_market_date(db)
        if not _fresh_enough(official_date, target_eod_date):
            print(
                "  WARN   Official NSE index EOD is unavailable/stale; continuing with the latest completed "
                f"market row {latest_market_date} and degraded data quality.",
                flush=True,
            )
            if not _fresh_enough(latest_market_date, target_eod_date):
                raise RuntimeError(
                    "No fresh completed Nifty EOD row is available; model bootstrap stopped before starting dashboard"
                )

        print("[2/3] Validating aligned features...", flush=True)
        features = assembled_features(db)
        if len(features) < 1000:
            raise RuntimeError(f"Only {len(features)} Nifty rows are available; at least 1,000 are required")
        latest_trainable = features.dropna(subset=["target_next_day_up"]).date.iloc[-1]
        deployed = db.scalar(select(ModelVersion).where(ModelVersion.status == "deployed").order_by(ModelVersion.created_at.desc()))
        artifact_exists = bool(deployed and Path(deployed.artifact_path).exists())
        needs_training = not deployed or not artifact_exists or deployed.training_end < latest_trainable

        if needs_training:
            print(f"[3/3] Training through {latest_trainable} with expanding walk-forward validation...", flush=True)
            trained = retrain(db)
            gates = trained["metrics"]["deployment_gates"]
            print(f"  Model {trained['model_version']} — {trained['status']} — gates {gates}", flush=True)
            if trained["status"] == "eligible":
                result = deploy_model(db, trained["model_version"])
            elif deployed and artifact_exists:
                result = {"prediction": generate_prediction(db, deployed)}
            else:
                raise RuntimeError(f"First model did not pass deployment gates: {gates}")
        else:
            print(f"[3/3] Model {deployed.version} is current; generating a fresh prediction...", flush=True)
            result = {"prediction": generate_prediction(db, deployed)}

        prediction = result["prediction"]
        print("READY " + json.dumps({
            "official_trading_date": str(official_date), "market_trading_date": str(latest_market_date),
            "model_version": prediction["model_version"],
            "prediction_date": prediction["date"], "next_trading_day": prediction["next_trading_day"],
            "probability_up": prediction["probability_up"], "data_quality": prediction["data_quality"],
            "data_completeness": prediction["data_completeness"],
        }), flush=True)


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(f"BOOTSTRAP FAILED: {exc}", flush=True)
        raise SystemExit(1) from exc
