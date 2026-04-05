import { NextRequest, NextResponse } from "next/server"
import { auth } from "@clerk/nextjs/server"
import { supabaseServer } from "@/lib/supabase-server"

interface LogMessageBody {
  session_id: string
  seq: number
  role: "user" | "assistant"
  message_type: string
  content: unknown
}

export async function POST(req: NextRequest) {
  try {
    const { userId } = await auth()
    const body = (await req.json()) as Partial<LogMessageBody>

    if (!body.session_id || body.seq === undefined || !body.role || !body.message_type) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 })
    }

    const { error } = await supabaseServer.from("persona_messages").insert({
      session_id: body.session_id,
      user_id: userId ?? null,
      seq: body.seq,
      role: body.role,
      message_type: body.message_type,
      content: body.content ?? null,
    })

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
