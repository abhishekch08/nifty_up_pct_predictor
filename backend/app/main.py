from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from .api import router
from .config import get_settings
from .database import Base, engine
from .scheduler import build_scheduler

settings = get_settings()
scheduler = None


@asynccontextmanager
async def lifespan(_: FastAPI):
    global scheduler
    Base.metadata.create_all(engine)
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
