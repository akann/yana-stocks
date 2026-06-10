from datetime import UTC, datetime
from unittest.mock import MagicMock, patch

import pytest
from alpaca.data.enums import DataFeed

from price_ingestor.alpaca_client import AlpacaClient


def _make_snapshot(
    price: float,
    bid: float,
    ask: float,
    volume: float,
    ts: datetime | None = None,
) -> MagicMock:
    snap = MagicMock()
    snap.latest_trade.price = price
    snap.latest_trade.size = volume
    snap.latest_trade.timestamp = ts or datetime(2024, 1, 1, 12, 0, tzinfo=UTC)
    snap.latest_quote.bid_price = bid
    snap.latest_quote.ask_price = ask
    return snap


@pytest.fixture
def client() -> AlpacaClient:
    with patch("price_ingestor.alpaca_client.StockHistoricalDataClient"):
        return AlpacaClient(
            "key", "secret", "https://data.alpaca.markets", DataFeed.IEX
        )


def test_get_snapshots_maps_fields(client: AlpacaClient) -> None:
    client._client.get_stock_snapshot.return_value = {
        "AAPL": _make_snapshot(150.0, 149.9, 150.1, 1000.0),
    }

    result = client.get_snapshots(["AAPL"])

    assert "AAPL" in result
    msg = result["AAPL"]
    assert msg.symbol == "AAPL"
    assert msg.price == 150.0
    assert msg.bid == 149.9
    assert msg.ask == 150.1
    assert msg.volume == 1000.0
    assert "2024-01-01" in msg.timestamp


def test_get_snapshots_skips_missing_trade(client: AlpacaClient) -> None:
    snap = MagicMock()
    snap.latest_trade = None
    client._client.get_stock_snapshot.return_value = {"AAPL": snap}

    assert client.get_snapshots(["AAPL"]) == {}


def test_get_snapshots_skips_missing_quote(client: AlpacaClient) -> None:
    snap = MagicMock()
    snap.latest_quote = None
    client._client.get_stock_snapshot.return_value = {"AAPL": snap}

    assert client.get_snapshots(["AAPL"]) == {}
