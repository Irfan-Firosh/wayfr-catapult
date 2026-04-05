"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import dynamic from "next/dynamic"

import { cn } from "@/lib/utils"

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000"

export type ObjectItem = {
  id: string
  label: string
  classLabel?: string
  x: number
  y: number
  z: number
  track_id?: number | null
  confidence: number | null
  n_observations: number
  bbox_min?: number[] | null
  bbox_max?: number[] | null
}

export type SceneDebugOptions = {
  showBBoxes: boolean
  showCentroids: boolean
  showApproxRegion: boolean
  showExactPoints: boolean
}

export type SceneDisplayMode = "normal" | "ghost" | "isolate"
export type SceneColorMode = "natural" | "class" | "instance"
export type CameraPreset = "overview" | "top" | "reset" | "focus"

export type CameraCommand = {
  preset: CameraPreset
  nonce: number
}

export type ExactObjectHighlight = {
  trackId: number
  label: string
  pointCount: number
  sampledPointCount: number
  sampledPoints: [number, number, number][]
}

type ResolvedSceneAsset = {
  url: string
  source: "local" | "remote"
}

export interface HomeSceneViewerProps {
  homeId?: string
  glbUrl: string
  sceneVersion?: string
  objects: ObjectItem[]
  mode?: "default" | "annotator"
  path?: { x: number; z: number }[]
  currentStepIndex?: number
  targetLabel?: string
  height?: number | string
  className?: string
  focusedObjectId?: string | null
  selectedObjectIds?: string[]
  hoveredObjectId?: string | null
  displayMode?: SceneDisplayMode
  colorMode?: SceneColorMode
  cameraCommand?: CameraCommand | null
  onObjectActivate?: (objectId: string, options?: { additive?: boolean }) => void
  onObjectHover?: (objectId: string | null) => void
  debugOptions?: Partial<SceneDebugOptions>
  onVertexCountChange?: (count: number) => void
  showSceneBadge?: boolean
  exactSelectionHighlight?: boolean
}

const sceneAssetCache = new Map<string, Promise<ResolvedSceneAsset>>()
const sceneObjectUrlCache = new Map<string, ResolvedSceneAsset>()
const LOCAL_SCENE_BROWSER_CACHE = "wayfr-local-scenes-v1"
const DEFAULT_DEBUG_OPTIONS: SceneDebugOptions = {
  showBBoxes: false,
  showCentroids: false,
  showApproxRegion: false,
  showExactPoints: false,
}

const Scene = dynamic(() => import("./HomeSceneInner").then((m) => m.HomeSceneInner), {
  ssr: false,
  loading: () => (
    <div
      style={{
        width: "100%",
        height: "100%",
        background: "#030408",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        borderRadius: 8,
      }}
    >
      <span style={{ fontFamily: "monospace", fontSize: 12, color: "#F5A62360" }}>
        Loading 3D scene...
      </span>
    </div>
  ),
})

function buildSceneCacheKey(homeId: string | undefined, glbUrl: string, sceneVersion?: string) {
  if (!homeId) return `${glbUrl}:${sceneVersion ?? "latest"}`
  return `${homeId}:${sceneVersion ?? "latest"}`
}

function buildVersionSuffix(sceneVersion?: string) {
  if (!sceneVersion) return ""
  return `?v=${encodeURIComponent(sceneVersion)}`
}

async function readLocalSceneAsObjectUrl(url: string) {
  if (typeof window === "undefined") {
    throw new Error("Browser cache unavailable on server.")
  }

  const cache = "caches" in window ? await window.caches.open(LOCAL_SCENE_BROWSER_CACHE) : null
  let response = cache ? await cache.match(url) : undefined

  if (!response) {
    response = await fetch(url, { cache: "force-cache" })
    if (!response.ok) {
      throw new Error(`Failed to read local scene (${response.status})`)
    }
    await cache?.put(url, response.clone())
  }

  const blob = await response.blob()
  return URL.createObjectURL(blob)
}

