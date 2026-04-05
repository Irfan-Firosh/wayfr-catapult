"use client"

import { useEffect, useMemo, useState } from "react"
import { useLoader } from "@react-three/fiber"
import * as THREE from "three"
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js"
import type { GLTF } from "three/examples/jsm/loaders/GLTFLoader.js"

interface GlbPointCloudProps {
  url: string
  pointSize?: number
  onLoad?: (pointCount: number) => void
  onError?: (err: Error) => void
}

function createCircleTexture(): THREE.Texture {
  const size = 64
  const canvas = document.createElement("canvas")
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext("2d")!
  ctx.beginPath()
  ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2)
  ctx.fillStyle = "white"
  ctx.fill()
  const tex = new THREE.CanvasTexture(canvas)
  tex.needsUpdate = true
  return tex
}

function extractPointCloud(gltf: GLTF) {
  const allPositions: number[] = []
  const allColors: number[] = []

  gltf.scene.traverse((child: THREE.Object3D) => {
    if (!(child instanceof THREE.Mesh)) return
    const geom = child.geometry as THREE.BufferGeometry
    const posAttr = geom.getAttribute("position")
    if (!posAttr) return

    child.updateMatrixWorld(true)
    const matrix = child.matrixWorld

    const colorAttr = geom.getAttribute("color")
    const tempPos = new THREE.Vector3()

    for (let i = 0; i < posAttr.count; i++) {
      tempPos.set(posAttr.getX(i), posAttr.getY(i), posAttr.getZ(i))
      tempPos.applyMatrix4(matrix)
      allPositions.push(tempPos.x, tempPos.y, tempPos.z)

      if (colorAttr) {
        allColors.push(colorAttr.getX(i), colorAttr.getY(i), colorAttr.getZ(i))
      } else {
        allColors.push(0.6, 0.6, 0.6)
      }
    }
  })

  return {
    positions: new Float32Array(allPositions),
    colors: new Float32Array(allColors),
    count: allPositions.length / 3,
  }
}

export function GlbPointCloud({ url, pointSize = 0.015, onLoad, onError }: GlbPointCloudProps) {
  const gltf = useLoader(GLTFLoader, url, undefined, (event) => {
    if (event instanceof ErrorEvent && onError) {
      onError(new Error(event.message))
    }
  })

  const { positions, colors, count } = useMemo(() => extractPointCloud(gltf), [gltf])

  const circleTexture = useMemo(() => createCircleTexture(), [])

  useEffect(() => {
    if (count > 0) onLoad?.(count)
  }, [count, onLoad])

  if (count === 0) return null

  return (
    <points>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
        <bufferAttribute attach="attributes-color" args={[colors, 3]} />
      </bufferGeometry>
      <pointsMaterial
        size={pointSize}
        vertexColors
        sizeAttenuation
        map={circleTexture}
        alphaTest={0.5}
        transparent
        depthWrite
      />
    </points>
  )
}
