from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.cron import CronTrigger

from .database import SessionLocal
from .services import fetch_market_data, generate_prediction, retrain


def _daily() -> None:
    with SessionLocal() as db:
        fetch_market_data(db)
        try:
            generate_prediction(db)
        except ValueError:
            pass


def _weekly() -> None:
    with SessionLocal() as db:
        retrain(db)


def build_scheduler() -> BackgroundScheduler:
    scheduler = BackgroundScheduler(timezone="Asia/Kolkata")
    scheduler.add_job(_daily, CronTrigger(day_of_week="mon-fri", hour=18, minute=30), id="daily_pipeline", coalesce=True, max_instances=1)
    scheduler.add_job(_weekly, CronTrigger(day_of_week="sat", hour=8), id="weekly_retrain", coalesce=True, max_instances=1)
    return scheduler

