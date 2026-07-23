from __future__ import annotations

from unittest.mock import MagicMock

from ml_predictor.service import PredictorService


def _service(*, baseline: list[str], dynamic: set[str] | Exception) -> PredictorService:
    """Build a PredictorService with mocked settings/storage, bypassing __init__
    (which would otherwise try to construct real Mongo/MinIO/Kafka clients)."""
    service = PredictorService.__new__(PredictorService)
    service._settings = MagicMock(symbols=baseline)
    service._storage = MagicMock()
    if isinstance(dynamic, Exception):
        service._storage.get_user_tracked_symbols.side_effect = dynamic
    else:
        service._storage.get_user_tracked_symbols.return_value = dynamic
    return service


def test_tracked_symbols_includes_dynamic_and_baseline() -> None:
    service = _service(baseline=["AAPL", "MSFT"], dynamic={"XOM"})
    symbols = service._tracked_symbols()
    assert set(symbols) == {"AAPL", "MSFT", "XOM"}


def test_tracked_symbols_dynamic_not_duplicated_with_baseline() -> None:
    service = _service(baseline=["AAPL", "MSFT"], dynamic={"AAPL"})
    symbols = service._tracked_symbols()
    assert symbols.count("AAPL") == 1
    assert set(symbols) == {"AAPL", "MSFT"}


def test_tracked_symbols_falls_back_to_baseline_on_storage_error() -> None:
    service = _service(baseline=["AAPL", "MSFT"], dynamic=RuntimeError("mongo down"))
    symbols = service._tracked_symbols()
    assert set(symbols) == {"AAPL", "MSFT"}


def test_tracked_symbols_no_baseline_no_dynamic() -> None:
    service = _service(baseline=[], dynamic=set())
    assert service._tracked_symbols() == []
