"""Audio file upload, listing, and deletion endpoints."""
import uuid
import shutil
from pathlib import Path
from fastapi import APIRouter, UploadFile, File, Depends, HTTPException
from sqlalchemy.orm import Session

from pydantic import BaseModel

from ..models.database import get_db
from ..models.orm import AudioFile, ProcessStatus, TaskGroup
from ..config import settings

router = APIRouter(prefix="/api/audio", tags=["audio"])

ALLOWED_EXTENSIONS = {".mp3", ".wav", ".m4a", ".mp4", ".ogg", ".aac", ".flac", ".m4s"}


class TaskGroupCreate(BaseModel):
    name: str


@router.get("/tasks")
def list_tasks(db: Session = Depends(get_db)):
    """List all task groups."""
    tasks = db.query(TaskGroup).order_by(TaskGroup.created_at.asc()).all()
    return [t.to_dict() for t in tasks]


@router.post("/tasks")
def create_task(req: TaskGroupCreate, db: Session = Depends(get_db)):
    """Create a new task group."""
    existing = db.query(TaskGroup).filter(TaskGroup.name == req.name).first()
    if existing:
        raise HTTPException(400, "任务分类名称已存在")

    new_task = TaskGroup(name=req.name)
    db.add(new_task)
    db.commit()
    db.refresh(new_task)
    return new_task.to_dict()


@router.delete("/tasks/{task_id}")
def delete_task(task_id: str, db: Session = Depends(get_db)):
    """Delete a task group. Reset associated files to 'default'."""
    if task_id == "default":
        raise HTTPException(400, "默认任务分类不能删除")

    task = db.query(TaskGroup).filter(TaskGroup.id == task_id).first()
    if not task:
        raise HTTPException(404, "任务分类不存在")

    # Reset files in this task to default
    db.query(AudioFile).filter(AudioFile.task_id == task_id).update({"task_id": "default"})

    db.delete(task)
    db.commit()
    return {"ok": True}


@router.post("/upload")
async def upload_audio(
    file: UploadFile = File(...),
    task_id: str = "default",
    db: Session = Depends(get_db)
):
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
        task_id=task_id,
    )
    db.add(db_file)
    db.commit()
    db.refresh(db_file)

    return db_file.to_dict()


@router.get("/")
def list_files(task_id: str = None, db: Session = Depends(get_db)):
    """List audio files, newest first."""
    query = db.query(AudioFile)
    if task_id:
        query = query.filter(AudioFile.task_id == task_id)
    files = query.order_by(AudioFile.created_at.desc()).all()
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
