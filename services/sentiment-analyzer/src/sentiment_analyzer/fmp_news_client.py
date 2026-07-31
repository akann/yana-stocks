from __future__ import annotations

import logging
from datetime import UTC, datetime
from typing import Any

import httpx
import pybreaker
from pydantic import BaseModel, ValidationError

from .metrics import external_api_circuit_state, external_api_requests_total

logger = logging.getLogger(__name__)


class NewsApiError(Exception):
    pass


class FmpArticle(BaseModel):
    """Runtime shape check for an FMP news article — every field is optional,
    but a *present* field with the wrong type (FMP renaming/retyping a field)
    fails validation instead of silently resolving to '' downstream."""

    title: str | None = None
    url: str | None = None
    publishedDate: str | None = None  # noqa: N815 - matches FMP's actual field name
    site: str | None = None


class _FmpBreakerListener(pybreaker.CircuitBreakerListener):
    """Mirrors portfolio-api/price-processor's breaker event → metric wiring."""

    def success(self, _cb: pybreaker.CircuitBreaker) -> None:
        external_api_requests_total.labels(provider="fmp", outcome="success").inc()

    def failure(self, _cb: pybreaker.CircuitBreaker, _exc: BaseException) -> None:
        external_api_requests_total.labels(provider="fmp", outcome="failure").inc()

    def state_change(
        self,
        _cb: pybreaker.CircuitBreaker,
        _old_state: object,
        new_state: pybreaker.CircuitBreakerState,
    ) -> None:
        state_value = {
            pybreaker.STATE_OPEN: 1,
            pybreaker.STATE_HALF_OPEN: 0.5,
            pybreaker.STATE_CLOSED: 0,
        }.get(new_state.name, 0)
        external_api_circuit_state.labels(provider="fmp").set(state_value)
        if new_state.name == pybreaker.STATE_OPEN:
            logger.warning("Circuit opened for fmp — failing fast until half-open retry")


class FmpNewsClient:
    _BASE_URL = "https://financialmodelingprep.com/stable/news/stock"

    def __init__(self, api_key: str) -> None:
        self._client = httpx.Client(timeout=30)
        self._api_key = api_key
        # No `timeout` param here deliberately — the httpx.Client above already
        # enforces its own 30s timeout; pybreaker has no separate timeout
        # option of its own, so there's no double-timeout risk to worry about.
        self._breaker = pybreaker.CircuitBreaker(
            fail_max=5,
            reset_timeout=30,
            listeners=[_FmpBreakerListener()],
        )
        external_api_circuit_state.labels(provider="fmp").set(0)

    def _fetch_page(self, symbol: str, from_date: str) -> object:
        response = self._client.get(
            self._BASE_URL,
            params={
                "symbols": symbol,
                "limit": 50,
                "from": from_date,
                "apikey": self._api_key,
            },
        )
        response.raise_for_status()
        return response.json()

    def fetch_articles(self, symbols: list[str], since: datetime) -> list[dict[str, object]]:
        results: list[dict[str, object]] = []
        from_date = since.strftime("%Y-%m-%d")

        for symbol in symbols:
            try:
                articles: object = self._breaker.call(self._fetch_page, symbol, from_date)
            except pybreaker.CircuitBreakerError as exc:
                raise NewsApiError(f"FMP circuit open, skipping {symbol}: {exc}") from exc
            except httpx.HTTPError as exc:
                raise NewsApiError(f"FMP news request failed for {symbol}: {exc}") from exc

            if not isinstance(articles, list):
                external_api_requests_total.labels(provider="fmp", outcome="invalid_shape").inc()
                logger.warning("FMP news response for %s was not an array — skipping", symbol)
                continue

            for raw in articles:
                if not isinstance(raw, dict):
                    continue
                try:
                    article = FmpArticle.model_validate(raw)
                except ValidationError as exc:
                    external_api_requests_total.labels(
                        provider="fmp", outcome="invalid_shape"
                    ).inc()
                    logger.warning(
                        "Skipping FMP news article with unexpected shape: %s", exc
                    )
                    continue

                result: dict[str, Any] = {
                    "headline": article.title or "",
                    "source": article.site or "fmp",
                    "url": article.url or "",
                    "created_at": article.publishedDate or "",
                    "symbols": [symbol],
                }
                results.append(result)

        return results

    def close(self) -> None:
        self._client.close()

    @staticmethod
    def parse_published_at(raw: object) -> datetime:
        if not isinstance(raw, str):
            return datetime.now(tz=UTC)
        # FMP format: "2024-01-15 10:30:00" or ISO
        for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%dT%H:%M:%S%z"):
            try:
                dt = datetime.strptime(raw, fmt)
                return dt.replace(tzinfo=UTC) if dt.tzinfo is None else dt
            except ValueError:
                continue
        try:
            return datetime.fromisoformat(raw.replace("Z", "+00:00"))
        except ValueError:
            return datetime.now(tz=UTC)
