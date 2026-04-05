"""
Navigation routes:
  POST /api/navigation/plan  — generate a route from current position to a named object
"""

from __future__ import annotations

import math

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from core.logging import get_logger
from db.repositories import homes as homes_repo
from services.navigation.instruction_generator import waypoints_to_instructions
from services.navigation.pathfinder import plan_route

logger = get_logger(__name__)
router = APIRouter(prefix="/api/navigation", tags=["navigation"])


class PlanRequest(BaseModel):
    home_id: str
    target_label: str
    current_x: float = 0.0
    current_z: float = 0.0
    heading_rad: float = 0.0  # 0 = facing +Z (forward)


@router.post("/plan")
async def plan_navigation(body: PlanRequest):
    home = await homes_repo.get(body.home_id)
    if home is None:
        raise HTTPException(status_code=404, detail=f"Home '{body.home_id}' not found")
    if home.status != "ready":
        raise HTTPException(status_code=409, detail=f"Home not ready (status={home.status})")

    objects = await homes_repo.get_objects(body.home_id)
    if not objects:
        raise HTTPException(status_code=404, detail="No objects mapped for this home yet")

    waypoints, target = plan_route(
        objects,
        body.current_x,
        body.current_z,
        body.target_label,
    )

    if target is None:
        available = sorted({o.label for o in objects})
        raise HTTPException(
            status_code=404,
            detail=f"No object matching '{body.target_label}'. Available: {available}",
        )

    instructions = waypoints_to_instructions(
        waypoints,
        start_x=body.current_x,
        start_z=body.current_z,
        heading_rad=body.heading_rad,
    )

    total_distance = round(sum(wp.distance_m for wp in waypoints), 2)

    logger.info(
        "navigation_plan",
        home_id=body.home_id,
        target=body.target_label,
        waypoints=len(waypoints),
        distance_m=total_distance,
    )

    return {
        "home_id": body.home_id,
        "target_label": body.target_label,
        "target": {
            "label": target.label,
            "x": target.x,
            "y": target.y,
            "z": target.z,
            "confidence": target.confidence,
        },
        "waypoints": [{"x": wp.x, "z": wp.z, "distance_m": wp.distance_m} for wp in waypoints],
        "instructions": instructions,
        "total_distance_m": total_distance,
    }
