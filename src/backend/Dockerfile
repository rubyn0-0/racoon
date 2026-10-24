FROM python:3.12-slim

COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv

# BACKEND_DIR (constants.py) is two folders above the package, so data/ and migrations/ must sit in /app.
WORKDIR /app
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project

COPY alembic.ini ./
COPY migrations ./migrations
COPY data ./data
COPY src ./src
RUN uv sync --frozen --no-dev

# Render sets PORT; 8000 is the local default. Shell form so ${PORT} expands.
CMD uv run --no-sync uvicorn racoon.api:app --host 0.0.0.0 --port ${PORT:-8000}
