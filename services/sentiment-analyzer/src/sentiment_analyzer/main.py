import logging
import os

from .config import Settings
from .metrics import configure_metrics
from .worker import run


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
            static_fields={"service": "sentiment-analyzer"},
        )
    )
    logging.basicConfig(level=logging.INFO, handlers=[handler])


def _configure_tracing() -> None:
    import sentry_sdk
    from opentelemetry import trace
    from opentelemetry.baggage.propagation import W3CBaggagePropagator
    from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
    from opentelemetry.instrumentation.confluent_kafka import ConfluentKafkaInstrumentor
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

    resource = Resource.create({"service.name": os.environ.get("OTEL_SERVICE_NAME", "sentiment-analyzer")})
    provider = TracerProvider(resource=resource)
    provider.add_span_processor(BatchSpanProcessor(OTLPSpanExporter()))
    trace.set_tracer_provider(provider)
    PymongoInstrumentor().instrument()
    ConfluentKafkaInstrumentor().instrument()

    # Sentry: error capture only — see price-ingestor's main.py for the full
    # rationale (instrumenter="otel"/traces_sample_rate=0 stop Sentry from
    # creating competing spans; SentryPropagator must be composed alongside
    # the default W3C propagators, never registered alone, or traceparent
    # propagation to/from the Node services breaks silently).
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


def main() -> None:
    _configure_logging()
    _configure_tracing()
    configure_metrics()
    run(Settings())  # type: ignore[call-arg]  # required fields populated from env vars


if __name__ == "__main__":
    main()
