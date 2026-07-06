"""First-run and daily local bootstrap: fetch, validate, train, deploy, predict."""
from datetime import date, timedelta
from pathlib import Path
import json

from sqlalchemy import select

from .database import Base, SessionLocal, engine
from .models import ModelVersion
from .services import assembled_features, deploy_model, fetch_market_data, generate_prediction, retrain


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
        if not official_date or official_date < date.today() - timedelta(days=4):
            raise RuntimeError("Official NSE EOD data is unavailable or stale; model bootstrap stopped")

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
            "official_trading_date": str(official_date), "model_version": prediction["model_version"],
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

