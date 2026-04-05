"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { SendHorizontal, Sparkles, Loader2 } from "lucide-react"

import { HistoryPanel } from "@/components/personas/history-panel"
import type { HistorySession } from "@/components/personas/history-panel"
import { HomePicker } from "@/components/personas/home-picker"
import { PersonaEditor } from "@/components/personas/persona-editor"
import { PersonaSceneCard } from "@/components/personas/persona-scene-card"
import type { ObjectItem } from "@/components/scene/HomeSceneViewer"
import { cn } from "@/lib/utils"
import type {
  AnnotationPlan,
  ChatMessage,
  PersonaEditorMessage,
  PersonaProfile,
  SceneMessage,
  TextMessage,
} from "@/lib/persona-types"

// ── Constants ─────────────────────────────────────────────────────────────────

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000"

type Stage =
  | "idle"
  | "detecting"
  | "detected"
  | "editing"
  | "picking"
  | "annotating"
  | "ready"
  | "follow_up"

// ── Persona sigil ─────────────────────────────────────────────────────────────

function PersonaSigil({ small }: { small?: boolean }) {
  return (
    <div
      className={cn(
        "persona-sigil-shell transition-all duration-500",
        small && "persona-sigil-shell-sm"
      )}
      aria-hidden="true"
    >
      <span className="persona-sigil-aura" />
      <span className="persona-sigil-orbit persona-sigil-orbit-a" />
      <span className="persona-sigil-orbit persona-sigil-orbit-b" />
      <span className="persona-sigil-frame" />
      <span className="persona-sigil-spine" />
      <span className="persona-sigil-shard persona-sigil-shard-left" />
      <span className="persona-sigil-shard persona-sigil-shard-right" />
      <span className="persona-sigil-core">
        <span className="persona-sigil-core-inner" />
      </span>
      <span className="persona-sigil-star persona-sigil-star-top" />
      <span className="persona-sigil-star persona-sigil-star-mid" />
      <span className="persona-sigil-star persona-sigil-star-bottom" />
      <style jsx>{`
        .persona-sigil-shell {
          --sigil-size: 172px;
          position: relative;
          width: var(--sigil-size);
          height: var(--sigil-size);
          flex-shrink: 0;
        }
        .persona-sigil-shell-sm {
          --sigil-size: 72px;
        }
        .persona-sigil-aura {
          position: absolute;
          inset: 12%;
          border-radius: 42%;
          background:
            radial-gradient(circle at 50% 50%, rgba(245, 166, 35, 0.3), rgba(245, 166, 35, 0.08) 42%, transparent 72%),
            radial-gradient(circle at 30% 30%, rgba(255, 239, 206, 0.26), transparent 34%);
          filter: blur(16px);
          animation: sigilAura 5.6s ease-in-out infinite;
        }
        .persona-sigil-orbit {
          position: absolute;
          inset: 15%;
          border-radius: 50%;
          border: 1px solid rgba(255, 225, 176, 0.16);
        }
        .persona-sigil-orbit-a {
          transform: rotate(22deg) scaleX(0.84);
          animation: sigilOrbitA 10s linear infinite;
        }
        .persona-sigil-orbit-b {
          inset: 22%;
          border-color: rgba(245, 166, 35, 0.24);
          transform: rotate(-34deg) scaleY(0.72);
          animation: sigilOrbitB 12s linear infinite;
        }
        .persona-sigil-frame {
          position: absolute;
          inset: 26%;
          border-radius: 26%;
          background:
            linear-gradient(135deg, rgba(255, 244, 219, 0.18), rgba(245, 166, 35, 0.04));
          border: 1px solid rgba(255, 230, 192, 0.22);
          box-shadow:
            inset 0 0 18px rgba(255, 242, 216, 0.08),
            0 0 24px rgba(245, 166, 35, 0.12);
          transform: rotate(45deg);
          animation: sigilFrame 8.6s ease-in-out infinite;
        }
        .persona-sigil-spine {
          position: absolute;
          top: 16%;
          bottom: 16%;
          left: 50%;
          width: 2px;
          margin-left: -1px;
          border-radius: 999px;
          background:
            linear-gradient(180deg, transparent, rgba(255, 244, 224, 0.9) 18%, rgba(245, 166, 35, 0.85) 50%, rgba(255, 244, 224, 0.9) 82%, transparent);
          box-shadow:
            0 0 16px rgba(245, 166, 35, 0.22),
            0 0 28px rgba(245, 166, 35, 0.08);
          animation: sigilSpine 4.8s ease-in-out infinite;
        }
        .persona-sigil-shard {
          position: absolute;
          top: 50%;
          width: 18%;
          height: 28%;
          margin-top: -14%;
          border-radius: 18px;
          background:
            linear-gradient(180deg, rgba(255, 247, 230, 0.92), rgba(245, 166, 35, 0.72) 58%, rgba(152, 72, 20, 0.76));
          box-shadow:
            0 0 18px rgba(245, 166, 35, 0.22),
            inset 0 0 10px rgba(255, 255, 255, 0.12);
          opacity: 0.9;
        }
        .persona-sigil-shard-left {
          left: 23%;
          transform: skewY(18deg) rotate(-18deg);
          animation: sigilShardLeft 5.2s ease-in-out infinite;
        }
        .persona-sigil-shard-right {
          right: 23%;
          transform: skewY(-18deg) rotate(18deg);
          animation: sigilShardRight 5.2s ease-in-out infinite 0.35s;
        }
        .persona-sigil-core {
          position: absolute;
          top: 50%;
          left: 50%;
          width: 28%;
          height: 28%;
          margin-left: -14%;
          margin-top: -14%;
          border-radius: 28%;
          background:
            linear-gradient(145deg, rgba(255, 249, 240, 1), rgba(255, 209, 126, 0.96) 42%, rgba(230, 132, 28, 0.9) 72%, rgba(116, 48, 15, 0.86));
          box-shadow:
            0 0 24px rgba(245, 166, 35, 0.35),
            0 18px 38px rgba(0, 0, 0, 0.24);
          transform: rotate(45deg);
          animation: sigilCore 4.2s ease-in-out infinite;
        }
        .persona-sigil-core-inner {
          position: absolute;
          inset: 26%;
          display: flex;
          border-radius: 36%;
          background:
            radial-gradient(circle at 35% 35%, rgba(255, 255, 255, 0.98), rgba(255, 239, 203, 0.86) 44%, rgba(255, 210, 128, 0.18));
          box-shadow:
            0 0 16px rgba(255, 250, 240, 0.45),
            inset 0 0 10px rgba(255, 255, 255, 0.18);
        }
        .persona-sigil-star {
          position: absolute;
          left: 50%;
          width: 8px;
          height: 8px;
          margin-left: -4px;
          border-radius: 999px;
          background:
            radial-gradient(circle, rgba(255, 255, 255, 0.98), rgba(255, 231, 177, 0.84) 48%, rgba(245, 166, 35, 0.25));
          box-shadow:
            0 0 16px rgba(255, 242, 210, 0.3),
            0 0 28px rgba(245, 166, 35, 0.18);
          animation: sigilStar 3.8s ease-in-out infinite;
        }
        .persona-sigil-star-top {
          top: 19%;
          animation-delay: 0.1s;
        }
        .persona-sigil-star-mid {
          top: 50%;
          margin-top: -32%;
          margin-left: 26%;
          width: 6px;
          height: 6px;
          animation-delay: 0.6s;
        }
        .persona-sigil-star-bottom {
          bottom: 19%;
          animation-delay: 1.1s;
        }
        @keyframes sigilAura {
          0%, 100% { opacity: 0.74; transform: scale(0.94); }
          50% { opacity: 1; transform: scale(1.05); }
        }
        @keyframes sigilOrbitA {
          from { transform: rotate(22deg) scaleX(0.84); }
          to { transform: rotate(382deg) scaleX(0.84); }
        }
        @keyframes sigilOrbitB {
          from { transform: rotate(-34deg) scaleY(0.72); }
          to { transform: rotate(-394deg) scaleY(0.72); }
        }
        @keyframes sigilFrame {
          0%, 100% { transform: rotate(45deg) scale(0.98); border-radius: 26%; }
          50% { transform: rotate(45deg) scale(1.03); border-radius: 31%; }
        }
        @keyframes sigilSpine {
          0%, 100% { opacity: 0.84; transform: scaleY(0.94); }
          50% { opacity: 1; transform: scaleY(1.04); }
        }
        @keyframes sigilShardLeft {
          0%, 100% { transform: translate(-2px, -6px) skewY(18deg) rotate(-18deg); }
          50% { transform: translate(4px, 6px) skewY(10deg) rotate(-10deg); }
        }
        @keyframes sigilShardRight {
          0%, 100% { transform: translate(2px, 8px) skewY(-18deg) rotate(18deg); }
          50% { transform: translate(-5px, -5px) skewY(-9deg) rotate(10deg); }
        }
        @keyframes sigilCore {
          0%, 100% { transform: rotate(45deg) scale(0.96); }
          50% { transform: rotate(45deg) scale(1.08); }
        }
        @keyframes sigilStar {
          0%, 100% { opacity: 0.36; transform: scale(0.9); }
          50% { opacity: 1; transform: scale(1.15); }
        }
        @media (max-width: 640px) {
          .persona-sigil-shell {
            --sigil-size: 136px;
          }
          .persona-sigil-shell-sm {
            --sigil-size: 62px;
          }
          .persona-sigil-star {
            width: 6px;
            height: 6px;
            margin-left: -3px;
          }
        }
        @media (prefers-reduced-motion: reduce) {
          .persona-sigil-aura,
          .persona-sigil-orbit-a,
          .persona-sigil-orbit-b,
          .persona-sigil-frame,
          .persona-sigil-spine,
          .persona-sigil-shard-left,
          .persona-sigil-shard-right,
          .persona-sigil-core,
          .persona-sigil-star {
            animation: none;
          }
        }
      `}</style>
    </div>
  )
}

