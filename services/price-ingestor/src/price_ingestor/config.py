from alpaca.data.enums import DataFeed
from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env", env_file_encoding="utf-8", extra="ignore"
    )

    alpaca_api_key: str
    alpaca_api_secret: str
    alpaca_base_url: str = "https://data.alpaca.markets"
    alpaca_feed: DataFeed = DataFeed.IEX

    kafka_brokers: str = "localhost:9092"

    symbols: list[str] = [
        "AAPL",
        "GOOGL",
        "MSFT",
        "AMZN",
        "TSLA",
        "NVDA",
        "META",
        "JPM",
        "V",
        "JNJ",
    ]
    poll_interval_seconds: float = 5.0

    @field_validator("symbols", mode="before")
    @classmethod
    def parse_symbols(cls, v: object) -> object:
        if isinstance(v, str):
            return [s.strip() for s in v.split(",") if s.strip()]
        return v
