from __future__ import annotations

import json
import logging
from datetime import datetime
from typing import Any

from confluent_kafka import Producer
from opentelemetry.instrumentation.confluent_kafka import ConfluentKafkaInstrumentor

logger = logging.getLogger(__name__)

PREDICTION_TOPIC = "stocks.signals.prediction"


class KafkaProducer:
    def __init__(self, brokers: str) -> None:
        # Wrapped explicitly: ConfluentKafkaInstrumentor().instrument() patches
        # the class on the confluent_kafka module, but this module's `Producer`
        # name is bound at import time — before tracing setup runs — so producers
        # built from it were never proxied and no traceparent reached the wire
        # (confirmed on the live broker, 2026-07-24). The explicit wrap is
        # import-order-proof; its proxy tracer picks up the real provider once
        # _configure_tracing() sets it.
        self._producer: Producer = ConfluentKafkaInstrumentor.instrument_producer(
            Producer({"bootstrap.servers": brokers})
        )

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
