from __future__ import annotations

import logging
from datetime import UTC, datetime
from typing import Any

import sentry_sdk
from prophet import Prophet

from . import predictor as pred
from .config import Settings
from .kafka_producer import KafkaProducer
from .model_store import ModelStore
from .storage import PredictionStorage

logger = logging.getLogger(__name__)


class PredictorService:
    def __init__(self, settings: Settings) -> None:
        self._settings = settings
        self._storage = PredictionStorage(settings.mongodb_uri)
        self._model_store = ModelStore(
            endpoint=settings.minio_endpoint,
            access_key=settings.minio_access_key,
            secret_key=settings.minio_secret_key,
            bucket=settings.minio_bucket,
            secure=settings.minio_secure,
        )
        self._kafka = KafkaProducer(brokers=settings.kafka_brokers)
        self._models: dict[str, Prophet] = {}

    def initialize(self) -> None:
        """Load or train models for all tracked symbols."""
        for symbol in self._tracked_symbols():
            model = self._load_or_train(symbol)
            if model is not None:
                self._models[symbol] = model
                self._run_predictions(symbol, model)

    def refresh_all(self) -> None:
        """Retrain models and refresh predictions. Called by the scheduler."""
        for symbol in self._tracked_symbols():
            try:
                model = self._load_or_train(symbol, force_train=True)
                if model is not None:
                    self._models[symbol] = model
                    self._run_predictions(symbol, model)
            except Exception as exc:
                logger.error("Refresh failed for %s: %s", symbol, exc, exc_info=True)
                sentry_sdk.capture_exception(exc)

    def _tracked_symbols(self) -> list[str]:
        """Baseline symbols plus whatever any user actually holds/watches.

        Queried fresh each call (not cached at construction) so a symbol
        added to a portfolio/watchlist gets picked up on the next scheduled
        refresh without requiring a pod restart.
        """
        try:
            dynamic_symbols = self._storage.get_user_tracked_symbols()
        except Exception as exc:
            logger.warning("Failed to load user-tracked symbols, using baseline only: %s", exc)
            dynamic_symbols = set()

        baseline = self._settings.symbols
        return [*sorted(dynamic_symbols), *(s for s in baseline if s not in dynamic_symbols)]

    def get_predictions(self, symbol: str) -> list[dict[str, Any]]:
        return self._storage.get_predictions(symbol.upper())

    # ------------------------------------------------------------------ #

    def _load_or_train(self, symbol: str, *, force_train: bool = False) -> Prophet | None:
        if not force_train:
            json_str = self._model_store.load(symbol)
            if json_str is not None:
                logger.info("Loaded model for %s from MinIO", symbol)
                return pred.deserialize(json_str)

        return self._train_and_save(symbol)

    def _train_and_save(self, symbol: str) -> Prophet | None:
        df = self._storage.load_daily_bars(symbol, days=self._settings.training_days)
        if len(df) < 10:
            logger.warning("Insufficient training data for %s (%d rows)", symbol, len(df))
            return None

        logger.info("Training Prophet model for %s on %d daily bars", symbol, len(df))
        model = pred.train(df)
        self._model_store.save(symbol, pred.serialize(model))
        return model

    def _run_predictions(self, symbol: str, model: Prophet) -> None:
        current_price = self._storage.get_latest_price(symbol)
        if current_price is None:
            logger.warning("No current price for %s, skipping predictions", symbol)
            return

        generated_at = datetime.now(tz=UTC)
        results = pred.predict_all(model, current_price)

        for result in results:
            doc: dict[str, Any] = {
                "symbol": symbol,
                "horizon": result.horizon,
                "currentPrice": result.current_price,
                "predictedPrice": result.predicted_price,
                "confidence": result.confidence,
                "model": result.model,
                "generatedAt": generated_at,
            }
            self._storage.upsert_prediction(symbol, result.horizon, doc)
            self._kafka.publish(
                symbol=symbol,
                current_price=result.current_price,
                predicted_price=result.predicted_price,
                confidence=result.confidence,
                horizon=result.horizon,
                generated_at=generated_at,
            )

        self._kafka.flush()
        logger.info("Published predictions for %s", symbol)
