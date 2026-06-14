"""One-time backfill of 1-year daily OHLCV bars using yfinance into MongoDB.

Run with:
    backfill-history          # uses .env in cwd
    uv run backfill-history

yfinance is used instead of Alpaca because Alpaca's free tier does not
serve historical daily bars (only real-time snapshots).
"""

import logging
from datetime import UTC, datetime, timedelta

import yfinance as yf
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
            df = yf.Ticker(symbol).history(
                start=start.date(),
                end=end.date(),
                interval="1d",
                auto_adjust=True,
            )

            if df.empty:
                logger.warning("No bars returned for %s", symbol)
                continue

            ops: list[UpdateOne] = []
            for ts, row in df.iterrows():
                timestamp = ts.to_pydatetime().replace(tzinfo=UTC)
                ops.append(
                    UpdateOne(
                        {"symbol": symbol, "timestamp": timestamp, "interval": "1d"},
                        {
                            "$setOnInsert": {
                                "symbol": symbol,
                                "timestamp": timestamp,
                                "open": float(row["Open"]),
                                "high": float(row["High"]),
                                "low": float(row["Low"]),
                                "close": float(row["Close"]),
                                "volume": float(row["Volume"]),
                                "interval": "1d",
                            }
                        },
                        upsert=True,
                    )
                )

            result = collection.bulk_write(ops, ordered=False)
            total_upserted += result.upserted_count
            total_matched += result.matched_count
            logger.info(
                "%s: %d bars fetched, %d inserted, %d already existed",
                symbol,
                len(ops),
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
