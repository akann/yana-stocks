from __future__ import annotations

from datetime import UTC, datetime

import httpx


class NewsApiError(Exception):
    pass


class FmpNewsClient:
    _BASE_URL = "https://financialmodelingprep.com/api/v3/stock_news"

    def __init__(self, api_key: str) -> None:
        self._client = httpx.Client(timeout=30)
        self._api_key = api_key

    def fetch_articles(self, symbols: list[str], since: datetime) -> list[dict[str, object]]:
        results: list[dict[str, object]] = []
        from_date = since.strftime("%Y-%m-%d")

        for symbol in symbols:
            try:
                response = self._client.get(
                    self._BASE_URL,
                    params={
                        "tickers": symbol,
                        "limit": 50,
                        "from": from_date,
                        "apikey": self._api_key,
                    },
                )
                response.raise_for_status()
                articles: object = response.json()
                if not isinstance(articles, list):
                    continue
                for a in articles:
                    if not isinstance(a, dict):
                        continue
                    results.append(
                        {
                            "headline": a.get("title", ""),
                            "source": a.get("site", "fmp"),
                            "url": a.get("url", ""),
                            "created_at": a.get("publishedDate", ""),
                            "symbols": [symbol],
                        }
                    )
            except httpx.HTTPError as exc:
                raise NewsApiError(f"FMP news request failed for {symbol}: {exc}") from exc

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
