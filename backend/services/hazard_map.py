"""
Hazard map service — proximity queries, Redis caching, World ID rate limiting.
"""

from __future__ import annotations

import asyncio
import json
import math

from core.config import settings
from core.errors import RateLimitExceededError
from core.logging import get_logger
from db.repositories.hazards import hazard_repo
from models.hazard import Hazard, HazardSubmission, ProximityAlert
from models.session import GPSCoord

logger = get_logger(__name__)


def _get_redis():
    if not settings.redis_available:
        return None
    from upstash_redis import Redis  # type: ignore

    return Redis(url=settings.redis_url, token=settings.redis_token)


def _geohash6(lat: float, lng: float) -> str:
    try:
        import geohash  # type: ignore

        return geohash.encode(lat, lng, precision=6)
    except Exception:
        return f"{round(lat, 3)}:{round(lng, 3)}"


def _haversine(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    """Distance in metres between two GPS coords."""
    R = 6_371_000
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lng2 - lng1)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlambda / 2) ** 2
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def _bearing_to_direction(bearing_deg: float) -> str:
    if bearing_deg < 45 or bearing_deg >= 315:
        return "ahead"
    if 45 <= bearing_deg < 135:
        return "right"
    if 135 <= bearing_deg < 225:
        return "behind"
    return "left"


class HazardMapService:
    async def get_nearby(
        self,
        gps: GPSCoord | None,
        radius_m: float | None = None,
    ) -> list[ProximityAlert]:
        if not gps:
            return []

        radius = radius_m or settings.hazard_proximity_meters
        cache_key = f"hazards:{_geohash6(gps.lat, gps.lng)}"
        redis = _get_redis()

        if redis:
            try:
                cached = await asyncio.to_thread(redis.get, cache_key)
                if cached:
                    hazards = [Hazard(**h) for h in json.loads(cached)]
                    return self._to_alerts(hazards, gps)
            except Exception as exc:
                logger.warning("hazard_cache_read_failed", error=str(exc))

        hazards = await hazard_repo.get_within_radius(gps.lat, gps.lng, radius)

        if redis and hazards:
            try:
                payload = json.dumps([h.__dict__ for h in hazards])
                await asyncio.to_thread(
                    redis.setex, cache_key, settings.hazard_cache_ttl_s, payload
                )
            except Exception as exc:
                logger.warning("hazard_cache_write_failed", error=str(exc))

        return self._to_alerts(hazards, gps)

    async def submit_hazard(
        self,
        submission: HazardSubmission,
        nullifier_hash: str,
    ) -> Hazard:
        redis = _get_redis()
        if redis:
            rate_key = f"hazard_limit:{nullifier_hash}"
            try:
                count = await asyncio.to_thread(redis.incr, rate_key)
                if count == 1:
                    await asyncio.to_thread(redis.expire, rate_key, 86400)
                if count > 5:
                    raise RateLimitExceededError(
                        "Maximum 5 hazard reports per day per verified human"
                    )
            except RateLimitExceededError:
                raise
            except Exception as exc:
                logger.warning("rate_limit_check_failed", error=str(exc))

        hazard = await hazard_repo.create(submission, nullifier_hash)

        nearby_count = await hazard_repo.count_unique_reporters_at(hazard.lat, hazard.lng)
        if nearby_count >= 3:
            await hazard_repo.set_verified(hazard.id)
            hazard.verified = True

        # Invalidate cache
        if redis:
            try:
                await asyncio.to_thread(
                    redis.delete, f"hazards:{_geohash6(hazard.lat, hazard.lng)}"
                )
            except Exception:
                pass

        return hazard

    def _to_alerts(self, hazards: list[Hazard], gps: GPSCoord) -> list[ProximityAlert]:
        alerts: list[ProximityAlert] = []
        for h in hazards:
            dist = _haversine(gps.lat, gps.lng, h.lat, h.lng)
            # Simple bearing (approximate)
            dlat = h.lat - gps.lat
            dlng = h.lng - gps.lng
            bearing = math.degrees(math.atan2(dlng, dlat)) % 360
            alerts.append(
                ProximityAlert(
                    hazard_id=h.id,
                    label=h.label,
                    description=h.description,
                    severity=h.severity,
                    distance_m=round(dist, 1),
                    direction=_bearing_to_direction(bearing),
                    verified=h.verified,
                    verified_count=h.verifier_count,
                )
            )
        return sorted(alerts, key=lambda a: a.distance_m)


hazard_map = HazardMapService()
