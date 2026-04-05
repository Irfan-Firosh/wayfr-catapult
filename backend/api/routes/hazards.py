from fastapi import APIRouter, Query
from pydantic import BaseModel, field_validator

from services.hazard_map import hazard_map
from services.worldid import worldid_service
from models.hazard import HazardSubmission
from models.worldid import WorldIDProof

router = APIRouter(prefix="/hazards")


class HazardSubmitRequest(BaseModel):
    label: str
    description: str
    severity: str
    lat: float
    lng: float
    merkle_root: str
    nullifier_hash: str
    proof: str
    verification_level: str = "orb"
    signal: str

    @field_validator("severity")
    @classmethod
    def validate_severity(cls, v: str) -> str:
        allowed = {"low", "medium", "high", "critical"}
        if v not in allowed:
            raise ValueError(f"severity must be one of {allowed}")
        return v


@router.post("")
async def submit_hazard(body: HazardSubmitRequest):
    world_proof = WorldIDProof(
        merkle_root=body.merkle_root,
        nullifier_hash=body.nullifier_hash,
        proof=body.proof,
        verification_level=body.verification_level,
        signal=body.signal,
    )
    await worldid_service.verify(world_proof, action="submit-hazard")

    submission = HazardSubmission(
        label=body.label,
        description=body.description,
        severity=body.severity,
        lat=body.lat,
        lng=body.lng,
        world_id_proof=body.proof,
        nullifier_hash=body.nullifier_hash,
    )
    hazard = await hazard_map.submit_hazard(submission, body.nullifier_hash)
    return {"id": hazard.id, "verified": hazard.verified}


@router.get("/nearby")
async def get_nearby(
    lat: float = Query(...),
    lng: float = Query(...),
    radius_m: float = Query(default=100.0),
):
    from models.session import GPSCoord

    gps = GPSCoord(lat=lat, lng=lng)
    alerts = await hazard_map.get_nearby(gps, radius_m=radius_m)
    return {
        "count": len(alerts),
        "hazards": [
            {
                "id": a.hazard_id,
                "label": a.label,
                "description": a.description,
                "severity": a.severity,
                "distance_m": a.distance_m,
                "direction": a.direction,
                "verified": a.verified,
                "verified_count": a.verified_count,
            }
            for a in alerts
        ],
    }
