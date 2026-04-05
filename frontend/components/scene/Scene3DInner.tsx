"use client"

import { useState, useCallback, useMemo, useRef, useEffect, Suspense } from "react"
import { Canvas, useFrame, useThree } from "@react-three/fiber"
import { OrbitControls, Html, GizmoHelper, GizmoViewport } from "@react-three/drei"
import * as THREE from "three"

// ── Types ───────────────────────────────────────────────────────────────────

type Object3D = {
  label: string
  x: number
  y: number
  z: number
  urgency: "high" | "medium" | "low"
  confidence?: number
}

// ── Constants ───────────────────────────────────────────────────────────────

const BG = "#0a0a0f"
const MANGO = "#F5A623"

const URGENCY_HEX: Record<string, number> = {
  high: 0xef4444,
  medium: 0xf5a623,
  low: 0x22c55e,
}

// Palette for unique per-object colors (matches OpenReality BOX_COLORS)
const BOX_COLORS = [
  0x4da6ff, 0xff6b6b, 0x51cf66, 0xfcc419, 0xcc5de8,
  0xff922b, 0x20c997, 0xf06595, 0x5c7cfa, 0x94d82d,
]

// ── Seeded random ───────────────────────────────────────────────────────────

function seededRng(seed: number) {
  let s = seed
  return () => {
    s = (s * 16807 + 0) % 2147483647
    return (s - 1) / 2147483646
  }
}

function hashLabel(label: string, index: number): number {
  let h = 0
  for (let i = 0; i < label.length; i++) h = (h * 31 + label.charCodeAt(i)) | 0
  return Math.abs(h) + index * 7919
}

// ── Room point cloud generator ──────────────────────────────────────────────
// Generates a dense colored point cloud simulating a 3D room scan

