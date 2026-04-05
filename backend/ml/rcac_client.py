"""
RCAC VLM client — Moondream 2 + LoRA fine-tuned on Purdue RCAC GPU cluster.
Falls back to Gemini 1.5 Flash automatically if RCAC is unreachable or times out.
"""

from __future__ import annotations

import asyncio
import base64
import json
from typing import Any

import httpx

from core.config import settings
from core.logging import get_logger
from models.vision import BBox2D, ObjectAnnotation

logger = get_logger(__name__)

# ── Prompt sent to both RCAC VLM and Gemini fallback ────────────────────────

DETECTION_PROMPT = """
You are a navigation assistant for a visually impaired person.
Analyse this image and return a JSON array of detected objects.

For each object return:
{
  "label": "short name (e.g. 'step', 'pole', 'person', 'door')",
  "confidence": 0.0-1.0,
  "urgency": "high" | "medium" | "low",
  "bbox": {"x": 0.0, "y": 0.0, "width": 0.0, "height": 0.0},  // normalised 0-1
  "distance_hint": "close" | "medium" | "far",
  "direction": "ahead" | "left" | "right"
}

Urgency rules:
- high: in the direct path, < 2m, immediate hazard (step drop, moving person, low obstacle)
- medium: relevant but not immediate (door, sign, bench, parked bike)
- low: background context (distant wall, building, sky)

Return ONLY valid JSON array, no explanation.
""".strip()


class RCACClient:
    """Primary object detection via RCAC-hosted VLM with Gemini fallback."""

    async def detect(self, image_bytes: bytes) -> list[ObjectAnnotation]:
        if settings.rcac_available:
            try:
                return await asyncio.wait_for(
                    self._call_rcac(image_bytes),
                    timeout=settings.rcac_timeout_ms / 1000,
                )
            except (asyncio.TimeoutError, Exception) as exc:
                logger.warning("rcac_failed", error=str(exc), fallback="gemini")

        if settings.gemini_available:
            try:
                return await self._call_gemini(image_bytes)
            except Exception as exc:
                logger.warning("gemini_failed", error=str(exc), fallback="genai")

        if settings.genai_available:
            try:
                return await self._call_genai(image_bytes)
            except Exception as exc:
                logger.warning("genai_detection_failed", error=str(exc))

        logger.warning("no_vlm_available", message="All VLM options unavailable — returning empty")
        return []

    # ── RCAC ─────────────────────────────────────────────────────────────────

    async def _call_rcac(self, image_bytes: bytes) -> list[ObjectAnnotation]:
        b64 = base64.b64encode(image_bytes).decode()
        payload = {
            "model": "moondream2-wayfr-lora",
            "prompt": DETECTION_PROMPT,
            "image": b64,
        }
        async with httpx.AsyncClient(timeout=settings.rcac_timeout_ms / 1000) as client:
            resp = await client.post(
                f"{settings.rcac_endpoint_url}/v1/generate",
                json=payload,
                headers={"Authorization": f"Bearer {settings.rcac_api_key}"},
            )
            resp.raise_for_status()
            raw = resp.json().get("text", "[]")
            return self._parse_detections(raw)

    # ── Gemini fallback ───────────────────────────────────────────────────────

    async def _call_gemini(self, image_bytes: bytes) -> list[ObjectAnnotation]:
        import google.generativeai as genai  # type: ignore

        genai.configure(api_key=settings.gemini_api_key)
        model = genai.GenerativeModel("gemini-1.5-flash")

        b64 = base64.b64encode(image_bytes).decode()
        image_part = {"mime_type": "image/jpeg", "data": b64}

        response = await asyncio.to_thread(
            model.generate_content,
            [DETECTION_PROMPT, image_part],
        )
        return self._parse_detections(response.text)

    # ── GenAI fallback (llama4 vision via OpenAI-compatible API) ─────────────

    async def _call_genai(self, image_bytes: bytes) -> list[ObjectAnnotation]:
        b64 = base64.b64encode(image_bytes).decode()
        payload = {
            "model": settings.genai_model,
            "messages": [
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "image_url",
                            "image_url": {"url": f"data:image/jpeg;base64,{b64}"},
                        },
                        {"type": "text", "text": DETECTION_PROMPT},
                    ],
                }
            ],
            "temperature": 0.1,
            "max_tokens": 1024,
        }
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.post(
                f"{settings.genai_base_url}/chat/completions",
                json=payload,
                headers={"Authorization": f"Bearer {settings.genai_api_key}"},
            )
            resp.raise_for_status()
            text = resp.json()["choices"][0]["message"]["content"]
            return self._parse_detections(text)

    # ── Parsing ───────────────────────────────────────────────────────────────

    def _parse_detections(self, raw: str) -> list[ObjectAnnotation]:
        try:
            # Strip markdown code fences if present
            text = raw.strip()
            if text.startswith("```"):
                text = text.split("\n", 1)[1].rsplit("```", 1)[0]

            items: list[dict[str, Any]] = json.loads(text)
            results: list[ObjectAnnotation] = []

            for item in items:
                bbox_data = item.get("bbox")
                bbox = (
                    BBox2D(
                        x=bbox_data["x"],
                        y=bbox_data["y"],
                        width=bbox_data["width"],
                        height=bbox_data["height"],
                    )
                    if bbox_data
                    else None
                )
                results.append(
                    ObjectAnnotation(
                        label=str(item.get("label", "unknown")),
                        confidence=float(item.get("confidence", 0.5)),
                        urgency=str(item.get("urgency", "low")),
                        bbox_2d=bbox,
                        direction=item.get("direction"),
                        distance_hint=item.get("distance_hint"),
                    )
                )
            return results
        except (json.JSONDecodeError, KeyError, TypeError) as exc:
            logger.error("detection_parse_failed", error=str(exc), raw=raw[:200])
            return []


# Module-level singleton
rcac_client = RCACClient()
