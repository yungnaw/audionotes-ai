"""Gemini AI cloud service for study notes generation.

Only receives plain text (from local transcription), never audio data.
This keeps API costs minimal.
"""
import logging
from ..config import settings

logger = logging.getLogger(__name__)


async def generate_notes(
    text: str,
    prompt_template: str = "",
    api_key: str | None = None,
    model_name: str | None = None,
) -> str:
    """Generate structured study notes from transcription text.

    Args:
        text: Transcribed text from SenseVoice
        prompt_template: User customizable prompt template
        api_key: Optional user-provided API key
        model_name: Optional user-provided model name

    Returns:
        Formatted Markdown study notes
    """
    from google import genai

    final_api_key = api_key if api_key else settings.GEMINI_API_KEY
    if not final_api_key:
        raise ValueError("未提供 API Key，请在前端设置中填写，或在环境变量中配置 GEMINI_API_KEY。")

    client = genai.Client(api_key=final_api_key)
    final_model = model_name if model_name else settings.GEMINI_MODEL

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
- ## 关键概念解析（解释专业术语和核心概念）
- ## 行动建议或结论

转录文本：
{text}"""

    result = client.models.generate_content(
        model=final_model,
        contents=prompt,
    )

    return result.text.strip() if result.text else ""

