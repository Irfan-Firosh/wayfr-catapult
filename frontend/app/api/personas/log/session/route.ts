import { NextRequest, NextResponse } from "next/server"
import { auth } from "@clerk/nextjs/server"
import { supabaseServer } from "@/lib/supabase-server"

export async function POST(req: NextRequest) {
  try {
    const { userId } = await auth()
    const body = (await req.json()) as { session_id?: string }
    const sessionId = body.session_id

    if (!sessionId) {
      return NextResponse.json({ error: "session_id required" }, { status: 400 })
    }

    const { error } = await supabaseServer.from("persona_sessions").upsert(
      {
        id: sessionId,
        user_id: userId ?? null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "id" }
    )

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal error" },
      { status: 500 }
    )
  }
}
