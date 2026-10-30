FROM ghcr.io/astral-sh/uv:python3.12-bookworm-slim
WORKDIR /app
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev
RUN uv run --no-sync playwright install --with-deps chromium
RUN apt-get update && apt-get install -y --no-install-recommends xvfb xauth && rm -rf /var/lib/apt/lists/*
COPY . .
CMD ["sh", "-c", "uv run --no-sync alembic upgrade head && exec xvfb-run -a -s '-screen 0 1280x900x24' uv run --no-sync uvicorn app.main:app --host 0.0.0.0 --port 8000"]
