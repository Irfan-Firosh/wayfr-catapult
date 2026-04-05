"use client"

import { useRef, useMemo, useEffect } from "react"
import { useFrame, useThree } from "@react-three/fiber"
import { OrbitControls } from "@react-three/drei"
import * as THREE from "three"

interface PathPoint {
  x: number
  z: number
}

interface ChaseCameraProps {
  path: PathPoint[]
  currentStepIndex: number
  startPosition?: { x: number; z: number }
  chaseBehind?: number
  chaseHeight?: number
}

const IDLE_RETURN_S = 3

export function ChaseCamera({
  path,
  currentStepIndex,
  startPosition,
  chaseBehind = 3,
  chaseHeight = 2.5,
}: ChaseCameraProps) {
  const controlsRef = useRef<any>(null)
  const interacting = useRef(false)
  const idleTimer = useRef(0)
  const { camera } = useThree()

  const fullPath = useMemo(() => {
    const start = startPosition ?? { x: 0, z: 0 }
    return [start, ...path]
  }, [path, startPosition])

  const { targetPos, cameraPos } = useMemo(() => {
    const idx = Math.min(currentStepIndex + 1, fullPath.length - 1)
    const current = fullPath[idx]
    const next = idx < fullPath.length - 1 ? fullPath[idx + 1] : fullPath[idx]

    const dx = next.x - current.x
    const dz = next.z - current.z
    const len = Math.sqrt(dx * dx + dz * dz)

    let behindX: number, behindZ: number
    if (len > 0.01) {
      behindX = current.x - (dx / len) * chaseBehind
      behindZ = current.z - (dz / len) * chaseBehind
    } else {
      behindX = current.x - chaseBehind
      behindZ = current.z
    }

    return {
      targetPos: new THREE.Vector3(current.x, 0.8, current.z),
      cameraPos: new THREE.Vector3(behindX, chaseHeight, behindZ),
    }
  }, [fullPath, currentStepIndex, chaseBehind, chaseHeight])

  useEffect(() => {
    camera.position.copy(cameraPos)
    camera.lookAt(targetPos)
    if (controlsRef.current) {
      controlsRef.current.target.copy(targetPos)
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useFrame((_, delta) => {
    if (!controlsRef.current) return

    if (interacting.current) {
      idleTimer.current = 0
      return
    }

    idleTimer.current += delta

    if (idleTimer.current > IDLE_RETURN_S) {
      const t = 1 - Math.pow(0.05, delta)
      camera.position.lerp(cameraPos, t)
      controlsRef.current.target.lerp(targetPos, t)
    }
  })

  return (
    <OrbitControls
      ref={controlsRef}
      target={[targetPos.x, targetPos.y, targetPos.z]}
      enableDamping
      dampingFactor={0.05}
      minPolarAngle={Math.PI * 0.05}
      maxPolarAngle={Math.PI * 0.48}
      minDistance={1}
      maxDistance={30}
      onStart={() => {
        interacting.current = true
      }}
      onEnd={() => {
        interacting.current = false
      }}
    />
  )
}