// ── Persona badge ─────────────────────────────────────────────────────────────

function PersonaBadge({ persona }: { persona: PersonaProfile }) {
  return (
    <div className="overflow-hidden rounded-2xl border border-border/50 bg-background/50 backdrop-blur-sm">
      <div
        className="flex items-center gap-3 px-4 py-3"
        style={{ borderBottom: `1px solid ${persona.colorScheme.primary}22` }}
      >
        <div
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full"
          style={{ backgroundColor: `${persona.colorScheme.primary}22` }}
        >
          <Sparkles className="h-3.5 w-3.5" style={{ color: persona.colorScheme.primary }} />
        </div>
        <div>
          <p className="text-sm font-semibold text-foreground">{persona.role}</p>
          <p className="text-xs text-muted-foreground">{persona.summary}</p>
        </div>
      </div>

      <div className="flex flex-wrap gap-1.5 px-4 py-3">
        {persona.primaryNeeds.map((need) => (
          <span
            key={need}
            className="rounded-full px-2.5 py-1 text-xs font-medium"
            style={{
              backgroundColor: `${persona.colorScheme.primary}15`,
              color: persona.colorScheme.primary,
            }}
          >
            {need}
          </span>
        ))}
      </div>

      <div className="flex items-center gap-2 border-t border-border/30 px-4 py-2.5 text-xs text-muted-foreground">
        <div className="flex gap-1.5">
          {Object.values(persona.colorScheme).map((color, i) => (
            <span
              key={i}
              className="inline-block h-3 w-3 rounded-full border border-white/10"
              style={{ backgroundColor: color }}
            />
          ))}
        </div>
        <span>{persona.narrativeStyle} view</span>
        {persona.derivedAnnotations.length > 0 && (
          <span className="ml-auto flex items-center gap-1 text-mango">
            <Sparkles className="h-2.5 w-2.5" />
            {persona.derivedAnnotations.length} new annotation type{persona.derivedAnnotations.length !== 1 ? "s" : ""}
          </span>
        )}
      </div>
    </div>
  )
}

