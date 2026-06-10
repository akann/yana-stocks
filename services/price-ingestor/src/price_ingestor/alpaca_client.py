import logging
from typing import cast

from alpaca.data import StockHistoricalDataClient
from alpaca.data.enums import DataFeed
from alpaca.data.models import Snapshot
from alpaca.data.requests import StockSnapshotRequest

from .models import RawPriceMessage

logger = logging.getLogger(__name__)


class AlpacaClient:
    def __init__(
        self,
        api_key: str,
        api_secret: str,
        base_url: str,
        feed: DataFeed,
    ) -> None:
        self._client = StockHistoricalDataClient(
            api_key=api_key,
            secret_key=api_secret,
            url_override=base_url,
        )
        self._feed = feed

    def get_snapshots(self, symbols: list[str]) -> dict[str, RawPriceMessage]:
        request = StockSnapshotRequest(symbol_or_symbols=symbols, feed=self._feed)
        raw = self._client.get_stock_snapshot(request)
        snapshots = cast(dict[str, Snapshot], raw)

        result: dict[str, RawPriceMessage] = {}
        for symbol, snap in snapshots.items():
            if snap.latest_trade is None or snap.latest_quote is None:
                logger.warning("Incomplete snapshot for %s, skipping", symbol)
                continue
            result[symbol] = RawPriceMessage(
                symbol=symbol,
                price=float(snap.latest_trade.price),
                bid=float(snap.latest_quote.bid_price),
                ask=float(snap.latest_quote.ask_price),
                volume=float(snap.latest_trade.size),
                timestamp=snap.latest_trade.timestamp.isoformat(),
            )
        return result
