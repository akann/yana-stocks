import json
from unittest.mock import patch

import pytest

from price_ingestor.kafka_producer import TOPIC, KafkaProducer
from price_ingestor.models import RawPriceMessage


@pytest.fixture
def producer() -> KafkaProducer:
    with patch("price_ingestor.kafka_producer.ConfluentProducer"):
        return KafkaProducer("localhost:9092")


def _make_message() -> RawPriceMessage:
    return RawPriceMessage(
        symbol="AAPL",
        open=149.5,
        high=151.0,
        low=149.0,
        close=150.0,
        volume=1000.0,
        timestamp="2024-01-01T12:00:00+00:00",
    )


def test_publish_uses_correct_topic(producer: KafkaProducer) -> None:
    producer.publish(_make_message())
    call_kwargs = producer._producer.produce.call_args.kwargs
    assert call_kwargs["topic"] == TOPIC


def test_publish_uses_symbol_as_key(producer: KafkaProducer) -> None:
    producer.publish(_make_message())
    call_kwargs = producer._producer.produce.call_args.kwargs
    assert call_kwargs["key"] == b"AAPL"


def test_publish_serialises_all_ohlcv_fields(producer: KafkaProducer) -> None:
    producer.publish(_make_message())
    call_kwargs = producer._producer.produce.call_args.kwargs
    payload = json.loads(call_kwargs["value"])
    assert payload["symbol"] == "AAPL"
    assert payload["open"] == 149.5
    assert payload["high"] == 151.0
    assert payload["low"] == 149.0
    assert payload["close"] == 150.0
    assert payload["volume"] == 1000.0
    assert payload["timestamp"] == "2024-01-01T12:00:00+00:00"


def test_publish_does_not_include_tick_fields(producer: KafkaProducer) -> None:
    """price/bid/ask are gone — RawPriceMessage is now a complete OHLCV bar."""
    producer.publish(_make_message())
    call_kwargs = producer._producer.produce.call_args.kwargs
    payload = json.loads(call_kwargs["value"])
    assert "price" not in payload
    assert "bid" not in payload
    assert "ask" not in payload
