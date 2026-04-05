# wayfr — World ID Integration

## Why World ID

The community hazard map is wayfr's safety infrastructure — blind users trust it with their lives.
A bot-submitted hazard that doesn't exist, or a missing hazard that was never reported, is a safety risk.
World ID ensures every single hazard report comes from a verified, unique human being.

**The demo hook:** "Every hazard on this map was verified by a real human, proven on-chain.
When Alex walks past a construction zone at night, she can trust this data is real."

---

## Tracks This Satisfies

- **Best Proof of Human Application** — Primary use case
- **Most Promising Startup** — Real-world trust mechanism (B2G sales angle)
- **Best Overall** — Adds credibility and technical depth

---

## Components

| Component | Purpose |
|-----------|---------|
| World ID MiniKit | Frontend SDK for verification UI |
| World ID API | Backend proof verification |
| World Chain (Base L2) | On-chain attestation storage |
| `HazardAttestation.sol` | Smart contract for immutable records |

---

## Setup

### 1. Register App in World Developer Portal

```
1. Go to developer.worldcoin.org
2. Create new app: "wayfr"
3. Add action: "submit-hazard-report"
   - Max verifications: 5 per person per day (matches our rate limit)
   - Verification level: "Orb" (highest trust)
4. Note: App ID (app_...) and Action ID
5. Set WORLD_APP_ID in env
```

### 2. Install MiniKit

```bash
cd apps/web
pnpm add @worldcoin/minikit-js
```

### 3. Configure MiniKit Provider

```tsx
// apps/web/app/layout.tsx
import { MiniKitProvider } from '@worldcoin/minikit-js'

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        <MiniKitProvider appId={process.env.NEXT_PUBLIC_WORLD_APP_ID!}>
          <ThemeProvider ...>
            {children}
          </ThemeProvider>
        </MiniKitProvider>
      </body>
    </html>
  )
}
```

---

## Verification Flow

### Frontend Component

```tsx
// apps/web/components/WorldIDButton.tsx
'use client'

import { MiniKit, VerificationLevel } from '@worldcoin/minikit-js'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Particles } from '@/components/magic/particles'

interface Props {
  onVerified: (token: string) => void
}

export function WorldIDButton({ onVerified }: Props) {
  const [verifying, setVerifying] = useState(false)
  const [verified, setVerified] = useState(false)

  const handleVerify = async () => {
    if (!MiniKit.isInstalled()) {
      // Web flow: redirect to World app or show QR code
      window.open(
        `https://worldcoin.org/verify?app_id=${process.env.NEXT_PUBLIC_WORLD_APP_ID}&action=submit-hazard-report`,
        '_blank'
      )
      return
    }

    setVerifying(true)
    try {
      const { finalPayload } = await MiniKit.commandsAsync.verify({
        action: 'submit-hazard-report',
        verification_level: VerificationLevel.Orb,
      })

      if (finalPayload.status === 'error') {
        throw new Error(finalPayload.error_code)
      }

      // Send to backend for verification + JWT issuance
      const res = await fetch('/api/verify-world-id', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          merkle_root: finalPayload.merkle_root,
          nullifier_hash: finalPayload.nullifier_hash,
          proof: finalPayload.proof,
          verification_level: finalPayload.verification_level,
          action: 'submit-hazard-report',
        }),
      })

      if (!res.ok) throw new Error('Verification failed')
      const { token } = await res.json()

      setVerified(true)
      onVerified(token)
    } catch (err) {
      console.error('World ID verification failed:', err)
    } finally {
      setVerifying(false)
    }
  }

  if (verified) {
    return (
      <div className="relative">
        <Particles className="absolute inset-0" quantity={50} />
        <div className="flex items-center gap-2 rounded-lg border border-green-500/30 bg-green-500/10 px-4 py-3">
          <span className="text-green-500">✓</span>
          <span className="text-sm font-medium">Verified Human</span>
        </div>
      </div>
    )
  }

  return (
    <Button
      onClick={handleVerify}
      disabled={verifying}
      className="gap-2"
    >
      {verifying ? (
        <span className="animate-spin">◌</span>
      ) : (
        <img src="/worldcoin-logo.svg" alt="" className="h-4 w-4" />
      )}
      {verifying ? 'Verifying...' : 'Verify with World ID'}
    </Button>
  )
}
```

---

## Backend Verification

```python
# backend/services/worldid.py

import httpx
from backend.core.config import settings

WORLDID_VERIFY_URL = "https://developer.worldcoin.org/api/v2/verify/{app_id}"

