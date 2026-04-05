"use client"

import { useEffect, useState } from "react"
import { Box, CheckCircle2, Clock, Loader2, XCircle } from "lucide-react"

import { cn } from "@/lib/utils"

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000"

type HomeStatus = "processing" | "ready" | "failed"

interface HomeSummary {
  home_id: string
  name: string
  status: HomeStatus
  num_objects: number
}

interface HomePickerProps {
  onSelect: (homeId: string, homeName: string) => void
  selectedHomeId?: string | null
}

function StatusIcon({ status }: { status: HomeStatus }) {
  if (status === "ready") return <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
  if (status === "processing") return <Loader2 className="h-3.5 w-3.5 animate-spin text-mango" />
  return <XCircle className="h-3.5 w-3.5 text-red-400" />
}

export function HomePicker({ onSelect, selectedHomeId }: HomePickerProps) {
  const [homes, setHomes] = useState<HomeSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    setError(null)

    Promise.all([
      fetch(`${API_URL}/api/homes`, { signal: controller.signal, cache: "no-store" })
        .then((res) => {
          if (!res.ok) throw new Error(`Failed to load scenes (${res.status})`)
          return res.json() as Promise<{ homes?: HomeSummary[] }>
        }),
      fetch("/api/local-scenes", { signal: controller.signal, cache: "no-store" })
        .then((res) => (res.ok ? (res.json() as Promise<{ home_ids?: string[] }>) : { home_ids: [] }))
        .catch(() => ({ home_ids: [] as string[] })),
    ])
      .then(([homesData, localData]) => {
        const localSet = new Set(localData.home_ids ?? [])
        const filtered = (homesData.homes ?? []).filter((h) => localSet.has(h.home_id))
        setHomes(filtered)
      })
      .catch((err: unknown) => {
        if (err instanceof Error && err.name === "AbortError") return
        setError(err instanceof Error ? err.message : "Failed to load scenes")
      })
      .finally(() => setLoading(false))

    return () => controller.abort()
  }, [])

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-2 text-sm text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        Loading your scenes…
      </div>
    )
  }

  if (error) {
    return (
      <p className="py-2 text-sm text-red-400">
        {error}
      </p>
    )
  }

  if (homes.length === 0) {
    return (
      <div className="flex items-center gap-2 rounded-2xl border border-border/40 bg-muted/30 px-4 py-3 text-sm text-muted-foreground">
        <Box className="h-4 w-4 shrink-0" />
        No local scenes found. Make sure your scanned spaces have a scene.glb file available.
      </div>
    )
  }

  return (
    <div className="flex gap-3 overflow-x-auto pb-1 scrollbar-none">
      {homes.map((home) => {
        const isSelected = home.home_id === selectedHomeId
        const isReady = home.status === "ready"

        return (
          <button
            key={home.home_id}
            onClick={() => isReady && onSelect(home.home_id, home.name)}
            disabled={!isReady}
            aria-pressed={isSelected}
            className={cn(
              "group flex min-w-[148px] flex-col gap-2 rounded-2xl border px-4 py-3 text-left transition-all duration-200",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mango/60",
              isSelected
                ? "border-mango/60 bg-mango/8 shadow-[0_0_0_1px_rgba(245,166,35,0.15)]"
                : "border-border/50 bg-background/60 hover:border-border hover:bg-muted/40",
              !isReady && "cursor-not-allowed opacity-50"
            )}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="truncate text-sm font-medium text-foreground">
                {home.name}
              </span>
              <StatusIcon status={home.status} />
            </div>

            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Box className="h-3 w-3 shrink-0" />
              {home.num_objects} object{home.num_objects !== 1 ? "s" : ""}
            </div>

            {isSelected && (
              <div className="h-0.5 w-full rounded-full bg-mango/60" />
            )}
          </button>
        )
      })}
    </div>
  )
}
