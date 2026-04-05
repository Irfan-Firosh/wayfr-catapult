"use client"

import Link from "next/link"
import { useCallback, useEffect, useMemo, useState } from "react"
import {
  ArrowRight,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  FolderClock,
  Loader2,
  Plus,
  RefreshCw,
  Search,
  TriangleAlert,
} from "lucide-react"

import {
  type CameraPreset,
  type ObjectItem,
  type SceneDebugOptions,
  type SceneDisplayMode,
  HomeSceneViewer,
} from "@/components/scene/HomeSceneViewer"
import { SceneObjectBrowser } from "@/components/scene/SceneObjectBrowser"
import { SceneObjectInspector } from "@/components/scene/SceneObjectInspector"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000"

type HomeStatus = "processing" | "ready" | "failed"

type HomeSummary = {
  home_id: string
  name: string
  status: HomeStatus
  num_objects: number
  created_at?: unknown
}

type HomeDetail = HomeSummary & {
  updated_at?: unknown
  error?: string | null
}

type HomesResponse = {
  homes?: HomeSummary[]
}

type HomeResponse = {
  home_id: string
  name: string
  status: HomeStatus
  num_objects: number
  error?: string | null
  created_at?: unknown
  updated_at?: unknown
}

type ObjectsResponse = {
  objects?: Array<{
    id: string
    label: string
    x: number
    y: number
    z: number
    track_id?: number | null
    bbox_min?: number[] | null
    bbox_max?: number[] | null
    confidence?: number | null
    n_observations?: number
  }>
}

function parseTimestamp(value: unknown) {
  if (typeof value === "number") {
    return new Date(value < 1e12 ? value * 1000 : value)
  }

  if (typeof value === "string") {
    const numeric = Number(value)
    if (Number.isFinite(numeric)) {
      return new Date(numeric < 1e12 ? numeric * 1000 : numeric)
    }

    const parsed = new Date(value)
    if (!Number.isNaN(parsed.getTime())) {
      return parsed
    }
  }

  return null
}

function formatDateTime(value: unknown) {
  const parsed = parseTimestamp(value)
  if (!parsed) return "Unknown"

  return parsed.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  })
}

function formatRelative(value: unknown) {
  const parsed = parseTimestamp(value)
  if (!parsed) return "Unknown"

  const diffMs = parsed.getTime() - Date.now()
  const diffMins = Math.round(diffMs / 60000)

  if (Math.abs(diffMins) < 60) {
    return `${Math.abs(diffMins)} min${Math.abs(diffMins) === 1 ? "" : "s"} ${diffMins <= 0 ? "ago" : "from now"}`
  }

  const diffHours = Math.round(diffMins / 60)
  if (Math.abs(diffHours) < 24) {
    return `${Math.abs(diffHours)} hr${Math.abs(diffHours) === 1 ? "" : "s"} ${diffHours <= 0 ? "ago" : "from now"}`
  }

  const diffDays = Math.round(diffHours / 24)
  return `${Math.abs(diffDays)} day${Math.abs(diffDays) === 1 ? "" : "s"} ${diffDays <= 0 ? "ago" : "from now"}`
}

function getStatusLabel(status: HomeStatus) {
  if (status === "ready") return "Ready"
  if (status === "processing") return "Processing"
  return "Failed"
}

function getStatusClasses(status: HomeStatus) {
  if (status === "ready") return "border-green-500/25 bg-green-500/12 text-green-200"
  if (status === "processing") return "border-mango/25 bg-mango/12 text-mango"
  return "border-red-500/25 bg-red-500/12 text-red-300"
}

function EmptyPanel() {
  return (
    <div className="w-full max-w-xl rounded-[36px] border border-white/10 bg-black/50 px-6 py-14 text-center text-white backdrop-blur-2xl">
      <FolderClock className="mx-auto h-10 w-10 text-mango" />
      <h2 className="mt-4 text-2xl font-semibold tracking-tight">No saved scenes yet</h2>
      <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-white/60">
        Start in setup, upload a walkthrough, and the completed GLB will appear here.
      </p>
      <Link
        href="/setup"
        className="mt-6 inline-flex items-center justify-center rounded-full bg-mango px-4 py-2 text-sm font-medium text-background transition-colors hover:bg-mango/90"
      >
        Open setup
        <ArrowRight className="ml-2 h-4 w-4" />
      </Link>
    </div>
  )
}