async function resolveSceneAsset(homeId: string | undefined, glbUrl: string, sceneVersion?: string) {
  const cacheKey = buildSceneCacheKey(homeId, glbUrl, sceneVersion)
  const cachedAsset = sceneObjectUrlCache.get(cacheKey)
  if (cachedAsset) return cachedAsset

  const inFlight = sceneAssetCache.get(cacheKey)
  if (inFlight) return inFlight

  const promise = (async () => {
    const versionSuffix = buildVersionSuffix(sceneVersion)
    const localUrl = homeId ? `/api/local-scenes/${homeId}${versionSuffix}` : null

    if (localUrl) {
      try {
        const objectUrl = await readLocalSceneAsObjectUrl(localUrl)
        const asset = { url: objectUrl, source: "local" as const }
        sceneObjectUrlCache.set(cacheKey, asset)
        return asset
      } catch {
        // Fall back to the backend scene URL when the local file is unavailable.
      }
    }

    const response = await fetch(glbUrl, { cache: "force-cache" })
    if (!response.ok) {
      throw new Error(`Failed to load remote scene (${response.status})`)
    }

    const blob = await response.blob()
    const asset = { url: URL.createObjectURL(blob), source: "remote" as const }
    sceneObjectUrlCache.set(cacheKey, asset)
    return asset
  })()

  sceneAssetCache.set(cacheKey, promise)

  try {
    return await promise
  } finally {
    sceneAssetCache.delete(cacheKey)
  }
}

