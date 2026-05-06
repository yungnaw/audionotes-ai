"""Processing endpoints: local transcription + cloud note generation."""
import asyncio
import logging
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..models.database import get_db, SessionLocal
from ..models.orm import AudioFile, ProcessStatus
from ..models.schemas import ProcessRequest
from ..services import sensevoice_service, gemini_service

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/process", tags=["process"])


async def process_task(file_id: str, request: ProcessRequest, semaphore: asyncio.Semaphore):
    async with semaphore:
        db = SessionLocal()
        try:
            f = db.query(AudioFile).filter(AudioFile.id == file_id).first()
            if not f:
                return {"id": file_id, "status": "failed", "error": "文件不存在"}

            # Transcription
            if f.source_type == "bili_text" and f.transcription:
                transcription_text = f.transcription
            else:
                f.status = ProcessStatus.TRANSCRIBING
                f.progress = 20
                db.commit()

                result = await asyncio.to_thread(
                    sensevoice_service.transcribe, f.file_path
                )
                transcription_text = result["full_text"]
                f.transcription = transcription_text
                f.language = result.get("language", "")
                f.progress = 50
                db.commit()

            # Note generation
            f.status = ProcessStatus.SUMMARIZING
            f.progress = 60
            db.commit()

            notes = await gemini_service.generate_notes(
                text=transcription_text,
                prompt_template=request.prompt_template,
                api_key=request.api_key,
                model_name=request.model_name,
            )

            f.study_notes = notes
            f.status = ProcessStatus.COMPLETED
            f.progress = 100
            f.custom_prompt = request.prompt_template
            db.commit()
            return {"id": file_id, "status": "completed"}

        except Exception as e:
            logger.exception(f"Batch processing failed for {file_id}")
            try:
                # Re-query f to avoid stale session issues
                f = db.query(AudioFile).filter(AudioFile.id == file_id).first()
                if f:
                    f.status = ProcessStatus.FAILED
                    f.error_message = str(e)
                    f.progress = 0
                    db.commit()
            except Exception as db_err:
                logger.exception("Failed to write task error state to DB")
            return {"id": file_id, "status": "failed", "error": str(e)}
        finally:
            db.close()


@router.post("/batch")
async def batch_process(
    request: ProcessRequest = ProcessRequest(),
    db: Session = Depends(get_db),
):
    """Process all pending (idle/failed) files concurrently with a limit of 8."""
    pending = (
        db.query(AudioFile)
        .filter(AudioFile.status.in_([ProcessStatus.IDLE, ProcessStatus.FAILED]))
        .all()
    )

    if not pending:
        return {"message": "没有待处理的文件", "processed": 0}

    pending_ids = [f.id for f in pending]
    semaphore = asyncio.Semaphore(8)

    # Launch all tasks in parallel using asyncio.gather
    tasks = [process_task(fid, request, semaphore) for fid in pending_ids]
    results = await asyncio.gather(*tasks)

    return {"processed": len(results), "results": results}

@router.post("/{file_id}")
async def process_file(
    file_id: str,
    request: ProcessRequest = ProcessRequest(),
    db: Session = Depends(get_db),
):
    """Full processing pipeline: local SenseVoice transcription → cloud Gemini notes."""
    f = db.query(AudioFile).filter(AudioFile.id == file_id).first()
    if not f:
        raise HTTPException(404, "文件不存在")

    try:
        # Step 1: Transcription (local or skip if already has text)
        if f.source_type == "bili_text" and f.transcription:
            # B站字幕已有文本，跳过转录
            transcription_text = f.transcription
        else:
            # 本地 SenseVoice 转录
            f.status = ProcessStatus.TRANSCRIBING
            f.progress = 20
            db.commit()

            result = await asyncio.to_thread(
                sensevoice_service.transcribe, f.file_path
            )
            transcription_text = result["full_text"]

            f.transcription = transcription_text
            f.language = result.get("language", "")
            f.progress = 50
            db.commit()

        # Step 2: Note generation (cloud Gemini)
        f.status = ProcessStatus.SUMMARIZING
        f.progress = 60
        db.commit()

        notes = await gemini_service.generate_notes(
            text=transcription_text,
            prompt_template=request.prompt_template,
            api_key=request.api_key,
            model_name=request.model_name,
        )

        # Step 3: Save results
        f.study_notes = notes
        f.status = ProcessStatus.COMPLETED
        f.progress = 100
        f.custom_prompt = request.prompt_template
        db.commit()

        return f.to_dict()

    except Exception as e:
        logger.exception(f"Processing failed for {file_id}")
        f.status = ProcessStatus.FAILED
        f.progress = 0
        f.error_message = str(e)
        db.commit()
        raise HTTPException(500, f"处理失败: {str(e)}")
