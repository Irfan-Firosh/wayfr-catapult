"use client"

import { useState, useCallback, Suspense } from "react"
import dynamic from "next/dynamic"

// ── Types ──────────────────────────────────────────────────────────────────

export type Object3D = {
  label: string
  x: number // right (+) / left (-) metres
  y: number // height above ground metres
  z: number // forward distance metres
  urgency: "high" | "medium" | "low"
  confidence?: number
}

interface World3DViewerProps {
  objects?: Object3D[]
  autoOrbit?: boolean
  onObjectClick?: (index: number) => void
}

// Dynamically load the R3F scene to avoid SSR issues
const Scene3D = dynamic(() => import("./Scene3DInner").then((m) => m.Scene3DInner), {
  ssr: false,
  loading: () => (
    <div
      style={{
        width: "100%",
        height: 500,
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

export function World3DViewer({ objects = [], autoOrbit = false, onObjectClick }: World3DViewerProps) {
  return (
    <div style={{ width: "100%", height: 500, position: "relative", borderRadius: 8, overflow: "hidden" }}>
      <Scene3D objects={objects} autoOrbit={autoOrbit} onObjectClick={onObjectClick} />

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
        <div>{objects.filter((o) => o.label !== "waiting\u2026").length} objects &middot; drag to orbit</div>
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
        SPATIAL MAP
      </div>
    </div>
  )
}
