import { NextResponse } from "next/server"
import type { IDKitResult } from "@worldcoin/idkit"

export async function POST(request: Request): Promise<Response> {
  const rpId = process.env.NEXT_PUBLIC_WORLD_RP_ID
  if (!rpId) {
    return NextResponse.json(
      { error: "NEXT_PUBLIC_WORLD_RP_ID not configured" },
      { status: 500 },
    )
  }

  const { idkitResponse } = (await request.json()) as {
    idkitResponse: IDKitResult
  }

  const response = await fetch(
    `https://developer.world.org/api/v4/verify/${rpId}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(idkitResponse),
    },
  )

  if (!response.ok) {
    const data = await response.json().catch(() => ({}))
    return NextResponse.json(
      {
        error: "Verification failed",
        detail: data.detail ?? "Unknown error from World ID API",
      },
      { status: 400 },
    )
  }

  const result = await response.json()
  return NextResponse.json({
    verified: true,
    nullifier: result.nullifier ?? null,
  })
}