export function HomeSceneViewer({
  homeId,
  glbUrl,
  sceneVersion,
  objects,
  mode = "default",
  path,
  currentStepIndex,
  targetLabel,
  height = 400,
  className,
  focusedObjectId = null,
  selectedObjectIds = [],
  hoveredObjectId = null,
  displayMode = "normal",
  colorMode = "natural",
  cameraCommand = null,
  onObjectActivate,
  onObjectHover,
  debugOptions,
  onVertexCountChange,
  showSceneBadge = true,
  exactSelectionHighlight = false,
}: HomeSceneViewerProps) {
  const mergedDebugOptions = useMemo(() => ({ ...DEFAULT_DEBUG_OPTIONS, ...debugOptions }), [debugOptions])
  const sceneKey = useMemo(
    () => buildSceneCacheKey(homeId, glbUrl, sceneVersion),
    [glbUrl, homeId, sceneVersion]
  )
  const [sceneState, setSceneState] = useState<{
    key: string
    asset: ResolvedSceneAsset | null
    failed: boolean
  }>({
    key: sceneKey,
    asset: null,
    failed: false,
  })
  const [vertexState, setVertexState] = useState({
    key: sceneKey,
    count: 0,
  })
  const [exactHighlightState, setExactHighlightState] = useState<{
    key: string
    data: ExactObjectHighlight | null
    unavailable: boolean
  }>({
    key: "",
    data: null,
    unavailable: false,
  })

  const navActive = !!path && path.length > 0
  const resolvedScene = sceneState.key === sceneKey ? sceneState.asset : null
  const glbFailed = sceneState.key === sceneKey ? sceneState.failed : false
  const vertexCount = vertexState.key === sceneKey ? vertexState.count : 0
  const focusedObject = useMemo(
    () => objects.find((object) => object.id === focusedObjectId) ?? null,
    [focusedObjectId, objects]
  )

  const handlePointCount = useCallback(
    (count: number) => {
      setVertexState((current) => {
        if (current.key === sceneKey && current.count === count) {
          return current
        }
        return { key: sceneKey, count }
      })
    },
    [sceneKey]
  )

  const handleGlbError = useCallback(() => {
    setSceneState((current) => {
      if (current.key !== sceneKey || current.failed) return current
      return { ...current, failed: true }
    })
  }, [sceneKey])

  useEffect(() => {
    let cancelled = false

    void resolveSceneAsset(homeId, glbUrl, sceneVersion)
      .then((asset) => {
        if (!cancelled) {
          setSceneState({
            key: sceneKey,
            asset,
            failed: false,
          })
          setVertexState((current) => (current.key === sceneKey ? current : { key: sceneKey, count: 0 }))
        }
      })
      .catch(() => {
        if (!cancelled) {
          setSceneState({
            key: sceneKey,
            asset: null,
            failed: true,
          })
          setVertexState((current) => (current.key === sceneKey ? current : { key: sceneKey, count: 0 }))
        }
      })

    return () => {
      cancelled = true
    }
  }, [glbUrl, homeId, sceneKey, sceneVersion])

  useEffect(() => {
    const trackId = focusedObject?.track_id
    const highlightKey = homeId && trackId != null ? `${sceneKey}:${trackId}` : ""
    const shouldLoadExactHighlight =
      (mode === "annotator" && mergedDebugOptions.showExactPoints) || exactSelectionHighlight

    if (!shouldLoadExactHighlight || !homeId || trackId == null) {
      return
    }

    let cancelled = false
    void fetch(`${API_URL}/api/homes/${homeId}/object-highlights/${trackId}?sample_limit=1024`, {
      cache: "force-cache",
    })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`Failed to load exact highlight (${response.status})`)
        }

        const payload = await response.json()
        const sampledPoints = Array.isArray(payload.sampled_points)
          ? payload.sampled_points
              .map((point: unknown) => {
                if (!Array.isArray(point) || point.length < 3) return null
                return [Number(point[0]), Number(point[1]), Number(point[2])] as [number, number, number]
              })
              .filter((point: [number, number, number] | null): point is [number, number, number] => point !== null)
          : []

        if (!cancelled) {
          setExactHighlightState({
            key: highlightKey,
            unavailable: false,
            data: {
              trackId,
              label: String(payload.label ?? focusedObject?.label ?? ""),
              pointCount: Number(payload.point_count ?? sampledPoints.length),
              sampledPointCount: Number(payload.sampled_point_count ?? sampledPoints.length),
              sampledPoints,
            },
          })
        }
      })
      .catch(() => {
        if (!cancelled) {
          setExactHighlightState({
            key: highlightKey,
            data: null,
            unavailable: true,
          })
        }
      })

    return () => {
      cancelled = true
    }
  }, [
    exactSelectionHighlight,
    focusedObject?.id,
    focusedObject?.label,
    focusedObject?.track_id,
    homeId,
    mergedDebugOptions.showExactPoints,
    mode,
    sceneKey,
  ])

  useEffect(() => {
    onVertexCountChange?.(vertexCount)
  }, [onVertexCountChange, vertexCount])

  const exactHighlight =
    exactHighlightState.key === (homeId && focusedObject?.track_id != null ? `${sceneKey}:${focusedObject.track_id}` : "")
      ? exactHighlightState.data
      : null

  return (
    <div
      className={cn("relative", className)}
      style={{ width: "100%", height, position: "relative", borderRadius: 8, overflow: "hidden" }}
    >
      {resolvedScene?.url ? (
        <Scene
          glbUrl={resolvedScene.url}
          objects={objects}
          mode={mode}
          path={path}
          currentStepIndex={currentStepIndex ?? 0}
          targetLabel={targetLabel}
          focusedObjectId={focusedObjectId}
          selectedObjectIds={selectedObjectIds}
          hoveredObjectId={hoveredObjectId}
          displayMode={displayMode}
          colorMode={colorMode}
          cameraCommand={cameraCommand}
          onObjectActivate={onObjectActivate}
          onObjectHover={onObjectHover}
          debugOptions={mergedDebugOptions}
          exactHighlight={exactHighlight}
          exactSelectionHighlight={exactSelectionHighlight}
          onPointCount={handlePointCount}
          onGlbError={handleGlbError}
        />
      ) : null}

      {showSceneBadge ? (
        <div className="pointer-events-none absolute bottom-3 left-3 z-20 rounded-full border border-white/10 bg-black/45 px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.16em] text-white/72 backdrop-blur-xl">
          {vertexCount > 0 ? `${vertexCount.toLocaleString()} verts` : glbFailed ? "scene unavailable" : "loading room mesh"}
          {" · "}
          {objects.length} visible
          {navActive ? " · navigation" : " · explore"}
        </div>
      ) : null}
    </div>
  )
}