function StageStateCard({
  title,
  description,
  tone = "neutral",
  loading = false,
}: {
  title: string
  description: string
  tone?: "neutral" | "error"
  loading?: boolean
}) {
  return (
    <div
      className={cn(
        "w-full max-w-lg rounded-[34px] border px-6 py-6 text-white shadow-[0_30px_120px_rgba(0,0,0,0.35)] backdrop-blur-2xl",
        tone === "error" ? "border-red-500/25 bg-red-500/10" : "border-white/10 bg-black/52"
      )}
    >
      <div className="flex items-start gap-4">
        <div
          className={cn(
            "flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl",
            tone === "error" ? "bg-red-500/12 text-red-300" : "bg-mango/12 text-mango"
          )}
        >
          {loading ? <Loader2 className="h-5 w-5 animate-spin" /> : <TriangleAlert className="h-5 w-5" />}
        </div>
        <div>
          <h2 className="text-xl font-semibold tracking-tight">{title}</h2>
          <p className="mt-2 text-sm leading-6 text-white/68">{description}</p>
        </div>
      </div>
    </div>
  )
}

export default function DashboardPage() {
  const [homes, setHomes] = useState<HomeSummary[]>([])
  const [requestedHomeId, setRequestedHomeId] = useState("")
  const [selectedHomeId, setSelectedHomeId] = useState("")
  const [selectedHome, setSelectedHome] = useState<HomeDetail | null>(null)
  const [objects, setObjects] = useState<ObjectItem[]>([])
  const [focusedObjectId, setFocusedObjectId] = useState<string | null>(null)
  const [selectedObjectIds, setSelectedObjectIds] = useState<string[]>([])
  const [hoveredObjectId, setHoveredObjectId] = useState<string | null>(null)
  const [historyQuery, setHistoryQuery] = useState("")
  const [sceneSwitcherExpanded, setSceneSwitcherExpanded] = useState(true)
  const [objectQuery, setObjectQuery] = useState("")
  const [hiddenLabels, setHiddenLabels] = useState<string[]>([])
  const [hiddenObjectIds, setHiddenObjectIds] = useState<string[]>([])
  const [pinnedObjectIds, setPinnedObjectIds] = useState<string[]>([])
  const [displayMode, setDisplayMode] = useState<SceneDisplayMode>("normal")
  const [viewerDebug, setViewerDebug] = useState<SceneDebugOptions>({
    showBBoxes: false,
    showCentroids: false,
    showApproxRegion: false,
    showExactPoints: false,
  })
  const [cameraCommandNonce, setCameraCommandNonce] = useState(0)
  const [cameraPreset, setCameraPreset] = useState<CameraPreset>("overview")
  const [scenePointCount, setScenePointCount] = useState(0)
  const [homesLoading, setHomesLoading] = useState(true)
  const [homeLoading, setHomeLoading] = useState(false)
  const [homesError, setHomesError] = useState<string | null>(null)
  const [homeError, setHomeError] = useState<string | null>(null)

  const loadHomes = useCallback(async (signal?: AbortSignal) => {
    setHomesError(null)
    setHomesLoading(true)

    try {
      const response = await fetch(`${API_URL}/api/homes`, { signal, cache: "no-store" })
      if (!response.ok) {
        throw new Error(`Failed to load homes (${response.status})`)
      }
      const data: HomesResponse = await response.json()
      setHomes(data.homes ?? [])
    } catch (error: unknown) {
      if (signal?.aborted) return
      setHomesError(error instanceof Error ? error.message : "Failed to load homes")
    } finally {
      if (!signal?.aborted) setHomesLoading(false)
    }
  }, [])

  const loadSelectedHome = useCallback(async (homeId: string, signal?: AbortSignal) => {
    if (!homeId) {
      setSelectedHome(null)
      setObjects([])
      return
    }

    setHomeLoading(true)
    setHomeError(null)

    try {
      const [homeResponse, objectsResponse] = await Promise.all([
        fetch(`${API_URL}/api/homes/${homeId}`, { signal, cache: "no-store" }),
        fetch(`${API_URL}/api/homes/${homeId}/objects`, { signal, cache: "no-store" }),
      ])

      if (!homeResponse.ok) throw new Error(`Failed to load home (${homeResponse.status})`)
      if (!objectsResponse.ok) throw new Error(`Failed to load objects (${objectsResponse.status})`)

      const homeData: HomeResponse = await homeResponse.json()
      const objectData: ObjectsResponse = await objectsResponse.json()

      setSelectedHome({
        home_id: homeData.home_id,
        name: homeData.name,
        status: homeData.status,
        num_objects: homeData.num_objects,
        error: homeData.error ?? null,
        created_at: homeData.created_at,
        updated_at: homeData.updated_at,
      })
      setObjects(
        (objectData.objects ?? []).map((object) => ({
          id: object.id,
          label: object.label,
          classLabel: object.label,
          x: object.x,
          y: object.y,
          z: object.z,
          track_id: object.track_id ?? null,
          bbox_min: object.bbox_min ?? null,
          bbox_max: object.bbox_max ?? null,
          confidence: object.confidence ?? null,
          n_observations: object.n_observations ?? 1,
        }))
      )
    } catch (error: unknown) {
      if (signal?.aborted) return
      setHomeError(error instanceof Error ? error.message : "Failed to load selected home")
    } finally {
      if (!signal?.aborted) setHomeLoading(false)
    }
  }, [])

  useEffect(() => {
    const syncRequestedHome = () => {
      const params = new URLSearchParams(window.location.search)
      setRequestedHomeId(params.get("home") ?? "")
    }

    syncRequestedHome()
    window.addEventListener("popstate", syncRequestedHome)
    return () => window.removeEventListener("popstate", syncRequestedHome)
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    void loadHomes(controller.signal)
    return () => controller.abort()
  }, [loadHomes])

  useEffect(() => {
    if (homes.length === 0) {
      setSelectedHomeId("")
      return
    }

    if (requestedHomeId && homes.some((home) => home.home_id === requestedHomeId)) {
      setSelectedHomeId((current) => (current === requestedHomeId ? current : requestedHomeId))
      return
    }

    setSelectedHomeId((current) => {
      if (current && homes.some((home) => home.home_id === current)) return current
      return homes[0]?.home_id ?? ""
    })
  }, [homes, requestedHomeId])

  useEffect(() => {
    setSelectedHome(null)
    setObjects([])
    setObjectQuery("")
    setHiddenLabels([])
    setHiddenObjectIds([])
    setPinnedObjectIds([])
    setFocusedObjectId(null)
    setSelectedObjectIds([])
    setHoveredObjectId(null)
    setDisplayMode("normal")
    setScenePointCount(0)
    setViewerDebug({
      showBBoxes: false,
      showCentroids: false,
      showApproxRegion: false,
      showExactPoints: false,
    })
  }, [selectedHomeId])

  useEffect(() => {
    const controller = new AbortController()
    void loadSelectedHome(selectedHomeId, controller.signal)
    return () => controller.abort()
  }, [selectedHomeId, loadSelectedHome])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setFocusedObjectId(null)
        setSelectedObjectIds([])
        setHoveredObjectId(null)
      }
    }

    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [])

  const sortedHomes = useMemo(() => {
    return [...homes].sort((left, right) => {
      const leftTime = parseTimestamp(left.created_at)?.getTime() ?? 0
      const rightTime = parseTimestamp(right.created_at)?.getTime() ?? 0
      return rightTime - leftTime
    })
  }, [homes])

  const filteredHomes = useMemo(() => {
    const query = historyQuery.trim().toLowerCase()
    if (!query) return sortedHomes
    return sortedHomes.filter((home) => {
      return (
        home.name.toLowerCase().includes(query) ||
        home.home_id.toLowerCase().includes(query) ||
        home.status.toLowerCase().includes(query)
      )
    })
  }, [historyQuery, sortedHomes])

  const activeHome = useMemo(() => {
    if (selectedHome?.home_id === selectedHomeId) {
      return selectedHome
    }
    return sortedHomes.find((home) => home.home_id === selectedHomeId) ?? null
  }, [selectedHome, selectedHomeId, sortedHomes])

  const activeHomeUpdatedAt =
    selectedHome && selectedHome.home_id === activeHome?.home_id
      ? selectedHome.updated_at ?? activeHome?.created_at
      : activeHome?.created_at

  const sceneUrl = activeHome ? `${API_URL}/api/homes/${activeHome.home_id}/scene` : ""
  const sceneVersion = activeHomeUpdatedAt ? String(activeHomeUpdatedAt) : undefined

  const visibleObjects = useMemo(() => {
    const query = objectQuery.trim().toLowerCase()
    return objects.filter((object) => {
      const label = object.label.trim().toLowerCase()
      if (hiddenLabels.includes(label)) return false
      if (hiddenObjectIds.includes(object.id)) return false
      if (query && !label.includes(query)) return false
      return true
    })
  }, [hiddenLabels, hiddenObjectIds, objectQuery, objects])

  const objectMap = useMemo(() => new Map(visibleObjects.map((object) => [object.id, object])), [visibleObjects])

  const focusedObject = useMemo(
    () => (focusedObjectId ? objectMap.get(focusedObjectId) ?? null : null),
    [focusedObjectId, objectMap]
  )

  const selectedObjects = useMemo(
    () => selectedObjectIds.map((id) => objectMap.get(id)).filter((object): object is ObjectItem => object != null),
    [objectMap, selectedObjectIds]
  )

  const visibleClassCount = useMemo(() => {
    return new Set(visibleObjects.map((object) => object.label.trim().toLowerCase())).size
  }, [visibleObjects])

  useEffect(() => {
    setSelectedObjectIds((current) => current.filter((id) => objectMap.has(id)))
    setFocusedObjectId((current) => (current && objectMap.has(current) ? current : null))
    setHoveredObjectId((current) => (current && objectMap.has(current) ? current : null))
  }, [objectMap])

  const createCameraCommand = useCallback((preset: CameraPreset) => {
    setCameraPreset(preset)
    setCameraCommandNonce((current) => current + 1)
  }, [])

  useEffect(() => {
    if (focusedObjectId) {
      createCameraCommand("focus")
    }
  }, [createCameraCommand, focusedObjectId])

  const selectHome = useCallback((homeId: string) => {
    setSelectedHomeId(homeId)
    setRequestedHomeId(homeId)
    window.history.replaceState({}, "", `/dashboard?home=${homeId}`)
  }, [])

  const refreshAll = useCallback(() => {
    void loadHomes()
    if (selectedHomeId) {
      void loadSelectedHome(selectedHomeId)
    }
  }, [loadHomes, loadSelectedHome, selectedHomeId])

  const activateObject = useCallback((objectId: string, additive = false) => {
    setSelectedObjectIds((current) => {
      if (additive) {
        if (current.includes(objectId)) {
          const next = current.filter((id) => id !== objectId)
          setFocusedObjectId((focused) => (focused === objectId ? next[0] ?? null : focused))
          return next
        }
        return [...current, objectId]
      }
      return [objectId]
    })
    setFocusedObjectId(objectId)
  }, [])

  const selectLabelGroup = useCallback(
    (label: string) => {
      const ids = visibleObjects.filter((object) => object.label.trim().toLowerCase() === label).map((object) => object.id)
      setSelectedObjectIds(ids)
      setFocusedObjectId(ids[0] ?? null)
    },
    [visibleObjects]
  )

  const togglePin = useCallback((objectId: string) => {
    setPinnedObjectIds((current) => (current.includes(objectId) ? current.filter((id) => id !== objectId) : [...current, objectId]))
  }, [])

  const hideObject = useCallback((objectId: string) => {
    setHiddenObjectIds((current) => (current.includes(objectId) ? current : [...current, objectId]))
  }, [])

  const toggleLabelVisibility = useCallback((label: string) => {
    const normalized = label.trim().toLowerCase()
    setHiddenLabels((current) =>
      current.includes(normalized) ? current.filter((item) => item !== normalized) : [...current, normalized]
    )
  }, [])

  const toggleViewerDebug = useCallback((key: keyof SceneDebugOptions) => {
    setViewerDebug((current) => ({ ...current, [key]: !current[key] }))
  }, [])

  const resetVisibility = useCallback(() => {
    setHiddenLabels([])
    setHiddenObjectIds([])
  }, [])

  const clearSelection = useCallback(() => {
    setFocusedObjectId(null)
    setSelectedObjectIds([])
    setHoveredObjectId(null)
  }, [])

  const toggleIsolate = useCallback(() => {
    setDisplayMode((current) => (current === "isolate" ? "normal" : "isolate"))
  }, [])

  const navigateRelative = useCallback(
    (delta: number, scope: "all" | "class") => {
      if (visibleObjects.length === 0) return

      const candidates =
        scope === "class" && focusedObject
          ? visibleObjects.filter((object) => object.label === focusedObject.label)
          : visibleObjects

      if (candidates.length === 0) return
      const currentIndex = focusedObjectId ? candidates.findIndex((object) => object.id === focusedObjectId) : -1
      const nextIndex = currentIndex >= 0 ? (currentIndex + delta + candidates.length) % candidates.length : 0
      const nextObject = candidates[nextIndex]
      if (nextObject) activateObject(nextObject.id)
    },
    [activateObject, focusedObject, focusedObjectId, visibleObjects]
  )

  const cameraCommand = useMemo(
    () => ({ preset: cameraPreset, nonce: cameraCommandNonce }),
    [cameraCommandNonce, cameraPreset]
  )

  const showReadyScene = activeHome?.status === "ready" && !homeError
  const showSceneControls = showReadyScene
  const showSideRail = homes.length > 0 && !homesError

  const metrics = [
    {
      label: "Points",
      value: scenePointCount > 0 ? scenePointCount.toLocaleString() : showReadyScene ? "..." : "0",
    },
    { label: "Objects", value: visibleObjects.length.toString() },
    { label: "Classes", value: visibleClassCount.toString() },
    { label: "Selected", value: selectedObjectIds.length.toString() },
  ]

  return (
    <main className="dark relative h-[100dvh] overflow-hidden bg-[#030507] text-white">
      {showReadyScene ? (
        <div className="absolute inset-0 z-0">
          <HomeSceneViewer
            homeId={activeHome?.home_id}
            glbUrl={sceneUrl}
            sceneVersion={sceneVersion}
            objects={visibleObjects}
            mode="annotator"
            focusedObjectId={focusedObjectId}
            selectedObjectIds={selectedObjectIds}
            hoveredObjectId={hoveredObjectId}
            displayMode={displayMode}
            cameraCommand={cameraCommand}
            onObjectActivate={(objectId, options) => activateObject(objectId, options?.additive)}
            onObjectHover={setHoveredObjectId}
            debugOptions={viewerDebug}
            onVertexCountChange={setScenePointCount}
            height="100%"
            showSceneBadge={false}
            className="h-full w-full rounded-none"
          />
        </div>
      ) : (
        <div className="absolute inset-0 z-0 bg-[radial-gradient(circle_at_top,rgba(88,196,255,0.1),transparent_28%),radial-gradient(circle_at_bottom,rgba(245,166,35,0.1),transparent_24%),linear-gradient(180deg,#030507_0%,#06090d_100%)]" />
      )}

      <div className="pointer-events-none absolute inset-0 z-10 bg-[radial-gradient(circle_at_top,rgba(88,196,255,0.08),transparent_28%),radial-gradient(circle_at_bottom,rgba(245,166,35,0.08),transparent_22%)]" />

      <div className="pointer-events-none absolute inset-x-0 top-0 z-30 px-3 pt-3 sm:px-5 sm:pt-5">
        <div className="flex items-center justify-center">
          <div className="pointer-events-auto inline-flex max-w-[calc(100vw-1.5rem)] items-center gap-3 rounded-full border border-white/10 bg-black/40 px-4 py-2 text-sm text-white/82 backdrop-blur-xl">
            <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-white/50">wayfr</span>
            <span className="truncate font-medium text-white">{activeHome?.name ?? "Scene explorer"}</span>
            {activeHome ? (
              <Badge className={cn("border font-medium", getStatusClasses(activeHome.status))}>
                {getStatusLabel(activeHome.status)}
              </Badge>
            ) : null}
            {homeLoading ? <Loader2 className="h-4 w-4 animate-spin text-mango" /> : null}
            <span className="hidden text-white/55 sm:inline">
              {activeHome ? `Updated ${formatRelative(activeHomeUpdatedAt)}` : homesLoading ? "Loading library" : "Immersive stage"}
            </span>
          </div>
        </div>
      </div>

      {homesError ? (
        <div className="absolute inset-x-0 top-20 z-40 flex justify-center px-3 sm:top-24">
          <div className="w-full max-w-2xl rounded-[28px] border border-red-500/25 bg-red-500/10 px-5 py-4 text-sm text-red-100 backdrop-blur-2xl">
            <div className="flex items-start gap-3">
              <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-red-300" />
              <div>
                <p className="font-medium text-white">Unable to load saved scenes.</p>
                <p className="mt-1 text-red-100/80">{homesError}</p>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {homesLoading && homes.length === 0 ? (
        <div className="absolute inset-0 z-20 flex items-center justify-center p-4">
          <StageStateCard
            title="Loading scene library"
            description="Pulling saved walkthroughs and preparing the immersive explorer."
            loading
          />
        </div>
      ) : null}

      {!homesLoading && homes.length === 0 && !homesError ? (
        <div className="absolute inset-0 z-20 flex items-center justify-center p-4">
          <EmptyPanel />
        </div>
      ) : null}

      {showSideRail ? (
        <>
          <div className="pointer-events-none absolute left-3 top-20 z-30 w-[220px] sm:left-5 sm:top-24 sm:w-[244px]">
            <div className="pointer-events-auto rounded-[28px] border border-white/10 bg-black/44 px-4 py-4 text-white/90 backdrop-blur-2xl">
              <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-white/48">Scene metrics</p>
              <div className="mt-4 grid grid-cols-2 gap-3">
                {metrics.map((metric) => (
                  <div key={metric.label} className="rounded-2xl border border-white/10 bg-white/5 px-3 py-3">
                    <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-white/42">{metric.label}</p>
                    <p className="mt-2 text-lg font-semibold text-white">{metric.value}</p>
                  </div>
                ))}
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => toggleViewerDebug("showApproxRegion")}
                  className={cn(
                    "rounded-full border px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.16em] transition-colors",
                    viewerDebug.showApproxRegion
                      ? "border-emerald-400/40 bg-emerald-400/12 text-emerald-200"
                      : "border-white/10 bg-white/5 text-white/66"
                  )}
                >
                  Approx
                </button>
                <button
                  type="button"
                  onClick={() => toggleViewerDebug("showBBoxes")}
                  className={cn(
                    "rounded-full border px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.16em] transition-colors",
                    viewerDebug.showBBoxes
                      ? "border-emerald-400/40 bg-emerald-400/12 text-emerald-200"
                      : "border-white/10 bg-white/5 text-white/66"
                  )}
                >
                  BBox
                </button>
              </div>
            </div>
          </div>

          <div className="pointer-events-none absolute inset-x-0 bottom-20 z-40 p-3 sm:inset-y-0 sm:right-0 sm:left-auto sm:w-[452px] sm:p-5">
            <aside className="pointer-events-auto mx-auto flex max-h-[min(68dvh,760px)] w-full max-w-[420px] flex-col gap-3 overflow-y-auto pr-1 sm:h-full sm:max-h-[calc(100dvh-2.5rem)]">
              <div className="rounded-[28px] border border-white/10 bg-black/48 p-4 backdrop-blur-2xl">
                <div className="flex items-start justify-between gap-3">
                  <button
                    type="button"
                    onClick={() => setSceneSwitcherExpanded((open) => !open)}
                    className="group flex min-w-0 flex-1 items-start gap-2 rounded-2xl text-left outline-none ring-offset-2 ring-offset-black/48 transition-colors hover:bg-white/5 focus-visible:ring-2 focus-visible:ring-mango/50"
                    aria-expanded={sceneSwitcherExpanded}
                    aria-controls={sceneSwitcherExpanded ? "scene-switcher-panel" : undefined}
                    id="scene-switcher-heading"
                  >
                    <ChevronDown
                      className={cn(
                        "mt-1 h-5 w-5 shrink-0 text-white/45 transition-transform duration-200 group-hover:text-white/70",
                        sceneSwitcherExpanded && "rotate-180"
                      )}
                      aria-hidden
                    />
                    <div>
                      <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-white/45">Scene switcher</p>
                      <h2 className="mt-1 text-lg font-semibold text-white">Search scenes</h2>
                    </div>
                  </button>

                  <div className="flex shrink-0 items-center gap-2">
                    <Button
                      variant="outline"
                      size="icon"
                      className="h-9 w-9 rounded-full border-white/10 bg-white/5 text-white hover:bg-white/10"
                      onClick={refreshAll}
                    >
                      <RefreshCw className={cn("h-4 w-4", homeLoading || homesLoading ? "animate-spin" : "")} />
                    </Button>
                    <Link
                      href="/setup"
                      className="inline-flex h-9 items-center justify-center rounded-full bg-mango px-3 text-sm font-medium text-background transition-colors hover:bg-mango/90"
                    >
                      <Plus className="mr-1.5 h-4 w-4" />
                      New
                    </Link>
                  </div>
                </div>

                {sceneSwitcherExpanded ? (
                  <div id="scene-switcher-panel" role="region" aria-labelledby="scene-switcher-heading">
                    <div className="relative mt-4">
                      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/34" />
                      <Input
                        value={historyQuery}
                        onChange={(event) => setHistoryQuery(event.target.value)}
                        placeholder="Search scenes"
                        className="rounded-2xl border-white/10 bg-white/5 pl-10 text-white placeholder:text-white/30"
                      />
                    </div>

                    <div className="mt-3 max-h-[260px] space-y-2 overflow-y-auto pr-1">
                      {filteredHomes.length > 0 ? (
                        filteredHomes.map((home) => {
                          const isSelected = home.home_id === activeHome?.home_id

                          return (
                            <button
                              key={home.home_id}
                              type="button"
                              onClick={() => selectHome(home.home_id)}
                              className={cn(
                                "w-full rounded-2xl border px-4 py-3 text-left transition-colors",
                                isSelected
                                  ? "border-mango/30 bg-mango/10 text-white"
                                  : "border-white/10 bg-white/5 text-white/90 hover:bg-white/8"
                              )}
                            >
                              <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0">
                                  <p className="truncate font-medium">{home.name}</p>
                                  <p className="mt-1 font-mono text-[11px] text-white/42">{home.home_id}</p>
                                </div>
                                <Badge className={cn("border shrink-0 font-medium", getStatusClasses(home.status))}>
                                  {getStatusLabel(home.status)}
                                </Badge>
                              </div>

                              <div className="mt-2 flex items-center justify-between text-xs text-white/46">
                                <span>{home.num_objects} objects</span>
                                <span>{formatDateTime(home.created_at)}</span>
                              </div>
                            </button>
                          )
                        })
                      ) : (
                        <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-5 text-sm text-white/50">
                          No scenes match this filter.
                        </div>
                      )}
                    </div>
                  </div>
                ) : null}
              </div>

              {activeHome?.status === "ready" ? (
                <>
                  <SceneObjectInspector
                    focusedObject={focusedObject}
                    selectedObjects={selectedObjects}
                    pinnedObjectIds={pinnedObjectIds}
                    displayMode={displayMode}
                    onClearSelection={clearSelection}
                    onToggleIsolate={toggleIsolate}
                    onTogglePin={togglePin}
                    onHideObject={hideObject}
                    onHideLabel={toggleLabelVisibility}
                  />

                  <SceneObjectBrowser
                    objects={visibleObjects}
                    query={objectQuery}
                    selectedObjectIds={selectedObjectIds}
                    focusedObjectId={focusedObjectId}
                    pinnedObjectIds={pinnedObjectIds}
                    hiddenLabels={hiddenLabels}
                    hiddenObjectIds={hiddenObjectIds}
                    onQueryChange={setObjectQuery}
                    onSelectObject={activateObject}
                    onSelectLabel={selectLabelGroup}
                    onHoverObject={setHoveredObjectId}
                    onTogglePin={togglePin}
                    onHideObject={hideObject}
                    onToggleLabelVisibility={toggleLabelVisibility}
                    onResetVisibility={resetVisibility}
                    listClassName="max-h-[280px] sm:max-h-[340px]"
                  />
                </>
              ) : null}
            </aside>
          </div>
        </>
      ) : null}

      {showSceneControls ? (
        <div
          className={cn(
            "pointer-events-none absolute bottom-4 z-30 flex justify-center px-3 sm:bottom-5",
            showSideRail
              ? "left-0 right-0 sm:left-[calc(1.25rem+244px+0.75rem)] sm:right-[calc(452px+1.25rem)]"
              : "left-1/2 w-[min(980px,calc(100%-1.5rem))] -translate-x-1/2 sm:w-[min(980px,calc(100%-3rem))]"
          )}
        >
          <div className="pointer-events-auto flex w-full max-w-[980px] flex-wrap items-center justify-center gap-2 rounded-[24px] border border-white/10 bg-black/42 px-3 py-3 backdrop-blur-2xl">
            <Button
              variant="outline"
              className="rounded-full border-white/10 bg-white/5 text-white hover:bg-white/10"
              onClick={() => navigateRelative(-1, "all")}
            >
              <ChevronLeft className="mr-2 h-4 w-4" />
              Previous
            </Button>
            <Button
              variant="outline"
              className="rounded-full border-white/10 bg-white/5 text-white hover:bg-white/10"
              onClick={() => navigateRelative(1, "all")}
            >
              Next
              <ChevronRight className="ml-2 h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              className="rounded-full border-white/10 bg-white/5 text-white hover:bg-white/10"
              onClick={() => navigateRelative(1, "class")}
              disabled={!focusedObject}
            >
              Next in class
            </Button>
            <Button
              variant="outline"
              className="rounded-full border-white/10 bg-white/5 text-white hover:bg-white/10"
              onClick={() => createCameraCommand("reset")}
            >
              Reset view
            </Button>
            <Button
              variant="outline"
              className="rounded-full border-white/10 bg-white/5 text-white hover:bg-white/10"
              onClick={() => createCameraCommand("top")}
            >
              Top view
            </Button>
            <Button
              variant="outline"
              className="rounded-full border-white/10 bg-white/5 text-white hover:bg-white/10"
              onClick={() => createCameraCommand("overview")}
            >
              Overview
            </Button>
            <Button
              variant="outline"
              className="rounded-full border-white/10 bg-white/5 text-white hover:bg-white/10"
              onClick={() => createCameraCommand("focus")}
              disabled={!focusedObject}
            >
              Focus selected
            </Button>
          </div>
        </div>
      ) : null}

      {homeError ? (
        <div className="absolute inset-0 z-20 flex items-center justify-center p-4 pb-28 sm:pb-4">
          <StageStateCard title="Scene failed to load" description={homeError} tone="error" />
        </div>
      ) : null}

      {!homeError && activeHome?.status === "processing" ? (
        <div className="absolute inset-0 z-20 flex items-center justify-center p-4 pb-28 sm:pb-4">
          <StageStateCard
            title="Scene is still processing"
            description="Setup is still building the annotated GLB and object anchors for this walkthrough."
            loading
          />
        </div>
      ) : null}

      {!homeError && activeHome?.status === "failed" ? (
        <div className="absolute inset-0 z-20 flex items-center justify-center p-4 pb-28 sm:pb-4">
          <StageStateCard
            title="Scene build failed"
            description={selectedHome?.error ?? "The backend returned a failed status for this run."}
            tone="error"
          />
        </div>
      ) : null}
    </main>
  )
}