class WorldIDService:
    async def verify_proof(self, proof_payload: WorldIDProof) -> VerificationResult:
        """
        Verify a World ID ZK proof with the Worldcoin API.
        Returns verification result and issues JWT if valid.
        """
        async with httpx.AsyncClient() as client:
            response = await client.post(
                WORLDID_VERIFY_URL.format(app_id=settings.world_app_id),
                json={
                    "nullifier_hash": proof_payload.nullifier_hash,
                    "merkle_root": proof_payload.merkle_root,
                    "proof": proof_payload.proof,
                    "action": proof_payload.action,
                    "signal": proof_payload.signal or "",
                    "verification_level": proof_payload.verification_level,
                },
                timeout=10.0
            )

        if response.status_code != 200:
            raise WorldIDInvalidError(f"Verification failed: {response.json()}")

        # Check daily rate limit
        daily_count = await self._get_daily_report_count(proof_payload.nullifier_hash)
        if daily_count >= 5:
            raise RateLimitExceededError("Maximum 5 reports per day")

        # Issue JWT
        token = self._issue_jwt(proof_payload.nullifier_hash, proof_payload.verification_level)

        return VerificationResult(
            token=token,
            nullifier_hash=proof_payload.nullifier_hash,
            verification_level=proof_payload.verification_level,
            reports_today=daily_count,
            reports_remaining_today=5 - daily_count,
        )

    def _issue_jwt(self, nullifier_hash: str, verification_level: str) -> str:
        import jwt
        payload = {
            "nullifier_hash": nullifier_hash,
            "world_verified": True,
            "verification_level": verification_level,
            "iat": int(time.time()),
            "exp": int(time.time()) + 86400,  # 24h
        }
        return jwt.encode(payload, settings.jwt_secret, algorithm="HS256")
```

---

## World Chain Smart Contract

```solidity
// infra/contracts/HazardAttestation.sol
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title HazardAttestation
 * @notice Records that a verified human submitted a hazard report.
 *         Deployed on World Chain (Base L2).
 *         Minimal contract — just events for indexing.
 */
contract HazardAttestation {
    address public owner;

    event AttestationSubmitted(
        bytes32 indexed nullifierHash,   // World ID nullifier (anonymous, unique per human)
        bytes32 indexed locationHash,    // keccak256(lat_int, lng_int) — no exact coords on-chain
        uint8 severity,                  // 1=low, 2=medium, 3=high, 4=critical
        uint256 timestamp
    );

    event HazardVerified(
        bytes32 indexed locationHash,
        uint8 reportCount,
        uint256 timestamp
    );

    // locationHash → report count
    mapping(bytes32 => uint8) public reportCounts;
    // (locationHash, nullifierHash) → already reported
    mapping(bytes32 => mapping(bytes32 => bool)) public hasReported;

    constructor() {
        owner = msg.sender;
    }

    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }

    function submitAttestation(
        bytes32 nullifierHash,
        bytes32 locationHash,
        uint8 severity
    ) external onlyOwner {
        require(!hasReported[locationHash][nullifierHash], "Already reported");
        require(severity >= 1 && severity <= 4, "Invalid severity");

        hasReported[locationHash][nullifierHash] = true;
        reportCounts[locationHash]++;

        emit AttestationSubmitted(nullifierHash, locationHash, severity, block.timestamp);

        if (reportCounts[locationHash] >= 3) {
            emit HazardVerified(locationHash, reportCounts[locationHash], block.timestamp);
        }
    }
}
```

### Deployment

```bash
# Install Foundry
curl -L https://foundry.paradigm.xyz | bash && foundryup

# Deploy to World Chain testnet
cd infra/contracts
forge create HazardAttestation \
  --rpc-url https://worldchain-mainnet.g.alchemy.com/v2/... \
  --private-key $DEPLOYER_PRIVATE_KEY

# Note deployed address → add to env
HAZARD_ATTESTATION_CONTRACT=0x...
```

---

## Demo Script for Best Proof of Human Track (60 seconds)

1. **Frame problem:** "Anyone can spam fake hazard reports. Bots could flood our map with false data, leading blind users into danger."

2. **Open /verify page** → "So before anyone can report a hazard, they prove they're a real human."

3. **Click "Verify with World ID"** → World ID modal opens → complete iris verification

4. **Particles animation fires** → "Verified. That's a real person."

5. **Submit a hazard report** → "Reporting construction zone at this location."

6. **Open World Chain block explorer** → Show live transaction → "And right now, on-chain, there's an immutable record that a verified human reported this hazard."

7. **Key statement:** "No bots. No fake reports. Every dot on this map was put there by a real person — proved by World ID's zero-knowledge proof. When Alex walks past a hazard, she can trust it's real."
