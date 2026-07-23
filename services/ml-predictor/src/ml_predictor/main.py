from __future__ import annotations

import asyncio
import logging
import os
from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager
from typing import Any

import uvicorn
from fastapi import FastAPI, HTTPException

from .config import Settings
from .metrics import instrument as instrument_metrics
from .service import PredictorService

logger = logging.getLogger(__name__)

_settings = Settings()  # type: ignore[call-arg]
_service = PredictorService(_settings)


async def _refresh_loop() -> None:
    while True:
        await asyncio.sleep(_settings.prediction_refresh_interval_seconds)
        try:
            await asyncio.to_thread(_service.refresh_all)
        except Exception as exc:
            logger.error("Scheduled refresh failed: %s", exc, exc_info=True)


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncGenerator[None, None]:
    # Startup: initialize models in background so server starts immediately
    asyncio.create_task(asyncio.to_thread(_service.initialize))
    task = asyncio.create_task(_refresh_loop())
    yield
    task.cancel()
    await asyncio.gather(task, return_exceptions=True)

    from opentelemetry import trace

    await asyncio.to_thread(trace.get_tracer_provider().shutdown)  # type: ignore[attr-defined]


app = FastAPI(title="ML Predictor", version="1.0.0", lifespan=lifespan)
instrument_metrics(app)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/api/predict/{symbol}")
def predict(symbol: str) -> dict[str, Any]:
    preds = _service.get_predictions(symbol.upper())
    if not preds:
        raise HTTPException(status_code=404, detail=f"No predictions available for {symbol}")
    return {"symbol": symbol.upper(), "predictions": preds}


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
            static_fields={"service": "ml-predictor"},
        )
    )
    logging.basicConfig(level=logging.INFO, handlers=[handler])


def _configure_tracing() -> None:
    from opentelemetry import trace
    from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
    from opentelemetry.instrumentation.confluent_kafka import ConfluentKafkaInstrumentor
    from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor
    from opentelemetry.instrumentation.pymongo import PymongoInstrumentor
    from opentelemetry.sdk.resources import Resource
    from opentelemetry.sdk.trace import TracerProvider
    from opentelemetry.sdk.trace.export import BatchSpanProcessor

    resource = Resource.create({"service.name": os.environ.get("OTEL_SERVICE_NAME", "ml-predictor")})
    provider = TracerProvider(resource=resource)
    provider.add_span_processor(BatchSpanProcessor(OTLPSpanExporter()))
    trace.set_tracer_provider(provider)
    PymongoInstrumentor().instrument()
    ConfluentKafkaInstrumentor().instrument()
    FastAPIInstrumentor.instrument_app(app)


def main() -> None:
    _configure_logging()
    _configure_tracing()
    uvicorn.run(app, host="0.0.0.0", port=_settings.port)


if __name__ == "__main__":
    main()
