from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_name: str = "Nifty Probability Terminal API"
    app_env: str = "development"
    database_url: str = "sqlite:///./data/nifty.db"
    cors_origins: str = "http://localhost:3000,http://localhost:5173,http://127.0.0.1:3000,http://127.0.0.1:5173"
    admin_api_key: str = "change-me"
    model_artifact_dir: str = "./artifacts"
    data_dir: str = "./data"
    scheduler_enabled: bool = False
    auto_refresh_enabled: bool = True
    auto_retrain_on_refresh: bool = True
    auto_refresh_min_minutes: int = 15
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    @property
    def cors_list(self) -> list[str]:
        return [item.strip() for item in self.cors_origins.split(",") if item.strip()]

    def ensure_directories(self) -> None:
        Path(self.model_artifact_dir).mkdir(parents=True, exist_ok=True)
        Path(self.data_dir).mkdir(parents=True, exist_ok=True)


@lru_cache
def get_settings() -> Settings:
    settings = Settings()
    settings.ensure_directories()
    return settings
