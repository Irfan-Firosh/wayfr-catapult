"""Hazard CRUD + PostGIS proximity queries."""

from __future__ import annotations

import asyncio
import uuid
import time

from core.logging import get_logger
from db.client import get_supabase
from models.hazard import Hazard, HazardSubmission

logger = get_logger(__name__)

# Approximate metres per degree of latitude
M_PER_DEG_LAT = 111_320.0


class HazardRepository:
    async def create(self, submission: HazardSubmission, nullifier_hash: str) -> Hazard:
        hazard = Hazard(
            id=str(uuid.uuid4()),
            label=submission.label,
            description=submission.description,
            severity=submission.severity,
            lat=submission.lat,
            lng=submission.lng,
            reporter_nullifier=nullifier_hash,
        )
        client = get_supabase()
        if client:
            row = {
                "id": hazard.id,
                "label": hazard.label,
                "description": hazard.description,
                "severity": hazard.severity,
                "lat": hazard.lat,
                "lng": hazard.lng,
                "reporter_nullifier": hazard.reporter_nullifier,
                "verified": False,
                "verifier_count": 1,
                "created_at": hazard.created_at,
            }
            await asyncio.to_thread(lambda: client.table("hazards").insert(row).execute())
        return hazard

    async def get_within_radius(self, lat: float, lng: float, radius_m: float) -> list[Hazard]:
        client = get_supabase()
        if not client:
            return []

        # PostGIS ST_DWithin query via RPC
        try:
            result = await asyncio.to_thread(
                lambda: client.rpc(
                    "hazards_within_radius",
                    {"user_lat": lat, "user_lng": lng, "radius_m": radius_m},
                ).execute()
            )
            return [self._row_to_hazard(row) for row in (result.data or [])]
        except Exception as exc:
            logger.error("hazard_proximity_query_failed", error=str(exc))
            return []

    async def count_unique_reporters_at(self, lat: float, lng: float, radius_m: float = 20) -> int:
        client = get_supabase()
        if not client:
            return 0

        try:
            result = await asyncio.to_thread(
                lambda: client.rpc(
                    "count_unique_reporters_at",
                    {"lat": lat, "lng": lng, "radius_m": radius_m},
                ).execute()
            )
            return int((result.data or [{}])[0].get("count", 0))
        except Exception as exc:
            logger.error("count_reporters_failed", error=str(exc))
            return 0

    async def set_verified(self, hazard_id: str) -> None:
        client = get_supabase()
        if not client:
            return
        await asyncio.to_thread(
            lambda: client.table("hazards").update({"verified": True}).eq("id", hazard_id).execute()
        )

    def _row_to_hazard(self, row: dict) -> Hazard:
        return Hazard(
            id=row["id"],
            label=row["label"],
            description=row.get("description", ""),
            severity=row.get("severity", "low"),
            lat=row["lat"],
            lng=row["lng"],
            reporter_nullifier=row.get("reporter_nullifier", ""),
            verified=row.get("verified", False),
            verifier_count=row.get("verifier_count", 1),
            created_at=row.get("created_at", time.time()),
        )


hazard_repo = HazardRepository()
