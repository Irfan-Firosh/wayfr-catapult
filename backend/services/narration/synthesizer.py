"""
Narration synthesizer using RCAC GenAI (llama4 via OpenAI-compatible API).
Takes structured detection data → produces one natural spoken sentence.
Never receives image data — text only.
"""

from __future__ import annotations

import httpx

from core.config import settings
from core.logging import get_logger
from models.narration import NarrationResult

logger = get_logger(__name__)

SYSTEM_PROMPT = """You are the wayfr narration engine, assisting a visually impaired person wearing smart glasses.
Your job: generate exactly ONE short, clear sentence (max 15 words) describing the most important thing the user needs to know right now.

Priority order:
1. URGENT: Immediate object in path (< 1m) — always interrupt
2. HIGH: Object (1–3m) or step/drop detected
3. MEDIUM: Community hazard alert nearby
4. LOW: Scene context, text, items of interest

Rules:
- Use directional language: "ahead", "on your left", "on your right"
- Include distance when relevant: "3 feet ahead", "about 2 meters to your left"
- If nothing important: return exactly the string null
- Tone: calm, confident, precise. Like a trusted guide.

Examples:
GOOD: Step down 2 feet ahead on your right.
GOOD: Sign reads: Pull to open.
GOOD: Community alert: Wet floor 15 meters ahead, reported by 4 people.
BAD: I can see that there appears to be what looks like a step..."""


class NarrationSynthesizer:
    async def synthesize(self, description: str, priority: str) -> NarrationResult | None:
        if not description:
            return None

        if not settings.genai_available:
            logger.warning("genai_not_configured")
            return None

        try:
            text = await self._call_genai(description)
            if not text or text.strip().lower() == "null":
                return None
            return NarrationResult(text=text.strip(), priority=priority)
        except Exception as exc:
            logger.error("narration_synthesis_failed", error=str(exc))
            return None

    async def _call_genai(self, description: str) -> str:
        url = f"{settings.genai_base_url.rstrip('/')}/chat/completions"
        payload = {
            "model": settings.genai_model,
            "messages": [
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": f"Current scene:\n{description}"},
            ],
            "max_tokens": 60,
            "temperature": 0.3,
        }
        async with httpx.AsyncClient(timeout=8.0) as client:
            resp = await client.post(
                url,
                json=payload,
                headers={"Authorization": f"Bearer {settings.genai_api_key}"},
            )
            resp.raise_for_status()
            return resp.json()["choices"][0]["message"]["content"]


narration_synthesizer = NarrationSynthesizer()