// ── Message bubbles ───────────────────────────────────────────────────────────

function UserBubble({ text }: { text: string }) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[85%] rounded-3xl rounded-br-lg bg-mango/12 px-4 py-3 text-sm leading-relaxed text-foreground">
        {text}
      </div>
    </div>
  )
}

function AssistantBubble({ text, streaming }: { text: string; streaming?: boolean }) {
  // Strip the persona_json block from display
  const displayText = text
    .replace(/<persona_json>[\s\S]*?<\/persona_json>/g, "")
    .replace(/<persona_json>[\s\S]*/g, "") // partial tag mid-stream
    .trim()

  if (!displayText && !streaming) return null

  return (
    <div className="flex justify-start">
      <div className="max-w-[85%] rounded-3xl rounded-bl-lg bg-muted/40 px-4 py-3 text-sm leading-relaxed text-foreground">
        {displayText || (
          <span className="flex items-center gap-1.5 text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Thinking…
          </span>
        )}
        {streaming && displayText && (
          <span className="ml-0.5 inline-block h-3.5 w-0.5 animate-pulse bg-current align-middle opacity-70" />
        )}
      </div>
    </div>
  )
}

function AssistantLoadingBubble({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2 text-sm text-muted-foreground">
      <Loader2 className="h-3.5 w-3.5 animate-spin" />
      {label}
    </div>
  )
}

