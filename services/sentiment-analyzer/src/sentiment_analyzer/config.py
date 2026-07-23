from __future__ import annotations

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

# Baseline tickers always eligible for sentiment coverage, spanning major
# sectors so a commonly-viewed stock (e.g. XOM) has a signal even before any
# user holds or watches it. Rotated through max_symbols_per_poll at a time
# (see worker.select_symbols_for_poll) rather than fetched every cycle, since
# FMP's free tier (250 req/day) can't sustain one request per symbol per poll
# for a list this size.
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
    mongodb_uri: str = "mongodb://localhost:27017/sentiment"
    fmp_api_key: str
    huggingface_model: str = "ProsusAI/finbert"
    poll_interval_seconds: float = 300.0
    # Comma-separated ticker list, e.g. AAPL,GOOGL,MSFT
    symbols: list[str] = DEFAULT_SYMBOLS
    # FMP's free tier is 250 requests/day and fetch_articles makes one
    # request per symbol per poll (batching many symbols into one call was
    # tried and rejected — it starves less-newsy tickers of coverage in
    # favour of whatever's trending). This bounds symbols-per-poll so total
    # daily requests stay under budget regardless of how large `symbols` or
    # user holdings grow; the rest of the universe rotates in over
    # subsequent polls instead of being dropped.
    max_symbols_per_poll: int = 10

    @field_validator("symbols", mode="before")
    @classmethod
    def parse_symbols(cls, v: object) -> object:
        if not isinstance(v, str):
            return v
        result = [s.strip().upper() for s in v.split(",") if s.strip()]
        return result or DEFAULT_SYMBOLS
