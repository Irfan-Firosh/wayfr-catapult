"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { Upload, CheckCircle2, AlertCircle, ArrowRight, Loader2, MapPin, Smartphone } from "lucide-react"
import { HomeSceneViewer } from "@/components/scene/HomeSceneViewer"
import { PhoneCapture } from "@/components/setup/phone-capture"

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000"
const POLL_INTERVAL_MS = 3000

type HomeStatus = "processing" | "ready" | "failed"

type ObjectItem = {
  id: string
  label: string
  x: number
  y: number
  z: number
  confidence: number | null
  n_observations: number
}

type HomeInfo = {
  home_id: string
  name: string
  status: HomeStatus
  num_objects: number
  error?: string
}

export default function SetupPage() {
  const previewRef = useRef<HTMLVideoElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const previewUrlRef = useRef<string | null>(null)

  const [mode, setMode] = useState<"idle" | "recorded" | "uploading" | "polling" | "done" | "error" | "phone">("idle")
  const [recordedBlob, setRecordedBlob] = useState<Blob | null>(null)
  const [uploadFile, setUploadFile] = useState<File | null>(null)
  const [previewSrc, setPreviewSrc] = useState<string | null>(null)
  const [homeName, setHomeName] = useState("")
  const [homeInfo, setHomeInfo] = useState<HomeInfo | null>(null)
  const [objects, setObjects] = useState<ObjectItem[]>([])
  const [statusMsg, setStatusMsg] = useState("")
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current)
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current)
    }
  }, [])

  const setPreviewUrl = useCallback((file: Blob) => {
    if (previewUrlRef.current) {
      URL.revokeObjectURL(previewUrlRef.current)
    }

    const nextUrl = URL.createObjectURL(file)
    previewUrlRef.current = nextUrl
    setPreviewSrc(nextUrl)
  }, [])

  const handlePhoneVideo = useCallback((blob: Blob, filename: string) => {
    setRecordedBlob(blob)
    setUploadFile(null)
    setPreviewUrl(blob)
    setHomeName(filename.replace(/\.\w+$/, ""))
    setMode("recorded")
  }, [setPreviewUrl])

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setUploadFile(file)
    setRecordedBlob(null)
    setPreviewUrl(file)
    setMode("recorded")
  }

  const fetchObjects = useCallback(async (homeId: string) => {
    const res = await fetch(`${API_URL}/api/homes/${homeId}/objects`)
    const data: { objects?: ObjectItem[] } = await res.json()
    setObjects(data.objects ?? [])
  }, [])

  const startPolling = useCallback(
    (homeId: string) => {
    if (pollRef.current) clearInterval(pollRef.current)
    pollRef.current = setInterval(async () => {
      try {
        const res = await fetch(`${API_URL}/api/homes/${homeId}`)
        const data: HomeInfo = await res.json()
        const status: HomeStatus = data.status
        setHomeInfo((prev) => prev ? { ...prev, status, num_objects: data.num_objects, error: data.error } : prev)

        if (status === "ready") {
          if (pollRef.current) clearInterval(pollRef.current)
          setStatusMsg("Done!")
          await fetchObjects(homeId)
          setMode("done")
        } else if (status === "failed") {
          if (pollRef.current) clearInterval(pollRef.current)
          setError(data.error ?? "Setup failed")
          setMode("error")
        } else {
          setStatusMsg("Running 3D reconstruction on GPU…")
        }
      } catch {
        // ignore transient fetch errors
      }
    }, POLL_INTERVAL_MS)
    },
    [fetchObjects],
  )

  const submitVideo = useCallback(async () => {
    const blob = recordedBlob ?? uploadFile
    if (!blob) return
    setError(null)
    setMode("uploading")
    setStatusMsg("Uploading…")

    const form = new FormData()
    form.append("video", blob, uploadFile?.name ?? "walkthrough.webm")
    form.append("name", homeName || "My Home")

    try {
      const res = await fetch(`${API_URL}/api/homes`, { method: "POST", body: form })
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { detail?: string }
        throw new Error(body.detail ?? `HTTP ${res.status}`)
      }
      const data = (await res.json()) as HomeInfo
      setHomeInfo(data)
      setMode("polling")
      setStatusMsg("Building your 3D map…")
      startPolling(data.home_id)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Setup upload failed")
      setMode("error")
    }
  }, [recordedBlob, uploadFile, homeName, startPolling])

  const reset = () => {
    setMode("idle")
    setRecordedBlob(null)
    setUploadFile(null)
    setPreviewSrc(null)
    setError(null)
    setHomeInfo(null)
    setObjects([])
    if (previewUrlRef.current) {
      URL.revokeObjectURL(previewUrlRef.current)
      previewUrlRef.current = null
    }
    if (fileInputRef.current) {
      fileInputRef.current.value = ""
    }
  }

  const isProcessing = mode === "uploading" || mode === "polling"

  return (
    <main className="relative overflow-hidden">
      <div className="absolute inset-0 -z-10 bg-[radial-gradient(circle_at_top,rgba(244,162,35,0.18),transparent_35%),linear-gradient(180deg,rgba(255,250,242,0.96),rgba(255,255,255,1))]" />
      <div className="absolute inset-x-0 top-0 -z-10 h-[28rem] bg-[radial-gradient(circle_at_20%_20%,rgba(255,214,153,0.45),transparent_32%),radial-gradient(circle_at_80%_10%,rgba(196,122,30,0.14),transparent_28%)]" />

      <section className="relative mx-auto flex min-h-screen w-full max-w-6xl flex-col gap-8 px-6 py-8 pb-20">
        <div className="pl-1">
          <p className="text-[10px] font-mono uppercase tracking-[0.2em] text-muted-foreground">
            setup
          </p>
          <h1 className="text-xl font-semibold tracking-tight text-foreground">
            Set Up Your Home
          </h1>
        </div>

        {mode === "phone" && (
          <div className="overflow-hidden rounded-[2rem] border border-border/70 bg-background/85 p-4 shadow-[0_25px_80px_-50px_rgba(17,12,6,0.45)] backdrop-blur-xl sm:p-6">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.24em] text-mango-700">Phone capture</p>
                <p className="mt-1 text-sm text-muted-foreground">Open the camera flow on your phone, record once, and send the walkthrough back here.</p>
              </div>
            </div>
            <PhoneCapture
              onVideoReady={handlePhoneVideo}
              onCancel={() => setMode("idle")}
            />
          </div>
        )}

        {(mode === "idle" || mode === "recorded") && (
          <div className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
            <div className="overflow-hidden rounded-[2rem] border border-border/70 bg-background/85 p-4 shadow-[0_25px_80px_-50px_rgba(17,12,6,0.45)] backdrop-blur-xl sm:p-5">
              <div className="mb-4 flex items-center justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.24em] text-mango-700">
                    {mode === "recorded" ? "Walkthrough preview" : "Choose your capture method"}
                  </p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {mode === "recorded"
                      ? "Check the framing, name the map, then let wayfr reconstruct the space."
                      : "Upload an existing walkthrough or use your phone camera to record one now."}
                  </p>
                </div>
              </div>

              <video
                ref={previewRef}
                src={previewSrc ?? undefined}
                className={cn(
                  "aspect-video w-full rounded-[1.5rem] border border-border/70 bg-gradient-to-br from-muted via-background to-mango-50 object-cover",
                  mode !== "recorded" && "hidden",
                )}
                controls
              />

              {mode === "idle" && (
                <div className="grid gap-4 sm:grid-cols-2">
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    className="group relative overflow-hidden rounded-[1.6rem] border border-border/70 bg-[linear-gradient(160deg,rgba(255,250,242,0.96),rgba(255,244,224,0.84))] p-6 text-left shadow-[0_16px_50px_-34px_rgba(196,122,30,0.55)] transition duration-300 hover:-translate-y-0.5 hover:border-mango/35"
                  >
                    <div className="absolute inset-x-0 top-0 h-24 bg-[radial-gradient(circle_at_top,rgba(244,162,35,0.2),transparent_70%)]" />
                    <div className="relative flex h-full flex-col gap-12">
                      <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-mango-100 text-mango-700 shadow-[0_12px_30px_-18px_rgba(196,122,30,0.7)]">
                        <Upload className="h-5 w-5" />
                      </div>
                      <div>
                        <p className="text-lg font-semibold tracking-[-0.02em] text-foreground">Upload</p>
                        <p className="mt-1 text-sm leading-6 text-muted-foreground">Choose a file</p>
                        <div className="mt-4 inline-flex items-center gap-2 text-sm font-medium text-mango-700">
                          Add walkthrough
                          <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
                        </div>
                      </div>
                    </div>
                  </button>

                  <button
                    onClick={() => setMode("phone")}
                    className="group relative overflow-hidden rounded-[1.6rem] border border-mango/20 bg-foreground p-6 text-left text-white shadow-[0_18px_60px_-34px_rgba(17,12,6,0.85)] transition duration-300 hover:-translate-y-0.5 hover:border-mango/40"
                  >
                    <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(255,190,110,0.24),transparent_34%),linear-gradient(180deg,rgba(255,255,255,0.02),transparent)]" />
                    <div className="relative flex h-full flex-col gap-12">
                      <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white/10 text-mango-300 backdrop-blur-sm">
                        <Smartphone className="h-5 w-5" />
                      </div>
                      <div>
                        <p className="text-lg font-semibold tracking-[-0.02em]">Phone</p>
                        <p className="mt-1 text-sm leading-6 text-white/65">Scan QR code</p>
                        <div className="mt-4 inline-flex items-center gap-2 text-sm font-medium text-mango-300">
                          Start from mobile
                          <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
                        </div>
                      </div>
                    </div>
                  </button>

                  <input ref={fileInputRef} type="file" accept="video/*" className="hidden" onChange={handleFileChange} />
                </div>
              )}

              {mode === "recorded" && (
                <div className="mt-5 space-y-4">
                  <div className="rounded-[1.4rem] border border-mango/20 bg-mango-50/65 p-4">
                    <div className="flex items-start gap-3">
                      <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-mango-100 text-mango-700">
                        <CheckCircle2 className="h-5 w-5" />
                      </div>
                      <div>
                        <p className="text-sm font-semibold text-foreground">Capture looks ready</p>
                        <p className="mt-1 text-sm leading-6 text-muted-foreground">Give this map a memorable name so it is easy to find later from navigation and dashboards.</p>
                      </div>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <label className="text-sm font-medium text-foreground">Name this map</label>
                    <input
                      className="h-12 w-full rounded-2xl border border-border/70 bg-background px-4 text-sm text-foreground placeholder-muted-foreground shadow-sm transition focus:outline-none focus:ring-2 focus:ring-mango/40"
                      value={homeName}
                      onChange={(e) => setHomeName(e.target.value)}
                      placeholder="e.g. Living room"
                    />
                  </div>

                  <div className="flex flex-col gap-3 sm:flex-row">
                    <Button
                      onClick={submitVideo}
                      className="h-12 flex-1 rounded-2xl bg-primary text-sm font-semibold text-primary-foreground shadow-[0_18px_40px_-24px_rgba(196,122,30,0.8)] hover:bg-primary/90"
                    >
                      Build 3D map
                    </Button>
                    <Button
                      variant="outline"
                      onClick={reset}
                      className="h-12 rounded-2xl border-border/70 bg-background px-5"
                    >
                      Re-record
                    </Button>
                  </div>
                </div>
              )}
            </div>

            <div className="rounded-[2rem] border border-border/70 bg-background/80 p-5 backdrop-blur-xl">
              <p className="text-xs font-semibold uppercase tracking-[0.24em] text-mango-700">What makes a good scan</p>
              <div className="mt-5 space-y-4">
                {[
                  "Move slowly enough that furniture edges stay stable between frames.",
                  "Keep lights on and avoid sudden turns or covering the lens.",
                  "Include the objects you care about from at least two angles when possible.",
                ].map((tip, index) => (
                  <div key={tip} className="flex items-start gap-4 rounded-2xl border border-border/60 bg-background/80 p-4">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl bg-mango-100 text-sm font-semibold text-mango-700">
                      {index + 1}
                    </div>
                    <p className="text-sm leading-6 text-muted-foreground">{tip}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {isProcessing && (
          <div className="overflow-hidden rounded-[2rem] border border-mango/20 bg-foreground px-6 py-8 text-center text-white shadow-[0_30px_100px_-50px_rgba(17,12,6,0.9)]">
            <div className="mx-auto flex max-w-xl flex-col items-center">
              <div className="flex h-16 w-16 items-center justify-center rounded-[1.6rem] bg-white/10 backdrop-blur">
                <Loader2 className="h-8 w-8 animate-spin text-mango-300" />
              </div>
              <p className="mt-5 text-xs font-semibold uppercase tracking-[0.28em] text-white/45">Reconstruction in progress</p>
              <p className="mt-3 text-2xl font-semibold tracking-[-0.04em] text-white">{statusMsg}</p>
              <p className="mt-2 text-sm leading-6 text-white/60">Usually 2 to 5 minutes on GPU. We&apos;re aligning frames, estimating geometry, and indexing objects for search.</p>
              <div className="mt-6 flex items-center gap-2">
                {[0, 1, 2].map((i) => (
                  <span
                    key={i}
                    className="h-2 w-12 rounded-full bg-white/10"
                  >
                    <span
                      className="block h-full rounded-full bg-mango-300 animate-pulse"
                      style={{ animationDelay: `${i * 0.2}s` }}
                    />
                  </span>
                ))}
              </div>
            </div>
          </div>
        )}

        {mode === "error" && error && (
          <div className="rounded-[2rem] border border-destructive/20 bg-destructive/5 p-6 shadow-[0_16px_50px_-36px_rgba(180,40,40,0.65)]">
            <div className="flex items-start gap-3">
              <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-destructive" />
              <div>
                <p className="text-sm font-semibold text-destructive">Setup failed</p>
                <p className="mt-1 text-sm leading-6 text-muted-foreground">{error}</p>
              </div>
            </div>
            <Button variant="outline" onClick={reset} className="mt-4 h-10 rounded-xl border-border/70 bg-background text-sm">
              Try again
            </Button>
          </div>
        )}

        {mode === "done" && homeInfo && (
          <div className="space-y-6">
            <div className="grid gap-4 lg:grid-cols-[0.9fr_1.1fr]">
              <div className="rounded-[2rem] border border-border/70 bg-background/90 p-6 shadow-[0_20px_70px_-40px_rgba(17,12,6,0.35)]">
                <div className="flex items-center gap-3">
                  <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-green-100">
                    <CheckCircle2 className="h-6 w-6 text-green-600" />
                  </div>
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.24em] text-green-700">Map ready</p>
                    <p className="mt-1 text-xl font-semibold tracking-[-0.03em] text-foreground">{homeInfo.name || "Your home"}</p>
                  </div>
                </div>
                <div className="mt-6 grid grid-cols-2 gap-3">
                  <div className="rounded-2xl border border-border/60 bg-background p-4">
                    <p className="text-xs uppercase tracking-[0.22em] text-muted-foreground">Objects</p>
                    <p className="mt-2 text-3xl font-semibold tracking-[-0.04em] text-foreground">{objects.length}</p>
                  </div>
                  <div className="rounded-2xl border border-border/60 bg-background p-4">
                    <p className="text-xs uppercase tracking-[0.22em] text-muted-foreground">Status</p>
                    <p className="mt-2 text-lg font-semibold text-foreground">Searchable</p>
                  </div>
                </div>
              </div>

              <HomeSceneViewer
                homeId={homeInfo.home_id}
                glbUrl={`${API_URL}/api/homes/${homeInfo.home_id}/scene`}
                objects={objects}
                height={400}
                className="overflow-hidden rounded-[2rem] border border-border/70"
              />
            </div>

            {objects.length > 0 ? (
              <div className="grid gap-3 sm:grid-cols-2">
                {objects.map((obj) => (
                  <div
                    key={obj.id}
                    className="flex items-center justify-between rounded-2xl border border-border/70 bg-background/90 px-4 py-3"
                  >
                    <div className="flex items-center gap-3">
                      <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-mango-100">
                        <MapPin className="h-4 w-4 text-mango-700" />
                      </div>
                      <p className="text-sm font-medium capitalize text-foreground">{obj.label}</p>
                    </div>
                    <span className="text-xs text-muted-foreground">
                      {obj.n_observations} frames
                      {obj.confidence != null && ` · ${Math.round(obj.confidence * 100)}%`}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No objects detected. Try a slower walkthrough.</p>
            )}

            {objects.length > 0 && (
              <Link
                href={`/navigate?home=${homeInfo.home_id}`}
                className="flex w-full items-center justify-center gap-2 rounded-2xl bg-primary px-6 py-3.5 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
              >
                Navigate this home
                <ArrowRight className="h-4 w-4" />
              </Link>
            )}
          </div>
        )}
      </section>
    </main>
  )
}
