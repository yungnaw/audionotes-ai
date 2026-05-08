"""SQLAlchemy ORM models."""
import uuid
import enum
from datetime import datetime
from sqlalchemy import Column, String, Integer, Text, Enum, DateTime, Float
from .database import Base


class ProcessStatus(str, enum.Enum):
    IDLE = "idle"
    TRANSCRIBING = "transcribing"
    SUMMARIZING = "summarizing"
    COMPLETED = "completed"
    FAILED = "failed"


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
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None,
        }


class TaskGroup(Base):
    __tablename__ = "task_groups"

    id = Column(String, primary_key=True, default=lambda: uuid.uuid4().hex[:12])
    name = Column(String, unique=True, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)

    def to_dict(self):
        return {
            "id": self.id,
            "name": self.name,
            "created_at": self.created_at.isoformat() if self.created_at else None,
        }

