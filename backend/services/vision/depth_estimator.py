"""
DepthAnything v2 depth estimation via Replicate API.
Returns a metric depth map (H×W float32, metres).
"""

from __future__ import annotations

import asyncio
import base64
import io

import numpy as np

from core.config import settings
from core.logging import get_logger
from models.vision import DepthMap

logger = get_logger(__name__)

# Focal length assumptions for wayfr (640×480 frame, ~70° FOV)
FX = FY = 460.0
CX = 320.0
CY = 240.0


class DepthEstimator:
    async def estimate(self, image_bytes: bytes) -> DepthMap:
        if not settings.replicate_api_token:
            logger.warning("replicate_not_configured", message="Returning synthetic depth map")
            return self._synthetic_depth(640, 480)

        try:
            return await asyncio.to_thread(self._call_replicate, image_bytes)
        except Exception as exc:
            logger.warning("replicate_failed", error=str(exc), fallback="synthetic")
            return self._synthetic_depth(640, 480)

    def _call_replicate(self, image_bytes: bytes) -> DepthMap:
        import replicate  # type: ignore

        b64 = base64.b64encode(image_bytes).decode()
        data_uri = f"data:image/jpeg;base64,{b64}"

        output = replicate.run(
            "depth-anything/depth-anything-v2:large",
            input={"image": data_uri, "encoder": "vitl"},
        )

        # output is a URL to a greyscale PNG depth map
        import httpx

        response = httpx.get(str(output))
        response.raise_for_status()
        return self._decode_depth_image(response.content)

    def _decode_depth_image(self, png_bytes: bytes) -> DepthMap:
        from PIL import Image  # type: ignore

        img = Image.open(io.BytesIO(png_bytes)).convert("L")
        grey = np.array(img, dtype=np.float32)

        # Normalise to metric depth (0.1m – 20m range)
        # DepthAnything outputs inverse relative depth (closer = brighter)
        # Invert so 0=far, 1=close, then scale to metres
        inv = grey / 255.0
        depth_m = 0.1 + (1.0 - inv) * 19.9

        return DepthMap(
            depth_array=depth_m,
            min_depth=float(depth_m.min()),
            max_depth=float(depth_m.max()),
            width=img.width,
            height=img.height,
        )

    def _synthetic_depth(self, width: int, height: int) -> DepthMap:
        """Flat plane 2m ahead — used when Replicate is not configured."""
        depth = np.full((height, width), 2.0, dtype=np.float32)
        return DepthMap(
            depth_array=depth,
            min_depth=2.0,
            max_depth=2.0,
            width=width,
            height=height,
        )


depth_estimator = DepthEstimator()
