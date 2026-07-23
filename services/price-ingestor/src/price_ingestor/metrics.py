from prometheus_client import Counter, start_http_server

bars_published_total = Counter(
    "bars_published_total",
    "Total OHLCV bars published to stocks.prices.raw",
    ["symbol"],
)


def configure_metrics(port: int = 9464) -> None:
    """Starts a standalone /metrics HTTP server — this service has no other
    HTTP surface, so a dedicated server (not a route on an existing app) is
    the standard way to expose Prometheus metrics here."""
    start_http_server(port)
