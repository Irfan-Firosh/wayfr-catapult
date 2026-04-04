"use client"

import { useState, useEffect, useCallback, useRef } from "react"
import { Navbar } from "@/components/nav/Navbar"
import { World3DViewer, type Object3D } from "@/components/scene/World3DViewer"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { getSessionId, makeShareUrl } from "@/lib/session"

const WS_URL = process.env.NEXT_PUBLIC_WS_URL ?? "ws://localhost:8000"

type Detection = {
  id: number
  ts: string
  label: string
  urgency: "high" | "medium" | "low"
  distance: string
  direction: string
}

const IDLE_SCENE: Object3D[] = [{ label: "waiting\u2026", x: 0, y: 0, z: 3, urgency: "low", confidence: 1 }]

function nowTs() {
  return new Date().toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" })
}

export default function DashboardPage() {
  const wsRef = useRef<WebSocket | null>(null)
  const audioQueueRef = useRef<string[]>([])
  const playingRef = useRef(false)

  const [scene, setScene] = useState<Object3D[]>(IDLE_SCENE)
  const [detections, setDetections] = useState<Detection[]>([])
  const [narration, setNarration] = useState<string | null>(null)
  const [frameCount, setFrameCount] = useState(0)
  const [sessionSecs, setSessionSecs] = useState(0)
  const [sessionId, setSessionId] = useState("")
  const [captureUrl, setCaptureUrl] = useState("")
  const [copied, setCopied] = useState(false)
  const [wsStatus, setWsStatus] = useState<"disconnected" | "connecting" | "connected">("disconnected")
  const [liveMode, setLiveMode] = useState(false)
  const [selectedObj, setSelectedObj] = useState<number | null>(null)

  useEffect(() => {
    const id = getSessionId()
    setSessionId(id)
    setCaptureUrl(makeShareUrl(id))

    // Check for scan results in localStorage
    const scanData = localStorage.getItem(`wayfr_scan_${id}`)
    if (scanData) {
      try {
        const parsed = JSON.parse(scanData)
        if (parsed.objects?.length) {
          setScene(parsed.objects)
          setLiveMode(true)
          setFrameCount(parsed.stats?.total_frames ?? 0)
          parsed.objects.forEach((obj: { label: string; urgency: string; distance_m: number; direction: string }) => {
            setDetections((prev) =>
              [
                {
                  id: Date.now() + Math.random(),
                  ts: "scan",
                  label: obj.label,
                  urgency: (obj.urgency === "high" ? "high" : obj.urgency === "medium" ? "medium" : "low") as "high" | "medium" | "low",
                  distance: `${obj.distance_m}m`,
                  direction: obj.direction,
                },
                ...prev,
              ].slice(0, 30),
            )
          })
        }
      } catch {}
    }
  }, [])

  // Session timer
  useEffect(() => {
    const t = setInterval(() => setSessionSecs((s) => s + 1), 1000)
    return () => clearInterval(t)
  }, [])

  // ── Audio queue ───────────────────────────────────────────────────────────
  const drainAudioQueue = useCallback(() => {
    if (playingRef.current || audioQueueRef.current.length === 0) return
    playingRef.current = true
    const b64 = audioQueueRef.current.shift()!
    const binary = atob(b64)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
    const blob = new Blob([bytes], { type: "audio/mp3" })
    const url = URL.createObjectURL(blob)
    const audio = new Audio(url)
    audio.onended = () => {
      URL.revokeObjectURL(url)
      playingRef.current = false
      drainAudioQueue()
    }
    audio.onerror = () => {
      URL.revokeObjectURL(url)
      playingRef.current = false
      drainAudioQueue()
    }
    audio.play().catch(() => {
      playingRef.current = false
      drainAudioQueue()
    })
  }, [])

  // ── WebSocket connection ──────────────────────────────────────────────────
  useEffect(() => {
    if (!sessionId) return
    setWsStatus("connecting")
    const ws = new WebSocket(`${WS_URL}/ws/${sessionId}`)
    wsRef.current = ws

    ws.onopen = () => setWsStatus("connected")
    ws.onclose = () => setWsStatus("disconnected")
    ws.onerror = () => setWsStatus("disconnected")

    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data)

        if (msg.type === "audio") {
          setNarration(msg.text)
          setLiveMode(true)
          setFrameCount((n) => n + 1)
          // Queue audio for playback
          if (msg.data) {
            audioQueueRef.current.push(msg.data)
            drainAudioQueue()
          }
        }

        if (msg.type === "detections") {
          const objs: Object3D[] = (msg.objects || []).map(
            (o: { label: string; x: number; y: number; z: number; urgency: string; confidence: number }) => ({
              label: o.label,
              x: o.x || 0,
              y: 0,
              z: o.z || 1.5,
              urgency: o.urgency === "high" ? "high" : o.urgency === "medium" ? "medium" : "low",
              confidence: o.confidence,
            }),
          )
          if (objs.length > 0) {
            setScene(objs)
            setLiveMode(true)
            setFrameCount((n) => n + 1)
            // Add to detection log
            objs.forEach((obj: Object3D) => {
              setDetections((prev) =>
                [
                  {
                    id: Date.now() + Math.random(),
                    ts: nowTs(),
                    label: obj.label,
                    urgency: obj.urgency,
                    distance: `${Math.sqrt(obj.x ** 2 + obj.z ** 2).toFixed(1)}m`,
                    direction: obj.x < -0.5 ? "left" : obj.x > 0.5 ? "right" : "ahead",
                  },
                  ...prev,
                ].slice(0, 30),
              )
            })
          }
        }

        if (msg.type === "hazard_alert") {
          const h = msg.hazard
          setDetections((prev) =>
            [
              {
                id: Date.now(),
                ts: nowTs(),
                label: `\u26A0 ${h.type}`,
                urgency: (h.severity === "critical" || h.severity === "high" ? "high" : "medium") as "high" | "medium",
                distance: `${h.distance_m}m`,
                direction: h.direction,
              },
              ...prev,
            ].slice(0, 30),
          )
        }
      } catch {}
    }

    const ping = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "ping", timestamp: Date.now() }))
      }
    }, 20000)

    return () => {
      clearInterval(ping)
      ws.close()
    }
  }, [sessionId, drainAudioQueue])

  const sessionTime = `${String(Math.floor(sessionSecs / 60)).padStart(2, "0")}:${String(sessionSecs % 60).padStart(2, "0")}`

  const copyCapture = useCallback(() => {
    navigator.clipboard.writeText(captureUrl)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }, [captureUrl])

  const wsColor = wsStatus === "connected" ? "bg-green-400" : wsStatus === "connecting" ? "bg-mango animate-pulse" : "bg-muted-foreground"

  return (
    <main className="min-h-screen bg-background">
      <Navbar />

      <div className="mx-auto max-w-6xl px-4 pt-20 pb-12">
        {/* Header */}
        <div className="mb-4 flex items-center justify-between">
          <div>
            <p className="text-xs text-muted-foreground font-mono uppercase tracking-widest">Caregiver dashboard</p>
            <h1 className="mt-0.5 text-xl font-bold">Live session</h1>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5 text-xs font-mono text-muted-foreground">
              <span className="relative flex h-2 w-2">
                <span className={cn("absolute inline-flex h-full w-full rounded-full opacity-60", wsStatus === "connected" && "animate-ping", wsColor)} />
                <span className={cn("relative inline-flex h-2 w-2 rounded-full", wsColor)} />
              </span>
              {wsStatus} &middot; {sessionTime}
            </div>
            <Badge variant="outline" className="font-mono text-xs border-mango/30 text-mango">
              frame #{frameCount}
            </Badge>
          </div>
        </div>

        {/* Session link bar */}
        {sessionId && (
          <div className="mb-4 flex items-center gap-3 rounded-2xl border border-mango/15 bg-card/60 backdrop-blur-xl px-4 py-2.5">
            <span className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground shrink-0">Session</span>
            <span className="font-mono text-sm font-bold text-mango tracking-widest shrink-0">{sessionId}</span>
            <span className="text-[10px] font-mono text-muted-foreground flex-1 truncate hidden sm:block">{captureUrl}</span>
            <Button
              size="sm"
              variant="outline"
              onClick={copyCapture}
              className="text-[10px] font-mono border-mango/30 hover:border-mango/60 shrink-0 h-7 px-3"
            >
              {copied ? "Copied!" : "Copy capture link"}
            </Button>
          </div>
        )}

        {/* 3D viewer */}
        <div className="rounded-2xl border border-mango/15 bg-card/60 backdrop-blur-xl overflow-hidden">
          <div className="border-b border-border/40 px-4 py-2.5 flex items-center justify-between">
            <span className="text-xs font-mono text-muted-foreground">3D SPATIAL MAP — environment reconstruction</span>
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="text-[10px] font-mono border-mango/30 text-mango">
                {scene.filter((o) => o.label !== "waiting\u2026").length} objects
              </Badge>
              {!liveMode && (
                <Badge variant="outline" className="text-[10px] font-mono border-border text-muted-foreground">
                  waiting for capture
                </Badge>
              )}
            </div>
          </div>
          <div className="p-3">
            <World3DViewer objects={scene} autoOrbit onObjectClick={setSelectedObj} />
          </div>
        </div>

        {/* Bottom row */}
        <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
          {/* Narration */}
          <div className="rounded-2xl border border-border/40 bg-card/60 backdrop-blur-xl p-4">
            <p className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground mb-2">Current narration</p>
            <p className="text-sm font-medium leading-relaxed text-foreground min-h-[2.5rem]">
              {narration ? `\u201C${narration}\u201D` : <span className="text-muted-foreground italic">Waiting for live audio\u2026</span>}
            </p>
            <div className="mt-3 flex flex-wrap gap-1.5">
              <Badge variant="outline" className="text-[10px] font-mono border-mango/30 text-mango">
                llama4
              </Badge>
              <Badge variant="outline" className="text-[10px] font-mono border-border text-muted-foreground">
                Cartesia Elaine
              </Badge>
              <Badge variant="outline" className="text-[10px] font-mono border-border text-muted-foreground">
                &rarr; speakers
              </Badge>
            </div>

            <div className="mt-3 pt-3 border-t border-border">
              <p className="text-[10px] font-mono text-muted-foreground mb-1.5">DETECTED</p>
              <div className="flex flex-wrap gap-1.5 min-h-[1.5rem]">
                {scene
                  .filter((o) => o.label !== "waiting\u2026")
                  .map((obj, i) => (
                    <span
                      key={i}
                      className={cn(
                        "rounded-full px-2 py-0.5 text-[10px] font-mono border",
                        obj.urgency === "high"
                          ? "border-red-500/40 bg-red-500/10 text-red-400"
                          : obj.urgency === "medium"
                            ? "border-mango/40 bg-mango/10 text-mango"
                            : "border-green-500/40 bg-green-500/10 text-green-400",
                      )}
                    >
                      {obj.label} &middot; {Math.sqrt(obj.x ** 2 + obj.z ** 2).toFixed(1)}m
                    </span>
                  ))}
                {scene.every((o) => o.label === "waiting\u2026") && <span className="text-[10px] font-mono text-muted-foreground">&mdash;</span>}
              </div>
            </div>
          </div>

          {/* Detection log */}
          <div className="rounded-2xl border border-border/40 bg-card/60 backdrop-blur-xl overflow-hidden">
            <div className="border-b border-border/40 px-4 py-2.5">
              <span className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">Detection log</span>
            </div>
            <div className="h-52 overflow-y-auto">
              {detections.length === 0 ? (
                <p className="p-4 text-xs text-muted-foreground font-mono">Waiting for detections&hellip;</p>
              ) : (
                detections.map((d) => (
                  <div key={d.id} className="flex items-center gap-3 border-b border-border/50 px-4 py-2.5">
                    <span className="text-[10px] font-mono text-muted-foreground/50 shrink-0 w-16">{d.ts}</span>
                    <span
                      className={cn("h-1.5 w-1.5 rounded-full shrink-0", d.urgency === "high" ? "bg-red-400" : d.urgency === "medium" ? "bg-mango" : "bg-green-400")}
                    />
                    <span className="text-xs font-mono text-foreground/80 flex-1">{d.label}</span>
                    <span className="text-[10px] font-mono text-muted-foreground shrink-0">
                      {d.distance} {d.direction}
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </main>
  )
}
