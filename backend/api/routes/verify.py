from fastapi import APIRouter
from pydantic import BaseModel

from models.worldid import WorldIDProof
from services.worldid import worldid_service

router = APIRouter(prefix="/verify")


class VerifyRequest(BaseModel):
    merkle_root: str
    nullifier_hash: str
    proof: str
    verification_level: str = "orb"
    signal: str
    action: str = "submit-hazard"


@router.post("/world-id")
async def verify_world_id(body: VerifyRequest):
    world_proof = WorldIDProof(
        merkle_root=body.merkle_root,
        nullifier_hash=body.nullifier_hash,
        proof=body.proof,
        verification_level=body.verification_level,
        signal=body.signal,
    )
    result = await worldid_service.verify(world_proof, action=body.action)
    return {
        "verified": result.verified,
        "nullifier_hash": result.nullifier_hash,
        "action": result.action,
    }
