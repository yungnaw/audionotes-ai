"""Application configuration via environment variables."""
from pydantic_settings import BaseSettings
from pathlib import Path


class Settings(BaseSettings):
    # Gemini 云端配置
    GEMINI_API_KEY: str = ""
    GEMINI_MODEL: str = "gemini-2.5-flash"

    # DeepSeek 云端配置
    DEEPSEEK_API_KEY: str = ""
    DEEPSEEK_BASE_URL: str = "https://api.deepseek.com"
    DEEPSEEK_MODEL: str = "deepseek-chat"

    # Qwen 云端配置
    QWEN_API_KEY: str = ""
    QWEN_BASE_URL: str = "https://dashscope.aliyuncs.com/compatible-mode/v1"
    QWEN_MODEL: str = "qwen-plus"

    # GLM 云端配置
    GLM_API_KEY: str = ""
    GLM_BASE_URL: str = "https://open.bigmodel.cn/api/paas/v4"
    GLM_MODEL: str = "glm-4-flash"

    # SenseVoice 本地转录配置
    SENSEVOICE_MODEL: str = "iic/SenseVoiceSmall"
    SENSEVOICE_DEVICE: str = "cpu"
    SENSEVOICE_NCPU: int = 8

    # 存储
    DATABASE_URL: str = "sqlite:///./audionotes.db"
    UPLOAD_DIR: str = "./uploads"

    # 服务
    HOST: str = "0.0.0.0"
    PORT: int = 3000

    model_config = {"env_file": str(Path(__file__).parent.parent.parent / ".env"), "env_file_encoding": "utf-8"}

    def __init__(self, **values):
        super().__init__(**values)
        # 动态检测 NVIDIA GPU
        if not self.SENSEVOICE_DEVICE or self.SENSEVOICE_DEVICE == "cpu":
            try:
                import torch
                if torch.cuda.is_available():
                    self.SENSEVOICE_DEVICE = "cuda"
            except ImportError:
                pass


settings = Settings()

# 确保上传目录存在
Path(settings.UPLOAD_DIR).mkdir(parents=True, exist_ok=True)