// ── Simple prompt input ───────────────────────────────────────────────────────

interface PromptInputProps {
  value: string
  onChange: (v: string) => void
  onSubmit: () => void
  disabled?: boolean
  placeholder?: string
}

function PromptInput({ value, onChange, onSubmit, disabled, placeholder }: PromptInputProps) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)

  useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = "auto"
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`
  }, [value])

  return (
    <div className="rounded-[28px] border border-border/50 bg-background/88 p-2 shadow-[0_18px_50px_rgba(0,0,0,0.06)] backdrop-blur-xl transition-colors dark:border-white/12 dark:bg-[oklch(0.18_0.008_60)] dark:shadow-[0_24px_80px_rgba(0,0,0,0.32)]">
      <textarea
        ref={textareaRef}
        rows={1}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder ?? "Describe your role or what you're looking for…"}
        disabled={disabled}
        className="min-h-12 w-full resize-none border-0 bg-transparent p-3 text-foreground placeholder:text-muted-foreground/70 focus-visible:outline-none disabled:opacity-50"
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault()
            if (!disabled && value.trim()) onSubmit()
          }
        }}
      />
      <div className="flex items-center justify-end p-1 pt-0">
        <button
          type="button"
          disabled={disabled || !value.trim()}
          onClick={onSubmit}
          className="flex h-8 w-8 items-center justify-center rounded-full bg-black text-white transition-colors hover:bg-black/80 disabled:bg-black/30 dark:bg-white dark:text-black dark:hover:bg-white/80 dark:disabled:bg-[#515151] dark:disabled:text-white/30"
        >
          <SendHorizontal className="h-4 w-4" />
          <span className="sr-only">Send</span>
        </button>
      </div>
    </div>
  )
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function nanoid() {
  return Math.random().toString(36).slice(2, 10)
}

function extractPersonaJson(text: string): PersonaProfile | null {
  const match = text.match(/<persona_json>([\s\S]*?)<\/persona_json>/)
  if (!match) return null
  try {
    return JSON.parse(match[1]) as PersonaProfile
  } catch {
    return null
  }
}

async function parseStream(
  response: Response,
  onChunk: (accumulated: string) => void
): Promise<string> {
  const reader = response.body?.getReader()
  if (!reader) throw new Error("No response body")

  const decoder = new TextDecoder()
  let accumulated = ""

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    const chunk = decoder.decode(value, { stream: true })
    for (const line of chunk.split("\n")) {
      const trimmed = line.trim()
      if (!trimmed.startsWith("data:")) continue
      const data = trimmed.slice(5).trim()
      if (data === "[DONE]") continue
      try {
        const parsed = JSON.parse(data) as {
          choices?: Array<{ delta?: { content?: string } }>
        }
        const delta = parsed.choices?.[0]?.delta?.content
        if (delta) {
          accumulated += delta
          onChunk(accumulated)
        }
      } catch {
        // ignore malformed lines
      }
    }
  }

  return accumulated
}

// ── Logging helpers ───────────────────────────────────────────────────────────

function fireAndForget(url: string, body: unknown) {
  fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).catch(() => {
    // intentionally swallowed — logging must never break UX
  })
}

// ── Main component ────────────────────────────────────────────────────────────

export function PersonaConsole() {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [draft, setDraft] = useState("")
  const [stage, setStage] = useState<Stage>("idle")
  const [currentPersona, setCurrentPersona] = useState<PersonaProfile | null>(null)
  const [selectedHomeId, setSelectedHomeId] = useState<string | null>(null)
  const [selectedHomeName, setSelectedHomeName] = useState<string | null>(null)
  const [sceneObjects, setSceneObjects] = useState<ObjectItem[]>([])

  const messagesEndRef = useRef<HTMLDivElement | null>(null)
  const annotatingRef = useRef(false)
  // Logging state
  const sessionIdRef = useRef<string>(nanoid())
  const sessionCreatedRef = useRef(false)
  const seqRef = useRef(0)
  const originalPersonaRef = useRef<PersonaProfile | null>(null)
  const isActive = messages.length > 0

  function ensureSession() {
    if (sessionCreatedRef.current) return
    sessionCreatedRef.current = true
    fireAndForget("/api/personas/log/session", { session_id: sessionIdRef.current })
  }

  function logMessage(role: "user" | "assistant", messageType: string, content: unknown) {
    const seq = seqRef.current++
    fireAndForget("/api/personas/log/message", {
      session_id: sessionIdRef.current,
      seq,
      role,
      message_type: messageType,
      content,
    })
  }

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [])

  useEffect(() => {
    scrollToBottom()
  }, [messages, scrollToBottom])

  // ── Core: run detection ────────────────────────────────────────────────────

  const runDetection = useCallback(async (prompt: string) => {
    const userMsgId = nanoid()
    const assistantMsgId = nanoid()

    ensureSession()
    logMessage("user", "text", { text: prompt })

    setMessages((prev) => [
      ...prev,
      { id: userMsgId, role: "user", type: "text", text: prompt } satisfies TextMessage,
      { id: assistantMsgId, role: "assistant", type: "text", text: "", streaming: true } satisfies TextMessage,
    ])
    setStage("detecting")
    setDraft("")

    try {
      const res = await fetch("/api/personas/detect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt }),
      })

      if (!res.ok) {
        const err = await res.text()
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantMsgId
              ? ({ ...m, text: `Something went wrong: ${err}`, streaming: false } as TextMessage)
              : m
          )
        )
        setStage("idle")
        return
      }

      const fullText = await parseStream(res, (accumulated) => {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantMsgId
              ? ({ ...m, text: accumulated, streaming: true } as TextMessage)
              : m
          )
        )
      })

      // Finalize streaming message
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantMsgId
            ? ({ ...m, text: fullText, streaming: false } as TextMessage)
            : m
        )
      )

      const displayText = fullText
        .replace(/<persona_json>[\s\S]*?<\/persona_json>/g, "")
        .replace(/<persona_json>[\s\S]*/g, "")
        .trim()
      logMessage("assistant", "text", { text: displayText })

      const persona = extractPersonaJson(fullText)
      if (persona) {
        originalPersonaRef.current = persona
        setCurrentPersona(persona)
        logMessage("assistant", "persona_badge", { persona })
        // Append persona badge + editor (user reviews/edits before picking space)
        setMessages((prev) => [
          ...prev,
          { id: nanoid(), role: "assistant", type: "persona_badge", persona } as const,
          { id: nanoid(), role: "assistant", type: "persona_editor", persona } satisfies PersonaEditorMessage,
        ])
        setStage("editing")
      } else {
        // No structured persona — allow follow-up
        setStage("follow_up")
      }
    } catch (err) {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantMsgId
            ? ({ ...m, text: "Network error. Please try again.", streaming: false } as TextMessage)
            : m
        )
      )
      setStage("idle")
    }
  }, [])

  // ── Core: run annotation ───────────────────────────────────────────────────

  const runAnnotation = useCallback(
    async (homeId: string, homeName: string, persona: PersonaProfile) => {
      if (annotatingRef.current) return
      annotatingRef.current = true
      const loadingId = nanoid()
      setStage("annotating")
      setMessages((prev) => [
        ...prev,
        {
          id: loadingId,
          role: "assistant",
          type: "text",
          text: "__loading__",
          streaming: false,
        } satisfies TextMessage,
      ])

      try {
        // Fetch scene objects
        const objRes = await fetch(`${API_URL}/api/homes/${homeId}/objects`, { cache: "no-store" })
        if (!objRes.ok) throw new Error(`Failed to load objects (${objRes.status})`)
        const objData = await objRes.json() as { objects?: ObjectItem[] }
        const objects: ObjectItem[] = (objData.objects ?? []).map((o) => ({
          ...o,
          confidence: o.confidence ?? null,
          n_observations: o.n_observations ?? 1,
        }))
        setSceneObjects(objects)

        // Call annotation plan
        const annRes = await fetch("/api/personas/annotate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ persona, objects }),
        })
        if (!annRes.ok) {
          const err = await annRes.text()
          throw new Error(`Annotation error: ${err}`)
        }
        const plan = await annRes.json() as AnnotationPlan

        // Log annotation plan
        fireAndForget("/api/personas/log/annotation", {
          session_id: sessionIdRef.current,
          home_id: homeId,
          home_name: homeName,
          persona_role: persona.role,
          plan,
          scene_object_count: objects.length,
        })
        logMessage("assistant", "scene", { homeId, homeName, plan_summary: plan.summary })

        // Replace loading bubble with scene card
        setMessages((prev) => [
          ...prev.filter((m) => m.id !== loadingId),
          {
            id: nanoid(),
            role: "assistant",
            type: "scene",
            homeId,
            homeName,
            plan,
          } satisfies SceneMessage,
          {
            id: nanoid(),
            role: "assistant",
            type: "text",
            text: `I've customized the view for a ${persona.role}. You can ask me to adjust the focus or explore specific areas.`,
            streaming: false,
          } satisfies TextMessage,
        ])
        setStage("ready")
      } catch (err) {
        setMessages((prev) => [
          ...prev.filter((m) => m.id !== loadingId),
          {
            id: nanoid(),
            role: "assistant",
            type: "text",
            text: err instanceof Error ? err.message : "Failed to build annotation plan.",
            streaming: false,
          } satisfies TextMessage,
        ])
        setStage("detected")
      } finally {
        annotatingRef.current = false
      }
    },
    []
  )

  // ── Persona editor confirm ─────────────────────────────────────────────────

  const handleEditorConfirm = useCallback((editedPersona: PersonaProfile) => {
    const wasEdited =
      originalPersonaRef.current !== null &&
      JSON.stringify(editedPersona) !== JSON.stringify(originalPersonaRef.current)
    fireAndForget("/api/personas/log/profile", {
      session_id: sessionIdRef.current,
      persona: editedPersona,
      was_edited: wasEdited,
    })
    setCurrentPersona(editedPersona)
    setMessages((prev) => [
      ...prev,
      { id: nanoid(), role: "assistant", type: "home_picker" } as const,
    ])
    setStage("picking")
  }, [])

  const handleEditorBack = useCallback(() => {
    setStage("follow_up")
  }, [])

  // ── Load a past session from history ──────────────────────────────────────

  const loadHistorySession = useCallback(async (session: HistorySession) => {
    setStage("annotating")
    setMessages([])
    try {
      const objRes = await fetch(`${API_URL}/api/homes/${session.homeId}/objects`, {
        cache: "no-store",
      })
      if (!objRes.ok) throw new Error(`Failed to load objects (${objRes.status})`)
      const objData = (await objRes.json()) as { objects?: ObjectItem[] }
      const objects: ObjectItem[] = (objData.objects ?? []).map((o) => ({
        ...o,
        confidence: o.confidence ?? null,
        n_observations: o.n_observations ?? 1,
      }))
      setSceneObjects(objects)
      if (session.persona) setCurrentPersona(session.persona)
      setMessages([
        {
          id: nanoid(),
          role: "assistant",
          type: "scene",
          homeId: session.homeId,
          homeName: session.homeName ?? session.homeId,
          plan: session.plan,
        } satisfies SceneMessage,
      ])
      setStage("ready")
    } catch {
      setMessages([
        {
          id: nanoid(),
          role: "assistant",
          type: "text",
          text: "Failed to load that session. The scene may no longer be available.",
          streaming: false,
        } satisfies TextMessage,
      ])
      setStage("idle")
    }
  }, [])

  // ── Home selection ─────────────────────────────────────────────────────────

  const handleHomeSelect = useCallback(
    (homeId: string, homeName: string) => {
      if (!currentPersona) return
      if (annotatingRef.current || stage === "annotating" || stage === "ready") return
      setSelectedHomeId(homeId)
      setSelectedHomeName(homeName)
      void runAnnotation(homeId, homeName, currentPersona)
    },
    [currentPersona, runAnnotation, stage]
  )

  // ── Submit ─────────────────────────────────────────────────────────────────

  const handleSubmit = useCallback(() => {
    const text = draft.trim()
    if (!text) return

    // Allow sending from any non-busy stage
    if (stage !== "detecting" && stage !== "annotating") {
      void runDetection(text)
    }
  }, [draft, stage, runDetection])

  const isInputDisabled = stage === "detecting" || stage === "annotating" || stage === "editing"

  // Derive the latest scene message for the full-viewport view
  const latestSceneMsg = useMemo<SceneMessage | null>(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].type === "scene") return messages[i] as SceneMessage
    }
    return null
  }, [messages])

  // Full-viewport scene mode: scene is ready and we have a scene message
  const isSceneView = !!latestSceneMsg && stage === "ready"

  // ── Scene view ─────────────────────────────────────────────────────────────

  if (isSceneView && latestSceneMsg) {
    return (
      <div className="relative h-dvh w-full overflow-hidden">
        <PersonaSceneCard
          homeId={latestSceneMsg.homeId}
          homeName={latestSceneMsg.homeName}
          plan={latestSceneMsg.plan}
          objects={sceneObjects}
        />

        {/* Floating prompt — bottom centre */}
        <div className="pointer-events-none absolute bottom-5 left-1/2 z-30 w-full max-w-xl -translate-x-1/2 px-4">
          <div className="pointer-events-auto">
            <PromptInput
              value={draft}
              onChange={setDraft}
              onSubmit={handleSubmit}
              disabled={isInputDisabled}
              placeholder="Refine your view or ask about specific areas…"
            />
          </div>
        </div>

        {/* History button — bottom-right, above the prompt */}
        <div className="pointer-events-none absolute bottom-5 right-4 z-40">
          <div className="pointer-events-auto">
            <HistoryPanel onLoadSession={loadHistorySession} />
          </div>
        </div>
      </div>
    )
  }

  // ── Chat view ──────────────────────────────────────────────────────────────

  return (
    <div className="relative w-full">
      {/* History button — always top-right of the chat column */}
      <div className="absolute right-0 top-4 z-20 px-4 sm:px-6">
        <HistoryPanel onLoadSession={loadHistorySession} />
      </div>

    <section
      className={cn(
        "mx-auto flex w-full max-w-3xl flex-col px-4 sm:px-6",
        isActive ? "h-dvh py-4" : "min-h-screen py-6"
      )}
    >
      {/* Header: persona sigil */}
      <div
        className={cn(
          "flex w-full shrink-0 items-center transition-all duration-500",
          isActive ? "mb-4 justify-center pt-2" : "flex-1 flex-col justify-center pb-0"
        )}
      >
        {!isActive && (
          <p className="mb-8 text-center text-3xl tracking-tight text-foreground sm:text-4xl">
            Explore any space, your way
          </p>
        )}
        <PersonaSigil small={isActive} />
      </div>

      {/* Message list — scrollable */}
      {isActive && (
        <div className="flex flex-1 flex-col gap-4 overflow-y-auto pb-4">
          {messages.map((message) => {
            if (message.type === "text") {
              if (message.role === "user") {
                return <UserBubble key={message.id} text={message.text} />
              }
              if (message.text === "__loading__") {
                return (
                  <AssistantLoadingBubble
                    key={message.id}
                    label="Building your personalized view…"
                  />
                )
              }
              return (
                <AssistantBubble
                  key={message.id}
                  text={message.text}
                  streaming={message.streaming}
                />
              )
            }

            if (message.type === "persona_badge" && message.persona) {
              return <PersonaBadge key={message.id} persona={message.persona} />
            }

            if (message.type === "persona_editor") {
              return (
                <PersonaEditor
                  key={message.id}
                  persona={message.persona}
                  onConfirm={handleEditorConfirm}
                  onBack={handleEditorBack}
                />
              )
            }

            if (message.type === "home_picker") {
              return (
                <div key={message.id} className="flex flex-col gap-2">
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Choose a space to annotate
                  </p>
                  <HomePicker
                    onSelect={handleHomeSelect}
                    selectedHomeId={selectedHomeId}
                  />
                </div>
              )
            }

            // Scene messages are handled by isSceneView; skip here during chat phase
            if (message.type === "scene") return null

            return null
          })}
          <div ref={messagesEndRef} />
        </div>
      )}

      {/* Prompt box — pinned at bottom */}
      <div className={cn("w-full shrink-0", !isActive && "mt-10")}>
        <PromptInput
          value={draft}
          onChange={setDraft}
          onSubmit={handleSubmit}
          disabled={isInputDisabled}
          placeholder={
            stage === "editing"
              ? "Review and confirm your persona above…"
              : stage === "picking"
                ? "Select a space above, then ask anything…"
                : "Describe your role or what you're looking for…"
          }
        />
        {!isActive && (
          <p className="mt-3 text-center text-xs text-muted-foreground">
            Try &quot;I&apos;m a firefighter inspecting a building&quot; or &quot;accessibility consultant&quot;
          </p>
        )}
      </div>
    </section>
    </div>
  )
}

export default PersonaConsole
