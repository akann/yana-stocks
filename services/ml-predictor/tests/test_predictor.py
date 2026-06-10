from __future__ import annotations

from unittest.mock import MagicMock, patch

import pandas as pd

from ml_predictor.predictor import predict_all, train


def _mock_model(last_yhat: float, day1_yhat: float, day7_yhat: float, interval: float = 10.0) -> MagicMock:
    """Build a Prophet mock that returns controlled forecast values."""
    model = MagicMock()

    # history for anchor date
    model.history = pd.DataFrame({"ds": [pd.Timestamp("2024-01-01")]})

    def mock_predict(df: pd.DataFrame) -> pd.DataFrame:
        n = len(df)
        # anchor call (1 row, past date) vs. future forecast call (7 rows)
        if n == 1:
            yhats = [last_yhat]
        else:
            yhats = [day1_yhat + (day7_yhat - day1_yhat) * i / max(n - 1, 1) for i in range(n)]
        return pd.DataFrame({
            "ds": df["ds"].values,
            "yhat": yhats,
            "yhat_upper": [v + interval / 2 for v in yhats],
            "yhat_lower": [v - interval / 2 for v in yhats],
        })

    model.predict.side_effect = mock_predict
    model.make_future_dataframe.return_value = pd.DataFrame({
        "ds": pd.date_range("2024-01-02", periods=7),
    })

    return model


def test_predict_all_returns_four_horizons() -> None:
    model = _mock_model(last_yhat=100.0, day1_yhat=102.0, day7_yhat=108.0)
    results = predict_all(model, current_price=101.0)

    horizons = [r.horizon for r in results]
    assert horizons == ["1h", "4h", "1d", "1w"]


def test_predict_all_scales_to_current_price() -> None:
    # Model was trained when price was 100; current price is 120
    model = _mock_model(last_yhat=100.0, day1_yhat=105.0, day7_yhat=115.0)
    results = predict_all(model, current_price=120.0)

    # 1d prediction should be scaled: 105 / 100 * 120 = 126
    day1 = next(r for r in results if r.horizon == "1d")
    assert day1.predicted_price == round(120.0 * (105.0 / 100.0), 4)
    assert day1.current_price == 120.0


def test_predict_all_1h_interpolated_from_daily() -> None:
    model = _mock_model(last_yhat=100.0, day1_yhat=102.0, day7_yhat=108.0)
    results = predict_all(model, current_price=100.0)

    day1 = next(r for r in results if r.horizon == "1d")
    hour1 = next(r for r in results if r.horizon == "1h")
    daily_delta = day1.predicted_price - 100.0

    assert hour1.predicted_price == round(100.0 + daily_delta / 24, 4)


def test_predict_all_confidence_bounded() -> None:
    model = _mock_model(last_yhat=100.0, day1_yhat=102.0, day7_yhat=108.0, interval=10.0)
    results = predict_all(model, current_price=100.0)

    for r in results:
        assert 0.1 <= r.confidence <= 0.95


def test_predict_all_model_name_is_prophet() -> None:
    model = _mock_model(last_yhat=100.0, day1_yhat=102.0, day7_yhat=108.0)
    results = predict_all(model, current_price=100.0)

    assert all(r.model == "prophet" for r in results)


@patch("ml_predictor.predictor.Prophet")
def test_train_fits_model(mock_prophet_cls: MagicMock) -> None:
    mock_model = MagicMock()
    mock_prophet_cls.return_value = mock_model

    df = pd.DataFrame({
        "ds": pd.date_range("2024-01-01", periods=30),
        "y": [100.0 + i * 0.5 for i in range(30)],
    })
    result = train(df)

    mock_prophet_cls.assert_called_once()
    mock_model.fit.assert_called_once_with(df)
    assert result is mock_model
