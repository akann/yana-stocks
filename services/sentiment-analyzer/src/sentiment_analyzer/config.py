from __future__ import annotations

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

DEFAULT_SYMBOL_KEYWORDS: dict[str, str] = {
    "AAPL": "Apple",
    "GOOGL": "Google OR Alphabet",
    "MSFT": "Microsoft",
    "AMZN": "Amazon",
    "TSLA": "Tesla",
    "NVDA": "NVIDIA",
    "META": "Meta OR Facebook",
    "JPM": "JPMorgan",
    "V": "Visa",
    "JNJ": "Johnson Johnson",
}


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env", env_file_encoding="utf-8", extra="ignore"
    )

    kafka_brokers: str = "localhost:19092"
    mongodb_uri: str = "mongodb://localhost:27017/sentiment"
    news_api_key: str
    huggingface_model: str = "ProsusAI/finbert"
    poll_interval_seconds: float = 300.0
    # Format: AAPL:Apple|GOOGL:Google OR Alphabet|MSFT:Microsoft
    symbol_keywords: dict[str, str] = DEFAULT_SYMBOL_KEYWORDS

    @field_validator("symbol_keywords", mode="before")
    @classmethod
    def parse_symbol_keywords(cls, v: object) -> object:
        if not isinstance(v, str):
            return v
        result: dict[str, str] = {}
        for pair in v.split("|"):
            pair = pair.strip()
            if ":" in pair:
                symbol, keyword = pair.split(":", 1)
                result[symbol.strip().upper()] = keyword.strip()
        return result if result else DEFAULT_SYMBOL_KEYWORDS
