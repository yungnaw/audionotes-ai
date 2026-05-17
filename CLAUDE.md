# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

### Setup
```bash
uv sync                    # Install Python deps (FastAPI, FunASR/SenseVoice, torch, etc.)
npm install                # Install Node deps (React/Vite dev frontend only)
cp .env.example .env       # Then edit .env — at minimum set one LLM API key
```

### Run
```bash
python run.py              # Production: FastAPI on 0.0.0.0:3000, serves frontend/ as static files
npm run dev                # Development: Vite HMR + Express API proxy on 0.0.0.0:3000 (React frontend via server.ts)
npm run build              # Build React frontend to dist/ for production
npm run lint               # TypeScript type-check (tsc --noEmit)
```

### Environment variables (`.env`)
- `GEMINI_API_KEY` / `DEEPSEEK_API_KEY` / `QWEN_API_KEY` / `GLM_API_KEY` — LLM provider keys (at least one required)
- `JWT_SECRET_KEY` — set for production
- `SENSEVOICE_DEVICE` — `cpu` (default) or `cuda`; auto-detects NVIDIA GPU via torch if unset
- `SENSEVOICE_NCPU` — transcription concurrency (default 8)
- `ALLOW_REGISTRATION` / `INVITE_CODE` — registration gate

## Architecture

### Two separate frontends (choose one per run mode)

| Mode | Entry | Stack | Served by |
|------|-------|-------|-----------|
| Production | `frontend/index.html` + `frontend/js/app.js` | Vanilla JS, no framework | FastAPI static mount (`backend/main.py`) |
| Development | `src/main.tsx` → `src/App.tsx` | React 19 + TypeScript + Vite + Tailwind 4 | `server.ts` (Express + Vite middleware) |

**Important**: `src/App.tsx` is a standalone client-side React app that calls Gemini API directly from the browser — it does NOT use the backend API. The `frontend/` vanilla JS app calls the backend REST API. These are two independent implementations of the same UI concept. Only the `frontend/` app integrates with the full backend (auth, multi-provider, tasks, admin).

### Backend (`backend/`)

**Entry**: `run.py` → `backend/main.py` (FastAPI app factory with CORS, router registration, startup DB migration, static mount)

**Layers**:
- `routers/` — HTTP endpoints: `auth`, `audio` (files + task groups), `process` (transcription → LLM pipeline), `bilibili`, `export`, `models` (LLM model listing), `admin`
- `services/` — Business logic: `sensevoice_service` (lazy-loaded FunASR singleton), `llm_service` (multi-provider routing), `gemini_service` (native Gemini SDK path), `bilibili_service` (B站 extraction), `auth_service` (JWT + passlib sha256_crypt)
- `models/` — `orm.py` (SQLAlchemy: User, AudioFile, TaskGroup), `schemas.py` (Pydantic request/response), `database.py` (engine, session, get_db dependency)

**Key architectural patterns**:
- **SenseVoice lazy singleton** (`services/sensevoice_service.py`): Model loads on first call (~30s), then stays in memory. Thread-safe via double-checked locking. `reset_sensevoice()` invalidates it so next call reloads with new settings.
- **Dual semaphore pipeline** (`routers/process.py`): Transcription (CPU-bound) and LLM summarization (network-bound) use separate `asyncio.Semaphore` pools. Transcribe semaphore = `SENSEVOICE_NCPU`, summary semaphore = 3 (hardcoded). Global `paused_state` flag with `check_pause()` checkpoints.
- **LLM provider routing** (`services/llm_service.py`): `provider` parameter selects backend — `gemini` uses native Google GenAI SDK, `deepseek`/`qwen`/`glm` use OpenAI-compatible `/chat/completions` endpoint via httpx. Users can pass per-request `api_key` and `model_name` overrides.
- **Auth**: JWT HS256 via `python-jose`, password hashing via `passlib sha256_crypt` (NOT bcrypt, to avoid bcrypt v4/v5 compatibility issues). Dependencies: `get_current_user` (requires valid token), `require_admin` (also checks role).
- **Multi-tenancy**: All AudioFile and TaskGroup records are scoped to `user_id`. Routers enforce ownership by filtering on `current_user.id`.

### Database
- SQLite via SQLAlchemy 2.0 ORM, file: `audionotes.db` (gitignored)
- Tables auto-created on startup via `Base.metadata.create_all`
- Lightweight startup migrations in `backend/main.py` `on_startup` (adds missing columns with ALTER TABLE)
- Delete `audionotes.db` to reset schema during development

### File processing states
```
idle → transcribing (SenseVoice) → summarizing (LLM) → completed
                                                         ↘ failed (any stage)
```

### B站 import dual path
Subtitles first (fast, zero cost) → if none, download DASH audio stream from CDN (slow, requires transcription)

### Key service file
`en2zh.pyw` — Standalone English→Chinese translation tool using Helsinki-NLP/opus-mt-en-zh. Supports interactive, file batch, and CLI single-sentence modes. Has optional Tkinter GUI.
