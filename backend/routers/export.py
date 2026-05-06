"""Export endpoints: single markdown download and batch ZIP export."""
import io
import zipfile
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from ..models.database import get_db
from ..models.orm import AudioFile, ProcessStatus

router = APIRouter(prefix="/api/export", tags=["export"])


@router.get("/{file_id}")
def export_single(file_id: str, db: Session = Depends(get_db)):
    """Download study notes as a Markdown file."""
    f = db.query(AudioFile).filter(AudioFile.id == file_id).first()
    if not f or not f.study_notes:
        raise HTTPException(404, "笔记不存在")

    from urllib.parse import quote
    safe_name = f.name.replace("/", "_").replace("\\", "_").split(".")[0]
    filename = f"{safe_name}_学习笔记.md"
    encoded_filename = quote(filename)

    return StreamingResponse(
        io.BytesIO(f.study_notes.encode("utf-8")),
        media_type="text/markdown; charset=utf-8",
        headers={"Content-Disposition": f"attachment; filename*=UTF-8''{encoded_filename}"},
    )


@router.get("/batch/zip")
def export_batch(db: Session = Depends(get_db)):
    """Download all completed notes as a ZIP file."""
    completed = (
        db.query(AudioFile)
        .filter(
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
            zf.writestr(f"{safe_name}_学习笔记.md", f.study_notes)

    buf.seek(0)
    return StreamingResponse(
        buf,
        media_type="application/zip",
        headers={
            "Content-Disposition": "attachment; filename=AudioSense_batch_export.zip"
        },
    )
