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


app = FastAPI(title="ML Predictor", version="1.0.0", lifespan=lifespan)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/api/predict/{symbol}")
def predict(symbol: str) -> dict[str, Any]:
    preds = _service.get_predictions(symbol.upper())
    if not preds:
        raise HTTPException(status_code=404, detail=f"No predictions available for {symbol}")
    return {"symbol": symbol.upper(), "predictions": preds}


def _configure_tracing() -> None:
    from opentelemetry import trace
    from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
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
    FastAPIInstrumentor.instrument_app(app)


def main() -> None:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )
    _configure_tracing()
    uvicorn.run(app, host="0.0.0.0", port=_settings.port)


if __name__ == "__main__":
    main()
