from __future__ import annotations

import json
import logging
from datetime import datetime
from typing import Any

from confluent_kafka import Producer

logger = logging.getLogger(__name__)

SENTIMENT_TOPIC = "stocks.signals.sentiment"


class KafkaProducer:
    def __init__(self, brokers: str) -> None:
        self._producer: Producer = Producer({"bootstrap.servers": brokers})

    def publish(
        self,
        *,
        symbol: str,
        score: float,
        label: str,
        headline: str,
        article_url: str,
        published_at: datetime,
        analyzed_at: datetime,
    ) -> None:
        message: dict[str, Any] = {
            "symbol": symbol,
            "score": score,
            "label": label,
            "source": "newsapi",
            "headline": headline,
            "articleUrl": article_url,
            "publishedAt": published_at.isoformat(),
            "analyzedAt": analyzed_at.isoformat(),
        }
        self._producer.produce(
            SENTIMENT_TOPIC,
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
