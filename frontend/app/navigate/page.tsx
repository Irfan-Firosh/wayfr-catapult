"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { useSearchParams } from "next/navigation"
import { Navbar } from "@/components/nav/Navbar"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { MapPin, Navigation, ChevronRight, ChevronLeft, Camera, Loader2, CheckCircle2 } from "lucide-react"
import { HomeSceneViewer } from "@/components/scene/HomeSceneViewer"

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000"

type ObjectItem = { id: string; label: string; x: number; y: number; z: number; confidence: number | null; n_observations: number }
type Waypoint = { x: number; z: number; distance_m: number }
type NavPlan = {
  target_label: string
  target: { label: string; x: number; y: number; z: number; confidence: number | null }
  waypoints: Waypoint[]
  instructions: string[]
  total_distance_m: number
}

export default function NavigatePage() {
  const searchParams = useSearchParams()
  const homeId = searchParams.get("home") ?? ""

  const fileInputRef = useRef<HTMLInputElement>(null)

  const [objects, setObjects] = useState<ObjectItem[]>([])
  const [objectsLoading, setObjectsLoading] = useState(false)
  const [objectsError, setObjectsError] = useState<string | null>(null)

  const [target, setTarget] = useState("")
  const [planning, setPlanning] = useState(false)
  const [plan, setPlan] = useState<NavPlan | null>(null)
  const [planError, setPlanError] = useState<string | null>(null)
  const [currentStep, setCurrentStep] = useState(0)

  const [localizing, setLocalizing] = useState(false)
  const [localizePose, setLocalizePose] = useState<string | null>(null)

  useEffect(() => {
    if (!homeId) return
    setObjectsLoading(true)
    fetch(`${API_URL}/api/homes/${homeId}/objects`)
      .then((r) => r.json())
      .then((data) => {
        const items: ObjectItem[] = (data.objects ?? []).map((o: any) => ({
          id: o.id,
          label: o.label,
          x: o.x,
          y: o.y,
          z: o.z,
          confidence: o.confidence ?? null,
          n_observations: o.n_observations ?? 1,
        }))
        setObjects(items)
        if (items.length) setTarget(items[0].label)
      })
      .catch((err) => setObjectsError(err.message))
      .finally(() => setObjectsLoading(false))
  }, [homeId])

  const requestPlan = useCallback(async () => {
    if (!target || !homeId) return
    setPlanError(null)
    setPlanning(true)
    setPlan(null)
    setCurrentStep(0)
    try {
      const res = await fetch(`${API_URL}/api/navigation/plan`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ home_id: homeId, target_label: target, current_x: 0, current_z: 0, heading_rad: 0 }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.detail ?? `HTTP ${res.status}`)
      }
      setPlan(await res.json())
    } catch (err: any) {
      setPlanError(err.message)
    } finally {
      setPlanning(false)
    }
  }, [homeId, target])

  const handleLocalizeFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file || !homeId) return
    setLocalizing(true)
    setLocalizePose(null)
    try {
      const buf = await file.arrayBuffer()
      const b64 = btoa(String.fromCharCode(...new Uint8Array(buf)))
      const res = await fetch(`${API_URL}/api/homes/${homeId}/localize`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image_b64: b64 }),
      })
      const data = await res.json()
      setLocalizePose(
        data.success
          ? `x=${data.tx?.toFixed(2)}  y=${data.ty?.toFixed(2)}  z=${data.tz?.toFixed(2)}`
          : `Failed: ${data.error ?? "unknown"}`
      )
    } catch (err: any) {
      setLocalizePose(`Error: ${err.message}`)
    } finally {
      setLocalizing(false)
    }
  }

  const labels = [...new Set(objects.map((o) => o.label))]
  const totalSteps = plan?.instructions.length ?? 0

  // ── No home selected ──────────────────────────────────────────────────────
  if (!homeId) {
    return (
      <div className="min-h-screen bg-background">
        <Navbar />
        <main className="mx-auto max-w-xl px-6 pt-28 pb-20 text-center space-y-4">
          <p className="text-muted-foreground">No home selected.</p>
          <a
            href="/setup"
            className="inline-block rounded-xl bg-primary hover:bg-primary/90 px-6 py-2.5 text-sm font-semibold text-primary-foreground transition-colors"
          >
            Set up a home first →
          </a>
        </main>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-background">
      <Navbar />

      <main className="mx-auto max-w-xl px-6 pt-28 pb-20 space-y-8">

        {/* Header */}
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground">Navigate</h1>
          <p className="mt-1.5 text-sm text-muted-foreground">
            Home: <span className="font-mono text-foreground/70">{homeId}</span>
          </p>
        </div>

        {/* ── Target selector ───────────────────────────────────────── */}
        <section className="space-y-4">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            Where do you want to go?
          </h2>

          {objectsLoading && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading objects…
            </div>
          )}

          {objectsError && (
            <p className="text-sm text-destructive">{objectsError}</p>
          )}

          {!objectsLoading && labels.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {labels.map((label) => (
                <button
                  key={label}
                  onClick={() => setTarget(label)}
                  className={cn(
                    "rounded-full px-4 py-1.5 text-sm font-medium border transition-colors capitalize",
                    target === label
                      ? "bg-primary border-primary text-primary-foreground"
                      : "border-border bg-card text-foreground hover:border-mango/50 hover:bg-mango-50"
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
          )}

          {!objectsLoading && labels.length === 0 && !objectsError && (
            <p className="text-sm text-muted-foreground">No objects mapped for this home yet.</p>
          )}

          <input
            className="w-full rounded-xl border border-border bg-card px-4 py-2.5 text-sm text-foreground placeholder-muted-foreground focus:outline-none focus:ring-2 focus:ring-mango/50"
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            placeholder="Or type an object name…"
          />

          <Button
            onClick={requestPlan}
            disabled={!target || planning}
            className="w-full bg-primary hover:bg-primary/90 text-primary-foreground rounded-xl h-11 font-medium disabled:opacity-50"
          >
            {planning ? (
              <span className="flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" /> Planning route…
              </span>
            ) : (
              <span className="flex items-center gap-2">
                <Navigation className="h-4 w-4" /> Get directions
              </span>
            )}
          </Button>
        </section>

        {/* ── Plan error ────────────────────────────────────────────── */}
        {planError && (
          <div className="rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
            {planError}
          </div>
        )}

        {/* ── Navigation instructions ───────────────────────────────── */}
        {plan && (
          <section className="space-y-5">

            {/* 3D scene with navigation path */}
            <HomeSceneViewer
              glbUrl={`${API_URL}/api/homes/${homeId}/scene`}
              objects={objects}
              path={plan.waypoints}
              currentStepIndex={currentStep}
              targetLabel={plan.target_label}
              height={350}
              className="rounded-2xl border border-border overflow-hidden"
            />

            {/* Plan summary */}
            <div className="flex items-center justify-between rounded-2xl border border-border bg-card px-5 py-4">
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-mango-100">
                  <MapPin className="h-4 w-4 text-mango-700" />
                </div>
                <div>
                  <p className="font-semibold text-foreground capitalize">{plan.target_label}</p>
                  <p className="text-xs text-muted-foreground">{totalSteps} steps · {plan.total_distance_m}m</p>
                </div>
              </div>
              <span className="text-sm font-medium text-muted-foreground">
                {currentStep + 1} / {totalSteps}
              </span>
            </div>

            {/* Step cards */}
            <div className="space-y-2">
              {plan.instructions.map((instr, i) => {
                const isActive = i === currentStep
                const isDone = i < currentStep
                const isLast = i === totalSteps - 1
                return (
                  <button
                    key={i}
                    onClick={() => setCurrentStep(i)}
                    className={cn(
                      "w-full text-left rounded-xl border px-4 py-3.5 transition-colors flex items-center gap-3",
                      isActive && "border-primary/40 bg-primary/5",
                      isDone && "border-border bg-muted/40 opacity-50",
                      !isActive && !isDone && "border-border bg-card hover:border-mango/40"
                    )}
                  >
                    <span className={cn(
                      "flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold",
                      isActive && "bg-primary text-primary-foreground",
                      isDone && "bg-muted text-muted-foreground",
                      !isActive && !isDone && "bg-muted text-muted-foreground"
                    )}>
                      {isDone ? "✓" : isLast ? "⚑" : i + 1}
                    </span>
                    <span className={cn(
                      "text-sm",
                      isActive && "font-medium text-foreground",
                      isDone && "text-muted-foreground line-through",
                      !isActive && !isDone && "text-foreground"
                    )}>
                      {instr}
                    </span>
                  </button>
                )
              })}
            </div>

            {/* Prev / Next */}
            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={() => setCurrentStep((s) => Math.max(s - 1, 0))}
                disabled={currentStep === 0}
                className="flex-1 rounded-xl h-11 border-border"
              >
                <ChevronLeft className="h-4 w-4 mr-1" /> Back
              </Button>
              <Button
                onClick={() => setCurrentStep((s) => Math.min(s + 1, totalSteps - 1))}
                disabled={currentStep === totalSteps - 1}
                className="flex-1 bg-primary hover:bg-primary/90 text-primary-foreground rounded-xl h-11"
              >
                Next <ChevronRight className="h-4 w-4 ml-1" />
              </Button>
            </div>
          </section>
        )}

        {/* ── Localization ──────────────────────────────────────────── */}
        <section className="rounded-2xl border border-border bg-card p-5 space-y-3">
          <div>
            <h2 className="text-sm font-semibold text-foreground">Update my position</h2>
            <p className="text-xs text-muted-foreground mt-0.5">Take a photo to get your precise location in the map.</p>
          </div>

          <Button
            variant="outline"
            onClick={() => fileInputRef.current?.click()}
            disabled={localizing}
            className="rounded-xl border-border h-9 text-sm"
          >
            {localizing ? (
              <span className="flex items-center gap-2">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Localizing…
              </span>
            ) : (
              <span className="flex items-center gap-2">
                <Camera className="h-3.5 w-3.5" /> Upload photo
              </span>
            )}
          </Button>

          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handleLocalizeFile}
          />

          {localizePose && (
            <div className="flex items-start gap-2 rounded-lg bg-muted/50 px-3 py-2.5">
              <CheckCircle2 className="h-4 w-4 text-green-600 mt-0.5 shrink-0" />
              <p className="text-xs font-mono text-foreground">{localizePose}</p>
            </div>
          )}
        </section>

      </main>
    </div>
  )
}
