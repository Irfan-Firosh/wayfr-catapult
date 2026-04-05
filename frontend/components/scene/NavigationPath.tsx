"use client"

import { useRef, useMemo } from "react"
import { useFrame } from "@react-three/fiber"
import * as THREE from "three"

interface PathPoint {
  x: number
  z: number
}

interface NavigationPathProps {
  path: PathPoint[]
  currentStepIndex: number
  startPosition?: { x: number; z: number }
}

const MANGO = 0xf5a623
const PATH_Y = 0.04
const MARKER_Y = 0.08

export function NavigationPath({ path, currentStepIndex, startPosition }: NavigationPathProps) {
  const markerRef = useRef<THREE.Group>(null)
  const beamRef = useRef<THREE.Mesh>(null)
  const targetPosRef = useRef(new THREE.Vector3())

  const fullPath = useMemo(() => {
    const start = startPosition ?? { x: 0, z: 0 }
    return [start, ...path]
  }, [path, startPosition])

  const { completedGeom, upcomingGeom } = useMemo(() => {
    const splitIdx = Math.min(currentStepIndex + 1, fullPath.length)
    const completed = fullPath.slice(0, splitIdx + 1)
    const upcoming = fullPath.slice(splitIdx)

    function toLineGeom(pts: PathPoint[]): THREE.BufferGeometry {
      const verts = new Float32Array(pts.length * 3)
      for (let i = 0; i < pts.length; i++) {
        verts[i * 3] = pts[i].x
        verts[i * 3 + 1] = PATH_Y
        verts[i * 3 + 2] = pts[i].z
      }
      const geom = new THREE.BufferGeometry()
      geom.setAttribute("position", new THREE.BufferAttribute(verts, 3))
      return geom
    }

    return {
      completedGeom: completed.length >= 2 ? toLineGeom(completed) : null,
      upcomingGeom: upcoming.length >= 2 ? toLineGeom(upcoming) : null,
    }
  }, [fullPath, currentStepIndex])

  const currentPos = useMemo(() => {
    const idx = Math.min(currentStepIndex + 1, fullPath.length - 1)
    return fullPath[idx]
  }, [fullPath, currentStepIndex])

  useFrame((_, delta) => {
    if (!markerRef.current || !currentPos) return
    targetPosRef.current.set(currentPos.x, MARKER_Y, currentPos.z)
    markerRef.current.position.lerp(targetPosRef.current, 1 - Math.pow(0.01, delta))

    if (beamRef.current) {
      beamRef.current.position.x = markerRef.current.position.x
      beamRef.current.position.z = markerRef.current.position.z
    }
  })

  return (
    <group>
      {completedGeom && (
        <line>
          <primitive object={completedGeom} attach="geometry" />
          <lineBasicMaterial color={MANGO} transparent opacity={0.25} linewidth={2} />
        </line>
      )}

      {upcomingGeom && (
        <line>
          <primitive object={upcomingGeom} attach="geometry" />
          <lineBasicMaterial color={MANGO} transparent opacity={0.8} linewidth={2} />
        </line>
      )}

      {/* Position marker */}
      <group ref={markerRef} position={[currentPos?.x ?? 0, MARKER_Y, currentPos?.z ?? 0]}>
        <mesh>
          <sphereGeometry args={[0.08, 16, 16]} />
          <meshBasicMaterial color={MANGO} transparent opacity={0.9} />
        </mesh>
        {/* Outer glow ring */}
        <mesh rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[0.1, 0.18, 24]} />
          <meshBasicMaterial color={MANGO} transparent opacity={0.3} side={THREE.DoubleSide} />
        </mesh>
      </group>

      {/* Vertical beam at marker */}
      <mesh ref={beamRef} position={[currentPos?.x ?? 0, 1.0, currentPos?.z ?? 0]}>
        <cylinderGeometry args={[0.01, 0.01, 2.0, 6]} />
        <meshBasicMaterial color={MANGO} transparent opacity={0.15} />
      </mesh>

      {/* Start marker */}
      <mesh position={[fullPath[0].x, PATH_Y, fullPath[0].z]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.06, 0.12, 16]} />
        <meshBasicMaterial color={0xffffff} transparent opacity={0.5} side={THREE.DoubleSide} />
      </mesh>

      {/* End marker */}
      {fullPath.length > 1 && (
        <mesh
          position={[fullPath[fullPath.length - 1].x, PATH_Y, fullPath[fullPath.length - 1].z]}
          rotation={[-Math.PI / 2, 0, 0]}
        >
          <ringGeometry args={[0.06, 0.14, 16]} />
          <meshBasicMaterial color={0x22c55e} transparent opacity={0.6} side={THREE.DoubleSide} />
        </mesh>
      )}
    </group>
  )
}
