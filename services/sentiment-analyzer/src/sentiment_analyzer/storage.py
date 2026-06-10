from __future__ import annotations

import contextlib
from datetime import datetime

import pymongo
from pymongo import MongoClient
from pymongo.collection import Collection


class ArticleStorage:
    def __init__(self, uri: str) -> None:
        client: MongoClient[dict[str, object]] = MongoClient(uri)
        db_name = uri.rsplit("/", 1)[-1].split("?")[0] or "sentiment"
        db = client[db_name]
        self._articles: Collection[dict[str, object]] = db["articles"]
        self._ensure_indexes()

    def _ensure_indexes(self) -> None:
        self._articles.create_index("url", unique=True)
        self._articles.create_index(
            [("symbol", pymongo.ASCENDING), ("analyzed_at", pymongo.DESCENDING)]
        )

    def is_new(self, url: str) -> bool:
        return self._articles.count_documents({"url": url}, limit=1) == 0

    def save(self, doc: dict[str, object]) -> None:
        with contextlib.suppress(pymongo.errors.DuplicateKeyError):
            self._articles.insert_one(doc)

    def recent_for_symbol(self, symbol: str, limit: int = 10) -> list[dict[str, object]]:
        cursor = (
            self._articles.find({"symbol": symbol})
            .sort("analyzed_at", pymongo.DESCENDING)
            .limit(limit)
        )
        return list(cursor)

    @staticmethod
    def make_document(
        *,
        url: str,
        symbol: str,
        headline: str,
        source: str,
        published_at: datetime,
        sentiment_label: str,
        sentiment_score: float,
        analyzed_at: datetime,
    ) -> dict[str, object]:
        return {
            "url": url,
            "symbol": symbol,
            "headline": headline,
            "source": source,
            "published_at": published_at,
            "sentiment_label": sentiment_label,
            "sentiment_score": sentiment_score,
            "analyzed_at": analyzed_at,
        }
