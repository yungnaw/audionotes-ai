"""Audio file upload, listing, and deletion endpoints."""
import uuid
import shutil
from pathlib import Path
from fastapi import APIRouter, UploadFile, File, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from typing import List
from pydantic import BaseModel

from ..models.database import get_db
from ..models.orm import AudioFile, ProcessStatus, TaskGroup, User
from ..services.auth_service import get_current_user
from ..config import settings

router = APIRouter(prefix="/api/audio", tags=["audio"])

ALLOWED_EXTENSIONS = {".mp3", ".wav", ".m4a", ".mp4", ".ogg", ".aac", ".flac", ".m4s"}


class TaskGroupCreate(BaseModel):
    name: str


class FileMoveRequest(BaseModel):
    task_id: str


class BatchMoveRequest(BaseModel):
    file_ids: List[str]
    task_id: str


# ===== Task Groups =====

@router.get("/tasks")
def list_tasks(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """List task groups belonging to current user."""
    tasks = (
        db.query(TaskGroup)
        .filter(TaskGroup.user_id == current_user.id)
        .order_by(TaskGroup.created_at.asc())
        .all()
    )
    return [t.to_dict() for t in tasks]


@router.post("/tasks")
def create_task(
    req: TaskGroupCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Create a new task group for current user."""
    existing = (
        db.query(TaskGroup)
        .filter(TaskGroup.name == req.name, TaskGroup.user_id == current_user.id)
        .first()
    )
    if existing:
        raise HTTPException(400, "任务分类名称已存在")

    new_task = TaskGroup(name=req.name, user_id=current_user.id)
    db.add(new_task)
    db.commit()
    db.refresh(new_task)
    return new_task.to_dict()


@router.delete("/tasks/{task_id}")
def delete_task(
    task_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Delete a task group (cannot delete 'default'). Moves files to default."""
    if task_id == "default":
        raise HTTPException(400, "默认任务分类不能删除")

    task = (
        db.query(TaskGroup)
        .filter(TaskGroup.id == task_id, TaskGroup.user_id == current_user.id)
        .first()
    )
    if not task:
        raise HTTPException(404, "任务分类不存在")

    # Reset files in this task to default
    db.query(AudioFile).filter(
        AudioFile.task_id == task_id,
        AudioFile.user_id == current_user.id,
    ).update({"task_id": "default"})

    db.delete(task)
    db.commit()
    return {"ok": True}


# ===== Files =====

@router.post("/upload")
async def upload_audio(
    file: UploadFile = File(...),
    task_id: str = Query(default="default"),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Upload an audio file. Stored under uploads/{user_id}/."""
    ext = Path(file.filename or "").suffix.lower()
    if ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(400, f"不支持的文件类型: {ext}")

    # Per-user upload directory
    user_dir = Path(settings.UPLOAD_DIR) / current_user.id
    user_dir.mkdir(parents=True, exist_ok=True)

    file_id = uuid.uuid4().hex[:12]
    save_path = user_dir / f"{file_id}{ext}"

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
        user_id=current_user.id,
    )
    db.add(db_file)
    db.commit()
    db.refresh(db_file)

    return db_file.to_dict()


@router.get("/")
def list_files(
    task_id: str = None,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """List audio files for the current user, newest first."""
    query = db.query(AudioFile).filter(AudioFile.user_id == current_user.id)
    if task_id:
        query = query.filter(AudioFile.task_id == task_id)
    files = query.order_by(AudioFile.created_at.desc()).all()
    return [f.to_dict() for f in files]


@router.get("/{file_id}")
def get_file(
    file_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Get a single audio file by ID. Enforces ownership."""
    f = (
        db.query(AudioFile)
        .filter(AudioFile.id == file_id, AudioFile.user_id == current_user.id)
        .first()
    )
    if not f:
        raise HTTPException(404, "文件不存在")
    return f.to_dict()


@router.delete("/{file_id}")
def delete_file(
    file_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Delete an audio file. Enforces ownership."""
    f = (
        db.query(AudioFile)
        .filter(AudioFile.id == file_id, AudioFile.user_id == current_user.id)
        .first()
    )
    if not f:
        raise HTTPException(404, "文件不存在")

    if f.file_path:
        p = Path(f.file_path)
        if p.exists():
            try:
                p.unlink()
            except Exception as e:
                print(f"Warning: could not delete physical file {f.file_path}: {e}")

    db.delete(f)
    db.commit()
    return {"ok": True}


@router.delete("/")
def delete_all(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Delete all audio files belonging to current user."""
    files = db.query(AudioFile).filter(AudioFile.user_id == current_user.id).all()
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


@router.put("/{file_id}/move")
def move_file(
    file_id: str,
    req: FileMoveRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Move a file to a different task scenario/group."""
    f = (
        db.query(AudioFile)
        .filter(AudioFile.id == file_id, AudioFile.user_id == current_user.id)
        .first()
    )
    if not f:
        raise HTTPException(404, "文件不存在")

    # Validate task_id exists (unless it's "default")
    if req.task_id != "default":
        task = db.query(TaskGroup).filter(TaskGroup.id == req.task_id, TaskGroup.user_id == current_user.id).first()
        if not task:
            raise HTTPException(404, "目标任务场景不存在")

    f.task_id = req.task_id
    db.commit()
    db.refresh(f)
    return f.to_dict()


@router.post("/batch/move")
def batch_move(
    req: BatchMoveRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Move multiple files to a different task scenario."""
    if not req.file_ids:
        return {"ok": True, "updated_count": 0}

    # Validate task
    if req.task_id != "default":
        task = db.query(TaskGroup).filter(TaskGroup.id == req.task_id, TaskGroup.user_id == current_user.id).first()
        if not task:
            raise HTTPException(404, "目标任务场景不存在")

    # Update all files owned by current user
    updated = db.query(AudioFile).filter(
        AudioFile.id.in_(req.file_ids),
        AudioFile.user_id == current_user.id
    ).update({"task_id": req.task_id}, synchronize_session=False)
    
    db.commit()
    return {"ok": True, "updated_count": updated}
