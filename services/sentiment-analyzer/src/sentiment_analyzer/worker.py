from __future__ import annotations

import logging
from datetime import UTC, datetime, timedelta

from .analyzer import SentimentAnalyzer
from .config import Settings
from .kafka_producer import KafkaProducer
from .news_client import AlpacaNewsClient, NewsApiError
from .storage import ArticleStorage

logger = logging.getLogger(__name__)


def run(settings: Settings) -> None:
    news = AlpacaNewsClient(api_key=settings.alpaca_api_key, api_secret=settings.alpaca_api_secret)
    analyzer = SentimentAnalyzer(model_name=settings.huggingface_model)
    storage = ArticleStorage(uri=settings.mongodb_uri)
    producer = KafkaProducer(brokers=settings.kafka_brokers)

    symbols = list(settings.symbol_keywords.keys())
    logger.info(
        "Starting sentiment analyzer: symbols=%s interval=%ss model=%s",
        symbols,
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
        since = datetime.now(tz=UTC) - timedelta(seconds=settings.poll_interval_seconds)
        published_count = 0

        try:
            articles = news.fetch_articles(symbols=symbols, since=since)
        except NewsApiError as exc:
            logger.warning("Alpaca news error: %s", exc)
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
            published_at = AlpacaNewsClient.parse_published_at(article.get("created_at"))

            # Publish one signal per symbol the article mentions
            matched = [s for s in (article_symbols if isinstance(article_symbols, list) else []) if s in symbols]
            if not matched:
                matched = symbols  # fallback: treat as general market news

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
                        source=str(article.get("source", "alpaca")),
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
