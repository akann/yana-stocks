from __future__ import annotations

import asyncio
import logging
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


def main() -> None:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )
    uvicorn.run(app, host="0.0.0.0", port=_settings.port)


if __name__ == "__main__":
    main()
