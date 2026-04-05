from __future__ import annotations

from typing import Any

import cv2

_PALETTE = [
    (80, 200, 80), (200, 80, 80), (80, 80, 200), (200, 200, 80),
    (200, 80, 200), (80, 200, 200), (255, 160, 50), (50, 160, 255),
    (160, 255, 50), (255, 50, 160), (100, 255, 180), (180, 100, 255),
    (255, 220, 100), (100, 180, 220), (220, 100, 180), (130, 230, 130),
]


def _color_for_id(track_id: int | None) -> tuple[int, int, int]:
    if track_id is None:
        return (180, 180, 180)
    return _PALETTE[track_id % len(_PALETTE)]


def draw_detections(frame, detections: list[dict[str, Any]]) -> None:
    for det in detections:
        x1, y1, x2, y2 = [int(v) for v in det["bbox"]]
        label = det["label"]
        conf = det.get("confidence", 0.0)
        track_id = det.get("track_id")

        color = _color_for_id(track_id)
        cv2.rectangle(frame, (x1, y1), (x2, y2), color, 3)

        prefix = f"id={track_id}" if track_id is not None else "id=?"
        text = f"{prefix} | {label} {conf:.2f}"
        (tw, th), _ = cv2.getTextSize(text, cv2.FONT_HERSHEY_SIMPLEX, 0.8, 2)
        cv2.rectangle(frame, (x1, max(0, y1 - th - 12)), (x1 + tw + 8, y1), color, -1)
        cv2.putText(
            frame,
            text,
            (x1 + 4, y1 - 6),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.8,
            (20, 20, 20),
            2,
            cv2.LINE_AA,
        )

