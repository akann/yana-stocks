from datetime import UTC, datetime
from unittest.mock import MagicMock, patch

import pytest

from sentiment_analyzer.fmp_news_client import FmpNewsClient, NewsApiError


def _make_response(articles: list[dict]) -> MagicMock:
    resp = MagicMock()
    resp.json.return_value = articles
    resp.raise_for_status.return_value = None
    return resp


FMP_ARTICLE = {
    "title": "Apple beats earnings",
    "site": "reuters.com",
    "url": "https://reuters.com/aapl-earnings",
    "publishedDate": "2024-01-15 10:30:00",
    "symbol": "AAPL",
}


@patch("sentiment_analyzer.fmp_news_client.httpx.Client")
def test_fetch_normalises_fmp_fields(mock_client_class: MagicMock) -> None:
    mock_client = MagicMock()
    mock_client_class.return_value = mock_client
    mock_client.get.return_value = _make_response([FMP_ARTICLE])

    client = FmpNewsClient(api_key="test-key")
    since = datetime(2024, 1, 14, tzinfo=UTC)
    articles = client.fetch_articles(["AAPL"], since)

    assert len(articles) == 1
    assert articles[0]["headline"] == "Apple beats earnings"
    assert articles[0]["source"] == "reuters.com"
    assert articles[0]["url"] == "https://reuters.com/aapl-earnings"
    assert articles[0]["created_at"] == "2024-01-15 10:30:00"
    assert articles[0]["symbols"] == ["AAPL"]


@patch("sentiment_analyzer.fmp_news_client.httpx.Client")
def test_fetch_sends_correct_params(mock_client_class: MagicMock) -> None:
    mock_client = MagicMock()
    mock_client_class.return_value = mock_client
    mock_client.get.return_value = _make_response([FMP_ARTICLE])

    client = FmpNewsClient(api_key="my-key")
    since = datetime(2024, 1, 14, tzinfo=UTC)
    client.fetch_articles(["AAPL"], since)

    call_kwargs = mock_client.get.call_args
    assert call_kwargs[1]["params"]["symbols"] == "AAPL"
    assert call_kwargs[1]["params"]["apikey"] == "my-key"
    assert call_kwargs[1]["params"]["from"] == "2024-01-14"


@patch("sentiment_analyzer.fmp_news_client.httpx.Client")
def test_fetch_queries_each_symbol_separately(mock_client_class: MagicMock) -> None:
    mock_client = MagicMock()
    mock_client_class.return_value = mock_client
    mock_client.get.return_value = _make_response([FMP_ARTICLE])

    client = FmpNewsClient(api_key="key")
    since = datetime(2024, 1, 14, tzinfo=UTC)
    client.fetch_articles(["AAPL", "MSFT"], since)

    assert mock_client.get.call_count == 2


@patch("sentiment_analyzer.fmp_news_client.httpx.Client")
def test_fetch_raises_news_api_error_on_http_failure(mock_client_class: MagicMock) -> None:
    import httpx

    mock_client = MagicMock()
    mock_client_class.return_value = mock_client
    mock_client.get.side_effect = httpx.HTTPError("timeout")

    client = FmpNewsClient(api_key="key")
    since = datetime(2024, 1, 14, tzinfo=UTC)

    with pytest.raises(NewsApiError):
        client.fetch_articles(["AAPL"], since)


@patch("sentiment_analyzer.fmp_news_client.httpx.Client")
def test_fetch_skips_non_list_response(mock_client_class: MagicMock) -> None:
    mock_client = MagicMock()
    mock_client_class.return_value = mock_client
    resp = MagicMock()
    resp.json.return_value = {"error": "not a list"}
    resp.raise_for_status.return_value = None
    mock_client.get.return_value = resp

    client = FmpNewsClient(api_key="key")
    since = datetime(2024, 1, 14, tzinfo=UTC)
    articles = client.fetch_articles(["AAPL"], since)

    assert articles == []


@patch("sentiment_analyzer.fmp_news_client.httpx.Client")
def test_fetch_skips_article_with_unexpected_field_type(mock_client_class: MagicMock) -> None:
    # A renamed/retyped FMP field (e.g. `title` becoming a number) must be
    # caught here, not silently propagate as "" downstream — the concrete
    # "format change" case a reviewer asked about.
    mock_client = MagicMock()
    mock_client_class.return_value = mock_client
    malformed = {**FMP_ARTICLE, "title": 12345}
    mock_client.get.return_value = _make_response([malformed, FMP_ARTICLE])

    client = FmpNewsClient(api_key="key")
    since = datetime(2024, 1, 14, tzinfo=UTC)
    articles = client.fetch_articles(["AAPL"], since)

    assert len(articles) == 1
    assert articles[0]["headline"] == "Apple beats earnings"


@patch("sentiment_analyzer.fmp_news_client.httpx.Client")
def test_circuit_opens_after_repeated_failures(mock_client_class: MagicMock) -> None:
    import httpx

    mock_client = MagicMock()
    mock_client_class.return_value = mock_client
    mock_client.get.side_effect = httpx.HTTPError("timeout")

    client = FmpNewsClient(api_key="key")
    since = datetime(2024, 1, 14, tzinfo=UTC)

    # fail_max=5 on a fresh breaker — five failing calls trip it open.
    for _ in range(5):
        with pytest.raises(NewsApiError):
            client.fetch_articles(["AAPL"], since)

    calls_while_closed = mock_client.get.call_count
    assert calls_while_closed > 0

    # Once open, further calls must fail fast without hitting the network
    # again — this is the actual resilience behavior, not just a metric.
    with pytest.raises(NewsApiError):
        client.fetch_articles(["AAPL"], since)
    assert mock_client.get.call_count == calls_while_closed


def test_parse_published_at_fmp_format() -> None:
    dt = FmpNewsClient.parse_published_at("2024-01-15 10:30:00")
    assert dt.year == 2024
    assert dt.month == 1
    assert dt.day == 15
    assert dt.tzinfo == UTC


def test_parse_published_at_iso_format() -> None:
    dt = FmpNewsClient.parse_published_at("2024-01-15T10:30:00Z")
    assert dt.year == 2024


def test_parse_published_at_invalid_returns_now() -> None:
    before = datetime.now(tz=UTC)
    dt = FmpNewsClient.parse_published_at("not-a-date")
    after = datetime.now(tz=UTC)
    assert before <= dt <= after


def test_parse_published_at_non_string_returns_now() -> None:
    before = datetime.now(tz=UTC)
    dt = FmpNewsClient.parse_published_at(None)
    after = datetime.now(tz=UTC)
    assert before <= dt <= after