function generateRoomPointCloud(
  objects: Object3D[],
): { positions: Float32Array; colors: Float32Array } {
  if (objects.length === 0) {
    return { positions: new Float32Array(0), colors: new Float32Array(0) }
  }

  const xs = objects.map((o) => o.x)
  const zs = objects.map((o) => o.z)
  const minX = Math.min(...xs) - 1.5
  const maxX = Math.max(...xs) + 1.5
  const minZ = Math.min(0, Math.min(...zs) - 0.5)
  const maxZ = Math.max(...zs) + 1.5
  const width = maxX - minX
  const depth = maxZ - minZ
  const wallH = 2.6

  const pts: number[] = []
  const cols: number[] = []
  const rng = seededRng(123)

  // Floor points — dense scatter
  const floorCount = Math.round(width * depth * 60)
  for (let i = 0; i < floorCount; i++) {
    pts.push(minX + rng() * width, rng() * 0.02, minZ + rng() * depth)
    // Warm gray floor
    const v = 0.12 + rng() * 0.06
    cols.push(v * 1.1, v * 1.0, v * 0.9)
  }

  // Wall points — 4 walls
  const wallDensity = 40
  // Back wall (+Z)
  for (let i = 0; i < Math.round(width * wallH * wallDensity); i++) {
    pts.push(minX + rng() * width, rng() * wallH, maxZ + rng() * 0.05)
    const v = 0.08 + rng() * 0.05
    cols.push(v, v * 1.05, v * 1.1)
  }
  // Left wall (-X)
  for (let i = 0; i < Math.round(depth * wallH * wallDensity); i++) {
    pts.push(minX - rng() * 0.05, rng() * wallH, minZ + rng() * depth)
    const v = 0.09 + rng() * 0.05
    cols.push(v, v * 1.02, v * 1.08)
  }
  // Right wall (+X)
  for (let i = 0; i < Math.round(depth * wallH * wallDensity); i++) {
    pts.push(maxX + rng() * 0.05, rng() * wallH, minZ + rng() * depth)
    const v = 0.09 + rng() * 0.05
    cols.push(v, v * 1.02, v * 1.08)
  }
  // Front wall (-Z) — sparser, camera is near here
  for (let i = 0; i < Math.round(width * wallH * wallDensity * 0.3); i++) {
    pts.push(minX + rng() * width, rng() * wallH, minZ - rng() * 0.05)
    const v = 0.07 + rng() * 0.04
    cols.push(v, v, v * 1.05)
  }

  // Object surface points — dense clusters on each detected object
  objects.forEach((obj, idx) => {
    const color = new THREE.Color(BOX_COLORS[idx % BOX_COLORS.length])
    const r = seededRng(hashLabel(obj.label, idx))
    // Estimate object size from label
    const sz = getObjectSize(obj.label)
    const count = Math.round(sz[0] * sz[1] * sz[2] * 800)

    for (let i = 0; i < count; i++) {
      // Points on surfaces of a box
      const face = Math.floor(r() * 6)
      let px: number, py: number, pz: number
      const hw = sz[0] / 2, hh = sz[1] / 2, hd = sz[2] / 2

      switch (face) {
        case 0: px = hw; py = (r() - 0.5) * sz[1]; pz = (r() - 0.5) * sz[2]; break
        case 1: px = -hw; py = (r() - 0.5) * sz[1]; pz = (r() - 0.5) * sz[2]; break
        case 2: py = hh; px = (r() - 0.5) * sz[0]; pz = (r() - 0.5) * sz[2]; break
        case 3: py = -hh; px = (r() - 0.5) * sz[0]; pz = (r() - 0.5) * sz[2]; break
        case 4: pz = hd; px = (r() - 0.5) * sz[0]; py = (r() - 0.5) * sz[1]; break
        default: pz = -hd; px = (r() - 0.5) * sz[0]; py = (r() - 0.5) * sz[1]; break
      }

      // Add noise
      px += (r() - 0.5) * 0.03
      py += (r() - 0.5) * 0.03
      pz += (r() - 0.5) * 0.03

      pts.push(obj.x + px, Math.max((obj.y || 0) + sz[1] / 2 + py, 0.01), obj.z + pz)
      // Mix object color with slight variation
      const noise = 0.85 + r() * 0.3
      cols.push(color.r * noise, color.g * noise, color.b * noise)
    }
  })

  return {
    positions: new Float32Array(pts),
    colors: new Float32Array(cols),
  }
}

function getObjectSize(label: string): [number, number, number] {
  const sizes: Record<string, [number, number, number]> = {
    table: [1.2, 0.75, 0.8], chair: [0.5, 0.9, 0.5], couch: [2.0, 0.85, 0.9],
    sofa: [2.0, 0.85, 0.9], desk: [1.2, 0.75, 0.6], bed: [2.0, 0.6, 1.5],
    bench: [1.5, 0.45, 0.4], shelf: [0.8, 1.5, 0.35], cabinet: [0.8, 1.0, 0.5],
    stove: [0.7, 0.9, 0.6], refrigerator: [0.7, 1.7, 0.7], fridge: [0.7, 1.7, 0.7],
    sink: [0.6, 0.85, 0.5], door: [0.9, 2.0, 0.1], window: [1.0, 1.0, 0.1],
    wall: [2.0, 2.5, 0.1], floor: [2.0, 0.05, 2.0], tv: [1.0, 0.6, 0.1],
    person: [0.5, 1.7, 0.4], step: [1.0, 0.2, 0.4], "fire hydrant": [0.3, 0.7, 0.3],
    pole: [0.1, 2.0, 0.1], sign: [0.6, 0.6, 0.05], dishwasher: [0.6, 0.85, 0.6],
    oven: [0.6, 0.9, 0.6], counter: [1.5, 0.9, 0.6],
    "coffee table": [1.0, 0.45, 0.6], "trash can": [0.3, 0.6, 0.3],
    "light switch": [0.08, 0.12, 0.03],
  }
  return sizes[label.toLowerCase()] ?? [0.5, 0.6, 0.5]
}

