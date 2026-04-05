"""
World ID proof verification.
Calls the World ID developer API to verify ZK proofs.
"""

from __future__ import annotations


import httpx

from core.config import settings
from core.errors import WorldIDInvalidError
from core.logging import get_logger
from models.worldid import WorldIDProof, VerificationResult

logger = get_logger(__name__)

WORLD_ID_VERIFY_URL = "https://developer.worldcoin.org/api/v2/verify/{app_id}"


class WorldIDService:
    async def verify(self, proof: WorldIDProof, action: str) -> VerificationResult:
        if not settings.world_app_id:
            # Stub for dev — accept any proof
            logger.warning("world_id_not_configured", message="Accepting all proofs in dev mode")
            return VerificationResult(
                verified=True,
                nullifier_hash=proof.nullifier_hash,
                action=action,
            )

        url = WORLD_ID_VERIFY_URL.format(app_id=settings.world_app_id)
        payload = {
            "nullifier_hash": proof.nullifier_hash,
            "merkle_root": proof.merkle_root,
            "proof": proof.proof,
            "verification_level": proof.verification_level,
            "action": action,
            "signal": proof.signal,
        }

        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                resp = await client.post(url, json=payload)

            if resp.status_code == 200:
                return VerificationResult(
                    verified=True,
                    nullifier_hash=proof.nullifier_hash,
                    action=action,
                )

            data = resp.json()
            reason = data.get("detail", "Verification failed")
            logger.warning("world_id_rejected", reason=reason, nullifier=proof.nullifier_hash[:12])
            raise WorldIDInvalidError(reason)

        except WorldIDInvalidError:
            raise
        except Exception as exc:
            logger.error("world_id_api_error", error=str(exc))
            raise WorldIDInvalidError(f"World ID API error: {exc}") from exc


worldid_service = WorldIDService()
