import { NextRequest, NextResponse } from "next/server"
import { auth } from "@clerk/nextjs/server"
import { supabaseServer } from "@/lib/supabase-server"
import type { AnnotationPlan } from "@/lib/persona-types"

interface LogAnnotationBody {
  session_id: string
  home_id: string
  home_name: string
  persona_role: string
  plan: AnnotationPlan
  scene_object_count: number
}

export async function POST(req: NextRequest) {
  try {
    const { userId } = await auth()
    const body = (await req.json()) as Partial<LogAnnotationBody>

    if (!body.session_id || !body.home_id || !body.plan) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 })
    }

    const plan = body.plan
    const criticalCount = plan.annotations.filter((a) => a.priority === "critical").length
    const highCount = plan.annotations.filter((a) => a.priority === "high").length

    const { error } = await supabaseServer.from("persona_annotation_plans").insert({
      session_id: body.session_id,
      user_id: userId ?? null,
      home_id: body.home_id,
      home_name: body.home_name ?? null,
      persona_role: body.persona_role ?? plan.personaRole,
      plan_summary: plan.summary,
      annotations: plan.annotations,
      annotation_count: plan.annotations.length,
      critical_count: criticalCount,
      high_count: highCount,
      scene_object_count: body.scene_object_count ?? 0,
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
