FROM python:3.12-slim AS builder

RUN pip install uv

WORKDIR /app
COPY pyproject.toml .
RUN uv sync --no-dev --no-editable

FROM python:3.12-slim

RUN addgroup --system app && adduser --system --ingroup app app

WORKDIR /app
COPY --from=builder /app/.venv /app/.venv
COPY src/ ./src/

ENV PATH="/app/.venv/bin:$PATH"
ENV PYTHONUNBUFFERED=1

USER app
CMD ["python", "-m", "sentiment_analyzer.main"]
