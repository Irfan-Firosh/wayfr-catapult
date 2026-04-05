"use client"

import { useState, useEffect, useCallback, useRef } from "react"
import { Navbar } from "@/components/nav/Navbar"
import { SceneViewer, type SceneObject } from "@/components/scene/SceneViewer"
import { AnnotatedFrame, type Annotation } from "@/components/scene/AnnotatedFrame"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"

// ── Mock data that cycles to simulate the live pipeline ──────────────────────

type PipelineStage = "capture" | "depth" | "reconstruct" | "render" | "detect" | "narrate" | "tts"

const STAGE_LABELS: Record<PipelineStage, string> = {
  capture: "Capture",
  depth: "Depth",
  reconstruct: "3D Fusion",
  render: "Render Views",
  detect: "VLM Detect",
  narrate: "Narrate",
  tts: "TTS",
}

const STAGE_LATENCY: Record<PipelineStage, string> = {
  capture: "~80ms",
  depth: "~300ms",
  reconstruct: "~50ms",
  render: "~100ms",
  detect: "~200ms",
  narrate: "~200ms",
  tts: "~150ms",
}

const STAGES: PipelineStage[] = ["capture", "depth", "reconstruct", "render", "detect", "narrate", "tts"]

const MOCK_CYCLES: Array<{
  objects: SceneObject[]
  annotations: Annotation[]
  narration: string
  pointCount: number
  visionSource: "rcac" | "gemini"
}> = [
  {
    objects: [
      { label: "curb_drop", distance_m: 1.8, direction: "ahead", urgency: "high" },
      { label: "pole", distance_m: 3.2, direction: "right", urgency: "medium" },
    ],
    annotations: [
      { label: "curb_drop", bbox: [240, 280, 400, 380], confidence: 0.94, urgency: "high" },
      { label: "pole", bbox: [460, 160, 510, 400], confidence: 0.87, urgency: "medium" },
    ],
    narration: "Curb drop 6 feet ahead. Pole to your right.",
    pointCount: 87432,
    visionSource: "rcac",
  },
  {
    objects: [
      { label: "person", distance_m: 2.4, direction: "left", urgency: "medium" },
      { label: "bicycle", distance_m: 4.1, direction: "ahead", urgency: "medium" },
      { label: "door", distance_m: 1.2, direction: "ahead", urgency: "low" },
    ],
    annotations: [
      { label: "person", bbox: [80, 100, 200, 380], confidence: 0.91, urgency: "medium" },
      { label: "bicycle", bbox: [290, 200, 430, 380], confidence: 0.88, urgency: "medium" },
      { label: "door", bbox: [440, 80, 600, 420], confidence: 0.96, urgency: "low" },
    ],
    narration: "Person approaching on your left. Door directly ahead.",
    pointCount: 94210,
    visionSource: "rcac",
  },
  {
    objects: [
      { label: "step", distance_m: 0.9, direction: "ahead", urgency: "high" },
      { label: "handrail", distance_m: 1.1, direction: "right", urgency: "low" },
    ],
    annotations: [
      { label: "step", bbox: [160, 320, 480, 420], confidence: 0.97, urgency: "high" },
      { label: "handrail", bbox: [470, 140, 540, 420], confidence: 0.82, urgency: "low" },
    ],
    narration: "Step down 3 feet ahead. Handrail on your right.",
    pointCount: 102654,
    visionSource: "gemini",
  },
]

type LogEntry = {
  ts: string
  stage: PipelineStage
  text: string
  urgency?: "high" | "medium" | "low"
}

