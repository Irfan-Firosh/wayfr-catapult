"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { SendHorizontal, Sparkles, Loader2 } from "lucide-react"

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

// ── Blinking eyes ─────────────────────────────────────────────────────────────

function BlinkingEyes({ small }: { small?: boolean }) {
  return (
    <div
      className={cn(
        "flex items-center justify-center gap-6 sm:gap-8 transition-all duration-500",
        small ? "gap-3 sm:gap-4" : ""
      )}
      aria-hidden="true"
    >
      <span className={cn("persona-eye persona-eye-left", small && "persona-eye-sm")}>
        <span className="persona-eye-core" />
      </span>
      <span className={cn("persona-eye persona-eye-right", small && "persona-eye-sm")}>
        <span className="persona-eye-core" />
      </span>
      <style jsx>{`
        .persona-eye {
          display: block;
          width: 112px;
          height: 78px;
        }
        .persona-eye-sm {
          width: 44px;
          height: 30px;
        }
        .persona-eye-left {
          transform: rotate(-9deg);
        }
        .persona-eye-right {
          transform: rotate(9deg);
        }
        .persona-eye-core {
          display: block;
          width: 100%;
          height: 100%;
          border-radius: 24px;
          background:
            radial-gradient(circle at 50% 18%, rgba(255, 236, 204, 0.46), transparent 32%),
            radial-gradient(circle at 50% 72%, rgba(164, 82, 16, 0.18), transparent 50%),
            linear-gradient(180deg, rgba(255, 190, 76, 1), rgba(228, 138, 32, 0.95));
          box-shadow:
            0 0 32px rgba(245, 166, 35, 0.34),
            0 0 88px rgba(245, 166, 35, 0.18);
          transform-origin: center;
          animation: personaBlink 4.2s ease-in-out infinite;
          will-change: transform, opacity;
        }
        .persona-eye-sm .persona-eye-core {
          border-radius: 10px;
        }
        .persona-eye-right .persona-eye-core {
          animation-delay: 0.14s;
        }
        @keyframes personaBlink {
          0%, 86%, 100% { opacity: 1; transform: scaleY(1); }
          89%, 92%      { opacity: 0.92; transform: scaleY(0.16); }
        }
        @media (max-width: 640px) {
          .persona-eye { width: 86px; height: 62px; }
          .persona-eye-sm { width: 36px; height: 24px; }
          .persona-eye-core { border-radius: 20px; }
        }
        @media (prefers-reduced-motion: reduce) {
          .persona-eye-core { animation: none; }
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
      </div>
    )
  }

  // ── Chat view ──────────────────────────────────────────────────────────────

  return (
    <section className="mx-auto flex min-h-screen w-full max-w-3xl flex-col px-4 py-6 sm:px-6">
      {/* Header: eyes (compact when active) */}
      <div
        className={cn(
          "flex w-full items-center justify-center transition-all duration-500",
          isActive ? "mb-6 pt-2" : "flex-1 flex-col pb-0"
        )}
      >
        {!isActive && (
          <p className="mb-8 text-center text-3xl tracking-tight text-foreground sm:text-4xl">
            Explore any space, your way
          </p>
        )}
        <BlinkingEyes small={isActive} />
      </div>

      {/* Message list */}
      {isActive && (
        <div className="mb-6 flex flex-col gap-4">
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

      {/* Prompt box */}
      <div className={cn("w-full", !isActive && "mt-10")}>
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
  )
}

export default PersonaConsole
