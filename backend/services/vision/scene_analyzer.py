"""
Gemini 1.5 Flash scene understanding — runs every 3s using all four rendered views.
Produces a rich scene description for low-priority narration context.
"""

from __future__ import annotations

import asyncio
import base64

from core.config import settings
from core.logging import get_logger
from models.vision import SceneView
from models.session import SessionContext

logger = get_logger(__name__)

SCENE_PROMPT = """
You are an AI assistant helping a visually impaired person understand their environment.
You are given up to 4 synthetic camera views of the same 3D scene.

Describe in ONE concise sentence (max 20 words) the overall environment context —
NOT specific obstacles (those are handled separately), but the type of space:
e.g. "Indoor corridor with multiple doors ahead", "Busy outdoor footpath near a road",
"Quiet park with benches and trees".

Return only the sentence, no punctuation preamble.
""".strip()


class SceneAnalyzer:
    async def analyze(self, views: list[SceneView], ctx: SessionContext) -> str:
        if not settings.gemini_available:
            return ""

        return await asyncio.to_thread(self._call_gemini, views)

    def _call_gemini(self, views: list[SceneView]) -> str:
        import google.generativeai as genai  # type: ignore

        genai.configure(api_key=settings.gemini_api_key)
        model = genai.GenerativeModel("gemini-1.5-flash")

        parts: list[dict] = [SCENE_PROMPT]
        for view in views[:4]:
            b64 = base64.b64encode(view.image_bytes).decode()
            parts.append({"mime_type": "image/jpeg", "data": b64})

        response = model.generate_content(parts)
        return response.text.strip()


scene_analyzer = SceneAnalyzer()
