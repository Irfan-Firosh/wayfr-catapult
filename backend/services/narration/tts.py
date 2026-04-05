"""
Cartesia TTS service.
Uses the /tts/bytes endpoint — returns raw MP3 audio.
Falls back to gTTS (free, no key) if Cartesia is unavailable.
"""

from __future__ import annotations

import asyncio
import io

import httpx

from core.config import settings
from core.logging import get_logger
from models.narration import AudioChunk, NarrationResult

logger = get_logger(__name__)

CARTESIA_TTS_URL = "https://api.cartesia.ai/tts/bytes"
CARTESIA_VERSION = "2024-06-10"


class TTSService:
    async def synthesize(self, narration: NarrationResult) -> AudioChunk | None:
        if settings.cartesia_available:
            try:
                audio_bytes = await self._call_cartesia(narration.text)
                return AudioChunk(
                    data=audio_bytes,
                    text=narration.text,
                    priority=narration.priority,
                )
            except Exception as exc:
                logger.warning("cartesia_failed", error=str(exc), fallback="gtts")

        # Fallback: gTTS (no key needed)
        try:
            audio_bytes = await asyncio.to_thread(self._call_gtts, narration.text)
            return AudioChunk(
                data=audio_bytes,
                text=narration.text,
                priority=narration.priority,
            )
        except Exception as exc:
            logger.error("tts_all_failed", error=str(exc))
            return None

    async def _call_cartesia(self, text: str) -> bytes:
        payload = {
            "model_id": settings.cartesia_model_id,
            "transcript": text,
            "voice": {"mode": "id", "id": settings.cartesia_voice_id},
            "output_format": {
                "container": "mp3",
                "encoding": "mp3",
                "sample_rate": 44100,
            },
        }
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.post(
                CARTESIA_TTS_URL,
                json=payload,
                headers={
                    "X-API-Key": settings.cartesia_api_key,
                    "Cartesia-Version": CARTESIA_VERSION,
                },
            )
            resp.raise_for_status()
            return resp.content

    def _call_gtts(self, text: str) -> bytes:
        from gtts import gTTS  # type: ignore

        tts = gTTS(text=text, lang="en", slow=False)
        buf = io.BytesIO()
        tts.write_to_fp(buf)
        return buf.getvalue()


tts_service = TTSService()
