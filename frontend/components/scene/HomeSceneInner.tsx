"use client"

import { useState, useCallback, useMemo, useRef, useEffect, Suspense } from "react"
import { Canvas, useFrame, useThree } from "@react-three/fiber"
import { OrbitControls, Html } from "@react-three/drei"
import * as THREE from "three"

import { GlbPointCloud } from "./GlbPointCloud"
import { NavigationPath } from "./NavigationPath"
import { ChaseCamera } from "./ChaseCamera"
import type { ObjectItem } from "./HomeSceneViewer"

// ── Constants ───────────────────────────────────────────────────────────────

const BG = "#0a0a0f"
const MANGO = "#F5A623"

const BOX_COLORS = [
  0x4da6ff, 0xff6b6b, 0x51cf66, 0xfcc419, 0xcc5de8,
  0xff922b, 0x20c997, 0xf06595, 0x5c7cfa, 0x94d82d,
]

// ── Object size heuristics ──────────────────────────────────────────────────

function getObjectSize(label: string): [number, number, number] {
  const sizes: Record<string, [number, number, number]> = {
    table: [1.2, 0.75, 0.8], chair: [0.5, 0.9, 0.5], couch: [2.0, 0.85, 0.9],
    sofa: [2.0, 0.85, 0.9], desk: [1.2, 0.75, 0.6], bed: [2.0, 0.6, 1.5],
    bench: [1.5, 0.45, 0.4], shelf: [0.8, 1.5, 0.35], cabinet: [0.8, 1.0, 0.5],
    stove: [0.7, 0.9, 0.6], refrigerator: [0.7, 1.7, 0.7], fridge: [0.7, 1.7, 0.7],
    sink: [0.6, 0.85, 0.5], door: [0.9, 2.0, 0.1], window: [1.0, 1.0, 0.1],
    tv: [1.0, 0.6, 0.1], person: [0.5, 1.7, 0.4], microwave: [0.5, 0.35, 0.4],
    dishwasher: [0.6, 0.85, 0.6], oven: [0.6, 0.9, 0.6], counter: [1.5, 0.9, 0.6],
    "coffee table": [1.0, 0.45, 0.6], "trash can": [0.3, 0.6, 0.3],
    "light switch": [0.08, 0.12, 0.03],
  }
  return sizes[label.toLowerCase()] ?? [0.5, 0.6, 0.5]
}

// ── Object label + bounding box ─────────────────────────────────────────────

function ObjectBox({
  obj,
  index,
  isSelected,
  isDimmed,
  isTarget,
  onClick,
}: {
  obj: ObjectItem
  index: number
  isSelected: boolean
  isDimmed: boolean
  isTarget: boolean
  onClick: () => void
}) {
  const boxRef = useRef<THREE.Group>(null)
  const color = BOX_COLORS[index % BOX_COLORS.length]
  const sz = useMemo(() => getObjectSize(obj.label), [obj.label])
  const distance = Math.sqrt(obj.x ** 2 + obj.z ** 2)
  const activeColor = isTarget ? 0x22c55e : color

  useFrame(({ clock }) => {
    if (!boxRef.current) return
    if (isSelected || isTarget) {
      const s = 1 + Math.sin(clock.elapsedTime * 3) * 0.03
      boxRef.current.scale.set(s, s, s)
    } else {
      boxRef.current.scale.set(1, 1, 1)
    }
  })

  const opacity = isDimmed ? 0.08 : isSelected ? 0.6 : isTarget ? 0.5 : 0.35
  const lineOpacity = isDimmed ? 0.1 : isSelected ? 0.9 : isTarget ? 0.85 : 0.5

  return (
    <group
      ref={boxRef}
      position={[obj.x, (obj.y || 0) + sz[1] / 2, obj.z]}
      onClick={(e) => { e.stopPropagation(); onClick() }}
    >
      <lineSegments>
        <edgesGeometry args={[new THREE.BoxGeometry(sz[0], sz[1], sz[2])]} />
        <lineBasicMaterial color={activeColor} transparent opacity={lineOpacity} />
      </lineSegments>

      <mesh>
        <boxGeometry args={[sz[0], sz[1], sz[2]]} />
        <meshBasicMaterial
          color={activeColor}
          transparent
          opacity={opacity * 0.3}
          depthWrite={false}
          side={THREE.DoubleSide}
        />
      </mesh>

      {!isDimmed && (
        <line>
          <bufferGeometry>
            <bufferAttribute
              attach="attributes-position"
              args={[new Float32Array([0, -sz[1] / 2, 0, 0, -sz[1] / 2 - (obj.y || 0), 0]), 3]}
              count={2}
            />
          </bufferGeometry>
          <lineBasicMaterial color={activeColor} transparent opacity={0.25} />
        </line>
      )}

      {!isDimmed && (
        <Html
          center
          position={[0, sz[1] / 2 + 0.2, 0]}
          distanceFactor={10}
          occlude={false}
          style={{ pointerEvents: "auto" }}
        >
          <div
            onClick={(e) => { e.stopPropagation(); onClick() }}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "5px",
              padding: "2px 8px",
              borderRadius: "4px",
              border: `1px solid #${activeColor.toString(16).padStart(6, "0")}${isSelected || isTarget ? "bb" : "55"}`,
              background: isSelected || isTarget
                ? `#${activeColor.toString(16).padStart(6, "0")}30`
                : "rgba(10,10,15,0.85)",
              cursor: "pointer",
              whiteSpace: "nowrap",
              fontFamily: "monospace",
              fontSize: isSelected || isTarget ? "12px" : "10px",
              lineHeight: "1.4",
              color: `#${activeColor.toString(16).padStart(6, "0")}`,
              transition: "all 0.15s",
            }}
          >
            <span style={{ fontWeight: 600 }}>{obj.label}</span>
            {obj.confidence != null && (
              <span style={{ opacity: 0.6, fontSize: "9px" }}>
                {Math.round(obj.confidence * 100)}%
              </span>
            )}
            <span style={{ opacity: 0.5, fontSize: "9px" }}>{distance.toFixed(1)}m</span>
            {isTarget && <span style={{ fontSize: "9px" }}>TARGET</span>}
          </div>
        </Html>
      )}
    </group>
  )
}

