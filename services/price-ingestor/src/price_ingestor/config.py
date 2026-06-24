from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env", env_file_encoding="utf-8", extra="ignore"
    )

    massive_api_key: str

    kafka_brokers: str = "localhost:9092"

    # Stored as a plain string so pydantic-settings doesn't attempt JSON
    # pre-parsing (which fails on comma-separated values and empty strings).
    symbols: str = "AAPL,GOOGL,MSFT,AMZN,TSLA,NVDA,META,JPM,V,JNJ"

    @property
    def symbol_list(self) -> list[str]:
        return [s.strip() for s in self.symbols.split(",") if s.strip()]
