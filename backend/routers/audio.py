"""Audio file upload, listing, and deletion endpoints."""
import uuid
import shutil
from pathlib import Path
from fastapi import APIRouter, UploadFile, File, Depends, HTTPException
from sqlalchemy.orm import Session

from ..models.database import get_db
from ..models.orm import AudioFile, ProcessStatus
from ..config import settings

router = APIRouter(prefix="/api/audio", tags=["audio"])

ALLOWED_EXTENSIONS = {".mp3", ".wav", ".m4a", ".mp4", ".ogg", ".aac", ".flac", ".m4s"}


@router.post("/upload")
async def upload_audio(file: UploadFile = File(...), db: Session = Depends(get_db)):
    """Upload an audio file to the server."""
    ext = Path(file.filename or "").suffix.lower()
    if ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(400, f"不支持的文件类型: {ext}")

    file_id = uuid.uuid4().hex[:12]
    save_path = Path(settings.UPLOAD_DIR) / f"{file_id}{ext}"

    with open(save_path, "wb") as f:
        shutil.copyfileobj(file.file, f)

    file_size = save_path.stat().st_size

    db_file = AudioFile(
        id=file_id,
        name=file.filename or f"audio{ext}",
        original_filename=file.filename,
        file_path=str(save_path),
        file_size=file_size,
        mime_type=file.content_type or "audio/mpeg",
        source_type="file",
        status=ProcessStatus.IDLE,
    )
    db.add(db_file)
    db.commit()
    db.refresh(db_file)

    return db_file.to_dict()


@router.get("/")
def list_files(db: Session = Depends(get_db)):
    """List all audio files, newest first."""
    files = db.query(AudioFile).order_by(AudioFile.created_at.desc()).all()
    return [f.to_dict() for f in files]


@router.get("/{file_id}")
def get_file(file_id: str, db: Session = Depends(get_db)):
    """Get a single audio file by ID."""
    f = db.query(AudioFile).filter(AudioFile.id == file_id).first()
    if not f:
        raise HTTPException(404, "文件不存在")
    return f.to_dict()


@router.delete("/{file_id}")
def delete_file(file_id: str, db: Session = Depends(get_db)):
    """Delete an audio file and its stored data."""
    f = db.query(AudioFile).filter(AudioFile.id == file_id).first()
    if not f:
        raise HTTPException(404, "文件不存在")

    # Delete physical file
    if f.file_path:
        p = Path(f.file_path)
        if p.exists():
            try:
                p.unlink()
            except Exception as e:
                # Log but continue deletion from DB
                print(f"Warning: could not delete physical file {f.file_path}: {e}")

    db.delete(f)
    db.commit()
    return {"ok": True}


@router.delete("/")
def delete_all(db: Session = Depends(get_db)):
    """Delete all audio files."""
    files = db.query(AudioFile).all()
    for f in files:
        if f.file_path:
            p = Path(f.file_path)
            if p.exists():
                try:
                    p.unlink()
                except Exception as e:
                    print(f"Warning: could not delete physical file {f.file_path}: {e}")
        db.delete(f)
    db.commit()
    return {"ok": True, "deleted": len(files)}
