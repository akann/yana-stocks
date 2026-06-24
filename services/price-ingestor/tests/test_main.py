"""Tests for the handle_msg closure inside run().

Strategy: mock WebSocketClient so that client.run(handler) immediately calls
handler with the provided test messages instead of blocking on a real socket.
"""

import json
from datetime import UTC, datetime
from unittest.mock import MagicMock, call, patch

import pytest
from polygon.websocket.models.models import EquityAgg

from price_ingestor.config import Settings
from price_ingestor.main import run

START_TS_MS = int(datetime(2024, 1, 1, 14, 30, tzinfo=UTC).timestamp() * 1000)


def _make_agg(
    symbol: str = "AAPL",
    open: float = 149.0,
    high: float = 151.0,
    low: float = 148.5,
    close: float = 150.0,
    volume: float = 10_000.0,
    start_timestamp: int = START_TS_MS,
    event_type: str = "AM",
) -> EquityAgg:
    agg = MagicMock(spec=EquityAgg)
    agg.symbol = symbol
    agg.open = open
    agg.high = high
    agg.low = low
    agg.close = close
    agg.volume = volume
    agg.start_timestamp = start_timestamp
    agg.event_type = event_type
    return agg


def _run_with_msgs(settings: Settings, msgs: list) -> MagicMock:
    """Run the ingestor with a canned message list; return the mock producer."""
    mock_producer = MagicMock()

    def fake_client_run(handler):  # type: ignore[no-untyped-def]
        handler(msgs)

    with (
        patch("price_ingestor.main.KafkaProducer", return_value=mock_producer),
        patch("price_ingestor.main.WebSocketClient") as MockWS,
    ):
        mock_ws = MockWS.return_value
        mock_ws.run.side_effect = fake_client_run
        run(settings)

    return mock_producer


class TestHandleMsg:
    def test_publishes_valid_equity_agg(self, settings: Settings) -> None:
        producer = _run_with_msgs(settings, [_make_agg()])
        producer.publish.assert_called_once()
        bar = producer.publish.call_args.args[0]
        assert bar.symbol == "AAPL"
        assert bar.close == 150.0

    def test_maps_start_timestamp_to_utc_iso_string(self, settings: Settings) -> None:
        producer = _run_with_msgs(settings, [_make_agg()])
        bar = producer.publish.call_args.args[0]
        assert bar.timestamp == "2024-01-01T14:30:00+00:00"

    def test_skips_non_equity_agg_objects(self, settings: Settings) -> None:
        producer = _run_with_msgs(settings, [MagicMock()])
        producer.publish.assert_not_called()

    def test_skips_agg_with_wrong_event_type(self, settings: Settings) -> None:
        producer = _run_with_msgs(settings, [_make_agg(event_type="A")])
        producer.publish.assert_not_called()

    def test_skips_agg_with_none_close(self, settings: Settings) -> None:
        agg = _make_agg()
        agg.close = None
        producer = _run_with_msgs(settings, [agg])
        producer.publish.assert_not_called()

    def test_skips_agg_with_none_symbol(self, settings: Settings) -> None:
        agg = _make_agg()
        agg.symbol = None
        producer = _run_with_msgs(settings, [agg])
        producer.publish.assert_not_called()

    def test_skips_agg_with_none_start_timestamp(self, settings: Settings) -> None:
        agg = _make_agg()
        agg.start_timestamp = None
        producer = _run_with_msgs(settings, [agg])
        producer.publish.assert_not_called()

    def test_publishes_multiple_valid_aggs(self, settings: Settings) -> None:
        msgs = [_make_agg(symbol="AAPL"), _make_agg(symbol="GOOGL")]
        producer = _run_with_msgs(settings, msgs)
        assert producer.publish.call_count == 2

    def test_flushes_after_processing_batch(self, settings: Settings) -> None:
        producer = _run_with_msgs(settings, [_make_agg()])
        producer.flush.assert_called_once()

    def test_flushes_even_when_all_msgs_skipped(self, settings: Settings) -> None:
        producer = _run_with_msgs(settings, [MagicMock()])
        producer.flush.assert_called_once()
