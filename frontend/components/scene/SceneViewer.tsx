"use client"

import { useEffect, useRef } from "react"

export type SceneObject = {
  label: string
  distance_m: number
  direction: "ahead" | "left" | "right"
  urgency: "high" | "medium" | "low"
}

interface SceneViewerProps {
  objects?: SceneObject[]
  pointCount?: number
}

const URGENCY_COLOR: Record<SceneObject["urgency"], string> = {
  high: "#ef4444",
  medium: "#F5A623",
  low: "#22c55e",
}

// Convert direction + distance to canvas (x, y) relative to camera origin
function toCanvasCoords(
  obj: SceneObject,
  cx: number,
  cy: number,
  scale: number
): { x: number; y: number } {
  const angleMap: Record<SceneObject["direction"], number> = {
    ahead: 0,
    left: -35,
    right: 35,
  }
  const angleDeg = angleMap[obj.direction]
  const angleRad = (angleDeg * Math.PI) / 180
  const dx = Math.sin(angleRad) * obj.distance_m * scale
  const dy = -Math.cos(angleRad) * obj.distance_m * scale
  return { x: cx + dx, y: cy + dy }
}

export function SceneViewer({ objects = [], pointCount = 0 }: SceneViewerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const animRef = useRef<number>(0)
  const scanAngleRef = useRef<number>(0)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext("2d")
    if (!ctx) return

    const W = canvas.width
    const H = canvas.height
    const cx = W / 2
    const cy = H * 0.72
    const scale = 38 // px per metre

    function draw() {
      if (!ctx) return
      ctx.clearRect(0, 0, W, H)

      // Background
      ctx.fillStyle = "#0a0a0f"
      ctx.fillRect(0, 0, W, H)

      // Distance rings
      const rings = [1, 2, 3, 5]
      rings.forEach((r) => {
        ctx.beginPath()
        ctx.arc(cx, cy, r * scale, 0, Math.PI * 2)
        ctx.strokeStyle = "rgba(245,166,35,0.12)"
        ctx.lineWidth = 1
        ctx.stroke()

        // Label
        ctx.fillStyle = "rgba(245,166,35,0.35)"
        ctx.font = "9px monospace"
        ctx.fillText(`${r}m`, cx + r * scale + 3, cy - 3)
      })

      // Grid lines (every 1m, ±5m)
      ctx.strokeStyle = "rgba(255,255,255,0.04)"
      ctx.lineWidth = 1
      for (let i = -5; i <= 5; i++) {
        // Vertical
        ctx.beginPath()
        ctx.moveTo(cx + i * scale, 0)
        ctx.lineTo(cx + i * scale, H)
        ctx.stroke()
        // Horizontal
        ctx.beginPath()
        ctx.moveTo(0, cy + i * scale)
        ctx.lineTo(W, cy + i * scale)
        ctx.stroke()
      }

      // Animated scan line (radar sweep)
      scanAngleRef.current = (scanAngleRef.current + 0.015) % (Math.PI * 2)

      // Simple scan arc
      ctx.save()
      ctx.translate(cx, cy)
      ctx.rotate(scanAngleRef.current)
      const sweepGrad = ctx.createLinearGradient(0, -5 * scale, 0, 0)
      sweepGrad.addColorStop(0, "rgba(245,166,35,0.0)")
      sweepGrad.addColorStop(0.7, "rgba(245,166,35,0.06)")
      sweepGrad.addColorStop(1, "rgba(245,166,35,0.18)")
      ctx.beginPath()
      ctx.moveTo(0, 0)
      ctx.arc(0, 0, 5 * scale, -Math.PI / 2 - 0.3, -Math.PI / 2, false)
      ctx.closePath()
      ctx.fillStyle = sweepGrad
      ctx.fill()
      ctx.restore()

      // Scan line
      ctx.save()
      ctx.translate(cx, cy)
      ctx.rotate(scanAngleRef.current)
      ctx.beginPath()
      ctx.moveTo(0, 0)
      ctx.lineTo(0, -5 * scale)
      ctx.strokeStyle = "rgba(245,166,35,0.5)"
      ctx.lineWidth = 1.5
      ctx.stroke()
      ctx.restore()

      // Detected objects
      objects.forEach((obj) => {
        const { x, y } = toCanvasCoords(obj, cx, cy, scale)
        const color = URGENCY_COLOR[obj.urgency]

        // Pulsing glow
        const glow = ctx.createRadialGradient(x, y, 0, x, y, 14)
        glow.addColorStop(0, color + "80")
        glow.addColorStop(1, color + "00")
        ctx.beginPath()
        ctx.arc(x, y, 14, 0, Math.PI * 2)
        ctx.fillStyle = glow
        ctx.fill()

        // Dot
        ctx.beginPath()
        ctx.arc(x, y, 4, 0, Math.PI * 2)
        ctx.fillStyle = color
        ctx.fill()

        // Label
        ctx.fillStyle = "rgba(255,255,255,0.85)"
        ctx.font = "bold 10px monospace"
        ctx.fillText(obj.label, x + 8, y - 6)
        ctx.fillStyle = color
        ctx.font = "9px monospace"
        ctx.fillText(`${obj.distance_m.toFixed(1)}m`, x + 8, y + 5)
      })

      // Camera indicator (triangle pointing up = "ahead")
      ctx.save()
      ctx.translate(cx, cy)
      ctx.fillStyle = "#F5A623"
      ctx.beginPath()
      ctx.moveTo(0, -10)
      ctx.lineTo(-6, 6)
      ctx.lineTo(6, 6)
      ctx.closePath()
      ctx.fill()
      ctx.restore()

      // Point count HUD
      ctx.fillStyle = "rgba(245,166,35,0.5)"
      ctx.font = "9px monospace"
      ctx.fillText(`${pointCount.toLocaleString()} pts`, 8, H - 8)

      animRef.current = requestAnimationFrame(draw)
    }

    animRef.current = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(animRef.current)
  }, [objects, pointCount])

  return (
    <canvas
      ref={canvasRef}
      width={300}
      height={300}
      className="w-full rounded-xl"
      style={{ imageRendering: "pixelated" }}
    />
  )
}