export default function PipelinePage() {
  const [cycleIdx, setCycleIdx] = useState(0)
  const [activeStage, setActiveStage] = useState<PipelineStage>("capture")
  const [log, setLog] = useState<LogEntry[]>([])
  const [running, setRunning] = useState(true)
  const [frameCount, setFrameCount] = useState(0)

  const data = MOCK_CYCLES[cycleIdx % MOCK_CYCLES.length]

  const addLog = useCallback((stage: PipelineStage, text: string, urgency?: LogEntry["urgency"]) => {
    const ts = new Date().toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" })
    setLog((prev) => [{ ts, stage, text, urgency }, ...prev].slice(0, 40))
  }, [])

  // Pipeline simulation: advance through stages
  useEffect(() => {
    if (!running) return

    const stageDelays: Record<PipelineStage, number> = {
      capture: 80,
      depth: 300,
      reconstruct: 50,
      render: 100,
      detect: 200,
      narrate: 200,
      tts: 150,
    }

    let timeout: ReturnType<typeof setTimeout>
    let stageIdx = 0

    function advanceStage() {
      const stage = STAGES[stageIdx]
      setActiveStage(stage)

      if (stage === "capture") {
        setFrameCount((n) => n + 1)
        addLog("capture", "Frame captured (640×480 JPEG ~25KB)")
      } else if (stage === "depth") {
        addLog("depth", "DepthAnything v2 → depth map (metric, 0.05m voxel)")
      } else if (stage === "reconstruct") {
        addLog("reconstruct", `3D fusion complete — ${data.pointCount.toLocaleString()} points`)
      } else if (stage === "render") {
        addLog("render", "Rendered: current, top_down, left, right views")
      } else if (stage === "detect") {
        const src = data.visionSource === "rcac" ? "RCAC VLM" : "Gemini 1.5 Flash"
        const objs = data.objects.map((o) => `${o.label}@${Math.round(Math.random() * 10 + 88)}%`).join(", ")
        addLog("detect", `${src} → ${objs}`, data.objects[0]?.urgency)
      } else if (stage === "narrate") {
        addLog("narrate", `Claude Haiku → "${data.narration}"`, data.objects[0]?.urgency)
      } else if (stage === "tts") {
        addLog("tts", "ElevenLabs (Rachel) → MP3 streamed to glasses")
      }

      stageIdx = (stageIdx + 1) % STAGES.length

      const nextStage = STAGES[stageIdx]
      const delay = nextStage === "capture"
        ? 800 // pause between full cycles
        : stageDelays[STAGES[stageIdx - 1] ?? "capture"]

      if (stageIdx === 0) {
        setCycleIdx((n) => n + 1)
      }

      timeout = setTimeout(advanceStage, delay)
    }

    timeout = setTimeout(advanceStage, 400)
    return () => clearTimeout(timeout)
  }, [running, data, addLog])

  return (
    <main className="min-h-screen bg-background">
      <Navbar />

      <div className="mx-auto max-w-6xl px-4 pt-20 pb-12">
        {/* Header */}
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold">AI Vision Pipeline</h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              2D frame → depth map → 3D scene → synthetic views → VLM → narration
            </p>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs text-muted-foreground font-mono">frame #{frameCount}</span>
            <button
              onClick={() => setRunning((r) => !r)}
              className={cn(
                "rounded-full px-3 py-1 text-xs font-medium border transition-colors",
                running
                  ? "border-mango/40 bg-mango/10 text-mango"
                  : "border-border text-muted-foreground hover:border-mango/30"
              )}
            >
              {running ? "● live" : "paused"}
            </button>
          </div>
        </div>

        {/* Pipeline stage indicator */}
        <div className="mb-6 flex items-center gap-1 overflow-x-auto pb-1">
          {STAGES.map((stage, i) => (
            <div key={stage} className="flex items-center gap-1 shrink-0">
              <div
                className={cn(
                  "rounded-md px-2.5 py-1 text-xs font-mono transition-all duration-200",
                  activeStage === stage
                    ? "bg-mango text-background font-bold shadow-[0_0_12px_rgba(245,166,35,0.4)]"
                    : "bg-card text-muted-foreground border border-border"
                )}
              >
                <span className="opacity-50 mr-1">{i + 1}</span>
                {STAGE_LABELS[stage]}
                <span className="ml-1 opacity-40 text-[10px]">{STAGE_LATENCY[stage]}</span>
              </div>
              {i < STAGES.length - 1 && (
                <div className="h-px w-3 bg-border shrink-0" />
              )}
            </div>
          ))}
        </div>

        {/* Three panels */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* Panel 1: Raw input (simulated) */}
          <div className="rounded-xl border border-border bg-card overflow-hidden">
            <div className="border-b border-border px-3 py-2 flex items-center justify-between">
              <span className="text-xs font-mono text-muted-foreground">INPUT · raw frame</span>
              <Badge variant="outline" className="text-[10px] font-mono border-mango/30 text-mango">640×480</Badge>
            </div>
            <div className="p-3">
              <RawFrameSimulator stage={activeStage} />
              <div className="mt-2 space-y-1">
                <div className="flex justify-between text-[10px] font-mono text-muted-foreground">
                  <span>BT 5.3 → phone</span>
                  <span className="text-mango/70">~80ms</span>
                </div>
                <div className="flex justify-between text-[10px] font-mono text-muted-foreground">
                  <span>phone → backend (WSS)</span>
                  <span className="text-mango/70">~40ms</span>
                </div>
              </div>
            </div>
          </div>

          {/* Panel 2: 3D Scene */}
          <div className="rounded-xl border border-border bg-card overflow-hidden">
            <div className="border-b border-border px-3 py-2 flex items-center justify-between">
              <span className="text-xs font-mono text-muted-foreground">3D SCENE · bird's-eye</span>
              <Badge variant="outline" className="text-[10px] font-mono border-mango/30 text-mango">
                {data.pointCount.toLocaleString()} pts
              </Badge>
            </div>
            <div className="p-3">
              <SceneViewer objects={data.objects} pointCount={data.pointCount} />
              <div className="mt-2 space-y-1">
                <div className="flex justify-between text-[10px] font-mono text-muted-foreground">
                  <span>DepthAnything v2</span>
                  <span className="text-mango/70">~300ms</span>
                </div>
                <div className="flex justify-between text-[10px] font-mono text-muted-foreground">
                  <span>point cloud fusion (10-frame window)</span>
                  <span className="text-mango/70">~50ms</span>
                </div>
              </div>
            </div>
          </div>

          {/* Panel 3: Annotated synthetic view */}
          <div className="rounded-xl border border-border bg-card overflow-hidden">
            <div className="border-b border-border px-3 py-2 flex items-center justify-between">
              <span className="text-xs font-mono text-muted-foreground">VLM OUTPUT · annotated</span>
              <Badge
                variant="outline"
                className={cn(
                  "text-[10px] font-mono",
                  data.visionSource === "rcac"
                    ? "border-mango/30 text-mango"
                    : "border-blue-400/30 text-blue-400"
                )}
              >
                {data.visionSource === "rcac" ? "RCAC VLM" : "Gemini Flash"}
              </Badge>
            </div>
            <div className="p-3">
              <AnnotatedFrame annotations={data.annotations} viewLabel="current" />
              <div className="mt-2 space-y-1">
                <div className="flex justify-between text-[10px] font-mono text-muted-foreground">
                  <span>novel view synthesis → VLM</span>
                  <span className="text-mango/70">~300ms</span>
                </div>
                <div className="flex justify-between text-[10px] font-mono text-muted-foreground">
                  <span>back-project annotations → 3D</span>
                  <span className="text-mango/70">~20ms</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Narration + log row */}
        <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Current narration */}
          <div className="rounded-xl border border-mango/20 bg-card p-4">
            <div className="text-[10px] font-mono text-muted-foreground mb-2">NARRATION OUTPUT</div>
            <p className="text-sm font-medium text-foreground leading-relaxed">
              &ldquo;{data.narration}&rdquo;
            </p>
            <div className="mt-3 flex items-center gap-2 flex-wrap">
              <Badge variant="outline" className="text-[10px] border-mango/30 text-mango font-mono">
                Claude Haiku · ~200ms
              </Badge>
              <Badge variant="outline" className="text-[10px] border-border text-muted-foreground font-mono">
                ElevenLabs Rachel · ~150ms
              </Badge>
              <Badge variant="outline" className="text-[10px] border-border text-muted-foreground font-mono">
                → Ray-Ban speakers
              </Badge>
            </div>
            <div className="mt-3 pt-3 border-t border-border">
              <div className="text-[10px] font-mono text-muted-foreground mb-1">DETECTED OBJECTS</div>
              <div className="flex flex-wrap gap-1.5">
                {data.objects.map((obj, i) => (
                  <span
                    key={i}
                    className={cn(
                      "rounded-full px-2 py-0.5 text-[10px] font-mono border",
                      obj.urgency === "high"
                        ? "border-red-500/40 bg-red-500/10 text-red-400"
                        : obj.urgency === "medium"
                        ? "border-mango/40 bg-mango/10 text-mango"
                        : "border-green-500/40 bg-green-500/10 text-green-400"
                    )}
                  >
                    {obj.label} · {obj.distance_m}m {obj.direction}
                  </span>
                ))}
              </div>
            </div>
          </div>

          {/* Pipeline log */}
          <div className="rounded-xl border border-border bg-card overflow-hidden">
            <div className="border-b border-border px-3 py-2">
              <span className="text-[10px] font-mono text-muted-foreground">PIPELINE LOG</span>
            </div>
            <div className="h-52 overflow-y-auto p-2 space-y-0.5">
              {log.map((entry, i) => (
                <div key={i} className="flex gap-2 items-start text-[10px] font-mono">
                  <span className="text-muted-foreground/50 shrink-0 pt-0.5">{entry.ts}</span>
                  <span
                    className={cn(
                      "shrink-0 pt-0.5",
                      entry.stage === "detect" || entry.stage === "narrate"
                        ? "text-mango"
                        : "text-muted-foreground/70"
                    )}
                  >
                    [{STAGE_LABELS[entry.stage]}]
                  </span>
                  <span
                    className={cn(
                      "text-foreground/70",
                      entry.urgency === "high" && "text-red-400",
                    )}
                  >
                    {entry.text}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Latency budget footer */}
        <div className="mt-4 rounded-xl border border-border bg-card/50 p-4">
          <div className="text-[10px] font-mono text-muted-foreground mb-3">LATENCY BUDGET</div>
          <div className="flex flex-wrap gap-1.5 items-center text-[10px] font-mono">
            {[
              { label: "BT capture", ms: 80, color: "text-foreground/50" },
              { label: "WSS", ms: 40, color: "text-foreground/50" },
              { label: "depth", ms: 300, color: "text-mango/70" },
              { label: "3D fusion", ms: 50, color: "text-foreground/50" },
              { label: "render views", ms: 100, color: "text-foreground/50" },
              { label: "VLM detect", ms: 200, color: "text-mango/70" },
              { label: "Cloud Vision", ms: 150, color: "text-foreground/50" },
              { label: "back-project", ms: 20, color: "text-foreground/50" },
              { label: "narration", ms: 200, color: "text-mango/70" },
              { label: "TTS chunk", ms: 150, color: "text-mango/70" },
              { label: "delivery", ms: 120, color: "text-foreground/50" },
            ].map((s, i, arr) => (
              <span key={i} className="flex items-center gap-1">
                <span className={s.color}>{s.label}</span>
                <span className="text-muted-foreground/40">{s.ms}ms</span>
                {i < arr.length - 1 && <span className="text-muted-foreground/30">+</span>}
              </span>
            ))}
            <span className="ml-2 text-mango font-bold">= ~1,010ms target</span>
          </div>
        </div>
      </div>
    </main>
  )
}

