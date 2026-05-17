"""SQLAlchemy ORM models."""
import uuid
import enum
from datetime import datetime
from sqlalchemy import Column, String, Integer, Text, Enum, DateTime, Float, Boolean
from .database import Base


class ProcessStatus(str, enum.Enum):
    IDLE = "idle"
    TRANSCRIBING = "transcribing"
    SUMMARIZING = "summarizing"
    COMPLETED = "completed"
    FAILED = "failed"


class UserRole(str, enum.Enum):
    ADMIN = "admin"
    USER = "user"


class User(Base):
    __tablename__ = "users"

    id = Column(String, primary_key=True, default=lambda: uuid.uuid4().hex[:12])
    username = Column(String(64), unique=True, nullable=False, index=True)
    email = Column(String(256), unique=True, nullable=True, index=True)
    password_hash = Column(String(256), nullable=False)
    role = Column(Enum(UserRole), default=UserRole.USER)
    is_active = Column(Boolean, default=True)
    avatar_url = Column(String, default="")
    default_prompt = Column(String, default="")
    storage_quota_mb = Column(Integer, default=5120)  # 5 GB default
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    def to_dict(self):
        return {
            "id": self.id,
            "username": self.username,
            "email": self.email,
            "role": self.role.value if self.role else "user",
            "is_active": self.is_active,
            "avatar_url": self.avatar_url,
            "default_prompt": self.default_prompt,
            "storage_quota_mb": self.storage_quota_mb,
            "created_at": self.created_at.isoformat() if self.created_at else None,
        }


class AudioFile(Base):
    __tablename__ = "audio_files"

    id = Column(String, primary_key=True, default=lambda: uuid.uuid4().hex[:12])
    name = Column(String, nullable=False)
    original_filename = Column(String)
    file_path = Column(String)
    file_size = Column(Integer, default=0)
    mime_type = Column(String)
    source_type = Column(String, default="file")  # 'file' | 'bili_text' | 'bili_audio'
    status = Column(Enum(ProcessStatus), default=ProcessStatus.IDLE)
    progress = Column(Integer, default=0)
    transcription = Column(Text, default="")
    study_notes = Column(Text, default="")
    custom_prompt = Column(Text, default="")
    error_message = Column(Text, default="")
    duration = Column(Float, default=0.0)
    language = Column(String, default="")
    task_id = Column(String, default="default")
    user_id = Column(String, nullable=True, index=True)  # nullable for legacy data
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    def to_dict(self):
        return {
            "id": self.id,
            "name": self.name,
            "original_filename": self.original_filename,
            "file_size": self.file_size,
            "mime_type": self.mime_type,
            "source_type": self.source_type,
            "status": self.status.value if self.status else "idle",
            "progress": self.progress,
            "transcription": self.transcription or "",
            "study_notes": self.study_notes or "",
            "custom_prompt": self.custom_prompt or "",
            "error_message": self.error_message or "",
            "duration": self.duration,
            "language": self.language,
            "task_id": self.task_id,
            "user_id": self.user_id,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None,
        }


class PromptTemplate(Base):
    __tablename__ = "prompt_templates"

    id = Column(String, primary_key=True, default=lambda: uuid.uuid4().hex[:12])
    user_id = Column(String, nullable=False, index=True)
    name = Column(String(128), nullable=False)
    content = Column(Text, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    def to_dict(self):
        return {
            "id": self.id,
            "user_id": self.user_id,
            "name": self.name,
            "content": self.content,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None,
        }


class TaskGroup(Base):
    __tablename__ = "task_groups"

    id = Column(String, primary_key=True, default=lambda: uuid.uuid4().hex[:12])
    name = Column(String, nullable=False)
    user_id = Column(String, nullable=True, index=True)  # nullable for legacy data
    created_at = Column(DateTime, default=datetime.utcnow)

    def to_dict(self):
        return {
            "id": self.id,
            "name": self.name,
            "user_id": self.user_id,
            "created_at": self.created_at.isoformat() if self.created_at else None,
        }
