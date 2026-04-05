import { NextRequest, NextResponse } from "next/server"
import { auth } from "@clerk/nextjs/server"
import { supabaseServer } from "@/lib/supabase-server"
import type { PersonaProfile } from "@/lib/persona-types"

interface LogProfileBody {
  session_id: string
  persona: PersonaProfile
  was_edited: boolean
}

export async function POST(req: NextRequest) {
  try {
    const { userId } = await auth()
    const body = (await req.json()) as Partial<LogProfileBody>

    if (!body.session_id || !body.persona) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 })
    }

    const persona = body.persona

    const { error } = await supabaseServer.from("persona_profiles").insert({
      session_id: body.session_id,
      user_id: userId ?? null,
      role: persona.role,
      summary: persona.summary,
      primary_needs: persona.primaryNeeds,
      annotation_focus: persona.annotationFocus,
      derived_annotations: persona.derivedAnnotations,
      color_scheme: persona.colorScheme,
      narrative_style: persona.narrativeStyle,
      was_edited: body.was_edited ?? false,
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
