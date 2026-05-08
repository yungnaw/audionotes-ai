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
from .routers import audio, process, bilibili, export, models

# Logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger(__name__)

# Create app
app = FastAPI(
    title="AudioNotes AI",
    description="智能音频学习助手 - 本地转录 + 云端笔记生成",
    version="2.0.0",
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
app.include_router(audio.router)
app.include_router(process.router)
app.include_router(bilibili.router)
app.include_router(export.router)
app.include_router(models.router)



@app.on_event("startup")
def on_startup():
    """Initialize database on startup."""
    init_db()
    # Create default TaskGroup if it doesn't exist
    from .models.database import SessionLocal
    from .models.orm import TaskGroup
    db = SessionLocal()
    try:
        default_group = db.query(TaskGroup).filter(TaskGroup.id == "default").first()
        if not default_group:
            default_group = TaskGroup(id="default", name="默认任务")
            db.add(default_group)
            db.commit()
    except Exception as e:
        logger.error(f"Failed to create default task group: {e}")
    finally:
        db.close()

    logger.info(f"Database initialized: {settings.DATABASE_URL}")
    logger.info(f"Upload directory: {Path(settings.UPLOAD_DIR).resolve()}")
    logger.info(f"Gemini model: {settings.GEMINI_MODEL}")
    logger.info(f"SenseVoice model: {settings.SENSEVOICE_MODEL} (device: {settings.SENSEVOICE_DEVICE})")
    logger.info("SenseVoice model will load lazily on first transcription request.")


@app.get("/api/health")
def health():
    """Health check endpoint."""
    return {"status": "ok", "version": "2.0.0"}


# Serve frontend static files (must be last)
dist_dir = Path(__file__).parent.parent / "dist"
frontend_dir = Path(__file__).parent.parent / "frontend"

if dist_dir.exists():
    app.mount("/", StaticFiles(directory=str(dist_dir), html=True), name="frontend")
elif frontend_dir.exists():
    app.mount("/", StaticFiles(directory=str(frontend_dir), html=True), name="frontend")
