from __future__ import annotations

import logging
from dataclasses import dataclass, field

import pandas as pd
from prophet import Prophet
from prophet.serialize import model_from_json, model_to_json

logger = logging.getLogger(__name__)

HORIZONS: list[str] = ["1h", "4h", "1d", "1w"]


@dataclass
class PredictionResult:
    horizon: str
    current_price: float
    predicted_price: float
    confidence: float
    model: str = field(default="prophet")


def train(df: pd.DataFrame) -> Prophet:
    """Fit Prophet on a daily DataFrame with columns ['ds', 'y']."""
    model = Prophet(
        weekly_seasonality=True,
        yearly_seasonality=True,
        daily_seasonality=False,
        interval_width=0.8,
        changepoint_prior_scale=0.05,
    )
    model.fit(df)
    return model


def serialize(model: Prophet) -> str:
    return str(model_to_json(model))


def deserialize(json_str: str) -> Prophet:
    return model_from_json(json_str)


def predict_all(model: Prophet, current_price: float) -> list[PredictionResult]:
    """
    Generate predictions for 1h / 4h / 1d / 1w from current_price.

    Strategy: fit Prophet on daily bars, forecast 7 days ahead, scale
    predictions proportionally to the gap between the last in-sample yhat
    and the current live price.
    """
    # In-sample yhat for the last training date — use as anchoring reference
    last_date = model.history["ds"].max()
    anchor_df = pd.DataFrame({"ds": [last_date]})
    anchor = model.predict(anchor_df)
    last_yhat = float(anchor.iloc[0]["yhat"])

    # Out-of-sample 7-day forecast
    future = model.make_future_dataframe(periods=7, freq="D", include_history=False)
    forecast = model.predict(future)

    day1 = forecast.iloc[0]
    day7 = forecast.iloc[6]

    # Proportional scaling so predictions are anchored at current market price
    def scale(raw: float) -> float:
        return current_price * (raw / last_yhat) if last_yhat > 0 else current_price

    def conf(upper: float, lower: float) -> float:
        width = abs(upper - lower)
        return round(max(0.1, min(0.95, 1.0 - width / max(abs(current_price), 1.0))), 4)

    day1_price = scale(float(day1["yhat"]))
    day7_price = scale(float(day7["yhat"]))
    daily_delta = day1_price - current_price
    day1_conf = conf(float(day1["yhat_upper"]), float(day1["yhat_lower"]))
    day7_conf = conf(float(day7["yhat_upper"]), float(day7["yhat_lower"]))

    return [
        PredictionResult("1h", current_price, round(current_price + daily_delta / 24, 4), day1_conf),
        PredictionResult("4h", current_price, round(current_price + daily_delta * 4 / 24, 4), day1_conf),
        PredictionResult("1d", current_price, round(day1_price, 4), day1_conf),
        PredictionResult("1w", current_price, round(day7_price, 4), day7_conf),
    ]
