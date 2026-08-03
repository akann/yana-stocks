from __future__ import annotations

import contextlib
from datetime import datetime

import pymongo
from pymongo import MongoClient, errors
from pymongo.collection import Collection
from pymongo.database import Database


class ArticleStorage:
    def __init__(self, uri: str) -> None:
        client: MongoClient[dict[str, object]] = MongoClient(uri)
        db_name = uri.rsplit("/", 1)[-1].split("?")[0] or "sentiment"
        self._db: Database[dict[str, object]] = client[db_name]
        self._articles: Collection[dict[str, object]] = self._db["articles"]
        self._ensure_indexes()

    def _ensure_indexes(self) -> None:
        self._articles.create_index("url", unique=True)
        self._articles.create_index(
            [("symbol", pymongo.ASCENDING), ("analyzed_at", pymongo.DESCENDING)]
        )

    def get_user_tracked_symbols(self) -> set[str]:
        """Symbols any user actually holds or watches.

        Reads the portfolio-service-owned `portfolios`/`watchlists`
        collections directly (both live in this same shared `yana_stocks`
        database, confirmed against the prod MONGODB_URI for both services)
        rather than via a new HTTP endpoint — no schema contract beyond the
        two field names below, which are stable.
        """
        portfolio_symbols = self._db["portfolios"].distinct("stocks.symbol")
        watchlist_symbols = self._db["watchlists"].distinct("symbols")
        return {
            s.strip().upper()
            for s in (*portfolio_symbols, *watchlist_symbols)
            if isinstance(s, str) and s.strip()
        }

    def is_new(self, url: str) -> bool:
        return self._articles.count_documents({"url": url}, limit=1) == 0

    def save(self, doc: dict[str, object]) -> None:
        with contextlib.suppress(errors.DuplicateKeyError):
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
