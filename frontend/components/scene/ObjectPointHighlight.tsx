"use client"

import { useMemo } from "react"
import * as THREE from "three"

interface ObjectPointHighlightProps {
  points: [number, number, number][]
  color?: string
  pointSize?: number
  opacity?: number
}

function createCircleTexture() {
  const size = 64
  const canvas = document.createElement("canvas")
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext("2d")
  if (!ctx) {
    return null
  }

  ctx.beginPath()
  ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2)
  ctx.fillStyle = "white"
  ctx.fill()

  const texture = new THREE.CanvasTexture(canvas)
  texture.needsUpdate = true
  return texture
}

export function ObjectPointHighlight({
  points,
  color = "#ffd585",
  pointSize = 0.032,
  opacity = 0.9,
}: ObjectPointHighlightProps) {
  const positions = useMemo(() => {
    const flat = new Float32Array(points.length * 3)
    points.forEach((point, index) => {
      flat[index * 3] = point[0]
      flat[index * 3 + 1] = point[1]
      flat[index * 3 + 2] = point[2]
    })
    return flat
  }, [points])

  const circleTexture = useMemo(() => createCircleTexture(), [])

  if (points.length === 0) {
    return null
  }

  return (
    <group renderOrder={20}>
      <points>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[positions, 3]} />
        </bufferGeometry>
        <pointsMaterial
          color={color}
          size={pointSize * 1.95}
          sizeAttenuation
          map={circleTexture ?? undefined}
          alphaTest={0.18}
          transparent
          opacity={opacity * 0.22}
          depthWrite={false}
          depthTest={false}
          blending={THREE.AdditiveBlending}
        />
      </points>

      <points>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[positions, 3]} />
        </bufferGeometry>
        <pointsMaterial
          color={color}
          size={pointSize}
          sizeAttenuation
          map={circleTexture ?? undefined}
          alphaTest={0.35}
          transparent
          opacity={opacity}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </points>
    </group>
  )
}
