from __future__ import annotations

import logging
from datetime import UTC, datetime, timedelta
from typing import Any

import pandas as pd
import pymongo
from pymongo import MongoClient
from pymongo.collection import Collection

logger = logging.getLogger(__name__)


class PredictionStorage:
    def __init__(self, uri: str) -> None:
        client: MongoClient[dict[str, Any]] = MongoClient(uri)
        db_name = uri.rsplit("/", 1)[-1].split("?")[0] or "prices"
        db = client[db_name]
        self._price_bars: Collection[dict[str, Any]] = db["price_bars"]
        self._predictions: Collection[dict[str, Any]] = db["predictions"]
        self._ensure_indexes()

    def _ensure_indexes(self) -> None:
        self._predictions.create_index(
            [("symbol", pymongo.ASCENDING), ("horizon", pymongo.ASCENDING)],
            unique=True,
        )
        self._predictions.create_index(
            [("symbol", pymongo.ASCENDING), ("generated_at", pymongo.DESCENDING)]
        )

    def load_daily_bars(self, symbol: str, days: int = 90) -> pd.DataFrame:
        """Fetch 1-min bars and aggregate to daily OHLCV for Prophet training."""
        since = datetime.now(tz=UTC) - timedelta(days=days)
        cursor = self._price_bars.find(
            {"symbol": symbol, "timestamp": {"$gte": since}},
            {"_id": 0, "timestamp": 1, "close": 1},
            sort=[("timestamp", pymongo.ASCENDING)],
        )
        rows = list(cursor)
        if not rows:
            return pd.DataFrame(columns=["ds", "y"])

        df = pd.DataFrame(rows)
        df["ds"] = pd.to_datetime(df["timestamp"]).dt.floor("D")
        daily = df.groupby("ds")["close"].last().reset_index()
        daily.columns = pd.Index(["ds", "y"])
        return daily

    def get_latest_price(self, symbol: str) -> float | None:
        bar = self._price_bars.find_one(
            {"symbol": symbol},
            sort=[("timestamp", pymongo.DESCENDING)],
        )
        if bar is None:
            return None
        close = bar.get("close")
        return float(close) if isinstance(close, (int, float)) else None

    def upsert_prediction(self, symbol: str, horizon: str, doc: dict[str, Any]) -> None:
        self._predictions.update_one(
            {"symbol": symbol, "horizon": horizon},
            {"$set": doc},
            upsert=True,
        )

    def get_predictions(self, symbol: str) -> list[dict[str, Any]]:
        return list(
            self._predictions.find(
                {"symbol": symbol},
                {"_id": 0},
                sort=[("horizon", pymongo.ASCENDING)],
            )
        )
