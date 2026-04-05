from __future__ import annotations

import time
from typing import Any

from core.logging import get_logger
from db.client import get_supabase
from models.home import HomeMap, HomeMapStatus, ObjectPosition

logger = get_logger(__name__)


def _row_to_home(row: dict[str, Any]) -> HomeMap:
    return HomeMap(
        id=row["id"],
        name=row["name"],
        status=HomeMapStatus(row["status"]),
        num_objects=row.get("num_objects", 0),
        error=row.get("error"),
        created_at=row.get("created_at", time.time()),
        updated_at=row.get("updated_at", time.time()),
    )


def _row_to_object(row: dict[str, Any]) -> ObjectPosition:
    return ObjectPosition(
        id=row["id"],
        home_id=row["home_id"],
        label=row["label"],
        x=float(row["x"]),
        y=float(row["y"]),
        z=float(row["z"]),
        track_id=row.get("track_id"),
        bbox_min=row.get("bbox_min"),
        bbox_max=row.get("bbox_max"),
        confidence=row.get("confidence"),
        n_observations=row.get("n_observations", 1),
    )


async def create(name: str) -> HomeMap | None:
    client = get_supabase()
    if client is None:
        logger.warning("supabase_not_configured")
        return None
    result = client.table("home_maps").insert({"name": name, "status": "processing"}).execute()
    if result.data:
        return _row_to_home(result.data[0])
    return None


async def update_status(
    home_id: str,
    status: str,
    error: str | None = None,
    num_objects: int | None = None,
) -> None:
    client = get_supabase()
    if client is None:
        return
    payload: dict[str, Any] = {"status": status, "updated_at": "now()"}
    if error is not None:
        payload["error"] = error
    if num_objects is not None:
        payload["num_objects"] = num_objects
    client.table("home_maps").update(payload).eq("id", home_id).execute()


async def get(home_id: str) -> HomeMap | None:
    client = get_supabase()
    if client is None:
        return None
    result = client.table("home_maps").select("*").eq("id", home_id).maybe_single().execute()
    if result.data:
        return _row_to_home(result.data)
    return None


async def list_all() -> list[HomeMap]:
    client = get_supabase()
    if client is None:
        return []
    result = client.table("home_maps").select("*").order("created_at", desc=True).execute()
    return [_row_to_home(r) for r in (result.data or [])]


async def upsert_objects(home_id: str, objects: list[ObjectPosition]) -> None:
    client = get_supabase()
    if client is None:
        return
    if not objects:
        return
    rows = [
        {
            "home_id": home_id,
            "label": obj.label,
            "track_id": obj.track_id,
            "x": obj.x,
            "y": obj.y,
            "z": obj.z,
            "bbox_min": obj.bbox_min,
            "bbox_max": obj.bbox_max,
            "confidence": obj.confidence,
            "n_observations": obj.n_observations,
        }
        for obj in objects
    ]
    client.table("object_positions").insert(rows).execute()


async def get_objects(home_id: str) -> list[ObjectPosition]:
    client = get_supabase()
    if client is None:
        return []
    result = (
        client.table("object_positions")
        .select("*")
        .eq("home_id", home_id)
        .order("n_observations", desc=True)
        .execute()
    )
    return [_row_to_object(r) for r in (result.data or [])]
