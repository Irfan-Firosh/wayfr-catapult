/**
 * POST /api/personas/annotate
 *
 * Takes a detected persona profile + scene objects and returns a full
 * annotation plan from RCAC GenAI. Non-streaming (JSON response).
 */

import type { AnnotationPlan, PersonaAnnotation, PersonaProfile } from "@/lib/persona-types"
import type { ObjectItem } from "@/components/scene/HomeSceneViewer"

export const runtime = "nodejs"

const GENAI_BASE_URL = process.env.GENAI_BASE_URL ?? "https://genai.rcac.purdue.edu/api"
const GENAI_API_KEY = process.env.GENAI_API_KEY ?? ""
const GENAI_MODEL = process.env.GENAI_MODEL ?? "llama4:latest"

function buildAnnotatePrompt(persona: PersonaProfile, objects: ObjectItem[]): string {
  const objectList = objects
    .map((o) => `{ "id": "${o.id}", "label": "${o.label}", "x": ${o.x.toFixed(2)}, "y": ${o.y.toFixed(2)}, "z": ${o.z.toFixed(2)} }`)
    .join(",\n")

  return `You are wayfr's annotation engine. Generate a customized annotation plan for a ${persona.role}.

PERSONA:
- Role: ${persona.role}
- Primary needs: ${persona.primaryNeeds.join(", ")}
- Annotation focus (prioritize these labels): ${persona.annotationFocus.join(", ")}
- Narrative style: ${persona.narrativeStyle}
- Derived annotations to create: ${JSON.stringify(persona.derivedAnnotations)}
- Color scheme: primary=${persona.colorScheme.primary}, secondary=${persona.colorScheme.secondary}, danger=${persona.colorScheme.danger}

SCENE OBJECTS:
[
${objectList}
]

RULES:
1. For each object that matches the annotation focus: create a PersonaAnnotation with a persona-specific label, concise description, priority, and appropriate color from the color scheme.
2. For each derivedAnnotation in the persona: find the best matching object in the scene (by label similarity) and create an ADDITIONAL annotation entry with isNew=true, using the same objectId but the derived label and description.
3. Objects NOT in the annotation focus get priority "low" and color "#6b7280" (muted gray).
4. Use "critical" priority for life-safety items, "high" for primary work items, "medium" for supporting items, "low" for irrelevant.
5. Return ONLY a valid JSON object — no markdown, no extra text.

Return this exact JSON shape:
{
  "personaRole": "${persona.role}",
  "summary": "One sentence describing what was customized for this persona",
  "annotations": [
    {
      "objectId": "string",
      "originalLabel": "string",
      "personaLabel": "string",
      "personaDescription": "string",
      "priority": "critical|high|medium|low",
      "color": "#hex",
      "isNew": false
    }
  ]
}`
}

function extractJson(text: string): unknown {
  // Find first { and last } to extract the JSON object
  const start = text.indexOf("{")
  const end = text.lastIndexOf("}")
  if (start === -1 || end === -1) throw new Error("No JSON object found in response")
  return JSON.parse(text.slice(start, end + 1))
}

export async function POST(request: Request) {
  const body = await request.json() as { persona: PersonaProfile; objects: ObjectItem[] }

  if (!body.persona || !Array.isArray(body.objects)) {
    return new Response(JSON.stringify({ error: "persona and objects are required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    })
  }

  if (!GENAI_API_KEY) {
    return new Response(JSON.stringify({ error: "GENAI_API_KEY not configured" }), {
      status: 503,
      headers: { "Content-Type": "application/json" },
    })
  }

  const prompt = buildAnnotatePrompt(body.persona, body.objects)

  const upstream = await fetch(`${GENAI_BASE_URL}/v1/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${GENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: GENAI_MODEL,
      messages: [{ role: "user", content: prompt }],
      stream: false,
      temperature: 0.3,
      max_tokens: 4000,
    }),
  })

  if (!upstream.ok) {
    const text = await upstream.text()
    return new Response(JSON.stringify({ error: `GenAI error: ${upstream.status} ${text}` }), {
      status: 502,
      headers: { "Content-Type": "application/json" },
    })
  }

  const data = await upstream.json() as { choices: Array<{ message: { content: string } }> }
  const content = data.choices?.[0]?.message?.content ?? ""

  let plan: AnnotationPlan
  try {
    const parsed = extractJson(content) as AnnotationPlan
    // Validate minimally
    if (!parsed.annotations || !Array.isArray(parsed.annotations)) {
      throw new Error("Invalid plan: missing annotations array")
    }
    plan = parsed
  } catch (err) {
    return new Response(
      JSON.stringify({ error: "Failed to parse annotation plan", raw: content, detail: String(err) }),
      { status: 502, headers: { "Content-Type": "application/json" } }
    )
  }

  // Deduplicate annotation entries that have the same objectId + personaLabel
  const seen = new Set<string>()
  const deduped: PersonaAnnotation[] = []
  for (const ann of plan.annotations) {
    const key = `${ann.objectId}::${ann.personaLabel}`
    if (!seen.has(key)) {
      seen.add(key)
      deduped.push(ann)
    }
  }

  return new Response(JSON.stringify({ ...plan, annotations: deduped }), {
    headers: { "Content-Type": "application/json" },
  })
}
