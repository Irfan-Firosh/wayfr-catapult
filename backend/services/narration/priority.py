"""
Priority engine — scores and sorts objects to determine narration urgency.
Returns the highest-priority item that should be spoken right now.
"""

from __future__ import annotations

from models.vision import ObjectAnnotation, VisionResult
from models.hazard import ProximityAlert

URGENCY_SCORE = {"high": 100, "medium": 50, "low": 10}
SEVERITY_SCORE = {"critical": 90, "high": 70, "medium": 40, "low": 15}


def select_top_item(result: VisionResult) -> tuple[str, str]:
    """
    Returns (narration_input_json, priority_label).
    narration_input_json is the structured data passed to Claude Haiku.
    """
    candidates: list[tuple[int, str, str]] = []  # (score, description, priority)

    for obj in result.detected_objects:
        score = URGENCY_SCORE.get(obj.urgency, 10)
        # Boost score for very close objects
        if obj.distance_m is not None and obj.distance_m < 1.5:
            score += 40
        desc = _format_object(obj)
        priority = "urgent" if obj.urgency == "high" else "normal"
        candidates.append((score, desc, priority))

    for hazard in result.community_hazards:
        score = SEVERITY_SCORE.get(hazard.severity, 10) + 20  # hazards are community-verified
        desc = _format_hazard(hazard)
        priority = "urgent" if hazard.severity in ("critical", "high") else "normal"
        candidates.append((score, desc, priority))

    if not candidates:
        if result.text_annotations:
            top_text = result.text_annotations[0].text
            return f"Text visible: {top_text}", "low"
        if result.scene_description:
            return result.scene_description, "low"
        return "", "low"

    candidates.sort(key=lambda c: c[0], reverse=True)
    _, description, priority = candidates[0]
    return description, priority


def _format_object(obj: ObjectAnnotation) -> str:
    parts = [obj.label]
    if obj.distance_m is not None:
        parts.append(f"{obj.distance_m:.1f}m")
    if obj.direction:
        parts.append(obj.direction)
    parts.append(f"urgency:{obj.urgency}")
    return " | ".join(parts)


def _format_hazard(hazard: ProximityAlert) -> str:
    return (
        f"Community alert: {hazard.label} | "
        f"{hazard.distance_m:.0f}m {hazard.direction} | "
        f"severity:{hazard.severity} | verified_by:{hazard.verified_count}_people"
    )
