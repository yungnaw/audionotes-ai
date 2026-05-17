"""Processing endpoints: local transcription + cloud note generation."""
import asyncio
import json
import logging
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from ..models.database import get_db, SessionLocal
from ..models.orm import AudioFile, ProcessStatus, User
from ..models.schemas import ProcessRequest
from ..services import sensevoice_service, llm_service
from ..services.auth_service import get_current_user
from ..config import settings

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/process", tags=["process"])

paused_file_ids: set = set()
running_file_ids: set = set()


async def check_pause(file_id: str):
    """Block while this specific file is paused."""
    while file_id in paused_file_ids:
        await asyncio.sleep(0.5)


transcribe_sem = None
summary_sem = None


def get_transcribe_semaphore() -> asyncio.Semaphore:
    global transcribe_sem
    if transcribe_sem is None:
        transcribe_sem = asyncio.Semaphore(settings.SENSEVOICE_NCPU)
    return transcribe_sem


def get_summary_semaphore() -> asyncio.Semaphore:
    global summary_sem
    if summary_sem is None:
        summary_sem = asyncio.Semaphore(settings.SUMMARY_CONCURRENCY)
    return summary_sem


def reset_summary_semaphore(concurrency: int):
    global summary_sem
    summary_sem = asyncio.Semaphore(concurrency)
    logger.info(f"大模型并发数已联动更新为: {concurrency}")


def reset_transcribe_semaphore(concurrency: int):
    global transcribe_sem
    transcribe_sem = asyncio.Semaphore(concurrency)
    logger.info(f"本地转录并发数已联动更新为: {concurrency}")


async def process_task(file_id: str, request: ProcessRequest, user_id: str):
    """Core pipeline: transcription → LLM notes. user_id ensures ownership."""
    global running_file_ids
    running_file_ids.add(file_id)
    try:
        # Phase 1: Local transcription (CPU/GPU-bound, serialised by semaphore)
        async with get_transcribe_semaphore():
            await check_pause(file_id)
            db = SessionLocal()
            try:
                f = (
                    db.query(AudioFile)
                    .filter(AudioFile.id == file_id, AudioFile.user_id == user_id)
                    .first()
                )
                if not f:
                    return {"id": file_id, "status": "failed", "error": "文件不存在或无权限"}

                if f.transcription:
                    f.status = ProcessStatus.SUMMARIZING
                    f.progress = 50
                    db.commit()
                else:
                    await check_pause(file_id)
                    f.status = ProcessStatus.TRANSCRIBING
                    f.progress = 20
                    db.commit()

                    result = await asyncio.to_thread(
                        sensevoice_service.transcribe, f.file_path
                    )
                    f.transcription = result["full_text"]
                    f.language = result.get("language", "")
                    f.status = ProcessStatus.SUMMARIZING
                    f.progress = 50
                    db.commit()

            except Exception as e:
                logger.exception(f"Transcription failed for {file_id}")
                try:
                    f = db.query(AudioFile).filter(AudioFile.id == file_id).first()
                    if f:
                        f.status = ProcessStatus.FAILED
                        f.error_message = f"转录失败: {str(e)}"
                        f.progress = 0
                        db.commit()
                except Exception:
                    logger.exception("Failed to write transcription error state to DB")
                return {"id": file_id, "status": "failed", "error": f"转录失败: {str(e)}"}
            finally:
                db.close()

        # Phase 2: Cloud LLM note generation (network-bound)
        async with get_summary_semaphore():
            await check_pause(file_id)
            db = SessionLocal()
            try:
                f = db.query(AudioFile).filter(AudioFile.id == file_id).first()
                if not f or f.status == ProcessStatus.FAILED:
                    return {"id": file_id, "status": "failed"}

                transcription_text = f.transcription
                if not transcription_text:
                    raise Exception("未找到任何有效转录文本，无法生成笔记")

                await check_pause(file_id)
                f.status = ProcessStatus.SUMMARIZING
                f.progress = 60
                db.commit()

                notes = await llm_service.generate_notes(
                    text=transcription_text,
                    prompt_template=request.prompt_template,
                    provider=request.provider,
                    api_key=request.api_key,
                    model_name=request.model_name,
                    base_url=request.base_url,
                )

                f.study_notes = notes
                f.status = ProcessStatus.COMPLETED
                f.progress = 100
                f.custom_prompt = request.prompt_template
                db.commit()
                return {"id": file_id, "status": "completed"}

            except Exception as e:
                logger.exception(f"Summary failed for {file_id}")
                try:
                    f = db.query(AudioFile).filter(AudioFile.id == file_id).first()
                    if f:
                        f.status = ProcessStatus.FAILED
                        f.error_message = f"大模型生成失败: {str(e)}"
                        f.progress = 0
                        db.commit()
                except Exception:
                    logger.exception("Failed to write summary error state to DB")
                return {"id": file_id, "status": "failed", "error": f"大模型生成失败: {str(e)}"}
            finally:
                db.close()
    finally:
        running_file_ids.discard(file_id)


