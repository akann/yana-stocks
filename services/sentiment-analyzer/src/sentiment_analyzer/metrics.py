from prometheus_client import Counter, start_http_server

articles_processed_total = Counter(
    "articles_processed_total",
    "Total news articles run through sentiment analysis",
)

articles_failed_total = Counter(
    "articles_failed_total",
    "Total articles that failed FinBERT analysis",
)


def configure_metrics(port: int = 9464) -> None:
    """Starts a standalone /metrics HTTP server — this service has no other
    HTTP surface, so a dedicated server (not a route on an existing app) is
    the standard way to expose Prometheus metrics here."""
    start_http_server(port)
