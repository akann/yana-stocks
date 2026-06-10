from __future__ import annotations

from datetime import UTC, datetime

import httpx


class NewsApiError(Exception):
    pass


class NewsApiClient:
    _BASE_URL = "https://newsapi.org/v2/everything"

    def __init__(self, api_key: str) -> None:
        self._api_key = api_key
        self._client = httpx.Client(timeout=30)

    def fetch_articles(self, query: str, since: datetime) -> list[dict[str, object]]:
        params: dict[str, str | int] = {
            "q": query,
            "from": since.strftime("%Y-%m-%dT%H:%M:%S"),
            "language": "en",
            "sortBy": "publishedAt",
            "pageSize": 20,
            "apiKey": self._api_key,
        }
        response = self._client.get(self._BASE_URL, params=params)
        response.raise_for_status()
        data: dict[str, object] = response.json()
        if data.get("status") != "ok":
            raise NewsApiError(f"NewsAPI error: {data.get('message', 'unknown')}")
        articles = data.get("articles", [])
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
