from prometheus_client import Counter, Gauge, start_http_server

articles_processed_total = Counter(
    "articles_processed_total",
    "Total news articles run through sentiment analysis",
)

articles_failed_total = Counter(
    "articles_failed_total",
    "Total articles that failed FinBERT analysis",
)

# Emitted by FmpNewsClient's pybreaker CircuitBreaker (see fmp_news_client.py).
# Same names/labels as portfolio-api/price-processor's Node equivalents, so one
# PrometheusRule can query all three services by job.
external_api_requests_total = Counter(
    "external_api_requests_total",
    "Total calls to a third-party API, by outcome",
    ["provider", "outcome"],
)

# 0 = closed, 0.5 = half-open, 1 = open.
external_api_circuit_state = Gauge(
    "external_api_circuit_state",
    "Current circuit-breaker state for a third-party API's provider",
    ["provider"],
)


def configure_metrics(port: int = 9464) -> None:
    """Starts a standalone /metrics HTTP server — this service has no other
    HTTP surface, so a dedicated server (not a route on an existing app) is
    the standard way to expose Prometheus metrics here."""
    start_http_server(port)
