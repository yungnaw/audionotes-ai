"""Bilibili video import endpoints."""
import uuid
import logging
from pathlib import Path
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..models.database import get_db
from ..models.orm import AudioFile, ProcessStatus
from ..models.schemas import BilibiliImportRequest
from ..services import bilibili_service
from ..config import settings

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/bilibili", tags=["bilibili"])


@router.post("/import")
async def import_bilibili(
    request: BilibiliImportRequest,
    db: Session = Depends(get_db),
):
    """Import content from a Bilibili video URL."""
    try:
        data = await bilibili_service.extract_video_info(request.url, request.cid)
    except ValueError as e:
        raise HTTPException(400, str(e))
    except Exception as e:
        logger.exception("Bilibili import failed")
        raise HTTPException(500, f"B站导入失败: {str(e)}")

    # Multi-part video: return page list for user to choose
    if data["type"] == "list":
        return data

    file_id = uuid.uuid4().hex[:12]

    if data["type"] == "text":
        # Fast path: subtitles available
        db_file = AudioFile(
            id=file_id,
            name=f"[B站字幕] {data['title']}",
            source_type="bili_text",
            status=ProcessStatus.IDLE,
            transcription=data["content"],
            task_id=request.task_id,
        )
        db.add(db_file)
        db.commit()
        db.refresh(db_file)
        return db_file.to_dict()

    elif data["type"] == "audio":
        # Slow path: save audio for local transcription
        save_path = Path(settings.UPLOAD_DIR) / f"{file_id}.mp4"
        with open(save_path, "wb") as f:
            f.write(data["data"])

        db_file = AudioFile(
            id=file_id,
            name=f"[B站音频] {data['title']}",
            file_path=str(save_path),
            file_size=len(data["data"]),
            mime_type=data.get("mime_type", "audio/mp4"),
            source_type="bili_audio",
            status=ProcessStatus.IDLE,
            task_id=request.task_id,
        )
        db.add(db_file)
        db.commit()
        db.refresh(db_file)
        return db_file.to_dict()
