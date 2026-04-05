from __future__ import annotations

from dataclasses import dataclass


@dataclass
class WorldIDProof:
    merkle_root: str
    nullifier_hash: str
    proof: str
    verification_level: str  # "orb" | "device"
    signal: str  # e.g. session_id or action identifier


@dataclass
class VerificationResult:
    verified: bool
    nullifier_hash: str
    action: str
    reason: str | None = None