// ── Camera frustum at origin ────────────────────────────────────────────────

function CameraFrustum() {
  return (
    <group position={[0, 0.15, 0]}>
      <mesh rotation={[Math.PI / 2, 0, 0]}>
        <coneGeometry args={[0.06, 0.18, 4]} />
        <meshBasicMaterial color={0xffffff} wireframe transparent opacity={0.5} />
      </mesh>
      <mesh>
        <sphereGeometry args={[0.03, 8, 8]} />
        <meshBasicMaterial color={0xffffff} transparent opacity={0.7} />
      </mesh>
    </group>
  )
}

// ── Grid ────────────────────────────────────────────────────────────────────

function SceneGrid({ objects }: { objects: ObjectItem[] }) {
  const size = useMemo(() => {
    if (objects.length === 0) return 10
    const xs = objects.map((o) => Math.abs(o.x))
    const zs = objects.map((o) => Math.abs(o.z))
    return Math.ceil(Math.max(...xs, ...zs) * 2 + 4)
  }, [objects])

  return (
    <gridHelper
      args={[size, size, 0x333333, 0x1a1a1a]}
      position={[0, 0.001, size / 4]}
    />
  )
}

// ── Orbit camera (no navigation) ────────────────────────────────────────────

function ExploreCamera({ objects }: { objects: ObjectItem[] }) {
  const controlsRef = useRef<any>(null)
  const idleTimer = useRef(0)
  const interacting = useRef(false)
  const { camera } = useThree()

  const { target, dist } = useMemo(() => {
    if (objects.length === 0) return { target: new THREE.Vector3(0, 0.5, 3), dist: 6 }
    const cx = objects.reduce((s, o) => s + o.x, 0) / objects.length
    const cz = objects.reduce((s, o) => s + o.z, 0) / objects.length
    const xs = objects.map((o) => o.x)
    const zs = objects.map((o) => o.z)
    const spread = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...zs) - Math.min(...zs))
    return { target: new THREE.Vector3(cx, 0.8, cz), dist: Math.max(spread * 0.85, 5) }
  }, [objects])

  useEffect(() => {
    camera.position.set(target.x - dist * 0.4, dist * 0.55, target.z - dist * 0.5)
    camera.lookAt(target)
  }, [camera, target, dist])

  useFrame((_, delta) => {
    if (!controlsRef.current) return
    if (interacting.current) {
      idleTimer.current = 0
      controlsRef.current.autoRotate = false
    } else {
      idleTimer.current += delta
      if (idleTimer.current > 3) {
        controlsRef.current.autoRotate = true
        controlsRef.current.autoRotateSpeed = 0.8
      }
    }
  })

  return (
    <OrbitControls
      ref={controlsRef}
      target={[target.x, target.y, target.z]}
      enableDamping
      dampingFactor={0.05}
      minPolarAngle={Math.PI * 0.05}
      maxPolarAngle={Math.PI * 0.48}
      minDistance={1.5}
      maxDistance={dist * 3}
      autoRotate
      autoRotateSpeed={0.8}
      onStart={() => { interacting.current = true }}
      onEnd={() => { interacting.current = false }}
    />
  )
}

