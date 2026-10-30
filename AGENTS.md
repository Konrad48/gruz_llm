# Project guide

## Architecture

- `frontend/`: React 19, TypeScript, Vite, Tailwind CSS, Zustand, and Lucide.
  `App.tsx` coordinates data loading and chat streaming; `store.ts` holds state
  and the API helper; `i18n.ts` contains English and Polish labels.
- `Sidebar.tsx` and `ChatHistoryItem.tsx`: project/chat navigation and chat actions.
  Chat dropdowns use a portal to avoid changing row heights or scroll clipping.
- Document previews use React PDF plus backend preview endpoints; citations open
  the source reader and locate matching passages.
- `backend/app/main.py`: FastAPI endpoints, validation, streaming, and task lifecycle.
- `models.py`, `db.py`, and `backend/migrations/`: SQLAlchemy, PostgreSQL 17,
  pgvector, and Alembic. Projects own documents and chats; chats own messages.
- `ingestion.py`: extracts PDF, DOCX, XLSX, TXT, MD, and CSV text, preserves
  source locations, chunks text, and stores OpenAI embeddings in pgvector.
- `assistant.py`: Pydantic AI agent with vehicle context, recent messages,
  optional project-scoped document retrieval, and public-web tools.
- `web.py`: isolated Playwright Chromium sessions, Bing/DuckDuckGo search,
  webpage extraction, and OLX/Allegro/eBay listing inspection.
- `execution.py` records tool/model activity; `telemetry.py` adds optional Langfuse
  tracing grouped by chat ID, including prompts, outputs, and retrieved excerpts.
- Vite proxies `/api` to port 8000 during development; Docker serves the built
  frontend through Nginx. PostgreSQL and Docker uploads use persistent volumes.

## Runtime and data

- Run one backend worker: indexing and generation use in-process tasks.
  Accepted streamed turns survive client disconnects; interrupted jobs fail on restart.
- SSE sends accepted messages, activity, and completion/failure; execution records
  and source excerpts persist with assistant messages. A JSON chat endpoint also exists.
- Retrieval is optional and scoped to the selected project. Embeddings use 1536
  dimensions; changing embedding models requires re-indexing documents.
- Default models: `openai:gpt-4.1-mini` and `text-embedding-3-small`.
  Scanned PDFs need external OCR; spreadsheet previews use cached formula values.
- Settings load `backend/.env` independently of the working directory; process
  environment wins. Compose loads that file and overrides the database hostname.
  Vite uses frontend-local env files and exposes only `VITE_` variables to browser code.
- Local uploads use `backend/data/uploads`; Docker uploads use `/app/data/uploads`.
  Sharing the database does not copy uploaded files between these locations.
- Web tools are always enabled and require Playwright Chromium in headed mode.
  Native runs need a graphical desktop; Docker supplies an Xvfb virtual display.
- Browsing blocks private destinations, non-GET requests, downloads, and unsupported
  protocols. Redirects are validated. Sites may still block automation or require login.
  Only inspected individual listings become marketplace results; access does not
  establish fitment or availability. Keep these limits and project isolation intact.

## Checks

From `backend`:

```bash
uv run ruff check .
uv run ruff format --check .
uv run alembic upgrade head
uv run pytest
```

Integration tests require migrated PostgreSQL and use fake AI providers.
`RUN_BROWSER_TESTS=1 uv run pytest tests/test_browser.py` enables real Chromium
checks in headed mode; tests need a display (or Xvfb on Linux).
From `frontend`, run `npm run build`. See `README.md` for setup and startup commands.
