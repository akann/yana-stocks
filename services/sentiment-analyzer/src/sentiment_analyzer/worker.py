from __future__ import annotations

import logging
from datetime import UTC, datetime, timedelta

from .analyzer import SentimentAnalyzer
from .config import Settings
from .fmp_news_client import FmpNewsClient, NewsApiError
from .kafka_producer import KafkaProducer
from .storage import ArticleStorage

logger = logging.getLogger(__name__)


def select_symbols_for_poll(
    *,
    dynamic_symbols: set[str],
    baseline_symbols: list[str],
    cursor: int,
    max_symbols: int,
) -> tuple[list[str], int]:
    """Pick which symbols to fetch FMP news for this poll cycle.

    Symbols a user actually holds or watches always get a fresh fetch (they
    matter most and are typically few). Whatever budget remains rotates
    through baseline_symbols a window at a time via `cursor`, so a large
    baseline still gets covered over successive polls without ever exceeding
    max_symbols FMP requests in one cycle.
    """
    dynamic = sorted(dynamic_symbols)[:max_symbols]
    remaining_baseline = [s for s in baseline_symbols if s not in dynamic_symbols]
    budget = max(0, max_symbols - len(dynamic))

    if budget == 0 or not remaining_baseline:
        return dynamic, cursor

    n = len(remaining_baseline)
    start = cursor % n
    window_size = min(budget, n)
    window = [remaining_baseline[(start + i) % n] for i in range(window_size)]
    new_cursor = (start + window_size) % n

    return [*dynamic, *window], new_cursor


def run(settings: Settings) -> None:
    news = FmpNewsClient(api_key=settings.fmp_api_key)
    analyzer = SentimentAnalyzer(model_name=settings.huggingface_model)
    storage = ArticleStorage(uri=settings.mongodb_uri)
    producer = KafkaProducer(brokers=settings.kafka_brokers)

    logger.info(
        "Starting sentiment analyzer: baseline=%s interval=%ss model=%s max_symbols_per_poll=%s",
        settings.symbols,
        settings.poll_interval_seconds,
        settings.huggingface_model,
        settings.max_symbols_per_poll,
    )

    import signal
    import time
    import types

    running = True

    def _shutdown(sig: int, _frame: types.FrameType | None) -> None:
        nonlocal running
        logger.info("Received signal %d, shutting down", sig)
        running = False

    signal.signal(signal.SIGTERM, _shutdown)
    signal.signal(signal.SIGINT, _shutdown)

    cursor = 0

    while running:
        since = datetime.now(tz=UTC) - timedelta(seconds=settings.poll_interval_seconds)
        published_count = 0

        try:
            dynamic_symbols = storage.get_user_tracked_symbols()
        except Exception as exc:
            logger.warning("Failed to load user-tracked symbols, using baseline only: %s", exc)
            dynamic_symbols = set()

        symbols, cursor = select_symbols_for_poll(
            dynamic_symbols=dynamic_symbols,
            baseline_symbols=settings.symbols,
            cursor=cursor,
            max_symbols=settings.max_symbols_per_poll,
        )
        logger.info("Polling FMP for symbols=%s", symbols)

        try:
            articles = news.fetch_articles(symbols=symbols, since=since)
        except NewsApiError as exc:
            logger.warning("FMP news error: %s", exc)
            articles = []
        except Exception as exc:
            logger.error("Unexpected error fetching news: %s", exc)
            articles = []

        for article in articles:
            url = article.get("url")
            headline = article.get("headline") or article.get("summary")
            article_symbols: object = article.get("symbols", [])
            if not isinstance(url, str) or not isinstance(headline, str):
                continue
            if not storage.is_new(url):
                continue

            analyzed_at = datetime.now(tz=UTC)
            published_at = FmpNewsClient.parse_published_at(article.get("created_at"))

            matched = [s for s in (article_symbols if isinstance(article_symbols, list) else []) if s in symbols]
            if not matched:
                matched = symbols

            for symbol in matched:
                try:
                    result = analyzer.analyze(headline)
                except Exception as exc:
                    logger.error("FinBERT error for article %s: %s", url, exc)
                    continue

                storage.save(
                    ArticleStorage.make_document(
                        url=url,
                        symbol=symbol,
                        headline=headline,
                        source=str(article.get("source", "fmp")),
                        published_at=published_at,
                        sentiment_label=result["label"],
                        sentiment_score=result["score"],
                        analyzed_at=analyzed_at,
                    )
                )

                producer.publish(
                    symbol=symbol,
                    score=result["score"],
                    label=result["label"],
                    headline=headline,
                    article_url=url,
                    published_at=published_at,
                    analyzed_at=analyzed_at,
                )
                published_count += 1

        if published_count:
            producer.flush()
            logger.info("Published %d sentiment signals", published_count)

        time.sleep(settings.poll_interval_seconds)

    news.close()
