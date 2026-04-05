"use client"

import { useEffect, useRef, useState, useCallback } from "react"
import { Navbar } from "@/components/nav/Navbar"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { World3DViewer, type Object3D } from "@/components/scene/World3DViewer"
import { getSessionId, makeDashboardUrl } from "@/lib/session"
import { cn } from "@/lib/utils"

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000"

type ScanResult = {
  objects: (Object3D & { distance_m: number; direction: string; frame_count?: number })[]
  stats: {
    total_frames: number
    frames_with_objects: number
    unique_objects: number
    processing_time_s: number
  }
}

export default function CapturePage() {
  const videoRef = useRef<HTMLVideoElement>(null)
  const previewRef = useRef<HTMLVideoElement>(null)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const streamRef = useRef<MediaStream | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [sessionId, setSessionId] = useState("")
  const [dashUrl, setDashUrl] = useState("")
  const [copied, setCopied] = useState(false)

  // Mode: idle → recording → recorded → uploading → scanning → done
  const [mode, setMode] = useState<"idle" | "recording" | "recorded" | "uploading" | "scanning" | "done">("idle")
  const [recordedBlob, setRecordedBlob] = useState<Blob | null>(null)
  const [uploadFile, setUploadFile] = useState<File | null>(null)
  const [progress, setProgress] = useState("")
  const [error, setError] = useState<string | null>(null)

  // Scan results
  const [scanResult, setScanResult] = useState<ScanResult | null>(null)
  const [selectedObj, setSelectedObj] = useState<number | null>(null)

  useEffect(() => {
    const id = getSessionId()
    setSessionId(id)
    setDashUrl(makeDashboardUrl(id))
  }, [])

  // ── Camera recording ───────────────────────────────────────────────────────

  const startRecording = useCallback(async () => {
    setError(null)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment", width: 640, height: 480 },
        audio: false,
      })
      streamRef.current = stream
      if (videoRef.current) {
        videoRef.current.srcObject = stream
      }

      const recorder = new MediaRecorder(stream, { mimeType: "video/webm" })
      chunksRef.current = []
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data)
      }
      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: "video/webm" })
        setRecordedBlob(blob)
        setMode("recorded")
        // Show preview
        if (previewRef.current) {
          previewRef.current.src = URL.createObjectURL(blob)
        }
      }
      recorderRef.current = recorder
      recorder.start(1000) // collect data every 1s
      setMode("recording")
    } catch (err) {
      setError(err instanceof Error ? err.message : "Camera access denied")
    }
  }, [])

  const stopRecording = useCallback(() => {
    recorderRef.current?.stop()
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
    if (videoRef.current) videoRef.current.srcObject = null
  }, [])

  // ── File upload ────────────────────────────────────────────────────────────

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setUploadFile(file)
    setRecordedBlob(null)
    setMode("recorded")
    // Show preview
    if (previewRef.current) {
      previewRef.current.src = URL.createObjectURL(file)
    }
  }, [])

  // ── Scan ───────────────────────────────────────────────────────────────────

  const runScan = useCallback(async () => {
    const blob = recordedBlob || uploadFile
    if (!blob) return

    setMode("scanning")
    setProgress("Uploading video...")
    setError(null)

    try {
      const formData = new FormData()
      formData.append("file", blob, uploadFile?.name || "recording.webm")

      setProgress("Processing frames through AI pipeline...")

      const resp = await fetch(`${API_URL}/api/scan`, {
        method: "POST",
        body: formData,
      })

      if (!resp.ok) {
        const err = await resp.json().catch(() => ({ detail: "Scan failed" }))
        throw new Error(err.detail || `HTTP ${resp.status}`)
      }

      const data: ScanResult = await resp.json()
      setScanResult(data)

      // Store in localStorage for dashboard
      localStorage.setItem(`wayfr_scan_${sessionId}`, JSON.stringify(data))

      setMode("done")
      setProgress("")
    } catch (err) {
      setError(err instanceof Error ? err.message : "Scan failed")
      setMode("recorded")
      setProgress("")
    }
  }, [recordedBlob, uploadFile, sessionId])

  const reset = useCallback(() => {
    setMode("idle")
    setRecordedBlob(null)
    setUploadFile(null)
    setScanResult(null)
    setSelectedObj(null)
    setError(null)
    setProgress("")
  }, [])

  const copyLink = useCallback(() => {
    navigator.clipboard.writeText(dashUrl)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }, [dashUrl])

  // Cleanup on unmount
  useEffect(
    () => () => {
      streamRef.current?.getTracks().forEach((t) => t.stop())
      recorderRef.current?.stop()
    },
    [],
  )

  const scene: Object3D[] = scanResult?.objects ?? []

  return (
    <main className="min-h-screen bg-background">
      <Navbar />

      <div className="mx-auto max-w-5xl px-4 pt-20 pb-12">
        <div className="mb-6">
          <p className="text-xs font-mono uppercase tracking-widest text-muted-foreground">wayfr scan</p>
          <h1 className="mt-0.5 text-xl font-bold">Video scan &amp; 3D visualization</h1>
        </div>

        {/* Session bar */}
        <div className="mb-4 rounded-xl border border-mango/20 bg-card p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground mb-1">Session</p>
              <p className="text-lg font-bold font-mono text-mango tracking-widest">{sessionId}</p>
            </div>
            <Button size="sm" variant="outline" onClick={copyLink} className="text-xs border-mango/30 hover:border-mango/60 font-mono">
              {copied ? "Copied!" : "Copy dashboard link"}
            </Button>
          </div>
        </div>

        {/* ── Input section ─────────────────────────────────────────────────── */}
        {mode !== "done" && (
          <div className="rounded-xl border border-border bg-card overflow-hidden mb-4">
            <div className="border-b border-border px-4 py-2.5 flex items-center justify-between">
              <span className="text-xs font-mono text-muted-foreground uppercase tracking-widest">
                {mode === "recording" ? "Recording..." : mode === "scanning" ? "Processing..." : "Input"}
              </span>
              {mode === "recording" && (
                <span className="flex items-center gap-1.5 text-xs font-mono text-red-400">
                  <span className="relative flex h-2 w-2">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-400 opacity-60" />
                    <span className="relative inline-flex h-2 w-2 rounded-full bg-red-400" />
                  </span>
                  recording
                </span>
              )}
            </div>

            {/* Video preview area */}
            <div className="relative bg-black aspect-video flex items-center justify-center">
              {/* Live camera during recording */}
              <video ref={videoRef} autoPlay playsInline muted className={cn("w-full h-full object-cover", mode !== "recording" && "hidden")} />
              {/* Recorded/uploaded preview */}
              <video ref={previewRef} controls playsInline className={cn("w-full h-full object-cover", mode !== "recorded" && "hidden")} />

              {mode === "idle" && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-4">
                  <div className="text-center">
                    <p className="text-muted-foreground font-mono text-sm mb-1">Record or upload a video</p>
                    <p className="text-muted-foreground/60 font-mono text-xs">The AI will detect objects and build a 3D scene</p>
                  </div>
                </div>
              )}

              {mode === "scanning" && (
                <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/80">
                  <div className="relative w-16 h-16 mb-4">
                    <div className="absolute inset-0 rounded-full border-2 border-mango/20" />
                    <div className="absolute inset-0 rounded-full border-2 border-transparent border-t-mango animate-spin" />
                  </div>
                  <p className="text-mango font-mono text-sm">{progress}</p>
                  <p className="text-muted-foreground/60 font-mono text-[10px] mt-1">This may take 30–60 seconds</p>
                </div>
              )}
            </div>

            {/* Controls */}
            <div className="p-3 flex flex-wrap gap-2 border-t border-border">
              {mode === "idle" && (
                <>
                  <Button size="sm" onClick={startRecording} className="bg-mango text-background hover:bg-mango/90 font-mono text-xs">
                    Record video
                  </Button>
                  <input ref={fileInputRef} type="file" accept="video/*" onChange={handleFileSelect} className="hidden" />
                  <Button size="sm" variant="outline" onClick={() => fileInputRef.current?.click()} className="font-mono text-xs border-border">
                    Upload video
                  </Button>
                </>
              )}
              {mode === "recording" && (
                <Button size="sm" variant="outline" onClick={stopRecording} className="font-mono text-xs border-red-500/30 text-red-400 hover:border-red-500/60">
                  Stop recording
                </Button>
              )}
              {mode === "recorded" && (
                <>
                  <Button size="sm" onClick={runScan} className="bg-mango text-background hover:bg-mango/90 font-mono text-xs">
                    Scan &amp; analyze
                  </Button>
                  <Button size="sm" variant="outline" onClick={reset} className="font-mono text-xs border-border">
                    Discard
                  </Button>
                </>
              )}
            </div>
            {error && <p className="px-4 pb-3 text-xs font-mono text-red-400">{error}</p>}
          </div>
        )}

        {/* ── 3D spatial map (shown after scan) ────────────────────────────── */}
        {mode === "done" && scanResult && (
          <>
            {/* Stats bar */}
            <div className="mb-4 flex flex-wrap gap-2">
              <Badge variant="outline" className="font-mono text-xs border-mango/30 text-mango">
                {scanResult.stats.unique_objects} objects detected
              </Badge>
              <Badge variant="outline" className="font-mono text-xs border-border text-muted-foreground">
                {scanResult.stats.total_frames} frames analyzed
              </Badge>
              <Badge variant="outline" className="font-mono text-xs border-border text-muted-foreground">
                {scanResult.stats.processing_time_s}s processing
              </Badge>
              <Button size="sm" variant="outline" onClick={reset} className="ml-auto font-mono text-xs border-border">
                New scan
              </Button>
            </div>

            {/* 3D Viewer */}
            <div className="rounded-xl border border-mango/15 bg-card overflow-hidden mb-4">
              <div className="border-b border-border px-4 py-2.5 flex items-center justify-between">
                <span className="text-xs font-mono text-muted-foreground uppercase tracking-widest">3D SPATIAL MAP — environment reconstruction</span>
                <Badge variant="outline" className="text-[10px] font-mono border-mango/30 text-mango">
                  {scene.length} objects
                </Badge>
              </div>
              <div className="p-3">
                <World3DViewer objects={scene} autoOrbit onObjectClick={setSelectedObj} />
              </div>
            </div>

            {/* Annotations list */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Detection list */}
              <div className="rounded-xl border border-border bg-card overflow-hidden">
                <div className="border-b border-border px-4 py-2.5">
                  <span className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">Detected objects</span>
                </div>
                <div className="max-h-72 overflow-y-auto">
                  {scanResult.objects.map((obj, i) => (
                    <button
                      key={i}
                      onClick={() => setSelectedObj(i)}
                      className={cn(
                        "w-full flex items-center gap-3 border-b border-border/50 px-4 py-3 text-left transition-colors hover:bg-mango/5",
                        selectedObj === i && "bg-mango/10",
                      )}
                    >
                      <span
                        className={cn(
                          "h-2.5 w-2.5 rounded-full shrink-0",
                          obj.urgency === "high" ? "bg-red-400" : obj.urgency === "medium" ? "bg-mango" : "bg-green-400",
                        )}
                      />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-mono font-medium text-foreground">{obj.label}</p>
                        <p className="text-[10px] font-mono text-muted-foreground">
                          {obj.distance_m}m {obj.direction}
                          {obj.frame_count && obj.frame_count > 1 ? ` · seen in ${obj.frame_count} frames` : ""}
                        </p>
                      </div>
                      <div className="flex flex-col items-end gap-1">
                        <Badge
                          variant="outline"
                          className={cn(
                            "text-[9px] font-mono",
                            obj.urgency === "high"
                              ? "border-red-500/30 text-red-400"
                              : obj.urgency === "medium"
                                ? "border-mango/30 text-mango"
                                : "border-green-500/30 text-green-400",
                          )}
                        >
                          {obj.urgency}
                        </Badge>
                        <span className="text-[9px] font-mono text-muted-foreground">{Math.round((obj.confidence ?? 0) * 100)}%</span>
                      </div>
                    </button>
                  ))}
                  {scanResult.objects.length === 0 && <p className="p-4 text-xs text-muted-foreground font-mono">No objects detected in video</p>}
                </div>
              </div>

              {/* Selected object detail */}
              <div className="rounded-xl border border-border bg-card p-4">
                <p className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground mb-3">
                  {selectedObj !== null ? "Object detail" : "Scene summary"}
                </p>
                {selectedObj !== null && scanResult.objects[selectedObj] ? (
                  (() => {
                    const obj = scanResult.objects[selectedObj]
                    return (
                      <div className="space-y-3">
                        <div className="flex items-center gap-2">
                          <span
                            className={cn(
                              "h-3 w-3 rounded-full",
                              obj.urgency === "high" ? "bg-red-400" : obj.urgency === "medium" ? "bg-mango" : "bg-green-400",
                            )}
                          />
                          <h3 className="text-lg font-bold font-mono">{obj.label}</h3>
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          {[
                            ["Distance", `${obj.distance_m}m`],
                            ["Direction", obj.direction],
                            ["Urgency", obj.urgency],
                            ["Confidence", `${Math.round((obj.confidence ?? 0) * 100)}%`],
                            ["Position X", `${obj.x}m`],
                            ["Position Z", `${obj.z}m`],
                          ].map(([k, v]) => (
                            <div key={k} className="rounded-lg border border-border/50 p-2">
                              <p className="text-[9px] font-mono text-muted-foreground uppercase">{k}</p>
                              <p className="text-sm font-mono font-medium">{v}</p>
                            </div>
                          ))}
                        </div>
                      </div>
                    )
                  })()
                ) : (
                  <div className="space-y-2">
                    <p className="text-sm font-mono text-foreground/80">
                      {scanResult.stats.unique_objects} objects detected across {scanResult.stats.frames_with_objects} of{" "}
                      {scanResult.stats.total_frames} frames.
                    </p>
                    <p className="text-xs font-mono text-muted-foreground">Click an object in the list or 3D viewer to see details.</p>
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      <Badge variant="outline" className="text-[10px] font-mono border-mango/30 text-mango">
                        llama4 vision
                      </Badge>
                      <Badge variant="outline" className="text-[10px] font-mono border-border text-muted-foreground">
                        RCAC GenAI
                      </Badge>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </>
        )}

        {/* Instructions */}
        {mode === "idle" && (
          <div className="mt-4 rounded-xl border border-border bg-card p-4">
            <p className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground mb-2">How it works</p>
            <ol className="space-y-1.5 text-xs text-muted-foreground font-mono">
              <li>1. Record from camera or upload a video file</li>
              <li>2. AI extracts frames and detects objects (people, steps, poles, signs, doors...)</li>
              <li>3. Detections are merged and positioned in 3D space</li>
              <li>4. Explore the 3D spatial map visualization</li>
            </ol>
          </div>
        )}
      </div>
    </main>
  )
}
