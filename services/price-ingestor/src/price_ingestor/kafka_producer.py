import json
import logging

from confluent_kafka import KafkaError, Message
from confluent_kafka import Producer as ConfluentProducer

from .models import RawPriceMessage

logger = logging.getLogger(__name__)

TOPIC = "stocks.prices.raw"


class KafkaProducer:
    def __init__(self, brokers: str) -> None:
        self._producer = ConfluentProducer({"bootstrap.servers": brokers})

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