@router.post("/batch")
async def batch_process(
    request: ProcessRequest = ProcessRequest(),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Process all pending files for the current user."""
    pending = (
        db.query(AudioFile)
        .filter(
            AudioFile.user_id == current_user.id,
            AudioFile.status.in_([ProcessStatus.IDLE, ProcessStatus.FAILED]),
        )
        .all()
    )

    if not pending:
        return {"message": "没有待处理的文件", "processed": 0}

    pending_ids = [f.id for f in pending]
    tasks = [process_task(fid, request, current_user.id) for fid in pending_ids]
    results = await asyncio.gather(*tasks)

    return {"processed": len(results), "results": results}


# ===== Pause / Resume (must be before /{file_id} to avoid route conflict) =====

@router.post("/pause")
def pause_processing(current_user: User = Depends(get_current_user)):
    """Pause all currently processing files for this user."""
    global paused_file_ids
    db = SessionLocal()
    try:
        processing = (
            db.query(AudioFile)
            .filter(
                AudioFile.user_id == current_user.id,
                AudioFile.status.in_([ProcessStatus.TRANSCRIBING, ProcessStatus.SUMMARIZING]),
            )
            .all()
        )
        for f in processing:
            paused_file_ids.add(f.id)
        return {"paused": list(paused_file_ids), "count": len(processing)}
    finally:
        db.close()


@router.post("/resume")
def resume_processing(current_user: User = Depends(get_current_user)):
    """Resume all paused files for this user."""
    global paused_file_ids
    db = SessionLocal()
    try:
        processing = (
            db.query(AudioFile)
            .filter(
                AudioFile.user_id == current_user.id,
                AudioFile.status.in_([ProcessStatus.TRANSCRIBING, ProcessStatus.SUMMARIZING]),
            )
            .all()
        )
        needs_restart_ids = []
        for f in processing:
            paused_file_ids.discard(f.id)
            if f.id not in running_file_ids:
                needs_restart_ids.append(f.id)
        return {"paused": [], "count": 0, "needs_restart_ids": needs_restart_ids}
    finally:
        db.close()


@router.get("/status")
def get_pause_status(current_user: User = Depends(get_current_user)):
    global paused_file_ids
    return {"paused_file_ids": list(paused_file_ids)}


# ===== Per-file pause / resume =====

@router.post("/{file_id}/pause")
def pause_single_file(
    file_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Pause a single file. Only works on transcribing/summarizing files."""
    f = db.query(AudioFile).filter(
        AudioFile.id == file_id, AudioFile.user_id == current_user.id
    ).first()
    if not f:
        raise HTTPException(404, "文件不存在或无权限")
    if f.status not in (ProcessStatus.TRANSCRIBING, ProcessStatus.SUMMARIZING):
        raise HTTPException(400, "只能暂停正在转录或生成中的文件")

    global paused_file_ids
    paused_file_ids.add(file_id)
    return {"paused": True, "file_id": file_id}


@router.post("/{file_id}/resume")
def resume_single_file(
    file_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Resume a single paused file."""
    f = db.query(AudioFile).filter(
        AudioFile.id == file_id, AudioFile.user_id == current_user.id
    ).first()
    if not f:
        raise HTTPException(404, "文件不存在或无权限")

    global paused_file_ids, running_file_ids
    paused_file_ids.discard(file_id)
    needs_restart = file_id not in running_file_ids
    return {"paused": False, "file_id": file_id, "needs_restart": needs_restart}


# ===== Streaming processing endpoint =====

async def _ensure_transcription(file_id: str, user_id: str) -> str:
    """Ensure a file has been transcribed. Returns the transcription text."""
    db = SessionLocal()
    try:
        f = db.query(AudioFile).filter(
            AudioFile.id == file_id, AudioFile.user_id == user_id
        ).first()
        if not f:
            raise HTTPException(404, "文件不存在或无权限")

        if f.transcription:
            return f.transcription

        # Transcribe now
        if not f.file_path:
            raise HTTPException(400, "该文件没有音频数据，无法转录")

        await check_pause(file_id)
        f.status = ProcessStatus.TRANSCRIBING
        f.progress = 20
        db.commit()

        async with get_transcribe_semaphore():
            await check_pause(file_id)
            result = await asyncio.to_thread(
                sensevoice_service.transcribe, f.file_path
            )
            f.transcription = result["full_text"]
            f.language = result.get("language", "")
            f.status = ProcessStatus.SUMMARIZING
            f.progress = 50
            db.commit()

        return f.transcription
    finally:
        db.close()


@router.post("/{file_id}/stream")
async def process_file_stream(
    file_id: str,
    request: ProcessRequest = ProcessRequest(),
    current_user: User = Depends(get_current_user),
):
    """Stream LLM note generation via Server-Sent Events. Transcribes first if needed."""
    global running_file_ids
    running_file_ids.add(file_id)

    # Step 1: Ensure transcription exists
    try:
        transcription_text = await _ensure_transcription(file_id, current_user.id)
    except HTTPException:
        running_file_ids.discard(file_id)
        raise
    except Exception as e:
        running_file_ids.discard(file_id)
        logger.exception(f"Transcription failed for {file_id}")
        raise HTTPException(500, f"转录失败: {str(e)}")

    if not transcription_text:
        running_file_ids.discard(file_id)
        raise HTTPException(400, "未找到任何有效转录文本，无法生成笔记")

    # Step 2: Stream LLM output
    async def event_stream():
        full_text = ""
        db = SessionLocal()
        try:
            f = db.query(AudioFile).filter(AudioFile.id == file_id).first()
            if f:
                f.status = ProcessStatus.SUMMARIZING
                f.progress = 60
                db.commit()

            async for chunk in llm_service.generate_notes_stream(
                text=transcription_text,
                prompt_template=request.prompt_template,
                provider=request.provider,
                api_key=request.api_key,
                model_name=request.model_name,
                base_url=request.base_url,
            ):
                full_text += chunk
                yield f"data: {json.dumps({'chunk': chunk}, ensure_ascii=False)}\n\n"
                await asyncio.sleep(0.02)  # let the event loop flush this chunk to the client

            # Save completed notes
            if f:
                f.study_notes = full_text
                f.status = ProcessStatus.COMPLETED
                f.progress = 100
                f.custom_prompt = request.prompt_template
                db.commit()

            yield f"data: {json.dumps({'done': True})}\n\n"

        except Exception as e:
            logger.exception(f"Streaming failed for {file_id}")
            if f:
                f.status = ProcessStatus.FAILED
                f.error_message = f"大模型生成失败: {str(e)}"
                f.progress = 0
                db.commit()
            yield f"data: {json.dumps({'error': str(e)}, ensure_ascii=False)}\n\n"
        finally:
            db.close()
            running_file_ids.discard(file_id)

    return StreamingResponse(event_stream(), media_type="text/event-stream")


@router.post("/{file_id}")
async def process_file(
    file_id: str,
    request: ProcessRequest = ProcessRequest(),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Full processing pipeline for a single file. Enforces ownership."""
    f = (
        db.query(AudioFile)
        .filter(AudioFile.id == file_id, AudioFile.user_id == current_user.id)
        .first()
    )
    if not f:
        raise HTTPException(404, "文件不存在或无权限")

    res = await process_task(file_id, request, current_user.id)
    if res.get("status") == "failed":
        raise HTTPException(500, res.get("error", "处理失败"))

    db.refresh(f)
    return f.to_dict()
