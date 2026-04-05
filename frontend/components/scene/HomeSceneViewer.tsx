"use client"

import { useState, useCallback, useMemo, useRef, useEffect, Suspense } from "react"
import dynamic from "next/dynamic"

export type ObjectItem = {
  id: string
  label: string
  x: number
  y: number
  z: number
  confidence: number | null
  n_observations: number
  bbox_min?: number[] | null
  bbox_max?: number[] | null
}

export interface HomeSceneViewerProps {
  glbUrl: string
  objects: ObjectItem[]
  path?: { x: number; z: number }[]
  currentStepIndex?: number
  targetLabel?: string
  height?: number
  className?: string
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

export function HomeSceneViewer({
  glbUrl,
  objects,
  path,
  currentStepIndex,
  targetLabel,
  height = 400,
  className,
}: HomeSceneViewerProps) {
  const [pointCount, setPointCount] = useState(0)
  const [glbFailed, setGlbFailed] = useState(false)

  const navActive = !!path && path.length > 0

  return (
    <div
      className={className}
      style={{ width: "100%", height, position: "relative", borderRadius: 8, overflow: "hidden" }}
    >
      <Scene
        glbUrl={glbUrl}
        objects={objects}
        path={path}
        currentStepIndex={currentStepIndex ?? 0}
        targetLabel={targetLabel}
        onPointCount={setPointCount}
        onGlbError={() => setGlbFailed(true)}
      />

      {/* HUD overlay */}
      <div
        style={{
          position: "absolute",
          bottom: 8,
          left: 12,
          fontFamily: "monospace",
          fontSize: 10,
          color: "#F5A62380",
          pointerEvents: "none",
          lineHeight: 1.6,
        }}
      >
        <div>
          {pointCount > 0
            ? `${pointCount.toLocaleString()} pts`
            : glbFailed
              ? "synthetic view"
              : "loading..."}
          {" · "}
          {objects.length} objects
          {navActive ? " · navigating" : " · drag to orbit"}
        </div>
      </div>
      <div
        style={{
          position: "absolute",
          top: 8,
          right: 12,
          fontFamily: "monospace",
          fontSize: 10,
          color: "#F5A62350",
          pointerEvents: "none",
        }}
      >
        {navActive ? "NAVIGATION" : "3D SCENE"}
      </div>
    </div>
  )
}
