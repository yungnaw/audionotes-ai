"""SenseVoice local speech-to-text service.

Uses Alibaba's SenseVoice-Small model via FunASR for fast CPU-based transcription.
Non-autoregressive architecture provides 5-15x speedup over Whisper on CPU.
"""
import threading
import logging

logger = logging.getLogger(__name__)

_instance = None
_lock = threading.Lock()


def get_sensevoice():
    """Lazy singleton: model loads only on first call (~30s), then stays in memory."""
    global _instance
    if _instance is None:
        with _lock:
            if _instance is None:
                logger.info("Loading SenseVoice model (first time, may take 30-60s)...")
                from funasr import AutoModel
                from ..config import settings

                _instance = AutoModel(
                    model=settings.SENSEVOICE_MODEL,
                    vad_model="fsmn-vad",
                    vad_kwargs={"max_single_segment_time": 30000},
                    device=settings.SENSEVOICE_DEVICE,
                )
                logger.info("SenseVoice model loaded successfully.")
    return _instance


def transcribe(audio_path: str, language: str = "auto") -> dict:
    """Transcribe an audio file using local SenseVoice model.

    Args:
        audio_path: Path to the audio file
        language: Language code ("auto", "zh", "en", "yue", "ja", "ko")

    Returns:
        dict with keys: full_text, segments, language
    """
    from funasr.utils.postprocess_utils import rich_transcription_postprocess

    model = get_sensevoice()

    res = model.generate(
        input=audio_path,
        language=language,
        use_itn=True,
        batch_size_s=60,
    )

    # Process results
    segments = []
    full_text_parts = []

    if isinstance(res, list):
        for item in res:
            text = rich_transcription_postprocess(item.get("text", ""))
            if text.strip():
                full_text_parts.append(text)
                timestamps = item.get("timestamp", [])
                seg = {
                    "text": text,
                    "start": timestamps[0][0] / 1000.0 if timestamps else 0,
                    "end": timestamps[-1][-1] / 1000.0 if timestamps else 0,
                }
                segments.append(seg)

    full_text = "\n".join(full_text_parts) if full_text_parts else ""

    return {
        "full_text": full_text,
        "segments": segments,
        "language": language,
    }
