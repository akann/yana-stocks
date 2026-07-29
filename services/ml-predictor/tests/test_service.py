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


def _bare_service() -> PredictorService:
    """Bypass __init__ for track_symbol tests, which stub _load_or_train/
    _run_predictions directly rather than exercising real Mongo/MinIO."""
    service = PredictorService.__new__(PredictorService)
    service._models = {}
    return service


def test_track_symbol_trains_and_predicts_when_model_available() -> None:
    service = _bare_service()
    model = MagicMock()
    service._load_or_train = MagicMock(return_value=model)
    service._run_predictions = MagicMock()

    result = service.track_symbol("tsla")

    assert result is True
    service._load_or_train.assert_called_once_with("TSLA", force_train=False)
    service._run_predictions.assert_called_once_with("TSLA", model)
    assert service._models["TSLA"] is model


def test_track_symbol_returns_false_on_insufficient_data() -> None:
    service = _bare_service()
    service._load_or_train = MagicMock(return_value=None)
    service._run_predictions = MagicMock()

    result = service.track_symbol("AAPL")

    assert result is False
    service._run_predictions.assert_not_called()
    assert "AAPL" not in service._models


def test_track_symbol_swallows_exceptions_and_returns_false() -> None:
    service = _bare_service()
    service._load_or_train = MagicMock(side_effect=RuntimeError("mongo down"))

    result = service.track_symbol("AAPL")

    assert result is False
