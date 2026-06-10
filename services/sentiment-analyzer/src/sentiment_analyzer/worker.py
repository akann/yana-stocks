from __future__ import annotations

import logging
from datetime import UTC, datetime, timedelta

from .analyzer import SentimentAnalyzer
from .config import Settings
from .kafka_producer import KafkaProducer
from .news_client import NewsApiClient, NewsApiError
from .storage import ArticleStorage

logger = logging.getLogger(__name__)


def run(settings: Settings) -> None:
    news = NewsApiClient(api_key=settings.news_api_key)
    analyzer = SentimentAnalyzer(model_name=settings.huggingface_model)
    storage = ArticleStorage(uri=settings.mongodb_uri)
    producer = KafkaProducer(brokers=settings.kafka_brokers)

    logger.info(
        "Starting sentiment analyzer: symbols=%s interval=%ss model=%s",
        list(settings.symbol_keywords.keys()),
        settings.poll_interval_seconds,
        settings.huggingface_model,
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

    while running:
        since = datetime.now(tz=UTC) - timedelta(
            seconds=settings.poll_interval_seconds
        )
        published_count = 0

        for symbol, query in settings.symbol_keywords.items():
            if not running:
                break
            try:
                articles = news.fetch_articles(query=query, since=since)
            except NewsApiError as exc:
                logger.warning("NewsAPI error for %s: %s", symbol, exc)
                continue
            except Exception as exc:
                logger.error("Unexpected error fetching news for %s: %s", symbol, exc)
                continue

            for article in articles:
                url = article.get("url")
                headline = article.get("title") or article.get("description")
                if not isinstance(url, str) or not isinstance(headline, str):
                    continue
                if not storage.is_new(url):
                    continue

                analyzed_at = datetime.now(tz=UTC)
                published_at = NewsApiClient.parse_published_at(article.get("publishedAt"))

                try:
                    result = analyzer.analyze(headline)
                except Exception as exc:
                    logger.error("FinBERT error for article %s: %s", url, exc)
                    continue

                source_name = article.get("source")
                source = (
                    source_name["name"]
                    if isinstance(source_name, dict) and isinstance(source_name.get("name"), str)
                    else "newsapi"
                )

                storage.save(
                    ArticleStorage.make_document(
                        url=url,
                        symbol=symbol,
                        headline=headline,
                        source=source,
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
