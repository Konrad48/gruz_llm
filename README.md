# Gruz LLM

A bilingual car repair assistant with project-based chats, document search,
citations, and marketplace browsing. Architecture notes are in [AGENTS.md](AGENTS.md).

## Requirements

- Python 3.12+, uv, Node.js 22+, npm, and Docker with Compose.
- An OpenAI API key for chat and document indexing.
- Playwright Chromium and a graphical desktop (or Xvfb on Linux) for web browsing.

## How to run

Run these Bash commands from the repository root. Setup once:

```bash
[ -f backend/.env ] || cp backend/.env.example backend/.env
# Edit backend/.env: set OPENAI_API_KEY; keep DATABASE_URL at 127.0.0.1:5432.
docker compose up -d --wait db
(cd backend && uv sync --frozen && uv run playwright install chromium)
(cd frontend && npm ci)
```

On Linux, Chromium may also need `uv run playwright install --with-deps chromium`
from `backend`. Rerun dependency installation when lockfiles change.

Start the backend in one terminal, from the repository root:

```bash
cd backend
uv run alembic upgrade head
uv run uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload --reload-include '.env'
```

Start the frontend in another terminal, from the repository root:

```bash
cd frontend
npm run dev -- --port 5173 --strictPort
```

Open [the app](http://127.0.0.1:5173) or [API docs](http://127.0.0.1:8000/docs).

Alternatively, run everything in Docker:

```bash
docker compose up -d --build

# Stop containers without deleting data:
docker compose down
```
