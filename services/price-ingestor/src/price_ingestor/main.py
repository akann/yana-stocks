import logging
import signal
import time
import types

from .alpaca_client import AlpacaClient
from .config import Settings
from .kafka_producer import KafkaProducer

logger = logging.getLogger(__name__)


def run(settings: Settings) -> None:
    client = AlpacaClient(
        api_key=settings.alpaca_api_key,
        api_secret=settings.alpaca_api_secret,
        base_url=settings.alpaca_base_url,
        feed=settings.alpaca_feed,
    )
    producer = KafkaProducer(brokers=settings.kafka_brokers)

    logger.info(
        "Starting poll loop: symbols=%s interval=%ss feed=%s",
        settings.symbols,
        settings.poll_interval_seconds,
        settings.alpaca_feed.value,
    )

    running = True

    def _shutdown(sig: int, _frame: types.FrameType | None) -> None:
        nonlocal running
        logger.info("Received signal %d, shutting down", sig)
        running = False

    signal.signal(signal.SIGTERM, _shutdown)
    signal.signal(signal.SIGINT, _shutdown)

    while running:
        try:
            snapshots = client.get_snapshots(settings.symbols)
            for message in snapshots.values():
                producer.publish(message)
            producer.flush()
            logger.debug("Published %d snapshots", len(snapshots))
        except Exception as exc:
            logger.error("Poll error: %s", exc, exc_info=True)

        time.sleep(settings.poll_interval_seconds)


def main() -> None:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )
    run(Settings())


if __name__ == "__main__":
    main()
