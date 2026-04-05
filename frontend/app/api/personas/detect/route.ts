/**
 * POST /api/personas/detect
 *
 * Streams a persona detection response from RCAC GenAI.
 * The LLM responds conversationally then appends a <persona_json>…</persona_json>
 * block at the end. The client accumulates the full stream, strips the block
 * from the displayed text, and parses the JSON for the persona profile.
 */

export const runtime = "nodejs"

const GENAI_BASE_URL = process.env.GENAI_BASE_URL ?? "https://genai.rcac.purdue.edu/api"
const GENAI_API_KEY = process.env.GENAI_API_KEY ?? ""
const GENAI_MODEL = process.env.GENAI_MODEL ?? "llama4:latest"

const SYSTEM_PROMPT = `You are wayfr's spatial intelligence assistant. wayfr is an AI-powered 3D space annotation system that customizes how people see and interact with scanned environments.

Your job: analyze the user's message, understand who they are and what they need to see in a physical space, then respond warmly and concisely (2–3 sentences max). Acknowledge their role and tell them what you'll highlight for them.

After your conversational response, output a persona profile in this EXACT format — no other text after the closing tag:

<persona_json>
{
  "role": "string — user's role (e.g. 'Firefighter', 'Interior Designer', 'Blind Student', 'Architect')",
  "summary": "string — one sentence describing their spatial needs",
  "primaryNeeds": ["2-4 strings describing key needs"],
  "annotationFocus": ["object label strings to prioritize, e.g. 'door', 'wall', 'window', 'stairs'"],
  "derivedAnnotations": [
    {
      "label": "New annotation label for this persona",
      "mappedFrom": "original object type to map from",
      "description": "Why this matters to the persona",
      "priority": "critical"
    }
  ],
  "colorScheme": {
    "primary": "#hex — main annotation color. Default to warm mango (#F5A623) unless the role has stronger color associations (emergency/firefighter → #EF4444, medical → #3B82F6, nature/plant → #22C55E, law/security → #8B5CF6). Mango is the house color so prefer it when in doubt.",
    "secondary": "#hex — supporting annotations, cooler/more muted. E.g. #94A3B8 slate or a desaturated version of primary.",
    "danger": "#hex — critical/warning items. Use #EF4444 red or #F97316 orange."
  },
  "narrativeStyle": "string — tone descriptor, e.g. 'safety-focused', 'accessibility-first', 'aesthetic'"
}
</persona_json>`

export async function POST(request: Request) {
  const body = await request.json() as { prompt: string; history?: Array<{ role: string; content: string }> }

  if (!body.prompt || typeof body.prompt !== "string") {
    return new Response(JSON.stringify({ error: "prompt is required" }), {
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

  const messages = [
    { role: "system", content: SYSTEM_PROMPT },
    ...(body.history ?? []),
    { role: "user", content: body.prompt },
  ]

  const upstream = await fetch(`${GENAI_BASE_URL}/v1/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${GENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: GENAI_MODEL,
      messages,
      stream: true,
      temperature: 0.7,
      max_tokens: 1200,
    }),
  })

  if (!upstream.ok) {
    const text = await upstream.text()
    return new Response(JSON.stringify({ error: `GenAI error: ${upstream.status} ${text}` }), {
      status: 502,
      headers: { "Content-Type": "application/json" },
    })
  }

  // Pass the SSE stream through directly
  return new Response(upstream.body, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "X-Accel-Buffering": "no",
    },
  })
}
