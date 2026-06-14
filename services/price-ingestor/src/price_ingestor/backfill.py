"""One-time backfill of 1-year daily OHLCV bars from Alpaca into MongoDB.

Run with:
    backfill-history          # uses .env in cwd
    uv run backfill-history
"""

import logging
from datetime import UTC, datetime, timedelta

from alpaca.data import StockHistoricalDataClient
from alpaca.data.enums import DataFeed
from alpaca.data.requests import StockBarsRequest
from alpaca.data.timeframe import TimeFrame
from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict
from pymongo import MongoClient, UpdateOne
from pymongo.errors import BulkWriteError

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger(__name__)


class BackfillSettings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env", env_file_encoding="utf-8", extra="ignore"
    )

    alpaca_api_key: str
    alpaca_api_secret: str
    alpaca_base_url: str = "https://data.alpaca.markets"
    alpaca_feed: DataFeed = DataFeed.IEX

    mongodb_uri: str = "mongodb://localhost:27017/yana_stocks"

    symbols: list[str] = [
        "AAPL",
        "GOOGL",
        "MSFT",
        "AMZN",
        "TSLA",
        "NVDA",
        "META",
        "JPM",
        "V",
        "JNJ",
    ]

    @field_validator("symbols", mode="before")
    @classmethod
    def parse_symbols(cls, v: object) -> object:
        if isinstance(v, str):
            return [s.strip() for s in v.split(",") if s.strip()]
        return v


def main() -> None:
    settings = BackfillSettings()

    alpaca = StockHistoricalDataClient(
        api_key=settings.alpaca_api_key,
        secret_key=settings.alpaca_api_secret,
        url_override=settings.alpaca_base_url,
    )

    db_name = settings.mongodb_uri.rstrip("/").split("/")[-1]
    mongo: MongoClient[dict[str, object]] = MongoClient(settings.mongodb_uri)
    collection = mongo[db_name]["price_bars"]

    end = datetime.now(tz=UTC)
    start = end - timedelta(days=365)

    logger.info(
        "Backfilling daily bars for %d symbols from %s to %s",
        len(settings.symbols),
        start.date(),
        end.date(),
    )

    total_upserted = 0
    total_matched = 0

    for symbol in settings.symbols:
        logger.info("Fetching %s ...", symbol)
        try:
            request = StockBarsRequest(
                symbol_or_symbols=symbol,
                timeframe=TimeFrame.Day,
                start=start,
                end=end,
                feed=settings.alpaca_feed,
            )
            bars_response = alpaca.get_stock_bars(request)
            bars = bars_response[symbol] if symbol in bars_response else []  # noqa: SIM401

            if not bars:
                logger.warning("No bars returned for %s", symbol)
                continue

            ops = [
                UpdateOne(
                    {"symbol": symbol, "timestamp": bar.timestamp, "interval": "1d"},
                    {
                        "$setOnInsert": {
                            "symbol": symbol,
                            "timestamp": bar.timestamp,
                            "open": float(bar.open),
                            "high": float(bar.high),
                            "low": float(bar.low),
                            "close": float(bar.close),
                            "volume": float(bar.volume),
                            "interval": "1d",
                        }
                    },
                    upsert=True,
                )
                for bar in bars
            ]

            result = collection.bulk_write(ops, ordered=False)
            total_upserted += result.upserted_count
            total_matched += result.matched_count
            logger.info(
                "%s: %d bars fetched, %d inserted, %d already existed",
                symbol,
                len(bars),
                result.upserted_count,
                result.matched_count,
            )

        except BulkWriteError as exc:
            logger.error("%s bulk write partial failure: %s", symbol, exc.details)
        except Exception as exc:
            logger.error("Failed to backfill %s: %s", symbol, exc, exc_info=True)

    mongo.close()
    logger.info(
        "Done. Total inserted: %d, already existed: %d", total_upserted, total_matched
    )


if __name__ == "__main__":
    main()
