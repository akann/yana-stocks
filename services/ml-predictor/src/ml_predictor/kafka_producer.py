from __future__ import annotations

import json
import logging
from datetime import datetime
from typing import Any

from confluent_kafka import Producer

logger = logging.getLogger(__name__)

PREDICTION_TOPIC = "stocks.signals.prediction"


class KafkaProducer:
    def __init__(self, brokers: str) -> None:
        self._producer: Producer = Producer({"bootstrap.servers": brokers})

    def publish(
        self,
        *,
        symbol: str,
        current_price: float,
        predicted_price: float,
        confidence: float,
        horizon: str,
        generated_at: datetime,
    ) -> None:
        message: dict[str, Any] = {
            "symbol": symbol,
            "currentPrice": current_price,
            "predictedPrice": predicted_price,
            "confidence": confidence,
            "horizon": horizon,
            "model": "prophet",
            "generatedAt": generated_at.isoformat(),
        }
        self._producer.produce(
            PREDICTION_TOPIC,
            key=symbol,
            value=json.dumps(message).encode(),
            on_delivery=self._on_delivery,
        )

    def flush(self) -> None:
        self._producer.flush()

    @staticmethod
    def _on_delivery(err: object, _msg: object) -> None:
        if err:
            logger.error("Delivery failed: %s", err)
