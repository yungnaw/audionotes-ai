"""Unified LLM service supporting Gemini, DeepSeek, Qwen, and GLM."""
import logging
import httpx
from ..config import settings
from . import gemini_service

logger = logging.getLogger(__name__)


async def generate_notes(
    text: str,
    prompt_template: str = "",
    provider: str = "gemini",
    api_key: str | None = None,
    model_name: str | None = None,
) -> str:
    """Generate structured study notes from transcription text using chosen provider."""
    provider = provider.lower()

    if provider == "gemini":
        return await gemini_service.generate_notes(
            text=text,
            prompt_template=prompt_template,
            api_key=api_key,
            model_name=model_name,
        )

    # Resolve settings for OpenAI-compatible providers
    if provider == "deepseek":
        base_url = settings.DEEPSEEK_BASE_URL
        default_key = settings.DEEPSEEK_API_KEY
        default_model = settings.DEEPSEEK_MODEL
    elif provider == "qwen":
        base_url = settings.QWEN_BASE_URL
        default_key = settings.QWEN_API_KEY
        default_model = settings.QWEN_MODEL
    elif provider == "glm":
        base_url = settings.GLM_BASE_URL
        default_key = settings.GLM_API_KEY
        default_model = settings.GLM_MODEL
    else:
        raise ValueError(f"不支持的 LLM 提供商: {provider}")

    final_api_key = api_key if api_key else default_key
    if not final_api_key:
        raise ValueError(
            f"未提供 {provider.upper()} API Key，请在前端设置中填写，或在环境变量中配置对应 API_KEY。"
        )

    final_model = model_name if model_name else default_model

    # Construct prompt
    if prompt_template and "{text}" in prompt_template:
        prompt = prompt_template.replace("{text}", text)
    elif prompt_template:
        prompt = prompt_template + "\n\n转录文本：\n" + text
    else:
        prompt = f"""你是一位专业的学术助理。请根据以下转录文本，整理出一份极其详实、结构清晰的学习笔记。

笔记必须使用中文编写，包含以下部分：
- # [主题名称]（根据内容自动提取）
- ## 核心摘要（用3-5句话概括全部内容）
- ## 详细知识点（分章节深入细节，不要遗漏要点，使用 bullet points）
- ## 关键概念解析（解释专业术语 and 核心概念）
- ## 行动建议或结论

转录文本：
{text}"""

    headers = {
        "Authorization": f"Bearer {final_api_key}",
        "Content-Type": "application/json",
    }
    payload = {
        "model": final_model,
        "messages": [{"role": "user", "content": prompt}],
    }

    async with httpx.AsyncClient(timeout=120) as client:
        try:
            logger.info(f"Sending request to {provider.upper()} API using model {final_model}...")
            response = await client.post(
                f"{base_url.rstrip('/')}/chat/completions",
                headers=headers,
                json=payload,
            )
            response.raise_for_status()
            data = response.json()
            return data["choices"][0]["message"]["content"].strip()
        except Exception as e:
            logger.exception(f"{provider.upper()} API request failed")
            raise ValueError(f"{provider.upper()} API 请求失败: {str(e)}")
