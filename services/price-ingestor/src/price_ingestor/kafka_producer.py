import json
import logging

from confluent_kafka import KafkaError, Message
from confluent_kafka import Producer as ConfluentProducer
from opentelemetry.instrumentation.confluent_kafka import ConfluentKafkaInstrumentor

from .models import RawPriceMessage

logger = logging.getLogger(__name__)

TOPIC = "stocks.prices.raw"


class KafkaProducer:
    def __init__(self, brokers: str) -> None:
        # Wrapped explicitly — see ml-predictor's kafka_producer.py for the full
        # rationale: the module-level instrument() patch never reaches the
        # `ConfluentProducer` name bound here at import time, so producers built
        # from it carried no traceparent (confirmed on the live broker, 2026-07-24).
        self._producer: ConfluentProducer = ConfluentKafkaInstrumentor.instrument_producer(
            ConfluentProducer({"bootstrap.servers": brokers})
        )

    def publish(self, message: RawPriceMessage) -> None:
        self._producer.produce(
            topic=TOPIC,
            key=message.symbol.encode(),
            value=json.dumps(message.to_dict()).encode(),
            on_delivery=self._on_delivery,
        )

    def flush(self) -> None:
        self._producer.flush()

    @staticmethod
    def _on_delivery(err: KafkaError | None, _msg: Message) -> None:
        if err:
            logger.error("Delivery failed: %s", err)
