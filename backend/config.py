"""Application configuration via environment variables."""
from pydantic_settings import BaseSettings
from pathlib import Path


class Settings(BaseSettings):
    # Gemini 云端配置
    GEMINI_API_KEY: str = ""
    GEMINI_MODEL: str = "gemini-2.5-flash"

    # SenseVoice 本地转录配置
    SENSEVOICE_MODEL: str = "iic/SenseVoiceSmall"
    SENSEVOICE_DEVICE: str = "cpu"

    # 存储
    DATABASE_URL: str = "sqlite:///./audionotes.db"
    UPLOAD_DIR: str = "./uploads"

    # 服务
    HOST: str = "0.0.0.0"
    PORT: int = 3000

    model_config = {"env_file": str(Path(__file__).parent / ".env"), "env_file_encoding": "utf-8"}


settings = Settings()

# 确保上传目录存在
Path(settings.UPLOAD_DIR).mkdir(parents=True, exist_ok=True)
