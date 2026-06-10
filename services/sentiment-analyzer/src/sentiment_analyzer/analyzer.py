from __future__ import annotations

from typing import TypedDict

from transformers import pipeline as _hf_pipeline

SentimentLabel = str  # 'positive' | 'negative' | 'neutral'


class _FinBertScore(TypedDict):
    label: str
    score: float


class SentimentResult(TypedDict):
    label: SentimentLabel
    score: float


class SentimentAnalyzer:
    def __init__(self, model_name: str) -> None:
        self._pipe = _hf_pipeline(
            "text-classification",
            model=model_name,
            top_k=None,
        )

    def analyze(self, text: str) -> SentimentResult:
        """Returns label and a signed score in [-1, 1] (positive − negative)."""
        raw = self._pipe(text[:512])
        # pipeline with top_k=None returns list[list[dict]] for batch or list[dict] for single
        scores_list: list[_FinBertScore] = raw[0] if isinstance(raw[0], list) else raw  # type: ignore[assignment]

        scores = {item["label"].lower(): item["score"] for item in scores_list}
        signed = scores.get("positive", 0.0) - scores.get("negative", 0.0)

        if signed > 0.1:
            label: SentimentLabel = "positive"
        elif signed < -0.1:
            label = "negative"
        else:
            label = "neutral"

        return SentimentResult(label=label, score=round(signed, 4))
