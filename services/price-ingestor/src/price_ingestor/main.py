import logging
import os
import signal
import types
from datetime import UTC, datetime

from polygon import WebSocketClient
from polygon.websocket.models.common import Feed, Market
from polygon.websocket.models.models import EquityAgg

from .config import Settings
from .kafka_producer import KafkaProducer
from .models import RawPriceMessage

logger = logging.getLogger(__name__)


def _configure_logging() -> None:
    from pythonjsonlogger.json import JsonFormatter

    handler = logging.StreamHandler()
    handler.setFormatter(
        JsonFormatter(
            "{asctime}{levelname}{name}{message}",
            style="{",
            rename_fields={"asctime": "timestamp", "levelname": "level", "name": "logger"},
            static_fields={"service": "price-ingestor"},
        )
    )
    logging.basicConfig(level=logging.INFO, handlers=[handler])


def _configure_tracing() -> None:
    from opentelemetry import trace
    from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
    from opentelemetry.instrumentation.pymongo import PymongoInstrumentor
    from opentelemetry.sdk.resources import Resource
    from opentelemetry.sdk.trace import TracerProvider
    from opentelemetry.sdk.trace.export import BatchSpanProcessor

    resource = Resource.create(
        {"service.name": os.environ.get("OTEL_SERVICE_NAME", "price-ingestor")}
    )
    provider = TracerProvider(resource=resource)
    provider.add_span_processor(BatchSpanProcessor(OTLPSpanExporter()))
    trace.set_tracer_provider(provider)
    PymongoInstrumentor().instrument()


def run(settings: Settings) -> None:
    producer = KafkaProducer(brokers=settings.kafka_brokers)

    # Subscribe strings for all configured symbols, e.g. "AM.AAPL"
    subscriptions = [f"AM.{s}" for s in settings.symbol_list]

    logger.info(
        "Starting Massive WebSocket ingestor: symbols=%s feed=StarterFeed",
        settings.symbol_list,
    )

    stopping = False

    def _shutdown(sig: int, _frame: types.FrameType | None) -> None:
        nonlocal stopping
        logger.info("Received signal %d, shutting down", sig)
        stopping = True

    signal.signal(signal.SIGTERM, _shutdown)
    signal.signal(signal.SIGINT, _shutdown)

    def handle_msg(msgs: list[object]) -> None:
        for msg in msgs:
            if not isinstance(msg, EquityAgg) or msg.event_type != "AM":
                continue
            if msg.symbol is None or msg.start_timestamp is None:
                continue
            if None in (msg.open, msg.high, msg.low, msg.close, msg.volume):
                continue

            bar = RawPriceMessage(
                symbol=msg.symbol,
                open=float(msg.open),
                high=float(msg.high),
                low=float(msg.low),
                close=float(msg.close),
                volume=float(msg.volume),
                timestamp=datetime.fromtimestamp(
                    msg.start_timestamp / 1000, tz=UTC
                ).isoformat(),
            )
            producer.publish(bar)
            logger.debug("Published bar: %s close=%.2f", bar.symbol, bar.close)

        producer.flush()

    client = WebSocketClient(
        api_key=settings.massive_api_key,
        feed=Feed.StarterFeed,
        market=Market.Stocks,
    )
    client.subscribe(*subscriptions)
    # run() blocks and auto-reconnects on disconnect (up to max_reconnects=5 by default)
    client.run(handle_msg)


def main() -> None:
    _configure_logging()
    _configure_tracing()
    run(Settings())


if __name__ == "__main__":
    main()
