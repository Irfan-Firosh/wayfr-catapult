"use client"

import { useCallback, useMemo, useState } from "react"
import {
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  Layers,
  MapPin,
  Sparkles,
} from "lucide-react"

import {
  HomeSceneViewer,
  type CameraCommand,
  type ObjectItem,
  type PersonaAmbientAnnotation,
} from "@/components/scene/HomeSceneViewer"
import { cn } from "@/lib/utils"
import type { AnnotationPlan, AnnotationPriority, PersonaAnnotation } from "@/lib/persona-types"

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000"

const PRIORITY_ORDER: Record<AnnotationPriority, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
}

const PRIORITY_COLORS: Record<AnnotationPriority, string> = {
  critical: "#EF4444",
  high: "#F97316",
  medium: "#F5A623",
  low: "#6B7280",
}

// ── Clustering helpers ────────────────────────────────────────────────────────

/** Flat 2D distance between two objects (XZ plane). */
function dist2D(a: ObjectItem, b: ObjectItem): number {
  const dx = a.x - b.x
  const dz = a.z - b.z
  return Math.sqrt(dx * dx + dz * dz)
}

/** Scene diameter in the XZ plane — used to derive an adaptive merge threshold. */
function sceneDiameter(objects: ObjectItem[]): number {
  if (objects.length < 2) return 6
  const xs = objects.map((o) => o.x)
  const zs = objects.map((o) => o.z)
  return Math.max(
    Math.max(...xs) - Math.min(...xs),
    Math.max(...zs) - Math.min(...zs),
    1
  )
}

/** Pluralize the last word of a label ("Emergency Exit" → "Emergency Exits"). */
function pluralizeLabel(label: string): string {
  // Already looks plural (ends in s, excluding "glass", "grass" edge-cases via length check)
  if (/s$/i.test(label) && label.length > 3) return label

  const words = label.trim().split(/\s+/)
  const last = words[words.length - 1]
  const key = last.toLowerCase()

  const irregular: Record<string, string> = {
    person: "people",
    bench: "benches",
    shelf: "shelves",
    knife: "knives",
    leaf: "leaves",
    foot: "feet",
    tooth: "teeth",
    mouse: "mice",
    child: "children",
  }

  if (irregular[key]) {
    words[words.length - 1] = irregular[key]
  } else if (/(sh|ch|[sxz])$/i.test(last)) {
    words[words.length - 1] = last + "es"
  } else if (/[^aeiou]y$/i.test(last)) {
    words[words.length - 1] = last.slice(0, -1) + "ies"
  } else {
    words[words.length - 1] = last + "s"
  }

  return words.join(" ")
}

type ClusterResult = {
  annotations: PersonaAnnotation[]
  syntheticObjects: ObjectItem[]
}

/**
 * Greedy single-linkage clustering: same originalLabel objects that are all
 * within `threshold` metres of at least one cluster neighbour get merged into
 * one annotation at their centroid.
 */
