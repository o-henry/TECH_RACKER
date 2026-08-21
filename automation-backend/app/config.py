from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    environment: str = "production"
    log_level: str = "INFO"
    app_host: str = "0.0.0.0"
    app_port: int = 8000

    database_url: str = "postgresql+asyncpg://tracker:change-this-password@db:5432/technology_tracker"

    sec_user_agent: str = "TechnologyTracker/0.2 contact@example.com"
    openalex_mailto: str = "contact@example.com"
    openalex_api_key: str | None = None

    openalex_lookback_days: int = Field(default=14, ge=1, le=3650)
    openalex_initial_lookback_days: int = Field(default=3650, ge=1, le=10000)
    openalex_max_pages_per_query: int = Field(default=4, ge=1, le=100)
    openalex_page_size: int = Field(default=100, ge=1, le=100)

    clinical_trials_lookback_days: int = Field(default=30, ge=1, le=3650)
    clinical_trials_initial_lookback_days: int = Field(default=3650, ge=1, le=10000)
    clinical_trials_max_pages_per_query: int = Field(default=5, ge=1, le=100)
    clinical_trials_page_size: int = Field(default=100, ge=1, le=1000)

    sec_lookback_days: int = Field(default=120, ge=1, le=3650)
    sec_initial_lookback_days: int = Field(default=730, ge=1, le=10000)
    sec_max_filings_per_company: int = Field(default=80, ge=1, le=1000)
    sec_fetch_documents: bool = True
    sec_max_document_bytes: int = Field(default=10_000_000, ge=50_000, le=30_000_000)
    sec_requests_per_second: float = Field(default=2.0, gt=0, le=10)

    rss_feeds_path: Path = Path("config/rss_feeds.yml")
    rss_cron: str = "*/10 * * * *"
    rss_max_feed_bytes: int = Field(default=2_000_000, ge=10_000, le=5_000_000)

    scheduler_timezone: str = "Asia/Seoul"
    openalex_cron: str = "17 03 * * *"
    clinical_trials_cron: str = "41 */4 * * *"
    sec_cron: str = "7,37 * * * *"
    scheduler_run_on_startup: bool = True

    backend_control_token: str | None = None
    mcp_internal_token: str | None = None
    analysis_batch_size: int = Field(default=10, ge=1, le=10)
    analysis_daily_batch_limit: int = Field(default=6, ge=1, le=24)
    analysis_critical_burst_per_hour: int = Field(default=2, ge=0, le=6)
    analysis_lease_minutes: int = Field(default=20, ge=5, le=60)

    tracking_config_path: Path = Path("config/tracking.yml")
    seed_data_path: Path = Path("seed/technologies.json")
    frontend_dir: Path = Path("frontend")

    http_timeout_seconds: float = Field(default=30.0, gt=1, le=180)
    http_max_retries: int = Field(default=4, ge=0, le=10)

    @field_validator("database_url")
    @classmethod
    def normalize_database_url(cls, value: str) -> str:
        if value.startswith("postgres://"):
            return value.replace("postgres://", "postgresql+asyncpg://", 1)
        if value.startswith("postgresql://") and "+asyncpg" not in value:
            return value.replace("postgresql://", "postgresql+asyncpg://", 1)
        return value

    @field_validator("backend_control_token", "mcp_internal_token")
    @classmethod
    def reject_short_secrets(cls, value: str | None) -> str | None:
        if value is None or not value.strip():
            return None
        normalized = value.strip()
        if len(normalized) < 32:
            raise ValueError("Server tokens must be at least 32 characters")
        return normalized


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
