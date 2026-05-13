"""Admin endpoints: user management and system stats."""
import logging
from pathlib import Path
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..models.database import get_db
from ..models.orm import User, UserRole, AudioFile, ProcessStatus
from ..models.schemas import AdminUpdateUserRequest
from ..services.auth_service import require_admin
from ..config import settings

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/admin", tags=["admin"])


@router.get("/users")
def list_users(
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """List all registered users with basic stats."""
    users = db.query(User).order_by(User.created_at.asc()).all()
    result = []
    for u in users:
        d = u.to_dict()
        d["file_count"] = db.query(AudioFile).filter(AudioFile.user_id == u.id).count()
        result.append(d)
    return result


@router.put("/users/{user_id}")
def update_user(
    user_id: str,
    req: AdminUpdateUserRequest,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """Update user status, role, or quota."""
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(404, "用户不存在")
    if user_id == admin.id and req.role == "user":
        raise HTTPException(400, "不能降低自己的权限")

    if req.is_active is not None:
        user.is_active = req.is_active
    if req.role is not None:
        try:
            user.role = UserRole(req.role)
        except ValueError:
            raise HTTPException(400, f"无效的角色: {req.role}")
    if req.storage_quota_mb is not None:
        user.storage_quota_mb = req.storage_quota_mb

    db.commit()
    return user.to_dict()


@router.delete("/users/{user_id}")
def delete_user(
    user_id: str,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """Delete a user and all their data."""
    if user_id == admin.id:
        raise HTTPException(400, "不能删除自己的账号")
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(404, "用户不存在")

    # Delete user's files from disk
    files = db.query(AudioFile).filter(AudioFile.user_id == user_id).all()
    for f in files:
        if f.file_path:
            p = Path(f.file_path)
            if p.exists():
                try:
                    p.unlink()
                except Exception:
                    pass
        db.delete(f)

    db.delete(user)
    db.commit()
    return {"ok": True, "deleted_files": len(files)}


@router.get("/stats")
def system_stats(
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """Global system statistics."""
    total_users = db.query(User).count()
    active_users = db.query(User).filter(User.is_active == True).count()
    total_files = db.query(AudioFile).count()
    completed_files = db.query(AudioFile).filter(
        AudioFile.status == ProcessStatus.COMPLETED
    ).count()
    failed_files = db.query(AudioFile).filter(
        AudioFile.status == ProcessStatus.FAILED
    ).count()

    # Disk usage
    upload_dir = Path(settings.UPLOAD_DIR)
    total_size_bytes = sum(
        f.stat().st_size for f in upload_dir.rglob("*") if f.is_file()
    ) if upload_dir.exists() else 0

    return {
        "users": {
            "total": total_users,
            "active": active_users,
        },
        "files": {
            "total": total_files,
            "completed": completed_files,
            "failed": failed_files,
        },
        "storage": {
            "used_bytes": total_size_bytes,
            "used_mb": round(total_size_bytes / 1024 / 1024, 2),
        },
    }