// ── Scene content ───────────────────────────────────────────────────────────

function SceneContent({
  glbUrl,
  objects,
  path,
  currentStepIndex,
  targetLabel,
  onPointCount,
  onGlbError,
}: {
  glbUrl: string
  objects: ObjectItem[]
  path?: { x: number; z: number }[]
  currentStepIndex: number
  targetLabel?: string
  onPointCount: (n: number) => void
  onGlbError: () => void
}) {
  const [selected, setSelected] = useState<number | null>(null)
  const navActive = !!path && path.length > 0
  const targetLower = targetLabel?.toLowerCase()

  const handleClick = useCallback(
    (index: number) => setSelected((prev) => (prev === index ? null : index)),
    [],
  )

  return (
    <>
      {/* Camera controller */}
      {navActive ? (
        <ChaseCamera path={path!} currentStepIndex={currentStepIndex} />
      ) : (
        <ExploreCamera objects={objects} />
      )}

      <ambientLight intensity={0.5} color={0xffffff} />
      <directionalLight position={[5, 10, 5]} intensity={0.3} color={0xffffff} />
      <fog attach="fog" args={[BG, 12, 30]} />

      <SceneGrid objects={objects} />
      <axesHelper args={[1]} />
      <CameraFrustum />

      {/* Real GLB point cloud */}
      <Suspense fallback={null}>
        <GlbPointCloud url={glbUrl} onLoad={onPointCount} onError={onGlbError} />
      </Suspense>

      {/* Object bounding boxes with labels */}
      {objects.map((obj, i) => (
        <ObjectBox
          key={obj.id || `${obj.label}-${i}`}
          obj={obj}
          index={i}
          isSelected={selected === i}
          isDimmed={selected !== null && selected !== i}
          isTarget={!!targetLower && obj.label.toLowerCase() === targetLower}
          onClick={() => handleClick(i)}
        />
      ))}

      {/* Navigation path overlay */}
      {navActive && (
        <NavigationPath
          path={path!}
          currentStepIndex={currentStepIndex}
        />
      )}

      {/* Click background to deselect */}
      <mesh visible={false} onClick={() => setSelected(null)}>
        <sphereGeometry args={[50, 8, 8]} />
        <meshBasicMaterial side={THREE.BackSide} />
      </mesh>

      {objects.length === 0 && (
        <Html center position={[0, 1.5, 2]}>
          <div style={{ fontFamily: "monospace", fontSize: 13, color: "#F5A62350" }}>
            Loading scene...
          </div>
        </Html>
      )}
    </>
  )
}

// ── Exported component ──────────────────────────────────────────────────────

interface HomeSceneInnerProps {
  glbUrl: string
  objects: ObjectItem[]
  path?: { x: number; z: number }[]
  currentStepIndex: number
  targetLabel?: string
  onPointCount: (n: number) => void
  onGlbError: () => void
}

export function HomeSceneInner({
  glbUrl,
  objects,
  path,
  currentStepIndex,
  targetLabel,
  onPointCount,
  onGlbError,
}: HomeSceneInnerProps) {
  return (
    <Canvas
      style={{ width: "100%", height: "100%", background: BG }}
      camera={{ fov: 60, near: 0.01, far: 1000, position: [0, 3, 8] }}
      dpr={[1, 1.5]}
      gl={{ antialias: true, alpha: false }}
    >
      <Suspense
        fallback={
          <Html center>
            <span style={{ fontFamily: "monospace", fontSize: 12, color: "#F5A62350" }}>
              Loading...
            </span>
          </Html>
        }
      >
        <SceneContent
          glbUrl={glbUrl}
          objects={objects}
          path={path}
          currentStepIndex={currentStepIndex}
          targetLabel={targetLabel}
          onPointCount={onPointCount}
          onGlbError={onGlbError}
        />
      </Suspense>
    </Canvas>
  )
}
