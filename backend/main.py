"""AudioNotes AI - FastAPI application entry point.

Architecture:
- Local: SenseVoice (speech-to-text) + SQLite (persistence)
- Cloud: Gemini API (note generation) + Bilibili API (video import)
"""
import logging
from pathlib import Path
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from .config import settings
from .models.database import init_db
from .routers import audio, process, bilibili, export, models, auth, admin, prompts

# Logging — output to both terminal and file
LOG_DIR = Path(__file__).parent.parent / "logs"
LOG_DIR.mkdir(exist_ok=True)

log_format = logging.Formatter("%(asctime)s [%(levelname)s] %(name)s: %(message)s")

# File handler (with rotation — max 10 MB, keeps 3 backups)
from logging.handlers import RotatingFileHandler
file_handler = RotatingFileHandler(
    LOG_DIR / "app.log", maxBytes=10 * 1024 * 1024, backupCount=3, encoding="utf-8"
)
file_handler.setFormatter(log_format)
file_handler.setLevel(logging.INFO)

# Stream handler (terminal)
stream_handler = logging.StreamHandler()
stream_handler.setFormatter(log_format)
stream_handler.setLevel(logging.INFO)

# Apply to root logger so all modules inherit
root_logger = logging.getLogger()
root_logger.setLevel(logging.INFO)
root_logger.handlers.clear()  # remove basicConfig defaults
root_logger.addHandler(file_handler)
root_logger.addHandler(stream_handler)

logger = logging.getLogger(__name__)

# Create app
app = FastAPI(
    title="AudioNotes AI",
    description="智能音频学习助手 - 本地转录 + 云端笔记生成",
    version="3.0.0",
)

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Register routers
app.include_router(auth.router)
app.include_router(audio.router)
app.include_router(process.router)
app.include_router(bilibili.router)
app.include_router(export.router)
app.include_router(models.router)
app.include_router(admin.router)
app.include_router(prompts.router)



@app.on_event("startup")
def on_startup():
    """Initialize database and run lightweight migrations on startup."""
    init_db()

    # Run lightweight migrations for any missing columns
    from .models.database import engine
    import sqlalchemy as sa
    with engine.connect() as conn:
        # audio_files: ensure user_id column exists
        try:
            conn.execute(sa.text("ALTER TABLE audio_files ADD COLUMN user_id TEXT"))
            conn.commit()
            logger.info("Migration: added user_id to audio_files")
        except Exception:
            pass  # Column already exists

        # task_groups: ensure user_id column exists
        try:
            conn.execute(sa.text("ALTER TABLE task_groups ADD COLUMN user_id TEXT"))
            conn.commit()
            logger.info("Migration: added user_id to task_groups")
        except Exception:
            pass  # Column already exists

        # users: ensure default_prompt column exists
        try:
            conn.execute(sa.text("ALTER TABLE users ADD COLUMN default_prompt TEXT"))
            conn.commit()
            logger.info("Migration: added default_prompt to users")
        except Exception:
            pass  # Column already exists
    logger.info(f"Database initialized: {settings.DATABASE_URL}")
    logger.info(f"Upload directory: {Path(settings.UPLOAD_DIR).resolve()}")
    logger.info(f"Gemini model: {settings.GEMINI_MODEL}")
    logger.info(f"SenseVoice model: {settings.SENSEVOICE_MODEL} (device: {settings.SENSEVOICE_DEVICE})")
    logger.info("SenseVoice model will load lazily on first transcription request.")


@app.get("/api/health")
def health():
    """Health check endpoint."""
    return {"status": "ok", "version": "3.0.0"}


# Serve frontend static files (must be last)
dist_dir = Path(__file__).parent.parent / "dist"
frontend_dir = Path(__file__).parent.parent / "frontend"

if dist_dir.exists():
    app.mount("/", StaticFiles(directory=str(dist_dir), html=True), name="frontend")
elif frontend_dir.exists():
    app.mount("/", StaticFiles(directory=str(frontend_dir), html=True), name="frontend")