// ── Raw frame simulator canvas ─────────────────────────────────────────────

function RawFrameSimulator({ stage }: { stage: PipelineStage }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext("2d")
    if (!ctx) return

    const W = canvas.width
    const H = canvas.height

    ctx.clearRect(0, 0, W, H)

    const bg = ctx.createLinearGradient(0, 0, 0, H)
    bg.addColorStop(0, "#111120")
    bg.addColorStop(1, "#1c1c2e")
    ctx.fillStyle = bg
    ctx.fillRect(0, 0, W, H)

    // Simulated scene: ground + walls
    ctx.fillStyle = "#1e1e30"
    ctx.fillRect(0, H * 0.55, W, H)

    // Walls
    ctx.fillStyle = "#252535"
    ctx.fillRect(0, 0, W * 0.15, H)
    ctx.fillRect(W * 0.85, 0, W * 0.15, H)

    // Simple shapes representing scene content
    ctx.fillStyle = "#2a2a44"
    ctx.fillRect(W * 0.3, H * 0.2, W * 0.4, H * 0.35) // door shape

    // Depth flash when depth stage is active
    if (stage === "depth") {
      const grad = ctx.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, W * 0.6)
      grad.addColorStop(0, "rgba(245,166,35,0.15)")
      grad.addColorStop(1, "rgba(245,166,35,0)")
      ctx.fillStyle = grad
      ctx.fillRect(0, 0, W, H)
    }

    // Scan line effect during capture
    if (stage === "capture") {
      ctx.strokeStyle = "rgba(245,166,35,0.3)"
      ctx.lineWidth = 1.5
      ctx.beginPath()
      ctx.moveTo(0, H * 0.5)
      ctx.lineTo(W, H * 0.5)
      ctx.stroke()
    }

    // Labels
    ctx.fillStyle = "rgba(245,166,35,0.5)"
    ctx.font = "9px monospace"
    ctx.fillText("Ray-Ban Smart Glasses", 6, 14)
    ctx.fillStyle = "rgba(255,255,255,0.3)"
    ctx.font = "9px monospace"
    ctx.fillText("12MP · 640×480 · JPEG 70%", 6, H - 6)
  }, [stage])

  return (
    <canvas
      ref={canvasRef}
      width={320}
      height={240}
      className="w-full rounded-xl"
    />
  )
}
