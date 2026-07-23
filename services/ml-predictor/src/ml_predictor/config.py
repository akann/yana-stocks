from __future__ import annotations

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

# Baseline tickers always eligible for predictions, spanning major sectors so
# a commonly-viewed stock (e.g. XOM) has one even before any user holds or
# watches it. Unlike sentiment-analyzer's equivalent list, this isn't rotated
# through a per-cycle budget — training reads our own already-collected price
# history (no external API, no per-symbol rate limit), so the only cost is
# our own compute, which comfortably fits training this many small Prophet
# models (~90 daily points each) within the hourly refresh interval.
DEFAULT_SYMBOLS: list[str] = [
    "AAPL", "MSFT", "GOOGL", "AMZN", "NVDA", "META", "TSLA",  # tech
    "JPM", "V", "MA", "BAC", "GS",  # financials
    "XOM", "CVX",  # energy
    "JNJ", "PFE", "UNH",  # healthcare
    "WMT", "PG", "KO", "PEP", "COST",  # consumer staples
    "DIS", "NFLX", "HD", "MCD",  # consumer discretionary
    "BA", "GE", "CAT",  # industrials
    "ORCL", "CRM", "ADBE", "INTC", "AMD",  # tech / semis
]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env", env_file_encoding="utf-8", extra="ignore"
    )

    kafka_brokers: str = "localhost:19092"
    mongodb_uri: str = "mongodb://localhost:27017/prices"
    minio_endpoint: str = "localhost:9000"
    minio_access_key: str
    minio_secret_key: str
    minio_bucket: str = "yana-stocks-models"
    minio_secure: bool = False
    port: int = 8000
    symbols: list[str] = DEFAULT_SYMBOLS
    prediction_refresh_interval_seconds: float = 3600.0
    training_days: int = 90

    @field_validator("symbols", mode="before")
    @classmethod
    def parse_symbols(cls, v: object) -> object:
        if isinstance(v, str):
            return [s.strip() for s in v.split(",") if s.strip()]
        return v
