"""Pydantic request/response schemas."""
from pydantic import BaseModel
from typing import Optional


class ProcessRequest(BaseModel):
    prompt_template: str = ""
    provider: str = "gemini"
    api_key: Optional[str] = None
    model_name: Optional[str] = None


class BilibiliImportRequest(BaseModel):
    url: str
    cid: Optional[int] = None
    task_id: str = "default"


class AudioFileResponse(BaseModel):
    id: str
    name: str
    original_filename: Optional[str] = None
    file_size: int = 0
    mime_type: Optional[str] = None
    source_type: str = "file"
    status: str = "idle"
    progress: int = 0
    transcription: str = ""
    study_notes: str = ""
    custom_prompt: str = ""
    error_message: str = ""
    duration: float = 0.0
    language: str = ""
    created_at: Optional[str] = None
    updated_at: Optional[str] = None


class BilibiliPageInfo(BaseModel):
    cid: int
    part: str
    page: int


class BilibiliListResponse(BaseModel):
    type: str = "list"
    title: str
    bvid: str
    pages: list[BilibiliPageInfo]
