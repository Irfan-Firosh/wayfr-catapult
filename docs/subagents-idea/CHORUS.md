# CHORUS — Collaborative Habitat Observer & Reasoning Unit Swarm

> Multi-agent spatial intelligence layer for wayfr personas.

---

## Concept

When a user builds a persona view of a space, they get one perspective. **CHORUS** lets them summon a **council of 4 specialized AI agents** that simultaneously analyze the same scene from radically different lenses — and then synthesize their findings into a single unified annotation plan.

This is a user-triggered feature. A "Launch Council" button appears in the scene view after a persona is applied. The user clicks it, and the council runs live, with real-time streaming updates showing each agent's progress.

---

## The Council

Four agents are spawned at runtime, each with a distinct personality and focus area:

| Agent | Name | Specialty | Color |
|-------|------|-----------|-------|
| `safety` | Safety Sentinel | Hazards, fire exits, emergency equipment | `#EF4444` red |
| `access` | Access Advocate | Wheelchair access, ADA compliance, inclusion | `#3B82F6` blue |
| `flow` | Flow Analyst | Traffic patterns, bottlenecks, workflow efficiency | `#10B981` green |
| `atmos` | Atmosphere Auditor | Lighting, comfort, privacy, acoustics | `#8B5CF6` purple |

Agents run **in parallel** — all 4 are spawned simultaneously via `Promise.allSettled`. Each has its own system prompt tuned to its specialty, with its own color scheme for annotations.

---

## What Makes It Hackathon-Worthy

### 1. Live Agent Activity Feed
The UI shows a streaming feed of which agent is working, what they've found, and when they complete. It feels like watching a team of analysts work a room in real time.

### 2. Conflict Detection
When two agents disagree on the priority of the same object (e.g., Safety says "critical" for a door, but Flow says "low"), that conflict is flagged visually. Conflicts show as amber warning strips in the feed.

**Example:** Safety Sentinel marks `door_3` as `critical` (blocked fire exit). Flow Analyst marks it `low` (rarely used). The council flags this conflict and the synthesis escalates it to `critical` — safety wins.

### 3. Confidence-as-Opacity in 3D
The synthesized annotation plan includes a `confidence` score per annotation. In the 3D viewer, high-confidence objects render at full opacity; low-confidence objects are subtly faded. This gives a spatial sense of certainty across the whole scene.

### 4. Synthesized Expert Narrative
After all 4 agents complete, a synthesis pass merges their findings into a single `AnnotationPlan`. The summary becomes: _"Council synthesis: 4 agents analyzed 47 objects, found 3 priority conflicts. Safety concerns elevated in north corridor."_

---

## Architecture

### API

```
POST /api/personas/swarm
  Body: { persona: PersonaProfile, objects: ObjectItem[], sessionId?: string }
  Returns: text/event-stream (SSE)
```

No separate init step. A single POST returns a streaming response that emits events as agents complete.

### SSE Event Stream

```
data: {"type":"council_ready","data":{agents:[...]}, "timestamp":...}

data: {"type":"agent_start","agentId":"safety","timestamp":...}
data: {"type":"agent_start","agentId":"access","timestamp":...}
data: {"type":"agent_start","agentId":"flow","timestamp":...}
data: {"type":"agent_start","agentId":"atmos","timestamp":...}

data: {"type":"agent_complete","agentId":"flow","timestamp":...,"data":{annotations:[...],confidence:0.87,narrative:"..."}}
data: {"type":"agent_complete","agentId":"safety","timestamp":...,"data":{...}}
data: {"type":"agent_complete","agentId":"access","timestamp":...,"data":{...}}
data: {"type":"agent_complete","agentId":"atmos","timestamp":...,"data":{...}}

data: {"type":"conflict_detected","timestamp":...,"data":{objectId:"...",agentIds:[...],description:"..."}}

data: {"type":"synthesis_start","timestamp":...}
data: {"type":"synthesis_complete","timestamp":...,"data":{synthesizedPlan:{...},conflicts:[...]}}

data: [DONE]
```

### Agent Prompt Design

Each agent receives the same scene objects but a different system prompt. The prompt instructs the agent to:
- Annotate from its specific lens only
- Use its own color palette
- Return `{ agentId, confidence, narrative, annotations[] }` as JSON
- Focus on the 8–15 most relevant objects (not exhaustive)

### Synthesis Algorithm

Algorithmic (no extra LLM call — keeps it fast):

1. Collect all annotations from all 4 agents
2. Group by `objectId`
3. For each object with multiple annotations:
   - Pick the highest-priority one as canonical
   - Flag a conflict if priority difference ≥ 2 levels (e.g., `critical` vs `medium`)
4. Deduplicate by `objectId + personaLabel`
5. Build merged `AnnotationPlan` with summary: "Council synthesis: N agents, M objects, K conflicts"

---

## UI Components

### `SwarmConsole` (panel overlay)

Slides in from the right in the scene view. Three zones:

**Zone 1 — Agent Grid (2×2)**
Each agent card shows:
- Colored dot + name + specialty
- Status: `thinking…` / `complete (N annotations)` / `error`
- Animated pulse while running

**Zone 2 — Activity Feed**
Chronological log of events:
- `[🔴 Safety] Analysis complete · 11 annotations`
- `[⚠️ Conflict] "door_3" — Safety:critical vs Flow:low`
- `[🔵 Access] 8 accessibility annotations found`
- `[✓ Synthesis] Council view ready`

**Zone 3 — Action Bar**
- `Apply Council View` button (enabled when synthesis complete)
- Annotation count badge
- Conflict count badge (amber if > 0)

### Integration in `PersonaConsole`

In the scene view (`isSceneView` branch):
- Add a `swarmOpen` boolean state
- Add a `swarmPlan` state (`AnnotationPlan | null`) that overrides `latestSceneMsg.plan`
- Active plan = `swarmPlan ?? latestSceneMsg.plan`
- Small "CHORUS" button floats bottom-right (next to history button)
- When `swarmOpen`, render `<SwarmConsole>` as an overlay

---

## Files to Create

```
frontend/lib/swarm-types.ts                     ← types
frontend/app/api/personas/swarm/route.ts        ← POST SSE endpoint
frontend/components/personas/swarm-console.tsx  ← UI component
```

Files to modify:
```
frontend/components/personas/persona-console.tsx   ← add swarm state + button
```

---

## Key Demo Moment

1. User builds a "Firefighter" persona view of a living room
2. They click **"Launch CHORUS Council"**
3. The panel opens — 4 agents start thinking simultaneously (animated)
4. Safety Sentinel finishes first: 11 annotations, mostly red
5. Access Advocate finishes: 8 blue annotations, flags the narrow hallway
6. Conflict detected: "couch" — Flow says move it, Atmos says keep it
7. All agents complete. Synthesis runs instantly.
8. User clicks **"Apply Council View"** — the 3D scene updates with the merged multi-agent annotation layer
9. Objects flagged by multiple agents glow brighter; disputed objects pulse amber

This is the moment that wins the demo.

---

## MVP Scope

- Council config (4 hardcoded agents)
- 4 parallel GenAI calls
- SSE streaming with live activity feed
- Algorithmic conflict detection
- Algorithmic synthesis (no extra LLM call)
- `SwarmConsole` with agent grid + activity feed + apply button
- Confidence-as-opacity deferred to v2 (requires 3D viewer changes)

Estimated build time: ~4–6 hours.
