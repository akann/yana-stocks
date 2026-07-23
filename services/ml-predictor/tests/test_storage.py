from __future__ import annotations

from unittest.mock import MagicMock, patch

from ml_predictor.storage import PredictionStorage


def _make_client(portfolio_symbols: list[str], watchlist_symbols: list[str]) -> MagicMock:
    mock_client = MagicMock()
    mock_db = mock_client.__getitem__.return_value
    collections: dict[str, MagicMock] = {}

    def _collection(name: str) -> MagicMock:
        if name not in collections:
            col = MagicMock()
            if name == "portfolios":
                col.distinct.return_value = portfolio_symbols
            elif name == "watchlists":
                col.distinct.return_value = watchlist_symbols
            collections[name] = col
        return collections[name]

    mock_db.__getitem__.side_effect = _collection
    return mock_client


@patch("ml_predictor.storage.MongoClient")
def test_get_user_tracked_symbols_merges_and_uppercases(mock_client_class: MagicMock) -> None:
    mock_client_class.return_value = _make_client(
        portfolio_symbols=["aapl", "XOM"],
        watchlist_symbols=["msft", "  "],
    )

    storage = PredictionStorage(uri="mongodb://localhost:27017/yana_stocks")
    symbols = storage.get_user_tracked_symbols()

    assert symbols == {"AAPL", "XOM", "MSFT"}


@patch("ml_predictor.storage.MongoClient")
def test_get_user_tracked_symbols_queries_correct_fields(mock_client_class: MagicMock) -> None:
    mock_client = _make_client(portfolio_symbols=[], watchlist_symbols=[])
    mock_client_class.return_value = mock_client

    storage = PredictionStorage(uri="mongodb://localhost:27017/yana_stocks")
    storage.get_user_tracked_symbols()

    mock_db = mock_client.__getitem__.return_value
    mock_db.__getitem__.assert_any_call("portfolios")
    mock_db.__getitem__.assert_any_call("watchlists")


@patch("ml_predictor.storage.MongoClient")
def test_get_user_tracked_symbols_empty_when_no_data(mock_client_class: MagicMock) -> None:
    mock_client_class.return_value = _make_client(portfolio_symbols=[], watchlist_symbols=[])

    storage = PredictionStorage(uri="mongodb://localhost:27017/yana_stocks")
    assert storage.get_user_tracked_symbols() == set()
