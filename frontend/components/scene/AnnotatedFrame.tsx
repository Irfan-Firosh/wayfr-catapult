"use client"

import { useEffect, useRef } from "react"

export type Annotation = {
  label: string
  bbox: [number, number, number, number] // [x1, y1, x2, y2] in 0–640 x 0–480 space
  confidence: number
  urgency: "high" | "medium" | "low"
}

interface AnnotatedFrameProps {
  annotations?: Annotation[]
  viewLabel?: string
}

const URGENCY_COLOR: Record<Annotation["urgency"], string> = {
  high: "#ef4444",
  medium: "#F5A623",
  low: "#22c55e",
}

export function AnnotatedFrame({ annotations = [], viewLabel = "current" }: AnnotatedFrameProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext("2d")
    if (!ctx) return

    const W = canvas.width
    const H = canvas.height

    // Scale factor from 640×480 coordinate space to canvas
    const sx = W / 640
    const sy = H / 480

    ctx.clearRect(0, 0, W, H)

    // Dark scene background (simulates 3D-rendered synthetic view)
    const bg = ctx.createLinearGradient(0, 0, 0, H)
    bg.addColorStop(0, "#0f0f18")
    bg.addColorStop(1, "#1a1a2e")
    ctx.fillStyle = bg
    ctx.fillRect(0, 0, W, H)

    // Draw simulated scene structure lines (ground plane perspective)
    ctx.strokeStyle = "rgba(255,255,255,0.05)"
    ctx.lineWidth = 1
    const vanishX = W / 2
    const vanishY = H * 0.42
    for (let i = -8; i <= 8; i++) {
      ctx.beginPath()
      ctx.moveTo(vanishX, vanishY)
      ctx.lineTo(W * 0.5 + i * W * 0.1, H)
      ctx.stroke()
    }
    // Horizon line
    ctx.beginPath()
    ctx.moveTo(0, vanishY)
    ctx.lineTo(W, vanishY)
    ctx.strokeStyle = "rgba(255,255,255,0.07)"
    ctx.stroke()

    // Draw annotations
    annotations.forEach((ann) => {
      const [x1, y1, x2, y2] = ann.bbox
      const rx = x1 * sx
      const ry = y1 * sy
      const rw = (x2 - x1) * sx
      const rh = (y2 - y1) * sy
      const color = URGENCY_COLOR[ann.urgency]

      // Bounding box
      ctx.strokeStyle = color
      ctx.lineWidth = 2
      ctx.strokeRect(rx, ry, rw, rh)

      // Corner accents
      const corner = 8
      ctx.lineWidth = 3
      ;[
        [rx, ry, corner, 0, 0, corner],
        [rx + rw, ry, -corner, 0, 0, corner],
        [rx, ry + rh, corner, 0, 0, -corner],
        [rx + rw, ry + rh, -corner, 0, 0, -corner],
      ].forEach(([x, y, dx1, dy1, dx2, dy2]) => {
        ctx.beginPath()
        ctx.moveTo(x + dx1, y)
        ctx.lineTo(x, y)
        ctx.lineTo(x, y + dy2)
        ctx.strokeStyle = color
        ctx.stroke()
      })

      // Label background
      const labelText = `${ann.label} ${Math.round(ann.confidence * 100)}%`
      ctx.font = "bold 11px monospace"
      const tw = ctx.measureText(labelText).width
      ctx.fillStyle = color + "cc"
      ctx.fillRect(rx, ry - 18, tw + 8, 18)

      // Label text
      ctx.fillStyle = "#fff"
      ctx.fillText(labelText, rx + 4, ry - 4)
    })

    // View type label (top-left)
    ctx.fillStyle = "rgba(245,166,35,0.7)"
    ctx.font = "10px monospace"
    ctx.fillText(`view: ${viewLabel}`, 8, 16)

    // If no annotations yet
    if (annotations.length === 0) {
      ctx.fillStyle = "rgba(255,255,255,0.15)"
      ctx.font = "13px monospace"
      ctx.textAlign = "center"
      ctx.fillText("awaiting detections...", W / 2, H / 2)
      ctx.textAlign = "left"
    }
  }, [annotations, viewLabel])

  return (
    <canvas
      ref={canvasRef}
      width={320}
      height={240}
      className="w-full rounded-xl"
      style={{ imageRendering: "auto" }}
    />
  )
}
