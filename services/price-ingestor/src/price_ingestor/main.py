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
from .metrics import bars_published_total, configure_metrics
from .models import RawPriceMessage

logger = logging.getLogger(__name__)


class _TraceContextFilter(logging.Filter):
    """Stamps trace_id/span_id onto a record when a real OTel span is active."""

    def filter(self, record: logging.LogRecord) -> bool:
        from opentelemetry import trace

        span_context = trace.get_current_span().get_span_context()
        if span_context.is_valid:
            record.trace_id = format(span_context.trace_id, "032x")
            record.span_id = format(span_context.span_id, "016x")
        return True


def _configure_logging() -> None:
    from pythonjsonlogger.json import JsonFormatter

    handler = logging.StreamHandler()
    handler.addFilter(_TraceContextFilter())
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
    import sentry_sdk
    from opentelemetry import trace
    from opentelemetry.baggage.propagation import W3CBaggagePropagator
    from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
    from opentelemetry.instrumentation.pymongo import PymongoInstrumentor
    from opentelemetry.propagate import set_global_textmap
    from opentelemetry.propagators.composite import CompositePropagator
    from opentelemetry.sdk.resources import Resource
    from opentelemetry.sdk.trace import TracerProvider
    from opentelemetry.sdk.trace.export import BatchSpanProcessor
    from opentelemetry.trace.propagation.tracecontext import (
        TraceContextTextMapPropagator,
    )
    from sentry_sdk.integrations.opentelemetry import (
        SentryPropagator,
        SentrySpanProcessor,
    )

    resource = Resource.create(
        {"service.name": os.environ.get("OTEL_SERVICE_NAME", "price-ingestor")}
    )
    provider = TracerProvider(resource=resource)
    provider.add_span_processor(BatchSpanProcessor(OTLPSpanExporter()))
    trace.set_tracer_provider(provider)
    PymongoInstrumentor().instrument()
    # Kafka producer instrumentation is applied explicitly in kafka_producer.py
    # (ConfluentKafkaInstrumentor.instrument_producer) — the module-level
    # instrument() patch binds too late to reach the Producer name imported
    # there, so it was silently a no-op for this app's producer.

    # Sentry: error capture only, matching the NestJS services' convention —
    # OTel/Tempo remains the sole tracer. instrumenter="otel" + traces_sample_rate=0
    # together stop Sentry from creating its own competing/duplicated spans;
    # SentrySpanProcessor bridges the *existing* OTel spans so a captured error
    # still links to the active trace_id. SentryPropagator only understands
    # Sentry's own sentry-trace/baggage headers, not the standard W3C
    # traceparent header every other service in this system relies on — it
    # must be composed alongside the existing default propagators, never
    # registered alone, or cross-service trace propagation silently breaks.
    sentry_sdk.init(
        dsn=os.environ.get("SENTRY_DSN"),
        environment=os.environ.get("NODE_ENV", "production"),
        instrumenter="otel",
        traces_sample_rate=0,
    )
    provider.add_span_processor(SentrySpanProcessor())
    set_global_textmap(
        CompositePropagator(
            [
                TraceContextTextMapPropagator(),
                W3CBaggagePropagator(),
                SentryPropagator(),
            ]
        )
    )


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
        from opentelemetry import trace

        trace.get_tracer_provider().shutdown()  # type: ignore[attr-defined]

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
            bars_published_total.labels(symbol=bar.symbol).inc()
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
    configure_metrics()
    run(Settings())


if __name__ == "__main__":
    main()
