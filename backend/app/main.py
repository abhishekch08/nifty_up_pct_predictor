from contextlib import asynccontextmanager
from pathlib import Path
from threading import Thread

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from .api import router
from .config import get_settings
from .database import Base, SessionLocal, engine
from .scheduler import build_scheduler
from .services import auto_refresh

settings = get_settings()
scheduler = None


def _startup_refresh() -> None:
    with SessionLocal() as db:
        try:
            result = auto_refresh(db)
            print(f"STARTUP AUTO-REFRESH {result.get('status')} target={result.get('target_eod_date')} "
                  f"market={result.get('latest_market_date')} prediction={result.get('latest_prediction_date')}",
                  flush=True)
        except Exception as exc:
            print(f"STARTUP AUTO-REFRESH FAILED: {exc}", flush=True)


@asynccontextmanager
async def lifespan(_: FastAPI):
    global scheduler
    Base.metadata.create_all(engine)
    if settings.auto_refresh_enabled:
        Thread(target=_startup_refresh, daemon=True).start()
    if settings.scheduler_enabled:
        scheduler = build_scheduler(); scheduler.start()
    yield
    if scheduler:
        scheduler.shutdown(wait=False)


app = FastAPI(title=settings.app_name, version="1.0.0", lifespan=lifespan,
              description="Leakage-safe, calibrated next-session Nifty 50 probability service.")
app.add_middleware(CORSMiddleware, allow_origins=settings.cors_list, allow_credentials=True,
                   allow_methods=["*"], allow_headers=["*"])
app.include_router(router)

static_dir = Path(__file__).resolve().parent / "static"
if static_dir.exists():
    # The checked-in production frontend makes local use a single Python process.
    # API and documentation routes are registered first and keep precedence.
    app.mount("/", StaticFiles(directory=static_dir, html=True), name="frontend")
else:
    @app.get("/")
    def root() -> dict:
        return {"name": settings.app_name, "docs": "/docs", "health": "/api/health"}
