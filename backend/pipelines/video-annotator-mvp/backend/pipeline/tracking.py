from __future__ import annotations

from dataclasses import dataclass
from typing import Any


def _iou(box_a: list[float], box_b: list[float]) -> float:
    ax1, ay1, ax2, ay2 = box_a
    bx1, by1, bx2, by2 = box_b

    ix1 = max(ax1, bx1)
    iy1 = max(ay1, by1)
    ix2 = min(ax2, bx2)
    iy2 = min(ay2, by2)

    iw = max(0.0, ix2 - ix1)
    ih = max(0.0, iy2 - iy1)
    inter = iw * ih
    if inter <= 0:
        return 0.0

    area_a = max(0.0, ax2 - ax1) * max(0.0, ay2 - ay1)
    area_b = max(0.0, bx2 - bx1) * max(0.0, by2 - by1)
    union = area_a + area_b - inter
    return float(inter / max(union, 1e-8))


@dataclass
class _TrackState:
    track_id: int
    bbox: list[float]
    label: str
    misses: int = 0


class IoUTracker:
    """Simple greedy IoU tracker for stable IDs in MVP output."""

    def __init__(self, iou_threshold: float = 0.3, max_misses: int = 20) -> None:
        self._tracks: dict[int, _TrackState] = {}
        self._next_id = 1
        self._iou_threshold = iou_threshold
        self._max_misses = max_misses

    def update(self, detections: list[dict[str, Any]]) -> list[dict[str, Any]]:
        assigned_track_ids: set[int] = set()
        tracked: list[dict[str, Any]] = []

        # Build candidate matches by IoU for same label.
        candidates: list[tuple[float, int, int]] = []
        track_items = list(self._tracks.items())
        for det_idx, det in enumerate(detections):
            for track_id, track in track_items:
                if det["label"] != track.label:
                    continue
                iou = _iou(det["bbox"], track.bbox)
                if iou >= self._iou_threshold:
                    candidates.append((iou, det_idx, track_id))

        # Greedy assignment by best IoU first.
        used_det_idxs: set[int] = set()
        candidates.sort(key=lambda x: x[0], reverse=True)
        for iou, det_idx, track_id in candidates:
            if det_idx in used_det_idxs or track_id in assigned_track_ids:
                continue
            det = detections[det_idx]
            self._tracks[track_id].bbox = det["bbox"]
            self._tracks[track_id].misses = 0
            assigned_track_ids.add(track_id)
            used_det_idxs.add(det_idx)
            tracked.append({**det, "track_id": track_id, "iou_match": float(iou)})

        # Create tracks for unmatched detections.
        for det_idx, det in enumerate(detections):
            if det_idx in used_det_idxs:
                continue
            track_id = self._next_id
            self._next_id += 1
            self._tracks[track_id] = _TrackState(track_id=track_id, bbox=det["bbox"], label=det["label"])
            assigned_track_ids.add(track_id)
            tracked.append({**det, "track_id": track_id, "iou_match": None})

        # Age unmatched tracks and prune stale ones.
        stale: list[int] = []
        for track_id, track in self._tracks.items():
            if track_id not in assigned_track_ids:
                track.misses += 1
                if track.misses > self._max_misses:
                    stale.append(track_id)
        for track_id in stale:
            self._tracks.pop(track_id, None)

        # Stable ordering for deterministic output.
        tracked.sort(key=lambda d: (d["track_id"], -d.get("confidence", 0.0)))
        return tracked

