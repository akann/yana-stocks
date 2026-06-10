from unittest.mock import MagicMock, patch

from sentiment_analyzer.analyzer import SentimentAnalyzer


def _pipe_output(positive: float, negative: float, neutral: float) -> list[list[dict[str, object]]]:
    return [[
        {"label": "positive", "score": positive},
        {"label": "negative", "score": negative},
        {"label": "neutral", "score": neutral},
    ]]


@patch("sentiment_analyzer.analyzer._hf_pipeline")
def test_positive_headline(mock_pipeline: MagicMock) -> None:
    mock_pipeline.return_value = MagicMock(
        return_value=_pipe_output(0.85, 0.05, 0.10)
    )
    analyzer = SentimentAnalyzer(model_name="ProsusAI/finbert")

    result = analyzer.analyze("Apple reports record-breaking quarterly earnings")

    assert result["label"] == "positive"
    assert result["score"] > 0.1


@patch("sentiment_analyzer.analyzer._hf_pipeline")
def test_negative_headline(mock_pipeline: MagicMock) -> None:
    mock_pipeline.return_value = MagicMock(
        return_value=_pipe_output(0.05, 0.88, 0.07)
    )
    analyzer = SentimentAnalyzer(model_name="ProsusAI/finbert")

    result = analyzer.analyze("Tesla recalls 200,000 vehicles over safety concerns")

    assert result["label"] == "negative"
    assert result["score"] < -0.1


@patch("sentiment_analyzer.analyzer._hf_pipeline")
def test_neutral_headline(mock_pipeline: MagicMock) -> None:
    mock_pipeline.return_value = MagicMock(
        return_value=_pipe_output(0.30, 0.28, 0.42)
    )
    analyzer = SentimentAnalyzer(model_name="ProsusAI/finbert")

    result = analyzer.analyze("Microsoft announces quarterly earnings call date")

    assert result["label"] == "neutral"
    assert -0.1 <= result["score"] <= 0.1


@patch("sentiment_analyzer.analyzer._hf_pipeline")
def test_score_is_rounded(mock_pipeline: MagicMock) -> None:
    mock_pipeline.return_value = MagicMock(
        return_value=_pipe_output(0.7123456, 0.1234567, 0.1641977)
    )
    analyzer = SentimentAnalyzer(model_name="ProsusAI/finbert")

    result = analyzer.analyze("NVIDIA unveils next-generation GPU architecture")

    assert result["score"] == round(0.7123456 - 0.1234567, 4)