function clusterAnnotations(
  annotations: PersonaAnnotation[],
  objectMap: Map<string, ObjectItem>,
  threshold: number
): ClusterResult {
  // Group by originalLabel (case-insensitive)
  const byLabel = new Map<string, PersonaAnnotation[]>()
  for (const ann of annotations) {
    const key = ann.originalLabel.toLowerCase()
    const existing = byLabel.get(key) ?? []
    existing.push(ann)
    byLabel.set(key, existing)
  }

  const merged: PersonaAnnotation[] = []
  const syntheticObjects: ObjectItem[] = []

  for (const group of byLabel.values()) {
    if (group.length === 1) {
      merged.push(group[0])
      continue
    }

    // Resolve to actual objects (skip if object not found)
    const resolved = group
      .map((ann) => ({ ann, obj: objectMap.get(ann.objectId) }))
      .filter((item): item is { ann: PersonaAnnotation; obj: ObjectItem } => !!item.obj)

    if (resolved.length === 0) {
      merged.push(...group)
      continue
    }

    // Build clusters via greedy expansion
    const assigned = new Set<number>()
    const clusters: Array<typeof resolved> = []

    for (let i = 0; i < resolved.length; i++) {
      if (assigned.has(i)) continue
      const cluster = [resolved[i]]
      assigned.add(i)

      for (let j = i + 1; j < resolved.length; j++) {
        if (assigned.has(j)) continue
        const near = cluster.some((c) => dist2D(c.obj, resolved[j].obj) <= threshold)
        if (near) {
          cluster.push(resolved[j])
          assigned.add(j)
        }
      }

      clusters.push(cluster)
    }

    for (const cluster of clusters) {
      if (cluster.length === 1) {
        merged.push(cluster[0].ann)
        continue
      }

      // Centroid
      const cx = cluster.reduce((s, c) => s + c.obj.x, 0) / cluster.length
      const cy = cluster.reduce((s, c) => s + c.obj.y, 0) / cluster.length
      const cz = cluster.reduce((s, c) => s + c.obj.z, 0) / cluster.length

      // Encompassing bbox (fallback to ±0.4 when bbox absent)
      const bboxMin: [number, number, number] = [
        Math.min(...cluster.map((c) => c.obj.bbox_min?.[0] ?? c.obj.x - 0.4)),
        Math.min(...cluster.map((c) => c.obj.bbox_min?.[1] ?? c.obj.y - 0.4)),
        Math.min(...cluster.map((c) => c.obj.bbox_min?.[2] ?? c.obj.z - 0.4)),
      ]
      const bboxMax: [number, number, number] = [
        Math.max(...cluster.map((c) => c.obj.bbox_max?.[0] ?? c.obj.x + 0.4)),
        Math.max(...cluster.map((c) => c.obj.bbox_max?.[1] ?? c.obj.y + 0.4)),
        Math.max(...cluster.map((c) => c.obj.bbox_max?.[2] ?? c.obj.z + 0.4)),
      ]

      // Pick the highest-priority annotation as the template
      const best = cluster[0].ann
      const syntheticId = `cluster:${best.originalLabel}:${cx.toFixed(2)},${cz.toFixed(2)}`

      const syntheticObj: ObjectItem = {
        id: syntheticId,
        label: best.originalLabel,
        x: cx,
        y: cy,
        z: cz,
        confidence: null,
        n_observations: cluster.reduce((s, c) => s + c.obj.n_observations, 0),
        bbox_min: bboxMin,
        bbox_max: bboxMax,
      }
      syntheticObjects.push(syntheticObj)

      merged.push({
        ...best,
        objectId: syntheticId,
        personaLabel: pluralizeLabel(best.personaLabel),
      })
    }
  }

  // Re-sort by priority
  merged.sort((a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority])

  return { annotations: merged, syntheticObjects }
}

// ── Annotation picker row ─────────────────────────────────────────────────────

function AnnotationRow({
  annotation,
  isActive,
  isHovered,
  onClick,
  onHoverEnter,
  onHoverLeave,
}: {
  annotation: PersonaAnnotation
  isActive: boolean
  isHovered: boolean
  onClick: () => void
  onHoverEnter: () => void
  onHoverLeave: () => void
}) {
  const accent = annotation.color

  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={onHoverEnter}
      onMouseLeave={onHoverLeave}
      className="group flex w-full items-center gap-2.5 px-3 py-2 text-left transition-colors"
      style={{
        backgroundColor: isActive
          ? `${accent}22`
          : isHovered
            ? `${accent}10`
            : undefined,
      }}
    >
      {/* Indicator dot */}
      <div className="relative shrink-0">
        <span
          className="block h-1.5 w-1.5 rounded-full transition-transform"
          style={{ backgroundColor: accent }}
        />
        {isActive && (
          <span
            className="absolute -inset-[3px] rounded-full border opacity-70"
            style={{ borderColor: accent }}
          />
        )}
      </div>

      {/* Label */}
      <span
        className="flex-1 truncate text-[11px] font-medium leading-tight transition-colors"
        style={{ color: isActive ? accent : isHovered ? "rgba(255,255,255,0.88)" : "rgba(255,255,255,0.72)" }}
      >
        {annotation.personaLabel}
        {annotation.isNew && (
          <span className="ml-1 text-[9px] text-mango/80">✦</span>
        )}
      </span>

      {/* Priority letter */}
      <span
        className="shrink-0 text-[9px] font-bold uppercase tracking-wider opacity-60"
        style={{ color: PRIORITY_COLORS[annotation.priority] }}
      >
        {annotation.priority[0].toUpperCase()}
      </span>

      {isActive && (
        <MapPin className="h-2.5 w-2.5 shrink-0 opacity-60" style={{ color: accent }} />
      )}
    </button>
  )
}

