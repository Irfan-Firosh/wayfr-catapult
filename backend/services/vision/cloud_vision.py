"""
Google Cloud Vision API — OCR + object labels.
Runs in parallel with depth estimation on the raw frame.
"""

from __future__ import annotations

import asyncio
import base64
from dataclasses import dataclass

from core.config import settings
from core.logging import get_logger
from models.vision import TextAnnotation, BBox2D

logger = get_logger(__name__)


@dataclass
class CloudVisionResult:
    text: list[TextAnnotation]
    objects: list[str]


class CloudVisionService:
    async def analyze(self, image_bytes: bytes) -> CloudVisionResult:
        if not settings.google_cloud_api_key:
            return CloudVisionResult(text=[], objects=[])

        try:
            return await asyncio.to_thread(self._call_api, image_bytes)
        except Exception as exc:
            logger.warning("cloud_vision_failed", error=str(exc))
            return CloudVisionResult(text=[], objects=[])

    def _call_api(self, image_bytes: bytes) -> CloudVisionResult:
        import httpx

        b64 = base64.b64encode(image_bytes).decode()
        payload = {
            "requests": [
                {
                    "image": {"content": b64},
                    "features": [
                        {"type": "TEXT_DETECTION", "maxResults": 10},
                        {"type": "OBJECT_LOCALIZATION", "maxResults": 15},
                    ],
                }
            ]
        }

        resp = httpx.post(
            "https://vision.googleapis.com/v1/images:annotate",
            json=payload,
            params={"key": settings.google_cloud_api_key},
            timeout=5.0,
        )
        resp.raise_for_status()
        data = resp.json()

        annotations = data["responses"][0]
        text_items = self._parse_text(annotations.get("textAnnotations", []))
        object_labels = self._parse_objects(annotations.get("localizedObjectAnnotations", []))
        return CloudVisionResult(text=text_items, objects=object_labels)

    def _parse_text(self, raw: list[dict]) -> list[TextAnnotation]:
        results: list[TextAnnotation] = []
        for item in raw[:5]:  # Top 5 text blocks
            description = item.get("description", "").strip()
            if not description or len(description) < 2:
                continue
            verts = item.get("boundingPoly", {}).get("vertices", [])
            bbox = self._verts_to_bbox(verts)
            results.append(
                TextAnnotation(
                    text=description,
                    confidence=item.get("confidence", 0.9),
                    bbox_2d=bbox,
                )
            )
        return results

    def _parse_objects(self, raw: list[dict]) -> list[str]:
        return [item["name"] for item in raw if item.get("score", 0) > 0.5]

    def _verts_to_bbox(self, verts: list[dict]) -> BBox2D | None:
        if len(verts) < 4:
            return None
        xs = [v.get("x", 0) for v in verts]
        ys = [v.get("y", 0) for v in verts]
        # normalised (assume 640×480)
        return BBox2D(
            x=min(xs) / 640,
            y=min(ys) / 480,
            width=(max(xs) - min(xs)) / 640,
            height=(max(ys) - min(ys)) / 480,
        )


cloud_vision = CloudVisionService()