// ── Room point cloud mesh ───────────────────────────────────────────────────

function RoomPointCloud({ objects }: { objects: Object3D[] }) {
  const { positions, colors } = useMemo(() => generateRoomPointCloud(objects), [objects])
  const geomRef = useRef<THREE.BufferGeometry>(null)

  // Create circle texture for round points (matches OpenReality's createCircleTexture)
  const circleTexture = useMemo(() => {
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
  }, [])

  if (positions.length === 0) return null

  return (
    <points>
      <bufferGeometry ref={geomRef}>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
        <bufferAttribute attach="attributes-color" args={[colors, 3]} />
      </bufferGeometry>
      <pointsMaterial
        size={0.018}
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

// ── Detection bounding box ──────────────────────────────────────────────────

function DetectionBox({
  obj,
  index,
  isSelected,
  isDimmed,
  onClick,
}: {
  obj: Object3D
  index: number
  isSelected: boolean
  isDimmed: boolean
  onClick: () => void
}) {
  const boxRef = useRef<THREE.Group>(null)
  const color = BOX_COLORS[index % BOX_COLORS.length]
  const sz = useMemo(() => getObjectSize(obj.label), [obj.label])
  const distance = Math.sqrt(obj.x ** 2 + obj.z ** 2)
  const urgencyColor = URGENCY_HEX[obj.urgency]

  // Pulse for selected
  useFrame(({ clock }) => {
    if (boxRef.current && isSelected) {
      const s = 1 + Math.sin(clock.elapsedTime * 3) * 0.03
      boxRef.current.scale.set(s, s, s)
    } else if (boxRef.current) {
      boxRef.current.scale.set(1, 1, 1)
    }
  })

  const opacity = isDimmed ? 0.08 : isSelected ? 0.6 : 0.35
  const lineOpacity = isDimmed ? 0.1 : isSelected ? 0.9 : 0.5

  return (
    <group
      ref={boxRef}
      position={[obj.x, (obj.y || 0) + sz[1] / 2, obj.z]}
      onClick={(e) => { e.stopPropagation(); onClick() }}
    >
      {/* Wireframe bounding box */}
      <lineSegments>
        <edgesGeometry args={[new THREE.BoxGeometry(sz[0], sz[1], sz[2])]} />
        <lineBasicMaterial color={color} transparent opacity={lineOpacity} />
      </lineSegments>

      {/* Semi-transparent fill */}
      <mesh>
        <boxGeometry args={[sz[0], sz[1], sz[2]]} />
        <meshBasicMaterial
          color={color}
          transparent
          opacity={opacity * 0.3}
          depthWrite={false}
          side={THREE.DoubleSide}
        />
      </mesh>

      {/* Vertical stem to ground */}
      {!isDimmed && (
        <line>
          <bufferGeometry>
            <bufferAttribute
              attach="attributes-position"
              args={[new Float32Array([0, -sz[1] / 2, 0, 0, -sz[1] / 2 - (obj.y || 0), 0]), 3]}
              count={2}
            />
          </bufferGeometry>
          <lineBasicMaterial color={color} transparent opacity={0.25} />
        </line>
      )}

      {/* Label */}
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
              border: `1px solid #${color.toString(16).padStart(6, "0")}${isSelected ? "bb" : "55"}`,
              background: isSelected
                ? `#${color.toString(16).padStart(6, "0")}30`
                : "rgba(10,10,15,0.85)",
              cursor: "pointer",
              whiteSpace: "nowrap",
              fontFamily: "monospace",
              fontSize: isSelected ? "12px" : "10px",
              lineHeight: "1.4",
              color: `#${color.toString(16).padStart(6, "0")}`,
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
      {/* Cone pyramid */}
      <mesh rotation={[Math.PI / 2, 0, 0]}>
        <coneGeometry args={[0.06, 0.18, 4]} />
        <meshBasicMaterial color={0xffffff} wireframe transparent opacity={0.5} />
      </mesh>
      {/* Center sphere */}
      <mesh>
        <sphereGeometry args={[0.03, 8, 8]} />
        <meshBasicMaterial color={0xffffff} transparent opacity={0.7} />
      </mesh>
      {/* FOV lines */}
      <line>
        <bufferGeometry>
          <bufferAttribute
            attach="attributes-position"
            args={[new Float32Array([
              0, 0, 0, -1.2, -0.1, 2.5,
              0, 0, 0, 1.2, -0.1, 2.5,
            ]), 3]}
            count={4}
          />
        </bufferGeometry>
        <lineBasicMaterial color={0xcccccc} transparent opacity={0.15} />
      </line>
    </group>
  )
}

// ── Grid helper ─────────────────────────────────────────────────────────────

function SceneGrid({ objects }: { objects: Object3D[] }) {
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

// ── Auto-orbit camera ───────────────────────────────────────────────────────

function AutoCamera({
  autoOrbit,
  objects,
}: {
  autoOrbit: boolean
  objects: Object3D[]
}) {
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
    } else if (autoOrbit) {
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
      autoRotate={autoOrbit}
      autoRotateSpeed={0.8}
      onStart={() => { interacting.current = true }}
      onEnd={() => { interacting.current = false }}
    />
  )
}

// ── Scene content ───────────────────────────────────────────────────────────

function SceneContent({
  objects,
  autoOrbit,
  onObjectClick,
}: {
  objects: Object3D[]
  autoOrbit: boolean
  onObjectClick?: (index: number) => void
}) {
  const [selected, setSelected] = useState<number | null>(null)

  const realObjects = useMemo(
    () => objects.filter((o) => o.label !== "waiting\u2026"),
    [objects],
  )

  const handleClick = useCallback(
    (index: number) => {
      const next = selected === index ? null : index
      setSelected(next)
      if (next !== null) onObjectClick?.(next)
    },
    [selected, onObjectClick],
  )

  return (
    <>
      <AutoCamera autoOrbit={autoOrbit} objects={realObjects} />

      {/* Lighting — matches OpenReality */}
      <ambientLight intensity={0.5} color={0xffffff} />
      <directionalLight position={[5, 10, 5]} intensity={0.3} color={0xffffff} />
      <fog attach="fog" args={[BG, 12, 30]} />

      {/* Grid */}
      <SceneGrid objects={realObjects} />

      {/* Axes */}
      <axesHelper args={[1]} />

      {/* Camera frustum at origin */}
      <CameraFrustum />

      {/* Room point cloud */}
      <RoomPointCloud objects={realObjects} />

      {/* Detection bounding boxes */}
      {realObjects.map((obj, i) => (
        <DetectionBox
          key={`${obj.label}-${i}`}
          obj={obj}
          index={i}
          isSelected={selected === i}
          isDimmed={selected !== null && selected !== i}
          onClick={() => handleClick(i)}
        />
      ))}

      {/* Background click to deselect */}
      <mesh visible={false} onClick={() => setSelected(null)}>
        <sphereGeometry args={[50, 8, 8]} />
        <meshBasicMaterial side={THREE.BackSide} />
      </mesh>

      {/* Empty state */}
      {realObjects.length === 0 && (
        <Html center position={[0, 1.5, 2]}>
          <div style={{ fontFamily: "monospace", fontSize: 13, color: "#F5A62350" }}>
            Waiting for scan data...
          </div>
        </Html>
      )}
    </>
  )
}

// ── Exported component ──────────────────────────────────────────────────────

interface Scene3DInnerProps {
  objects: Object3D[]
  autoOrbit: boolean
  onObjectClick?: (index: number) => void
}

export function Scene3DInner({ objects, autoOrbit, onObjectClick }: Scene3DInnerProps) {
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
        <SceneContent objects={objects} autoOrbit={autoOrbit} onObjectClick={onObjectClick} />
      </Suspense>
    </Canvas>
  )
}