// ── Floating annotation picker ────────────────────────────────────────────────

function AnnotationPicker({
  annotations,
  focusedObjectId,
  hoveredObjectId,
  onChipClick,
  onChipHoverEnter,
  onChipHoverLeave,
}: {
  annotations: PersonaAnnotation[]
  focusedObjectId: string | null
  hoveredObjectId: string | null
  onChipClick: (ann: PersonaAnnotation) => void
  onChipHoverEnter: (ann: PersonaAnnotation) => void
  onChipHoverLeave: () => void
}) {
  const [collapsed, setCollapsed] = useState(false)
  const [showAll, setShowAll] = useState(false)

  const criticalCount = annotations.filter((a) => a.priority === "critical").length
  const highCount = annotations.filter((a) => a.priority === "high").length
  const VISIBLE_COUNT = 7
  const visible = showAll ? annotations : annotations.slice(0, VISIBLE_COUNT)
  const hasMore = annotations.length > VISIBLE_COUNT

  return (
    <div className="w-60 overflow-hidden rounded-2xl border border-white/10 bg-black/65 shadow-2xl backdrop-blur-2xl">
      {/* Header */}
      <button
        type="button"
        onClick={() => setCollapsed((c) => !c)}
        className="flex w-full items-center justify-between px-3 py-2.5 transition-colors hover:bg-white/5"
      >
        <div className="flex items-center gap-2">
          <Layers className="h-3 w-3 text-mango/80" />
          <span className="text-[11px] font-semibold text-white/90">Annotations</span>
          {criticalCount > 0 && (
            <span className="flex items-center gap-0.5 rounded-full bg-red-500/20 px-1.5 py-0.5 text-[8px] font-bold text-red-400">
              <AlertTriangle className="h-2 w-2" />
              {criticalCount}
            </span>
          )}
          {highCount > 0 && criticalCount === 0 && (
            <span className="rounded-full bg-orange-500/15 px-1.5 py-0.5 text-[8px] font-bold text-orange-400">
              {highCount} high
            </span>
          )}
        </div>
        {collapsed
          ? <ChevronDown className="h-3.5 w-3.5 text-white/30" />
          : <ChevronUp className="h-3.5 w-3.5 text-white/30" />
        }
      </button>

      {!collapsed && (
        <div className="border-t border-white/8">
          <div className="max-h-[52vh] overflow-y-auto scrollbar-none">
            {visible.map((ann, i) => (
              <AnnotationRow
                key={`${ann.objectId}-${i}`}
                annotation={ann}
                isActive={focusedObjectId === ann.objectId}
                isHovered={hoveredObjectId === ann.objectId && focusedObjectId !== ann.objectId}
                onClick={() => onChipClick(ann)}
                onHoverEnter={() => onChipHoverEnter(ann)}
                onHoverLeave={onChipHoverLeave}
              />
            ))}
          </div>
          {hasMore && (
            <button
              type="button"
              onClick={() => setShowAll((s) => !s)}
              className="flex w-full items-center justify-center gap-1 border-t border-white/8 py-2 text-[10px] text-white/35 transition-colors hover:text-white/65"
            >
              {showAll
                ? <><ChevronUp className="h-2.5 w-2.5" /> Show less</>
                : <><ChevronDown className="h-2.5 w-2.5" /> {annotations.length - VISIBLE_COUNT} more</>
              }
            </button>
          )}
        </div>
      )}
    </div>
  )
}

