import pytest
from alpaca.data.enums import DataFeed

from price_ingestor.config import Settings


@pytest.fixture
def settings() -> Settings:
    return Settings(
        alpaca_api_key="test-key",
        alpaca_api_secret="test-secret",
        alpaca_base_url="https://data.alpaca.markets",
        alpaca_feed=DataFeed.IEX,
        kafka_brokers="localhost:9092",
        symbols=["AAPL", "GOOGL"],
        poll_interval_seconds=0.0,
    )
