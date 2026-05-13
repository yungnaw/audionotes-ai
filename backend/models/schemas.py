"""Pydantic request/response schemas."""
from pydantic import BaseModel, EmailStr
from typing import Optional


# ===== Process =====
class ProcessRequest(BaseModel):
    prompt_template: str = ""
    provider: str = "gemini"
    api_key: Optional[str] = None
    model_name: Optional[str] = None


# ===== Bilibili =====
class BilibiliImportRequest(BaseModel):
    url: str
    cid: Optional[int] = None
    task_id: str = "default"


class BilibiliPageInfo(BaseModel):
    cid: int
    part: str
    page: int


class BilibiliListResponse(BaseModel):
    type: str = "list"
    title: str
    bvid: str
    pages: list[BilibiliPageInfo]


# ===== Audio =====
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
    task_id: Optional[str] = "default"
    user_id: Optional[str] = None
    created_at: Optional[str] = None
    updated_at: Optional[str] = None


# ===== Auth =====
class UserRegisterRequest(BaseModel):
    username: str
    password: str
    email: Optional[str] = None
    invite_code: Optional[str] = None  # optional invite gate


class UserLoginRequest(BaseModel):
    username: str
    password: str


class ChangePasswordRequest(BaseModel):
    old_password: str
    new_password: str


class UpdateProfileRequest(BaseModel):
    email: Optional[str] = None
    avatar_url: Optional[str] = None


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: dict


class UserResponse(BaseModel):
    id: str
    username: str
    email: Optional[str] = None
    role: str = "user"
    is_active: bool = True
    avatar_url: str = ""
    storage_quota_mb: int = 5120
    created_at: Optional[str] = None


# ===== Admin =====
class AdminUpdateUserRequest(BaseModel):
    is_active: Optional[bool] = None
    role: Optional[str] = None
    storage_quota_mb: Optional[int] = None