// ── Main scene card ───────────────────────────────────────────────────────────

interface PersonaSceneCardProps {
  homeId: string
  homeName: string
  plan: AnnotationPlan
  objects: ObjectItem[]
}

export function PersonaSceneCard({ homeId, homeName, plan, objects }: PersonaSceneCardProps) {
  const [focusedObjectId, setFocusedObjectId] = useState<string | null>(null)
  const [hoveredObjectId, setHoveredObjectId] = useState<string | null>(null)
  const [cameraCommand, setCameraCommand] = useState<CameraCommand | null>(null)

  // Base object map from real scene objects (used for pre-cluster lookups)
  const baseObjectMap = useMemo(() => {
    const map = new Map<string, ObjectItem>()
    for (const obj of objects) map.set(obj.id, obj)
    return map
  }, [objects])

  // All non-low annotations sorted by priority
  const priorityAnnotations = useMemo(
    () =>
      plan.annotations
        .filter((a) => a.priority !== "low")
        .sort((a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority]),
    [plan.annotations]
  )

  // Cluster nearby same-label annotations → merged list + synthetic centroid objects
  const { annotations: mergedAnnotations, syntheticObjects } = useMemo(() => {
    const diameter = sceneDiameter(objects)
    const threshold = diameter * 0.14
    return clusterAnnotations(priorityAnnotations, baseObjectMap, threshold)
  }, [priorityAnnotations, baseObjectMap, objects])

  // Combined objects (real + synthetic cluster centroids) passed to the viewer
  const viewerObjects = useMemo(
    () => [...objects, ...syntheticObjects],
    [objects, syntheticObjects]
  )

  // Full object map including synthetics (used for selection/hover lookups)
  const objectMap = useMemo(() => {
    const map = new Map<string, ObjectItem>()
    for (const obj of viewerObjects) map.set(obj.id, obj)
    return map
  }, [viewerObjects])

  // Critical + high objects get selection auras
  const selectedObjectIds = useMemo(
    () =>
      [
        ...new Set(
          mergedAnnotations
            .filter((a) => a.priority === "critical" || a.priority === "high")
            .map((a) => a.objectId)
            .filter((id) => objectMap.has(id))
        ),
      ],
    [mergedAnnotations, objectMap]
  )

  // labelMap: objectId → personaLabel for FocusCallout
  const labelMap = useMemo(() => {
    const map: Record<string, string> = {}
    for (const ann of mergedAnnotations) {
      if (!map[ann.objectId]) map[ann.objectId] = ann.personaLabel
    }
    return map
  }, [mergedAnnotations])

  // Ambient floating callouts for selected objects only
  const personaAmbientAnnotations = useMemo<PersonaAmbientAnnotation[]>(() => {
    const seen = new Set<string>()
    const result: PersonaAmbientAnnotation[] = []
    for (const ann of mergedAnnotations) {
      if (
        (ann.priority === "critical" || ann.priority === "high") &&
        objectMap.has(ann.objectId) &&
        !seen.has(ann.objectId)
      ) {
        seen.add(ann.objectId)
        result.push({ objectId: ann.objectId, label: ann.personaLabel, color: ann.color })
      }
    }
    return result
  }, [mergedAnnotations, objectMap])

  // ── Interactions ─────────────────────────────────────────────────────────

  const handleChipClick = useCallback(
    (annotation: PersonaAnnotation) => {
      const same = focusedObjectId === annotation.objectId
      const next = same ? null : annotation.objectId
      setFocusedObjectId(next)
      if (next) setCameraCommand({ preset: "focus", nonce: Date.now() })
    },
    [focusedObjectId]
  )

  const handleChipHoverEnter = useCallback((annotation: PersonaAnnotation) => {
    setHoveredObjectId(annotation.objectId)
  }, [])

  const handleChipHoverLeave = useCallback(() => {
    setHoveredObjectId(null)
  }, [])

  const handleObjectActivate = useCallback(
    (objectId: string) => {
      const same = focusedObjectId === objectId
      setFocusedObjectId(same ? null : objectId)
      if (!same) setCameraCommand({ preset: "focus", nonce: Date.now() })
    },
    [focusedObjectId]
  )

  const handleObjectHover = useCallback((id: string | null) => {
    setHoveredObjectId(id)
  }, [])

  const handleOverview = useCallback(() => {
    setFocusedObjectId(null)
    setCameraCommand({ preset: "overview", nonce: Date.now() })
  }, [])

  const derivedCount = mergedAnnotations.filter((a) => a.isNew).length

  return (
    <div className="relative h-full w-full overflow-hidden bg-[#07080d]">

      {/* ── 3D scene fills everything ── */}
      <div className="absolute inset-0">
        <HomeSceneViewer
          homeId={homeId}
          glbUrl={`${API_URL}/api/homes/${homeId}/scene`}
          objects={viewerObjects}
          mode="annotator"
          selectedObjectIds={selectedObjectIds}
          focusedObjectId={focusedObjectId}
          hoveredObjectId={hoveredObjectId}
          displayMode="normal"
          colorMode="natural"
          cameraCommand={cameraCommand}
          onObjectActivate={handleObjectActivate}
          onObjectHover={handleObjectHover}
          labelMap={labelMap}
          personaAmbientAnnotations={personaAmbientAnnotations}
          showSceneBadge={false}
          height="100%"
          className="h-full w-full"
        />
      </div>

      {/* ── Top-left: identity badge ── */}
      <div className="pointer-events-none absolute left-4 top-4 z-10">
        <div className="pointer-events-auto flex items-center gap-2 rounded-full border border-white/10 bg-black/55 px-3 py-1.5 shadow-lg backdrop-blur-2xl">
          <Layers className="h-3 w-3 shrink-0 text-mango" />
          <span className="text-[11px] font-semibold text-white/90">{homeName}</span>
          <span className="text-[10px] text-white/40">·</span>
          <span className="text-[10px] text-white/55">{plan.personaRole}</span>
          {derivedCount > 0 && (
            <>
              <span className="text-[10px] text-white/30">·</span>
              <span className="flex items-center gap-0.5 text-[9px] text-mango/70">
                <Sparkles className="h-2 w-2" />
                {derivedCount} custom
              </span>
            </>
          )}
        </div>
      </div>

      {/* ── Top-right: annotation picker ── */}
      <div className="pointer-events-none absolute right-4 top-4 z-10">
        <div className="pointer-events-auto">
          <AnnotationPicker
            annotations={mergedAnnotations}
            focusedObjectId={focusedObjectId}
            hoveredObjectId={hoveredObjectId}
            onChipClick={handleChipClick}
            onChipHoverEnter={handleChipHoverEnter}
            onChipHoverLeave={handleChipHoverLeave}
          />
        </div>
      </div>

      {/* ── Bottom-left: plan summary ── */}
      <div className="pointer-events-none absolute bottom-20 left-4 z-10 max-w-[340px]">
        <div className="rounded-xl border border-white/8 bg-black/50 px-3 py-1.5 backdrop-blur-xl">
          <p className="text-[10px] leading-relaxed text-white/55">{plan.summary}</p>
        </div>
      </div>

      {/* ── Bottom-right: overview button when an object is focused ── */}
      <div
        className={cn(
          "pointer-events-none absolute bottom-20 right-4 z-10 transition-all duration-200",
          focusedObjectId ? "opacity-100 translate-y-0" : "pointer-events-none opacity-0 translate-y-1"
        )}
      >
        <button
          type="button"
          onClick={handleOverview}
          className="pointer-events-auto flex items-center gap-1.5 rounded-full border border-white/15 bg-black/55 px-3 py-1.5 text-[10px] font-medium text-white/65 backdrop-blur-xl transition-colors hover:border-white/30 hover:text-white/90"
        >
          Overview
        </button>
      </div>
    </div>
  )
}
