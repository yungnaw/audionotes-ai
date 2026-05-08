"""Processing endpoints: local transcription + cloud note generation."""
import asyncio
import logging
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..models.database import get_db, SessionLocal
from ..models.orm import AudioFile, ProcessStatus
from ..models.schemas import ProcessRequest
from ..services import sensevoice_service, llm_service
from ..config import settings

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/process", tags=["process"])

paused_state = False

async def check_pause():
    while paused_state:
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
        summary_sem = asyncio.Semaphore(3)
    return summary_sem

def reset_transcribe_semaphore(concurrency: int):
    global transcribe_sem
    transcribe_sem = asyncio.Semaphore(concurrency)
    logger.info(f"本地转录并发数已联动更新为: {concurrency}")

async def process_task(file_id: str, request: ProcessRequest):
    # 第一阶段：转录 (GPU/CPU Bound)
    # 本地转录是高负载任务，通过 Semaphore(1) 让其排队，防显存溢出，且3秒一个速度极快
    async with get_transcribe_semaphore():
        await check_pause()
        db = SessionLocal()
        try:
            f = db.query(AudioFile).filter(AudioFile.id == file_id).first()
            if not f:
                return {"id": file_id, "status": "failed", "error": "文件不存在"}

            # Transcription
            if f.source_type == "bili_text" and f.transcription:
                # 已有文本直接进入待大模型生成状态
                f.status = ProcessStatus.SUMMARIZING
                f.progress = 50
                db.commit()
            else:
                await check_pause()
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
            except Exception as db_err:
                logger.exception("Failed to write transcription error state to DB")
            return {"id": file_id, "status": "failed", "error": f"转录失败: {str(e)}"}
        finally:
            db.close()

    # 此处本地 GPU 转录已经瞬间跑完并释放了 transcribe_semaphore 锁，
    # 后面文件的转录可以立即接上。当前文件不需要任何等待，直接启动第二阶段云端生成：

    # 第二阶段：大模型生成 (Cloud Network Bound)
    # 使用独立的 Semaphore(3) 保持网络多路高并发，同时温柔限流完美避免 503
    async with get_summary_semaphore():
        await check_pause()
        db = SessionLocal()
        try:
            f = db.query(AudioFile).filter(AudioFile.id == file_id).first()
            if not f or f.status == ProcessStatus.FAILED:
                return {"id": file_id, "status": "failed"}

            transcription_text = f.transcription
            if not transcription_text:
                raise Exception("未找到任何有效转录文本，无法生成笔记")

            await check_pause()
            f.status = ProcessStatus.SUMMARIZING
            f.progress = 60
            db.commit()

            notes = await llm_service.generate_notes(
                text=transcription_text,
                prompt_template=request.prompt_template,
                provider=request.provider,
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
            logger.exception(f"Summary failed for {file_id}")
            try:
                f = db.query(AudioFile).filter(AudioFile.id == file_id).first()
                if f:
                    f.status = ProcessStatus.FAILED
                    f.error_message = f"大模型生成失败: {str(e)}"
                    f.progress = 0
                    db.commit()
            except Exception as db_err:
                logger.exception("Failed to write summary error state to DB")
            return {"id": file_id, "status": "failed", "error": f"大模型生成失败: {str(e)}"}
        finally:
            db.close()


@router.post("/batch")
async def batch_process(
    request: ProcessRequest = ProcessRequest(),
    db: Session = Depends(get_db),
):
    """Process all pending (idle/failed) files concurrently with decoupled pipeline semaphores."""
    pending = (
        db.query(AudioFile)
        .filter(AudioFile.status.in_([ProcessStatus.IDLE, ProcessStatus.FAILED]))
        .all()
    )

    if not pending:
        return {"message": "没有待处理的文件", "processed": 0}

    pending_ids = [f.id for f in pending]

    # Launch all tasks in parallel using asyncio.gather
    tasks = [process_task(fid, request) for fid in pending_ids]
    results = await asyncio.gather(*tasks)

    return {"processed": len(results), "results": results}


@router.post("/{file_id}")
async def process_file(
    file_id: str,
    request: ProcessRequest = ProcessRequest(),
    db: Session = Depends(get_db),
):
    """Full processing pipeline: local SenseVoice transcription → cloud Gemini notes."""
    res = await process_task(file_id, request)
    if res.get("status") == "failed":
        raise HTTPException(500, res.get("error", "处理失败"))
    f = db.query(AudioFile).filter(AudioFile.id == file_id).first()
    if not f:
        raise HTTPException(404, "文件不存在")
    return f.to_dict()


@router.post("/pause")
def pause_processing():
    global paused_state
    paused_state = True
    return {"paused": True}


@router.post("/resume")
def resume_processing():
    global paused_state
    paused_state = False
    return {"paused": False}


@router.get("/status")
def get_pause_status():
    global paused_state
    return {"paused": paused_state}
