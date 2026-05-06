from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional
from google import genai
import logging
from ..config import settings

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/models", tags=["models"])

class ModelsRequest(BaseModel):
    api_key: Optional[str] = None

@router.post("/gemini")
def list_gemini_models(request: ModelsRequest):
    """List available Gemini models for the given API key."""
    final_api_key = request.api_key if request.api_key else settings.GEMINI_API_KEY
    if not final_api_key:
        return {"models": []}

    try:
        client = genai.Client(api_key=final_api_key)
        models = client.models.list()
        
        # Filter and format models
        available_models = []
        for m in models:
            if m.supported_actions and 'generateContent' in m.supported_actions:
                # remove models/ prefix
                model_id = m.name.replace("models/", "") if m.name.startswith("models/") else m.name
                available_models.append({
                    "id": model_id,
                    "name": m.display_name or model_id
                })
                
        return {"models": available_models}
    except Exception as e:
        logger.exception("Failed to fetch models")
        raise HTTPException(500, f"获取模型列表失败: {str(e)}")


class SystemConfigRequest(BaseModel):
    device: str
    ncpu: int


@router.get("/system")
def get_system_config():
    """Get current SenseVoice device and thread configuration."""
    cuda_available = False
    try:
        import torch
        cuda_available = torch.cuda.is_available()
    except ImportError:
        pass

    return {
        "device": settings.SENSEVOICE_DEVICE,
        "ncpu": settings.SENSEVOICE_NCPU,
        "cuda_available": cuda_available
    }


@router.post("/system")
def update_system_config(config: SystemConfigRequest):
    """Update SenseVoice device and thread configuration, resetting the model."""
    from ..services import sensevoice_service
    from . import process
    settings.SENSEVOICE_DEVICE = config.device
    settings.SENSEVOICE_NCPU = config.ncpu
    sensevoice_service.reset_sensevoice()
    process.reset_transcribe_semaphore(config.ncpu)
    
    return {
        "status": "ok",
        "device": settings.SENSEVOICE_DEVICE,
        "ncpu": settings.SENSEVOICE_NCPU
    }
