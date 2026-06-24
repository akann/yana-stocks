import pytest

from price_ingestor.config import Settings


@pytest.fixture
def settings() -> Settings:
    return Settings(
        massive_api_key="test-key",
        kafka_brokers="localhost:9092",
        symbols=["AAPL", "GOOGL"],
    )
