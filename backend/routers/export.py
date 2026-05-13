"""Export endpoints: single markdown download and batch ZIP export."""
import io
import zipfile
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session
from jose import JWTError

from ..models.database import get_db
from ..models.orm import AudioFile, ProcessStatus, User
from ..services.auth_service import decode_token
from ..config import settings

router = APIRouter(prefix="/api/export", tags=["export"])


def get_user_for_export(
    request: Request,
    token: Optional[str] = Query(default=None),
    db: Session = Depends(get_db),
) -> User:
    """Accept JWT token via Bearer header OR ?token= query param (for direct download URLs)."""
    # 1. Try query param first
    if token:
        try:
            payload = decode_token(token)
            user_id = payload.get("sub")
            if user_id:
                user = db.query(User).filter(User.id == user_id, User.is_active == True).first()
                if user:
                    return user
        except JWTError:
            pass

    # 2. Fall back to Authorization header
    auth_header = request.headers.get("Authorization", "")
    if auth_header.startswith("Bearer "):
        bearer_token = auth_header[7:]
        try:
            payload = decode_token(bearer_token)
            user_id = payload.get("sub")
            if user_id:
                user = db.query(User).filter(User.id == user_id, User.is_active == True).first()
                if user:
                    return user
        except JWTError:
            pass

    raise HTTPException(status_code=401, detail="认证失败，请登录后再下载")


@router.get("/{file_id}")
def export_single(
    file_id: str,
    include_transcription: bool = Query(False),
    current_user: User = Depends(get_user_for_export),
    db: Session = Depends(get_db),
):
    """Download study notes as a Markdown file. Enforces ownership."""
    f = (
        db.query(AudioFile)
        .filter(AudioFile.id == file_id, AudioFile.user_id == current_user.id)
        .first()
    )
    if not f or not f.study_notes:
        raise HTTPException(404, "笔记不存在")

    from urllib.parse import quote
    safe_name = f.name.replace("/", "_").replace("\\", "_").split(".")[0]
    filename = f"{safe_name}_学习笔记.md"
    encoded_filename = quote(filename)

    content = f.study_notes
    if include_transcription and f.transcription:
        content += "\n\n---\n\n## 原始录音文字\n\n" + f.transcription

    return StreamingResponse(
        io.BytesIO(content.encode("utf-8")),
        media_type="text/markdown; charset=utf-8",
        headers={"Content-Disposition": f"attachment; filename*=UTF-8''{encoded_filename}"},
    )


@router.get("/batch/zip")
def export_batch(
    include_transcription: bool = Query(False),
    current_user: User = Depends(get_user_for_export),
    db: Session = Depends(get_db),
):
    """Download all completed notes for the current user as a ZIP file."""
    completed = (
        db.query(AudioFile)
        .filter(
            AudioFile.user_id == current_user.id,
            AudioFile.status == ProcessStatus.COMPLETED,
            AudioFile.study_notes != "",
            AudioFile.study_notes.isnot(None),
        )
        .all()
    )

    if not completed:
        raise HTTPException(404, "没有已完成的笔记可导出")

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for f in completed:
            safe_name = f.name.replace("/", "_").replace("\\", "_").split(".")[0]
            content = f.study_notes
            if include_transcription and f.transcription:
                content += "\n\n---\n\n## 原始录音文字\n\n" + f.transcription
            zf.writestr(f"{safe_name}_学习笔记.md", content)

    buf.seek(0)
    return StreamingResponse(
        buf,
        media_type="application/zip",
        headers={
            "Content-Disposition": "attachment; filename=AudioSense_batch_export.zip"
        },
    )
