from __future__ import annotations

from datetime import UTC, datetime

import httpx


class NewsApiError(Exception):
    pass


class AlpacaNewsClient:
    _BASE_URL = "https://data.alpaca.markets/v1beta1/news"

    def __init__(self, api_key: str, api_secret: str) -> None:
        self._client = httpx.Client(
            timeout=30,
            headers={
                "APCA-API-KEY-ID": api_key,
                "APCA-API-SECRET-KEY": api_secret,
            },
        )

    def fetch_articles(self, symbols: list[str], since: datetime) -> list[dict[str, object]]:
        params: dict[str, str | int] = {
            "symbols": ",".join(symbols),
            "start": since.strftime("%Y-%m-%dT%H:%M:%SZ"),
            "limit": 50,
            "sort": "desc",
        }
        response = self._client.get(self._BASE_URL, params=params)
        response.raise_for_status()
        data: dict[str, object] = response.json()
        articles = data.get("news", [])
        return articles if isinstance(articles, list) else []

    def close(self) -> None:
        self._client.close()

    @staticmethod
    def parse_published_at(raw: object) -> datetime:
        if not isinstance(raw, str):
            return datetime.now(tz=UTC)
        try:
            return datetime.fromisoformat(raw.replace("Z", "+00:00"))
        except ValueError:
            return datetime.now(tz=UTC)
