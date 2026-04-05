"use client"

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Canvas, ThreeEvent, useFrame, useThree } from "@react-three/fiber"
import { GizmoHelper, GizmoViewport, Html, OrbitControls } from "@react-three/drei"
import * as THREE from "three"
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib"

import { ChaseCamera } from "./ChaseCamera"
import { GlbSceneModel, type SceneFocusRegion } from "./GlbSceneModel"
import { NavigationPath } from "./NavigationPath"
import { ObjectPointHighlight } from "./ObjectPointHighlight"
import type {
  CameraCommand,
  ExactObjectHighlight,
  ObjectItem,
  SceneColorMode,
  SceneDebugOptions,
  SceneDisplayMode,
} from "./HomeSceneViewer"

const BG = "#0a0a0f"
const SELECTED_ACCENT = 0xf6b54c
const HOVER_ACCENT = 0x8fd8ff

type Vec3Triple = [number, number, number]

type ObjectFocusMeta = {
  anchor: Vec3Triple
  center: Vec3Triple
  size: Vec3Triple
  bboxMin: Vec3Triple
  bboxMax: Vec3Triple
  floorY: number
  labelPosition: Vec3Triple
}

function getObjectSize(label: string): [number, number, number] {
  const sizes: Record<string, [number, number, number]> = {
    table: [1.2, 0.75, 0.8],
    chair: [0.5, 0.9, 0.5],
    couch: [2.0, 0.85, 0.9],
    sofa: [2.0, 0.85, 0.9],
    desk: [1.2, 0.75, 0.6],
    bed: [2.0, 0.6, 1.5],
    bench: [1.5, 0.45, 0.4],
    shelf: [0.8, 1.5, 0.35],
    cabinet: [0.8, 1.0, 0.5],
    stove: [0.7, 0.9, 0.6],
    refrigerator: [0.7, 1.7, 0.7],
    fridge: [0.7, 1.7, 0.7],
    sink: [0.6, 0.85, 0.5],
    door: [0.9, 2.0, 0.1],
    window: [1.0, 1.0, 0.1],
    tv: [1.0, 0.6, 0.1],
    person: [0.5, 1.7, 0.4],
    microwave: [0.5, 0.35, 0.4],
    dishwasher: [0.6, 0.85, 0.6],
    oven: [0.6, 0.9, 0.6],
    counter: [1.5, 0.9, 0.6],
    "coffee table": [1.0, 0.45, 0.6],
    "trash can": [0.3, 0.6, 0.3],
    "light switch": [0.08, 0.12, 0.03],
  }
  return sizes[label.toLowerCase()] ?? [0.5, 0.6, 0.5]
}

function getObjectFocusMeta(obj: ObjectItem): ObjectFocusMeta {
  if (obj.bbox_min?.length === 3 && obj.bbox_max?.length === 3) {
    const bboxMin: Vec3Triple = [obj.bbox_min[0], obj.bbox_min[1], obj.bbox_min[2]]
    const bboxMax: Vec3Triple = [obj.bbox_max[0], obj.bbox_max[1], obj.bbox_max[2]]
    const size: Vec3Triple = [
      Math.max(0.08, Math.abs(bboxMax[0] - bboxMin[0])),
      Math.max(0.08, Math.abs(bboxMax[1] - bboxMin[1])),
      Math.max(0.08, Math.abs(bboxMax[2] - bboxMin[2])),
    ]
    const center: Vec3Triple = [
      (bboxMin[0] + bboxMax[0]) / 2,
      (bboxMin[1] + bboxMax[1]) / 2,
      (bboxMin[2] + bboxMax[2]) / 2,
    ]

    return {
      anchor: [obj.x, obj.y, obj.z],
      center,
      size,
      bboxMin,
      bboxMax,
      floorY: bboxMin[1],
      labelPosition: [center[0], bboxMax[1] + 0.24, center[2]],
    }
  }

  const size = getObjectSize(obj.label)
  const center: Vec3Triple = [obj.x, (obj.y || 0) + size[1] / 2, obj.z]
  const bboxMin: Vec3Triple = [center[0] - size[0] / 2, center[1] - size[1] / 2, center[2] - size[2] / 2]
  const bboxMax: Vec3Triple = [center[0] + size[0] / 2, center[1] + size[1] / 2, center[2] + size[2] / 2]

  return {
    anchor: [obj.x, obj.y, obj.z],
    center,
    size,
    bboxMin,
    bboxMax,
    floorY: bboxMin[1],
    labelPosition: [center[0], bboxMax[1] + 0.24, center[2]],
  }
}

function toFocusRegion(meta: ObjectFocusMeta): SceneFocusRegion {
  return {
    center: meta.center,
    bboxMin: meta.bboxMin,
    bboxMax: meta.bboxMax,
  }
}

function hashString(input: string) {
  let hash = 0
  for (let index = 0; index < input.length; index += 1) {
    hash = (hash * 31 + input.charCodeAt(index)) >>> 0
  }
  return hash
}

function makeColorFromHsl(h: number, s: number, l: number) {
  return new THREE.Color().setHSL(h, s, l).getHex()
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function getObjectColor(object: ObjectItem, index: number, colorMode: SceneColorMode) {
  if (colorMode === "class") {
    return makeColorFromHsl((hashString(object.label) % 360) / 360, 0.68, 0.55)
  }
  if (colorMode === "instance") {
    return makeColorFromHsl(((index * 41) % 360) / 360, 0.75, 0.56)
  }
  return 0xcbd5e1
}

function FocusCallout({
  obj,
  meta,
  color,
  tone,
}: {
  obj: ObjectItem
  meta: ObjectFocusMeta
  color: number
  tone: "selected" | "hover"
}) {
  const hex = `#${color.toString(16).padStart(6, "0")}`

  return (
    <Html center position={meta.labelPosition} distanceFactor={11} occlude={false} style={{ pointerEvents: "none" }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "6px",
          padding: tone === "selected" ? "6px 12px" : "5px 10px",
          borderRadius: "999px",
          border: `1px solid ${hex}55`,
          background:
            tone === "selected"
              ? `linear-gradient(180deg, rgba(8,10,15,0.9), ${hex}2f)`
              : `linear-gradient(180deg, rgba(8,10,15,0.76), ${hex}1b)`,
          boxShadow: "0 18px 46px rgba(0,0,0,0.34)",
          backdropFilter: "blur(18px)",
          whiteSpace: "nowrap",
          fontFamily: "monospace",
          fontSize: tone === "selected" ? "12px" : "10px",
          lineHeight: "1.4",
          color: "#fff7ea",
        }}
      >
        <span style={{ fontWeight: 700 }}>{obj.label}</span>
      </div>
    </Html>
  )
}

function SelectionAura({
  meta,
  color,
  strength = "selected",
}: {
  meta: ObjectFocusMeta
  color: number
  strength?: "selected" | "secondary" | "hover"
}) {
  const shellRef = useRef<THREE.Group>(null)
  const baseOpacity = strength === "selected" ? 0.16 : strength === "hover" ? 0.1 : 0.08
  const ringOpacity = strength === "selected" ? 0.55 : strength === "hover" ? 0.34 : 0.22
  const shellScale = strength === "selected" ? 0.62 : 0.56
  const outerScale = strength === "selected" ? 0.76 : 0.68
  const ringOuter = Math.max(meta.size[0], meta.size[2]) * (strength === "selected" ? 0.7 : 0.62)

  useFrame(({ clock }) => {
    if (!shellRef.current) return
    const pulse = 1 + Math.sin(clock.elapsedTime * (strength === "selected" ? 2.4 : 1.8)) * 0.03
    shellRef.current.scale.setScalar(pulse)
  })

  return (
    <group>
      <group ref={shellRef} position={meta.center}>
        <mesh scale={[meta.size[0] * shellScale, meta.size[1] * shellScale, meta.size[2] * shellScale]}>
          <sphereGeometry args={[1, 28, 20]} />
          <meshBasicMaterial color={color} transparent opacity={baseOpacity} depthWrite={false} />
        </mesh>
        <mesh scale={[meta.size[0] * outerScale, meta.size[1] * outerScale, meta.size[2] * outerScale]}>
          <sphereGeometry args={[1, 24, 18]} />
          <meshBasicMaterial color={color} transparent opacity={baseOpacity * 0.55} depthWrite={false} side={THREE.BackSide} />
        </mesh>
      </group>
      <mesh position={[meta.center[0], meta.floorY + 0.03, meta.center[2]]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[ringOuter * 0.62, ringOuter, 48]} />
        <meshBasicMaterial color={color} transparent opacity={ringOpacity} depthWrite={false} side={THREE.DoubleSide} />
      </mesh>
    </group>
  )
}

function ObjectBeacon({
  meta,
  color,
  opacity,
  scale = 1,
}: {
  meta: ObjectFocusMeta
  color: number
  opacity: number
  scale?: number
}) {
  const radius = Math.max(meta.size[0], meta.size[2]) * 0.2 + 0.12

  return (
    <group>
      <mesh position={[meta.center[0], meta.floorY + 0.02, meta.center[2]]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[radius * 0.55, radius * scale, 32]} />
        <meshBasicMaterial color={color} transparent opacity={opacity} depthWrite={false} side={THREE.DoubleSide} />
      </mesh>
      <mesh position={[meta.center[0], meta.center[1], meta.center[2]]}>
        <sphereGeometry args={[0.04 * scale, 12, 12]} />
        <meshBasicMaterial color={color} transparent opacity={Math.min(1, opacity + 0.22)} depthWrite={false} />
      </mesh>
    </group>
  )
}

function ApproximateRegionDebug({ meta, color }: { meta: ObjectFocusMeta; color: number }) {
  return (
    <group position={meta.center}>
      <mesh scale={[meta.size[0] * 0.55, meta.size[1] * 0.55, meta.size[2] * 0.55]}>
        <sphereGeometry args={[1, 20, 16]} />
        <meshBasicMaterial color={color} transparent opacity={0.12} depthWrite={false} wireframe />
      </mesh>
    </group>
  )
}

function CentroidDebug({ obj }: { obj: ObjectItem }) {
  return (
    <mesh position={[obj.x, obj.y, obj.z]}>
      <sphereGeometry args={[0.05, 14, 14]} />
      <meshBasicMaterial color={0xffffff} transparent opacity={0.9} />
    </mesh>
  )
}

function LegacyObjectBox({
  obj,
  color,
  opacity,
  onClick,
}: {
  obj: ObjectItem
  color: number
  opacity: number
  onClick: () => void
}) {
  const meta = useMemo(() => getObjectFocusMeta(obj), [obj])

  return (
    <group
      position={meta.center}
      onClick={(event) => {
        event.stopPropagation()
        onClick()
      }}
    >
      <lineSegments>
        <edgesGeometry args={[new THREE.BoxGeometry(meta.size[0], meta.size[1], meta.size[2])]} />
        <lineBasicMaterial color={color} transparent opacity={Math.min(1, opacity + 0.28)} />
      </lineSegments>
      <mesh>
        <boxGeometry args={[meta.size[0], meta.size[1], meta.size[2]]} />
        <meshBasicMaterial color={color} transparent opacity={opacity * 0.26} depthWrite={false} side={THREE.DoubleSide} />
      </mesh>
    </group>
  )
}

function SceneGrid({ objects }: { objects: ObjectItem[] }) {
  const size = useMemo(() => {
    if (objects.length === 0) return 10
    const xs = objects.map((object) => Math.abs(object.x))
    const zs = objects.map((object) => Math.abs(object.z))
    return Math.ceil(Math.max(...xs, ...zs) * 2 + 4)
  }, [objects])

  return <gridHelper args={[size, size, 0x333333, 0x1a1a1a]} position={[0, 0.001, size / 4]} visible={objects.length > 0} />
}

function ExploreCamera({
  objects,
  focusedObject,
  cameraCommand,
}: {
  objects: ObjectItem[]
  focusedObject: ObjectItem | null
  cameraCommand: CameraCommand | null
}) {
  const controlsRef = useRef<OrbitControlsImpl | null>(null)
  const desiredTarget = useRef(new THREE.Vector3(0, 0.5, 3))
  const desiredPosition = useRef(new THREE.Vector3(-2.4, 3.2, -2.8))
  const appliedCommand = useRef<string>("")
  const hasBootstrapped = useRef(false)
  const animationProgress = useRef(1)
  const animationFromPosition = useRef(new THREE.Vector3())
  const animationToPosition = useRef(new THREE.Vector3())
  const animationFromTarget = useRef(new THREE.Vector3())
  const animationToTarget = useRef(new THREE.Vector3())
  const { camera } = useThree()

  const overview = useMemo(() => {
    if (objects.length === 0) {
      return { target: new THREE.Vector3(0, 0.8, 3), distance: 6 }
    }

    const metas = objects.map((object) => getObjectFocusMeta(object))
    const xs = metas.map((meta) => meta.center[0])
    const ys = metas.map((meta) => meta.center[1])
    const zs = metas.map((meta) => meta.center[2])
    const spread = Math.max(
      Math.max(...xs) - Math.min(...xs),
      Math.max(...zs) - Math.min(...zs),
      Math.max(...ys) - Math.min(...ys)
    )
    return {
      target: new THREE.Vector3(
        xs.reduce((sum, value) => sum + value, 0) / xs.length,
        clamp(ys.reduce((sum, value) => sum + value, 0) / ys.length, 0.65, 1.4),
        zs.reduce((sum, value) => sum + value, 0) / zs.length
      ),
      distance: Math.max(spread * 1.1, 5.5),
    }
  }, [objects])

  const applyPreset = useCallback(
    (preset: CameraCommand["preset"]) => {
      const target = desiredTarget.current
      const position = desiredPosition.current

      if (preset === "top") {
        target.copy(overview.target)
        position.set(overview.target.x, overview.target.y + overview.distance * 1.45, overview.target.z + 0.001)
        return
      }

      if (preset === "focus" && focusedObject) {
        const meta = getObjectFocusMeta(focusedObject)
        const span = Math.max(meta.size[0], meta.size[1], meta.size[2], 0.9)
        target.set(meta.center[0], meta.center[1], meta.center[2])
        position.set(meta.center[0] - span * 2.2, meta.center[1] + span * 1.5, meta.center[2] - span * 2.4)
        return
      }

      target.copy(overview.target)
      position.set(
        overview.target.x - overview.distance * 0.45,
        overview.target.y + overview.distance * 0.52,
        overview.target.z - overview.distance * 0.6
      )
    },
    [focusedObject, overview.distance, overview.target]
  )

  const startCameraAnimation = useCallback(() => {
    if (!controlsRef.current) return
    animationFromPosition.current.copy(camera.position)
    animationToPosition.current.copy(desiredPosition.current)
    animationFromTarget.current.copy(controlsRef.current.target)
    animationToTarget.current.copy(desiredTarget.current)
    animationProgress.current = 0
  }, [camera.position])

  useEffect(() => {
    if (hasBootstrapped.current) return
    hasBootstrapped.current = true
    applyPreset("reset")
    camera.position.copy(desiredPosition.current)
    camera.lookAt(desiredTarget.current)
  }, [applyPreset, camera])

  useEffect(() => {
    if (!cameraCommand) return
    const commandKey = `${cameraCommand.preset}:${cameraCommand.nonce}`
    if (appliedCommand.current === commandKey) return
    appliedCommand.current = commandKey
    applyPreset(cameraCommand.preset)
    startCameraAnimation()
  }, [applyPreset, cameraCommand, startCameraAnimation])

  useFrame((_, delta) => {
    if (!controlsRef.current) return
    if (animationProgress.current < 1) {
      animationProgress.current = Math.min(1, animationProgress.current + delta * 2.2)
      const eased = 1 - Math.pow(1 - animationProgress.current, 3)
      camera.position.lerpVectors(animationFromPosition.current, animationToPosition.current, eased)
      controlsRef.current.target.lerpVectors(animationFromTarget.current, animationToTarget.current, eased)
    }
    controlsRef.current.update()
  })

  return (
    <OrbitControls
      ref={controlsRef}
      enableDamping
      dampingFactor={0.06}
      minPolarAngle={0.001}
      maxPolarAngle={Math.PI - 0.001}
      minDistance={1.4}
      maxDistance={Math.max(overview.distance * 3.4, 8)}
      autoRotate={false}
    />
  )
}

function AnnotatorSelectionLayer({
  objects,
  focusedObjectId,
  selectedObjectIds,
  hoveredObjectId,
  onObjectActivate,
  onObjectHover,
  debugOptions,
  exactHighlight,
  displayMode,
  colorMode,
}: {
  objects: ObjectItem[]
  focusedObjectId: string | null
  selectedObjectIds: string[]
  hoveredObjectId: string | null
  onObjectActivate?: (objectId: string, options?: { additive?: boolean }) => void
  onObjectHover?: (objectId: string | null) => void
  debugOptions: SceneDebugOptions
  exactHighlight: ExactObjectHighlight | null
  displayMode: SceneDisplayMode
  colorMode: SceneColorMode
}) {
  const objectById = useMemo(() => new Map(objects.map((object) => [object.id, object])), [objects])
  const selectedSet = useMemo(() => new Set(selectedObjectIds), [selectedObjectIds])
  const focusedObject = focusedObjectId ? objectById.get(focusedObjectId) ?? null : null
  const hoveredObject =
    hoveredObjectId && hoveredObjectId !== focusedObjectId ? objectById.get(hoveredObjectId) ?? null : null
  const focusedMeta = useMemo(() => (focusedObject ? getObjectFocusMeta(focusedObject) : null), [focusedObject])
  const hoveredMeta = useMemo(() => (hoveredObject ? getObjectFocusMeta(hoveredObject) : null), [hoveredObject])

  return (
    <>
      {objects.map((obj, index) => {
        const meta = getObjectFocusMeta(obj)
        const baseColor = getObjectColor(obj, index, colorMode)
        const isSelected = selectedSet.has(obj.id)
        const isFocused = focusedObjectId === obj.id
        const hasSelection = selectedSet.size > 0
        const hiddenByMode = displayMode === "isolate" && hasSelection && !isSelected
        const beaconOpacity = hiddenByMode ? 0 : hasSelection && !isSelected ? (displayMode === "ghost" ? 0.06 : 0.12) : 0.38

        return (
          <group key={`interactive-${obj.id}`}>
            <mesh
              position={meta.center}
              scale={[meta.size[0] * 0.68, meta.size[1] * 0.68, meta.size[2] * 0.68]}
              onPointerOver={(event) => {
                event.stopPropagation()
                onObjectHover?.(obj.id)
              }}
              onPointerOut={(event) => {
                event.stopPropagation()
                onObjectHover?.(null)
              }}
              onClick={(event: ThreeEvent<MouseEvent>) => {
                event.stopPropagation()
                onObjectActivate?.(obj.id, { additive: !!event.nativeEvent.shiftKey })
              }}
              renderOrder={-10}
            >
              <sphereGeometry args={[1, 16, 12]} />
              <meshBasicMaterial transparent opacity={0} depthWrite={false} colorWrite={false} />
            </mesh>

            {beaconOpacity > 0 ? (
              <ObjectBeacon meta={meta} color={isFocused ? SELECTED_ACCENT : baseColor} opacity={beaconOpacity} scale={isSelected ? 1.1 : 1} />
            ) : null}
          </group>
        )
      })}

      {selectedObjectIds.map((objectId, index) => {
        const object = objectById.get(objectId)
        if (!object) return null
        const meta = getObjectFocusMeta(object)
        return (
          <SelectionAura
            key={`selected-aura-${objectId}`}
            meta={meta}
            color={objectId === focusedObjectId ? SELECTED_ACCENT : getObjectColor(object, index, colorMode)}
            strength={objectId === focusedObjectId ? "selected" : "secondary"}
          />
        )
      })}

      {hoveredObject && hoveredMeta ? (
        <>
          <SelectionAura meta={hoveredMeta} color={HOVER_ACCENT} strength="hover" />
          <FocusCallout obj={hoveredObject} meta={hoveredMeta} color={HOVER_ACCENT} tone="hover" />
        </>
      ) : null}

      {focusedObject && focusedMeta ? (
        <FocusCallout obj={focusedObject} meta={focusedMeta} color={SELECTED_ACCENT} tone="selected" />
      ) : null}

      {debugOptions.showApproxRegion && hoveredMeta ? <ApproximateRegionDebug meta={hoveredMeta} color={HOVER_ACCENT} /> : null}
      {debugOptions.showApproxRegion && focusedMeta ? <ApproximateRegionDebug meta={focusedMeta} color={SELECTED_ACCENT} /> : null}

      {debugOptions.showCentroids
        ? objects
            .filter((object) => selectedSet.has(object.id) || object.id === hoveredObjectId)
            .map((object) => <CentroidDebug key={`centroid-${object.id}`} obj={object} />)
        : null}

      {debugOptions.showBBoxes
        ? objects
            .filter((object) => selectedSet.has(object.id) || object.id === hoveredObjectId)
            .map((object, index) => (
              <LegacyObjectBox
                key={`bbox-${object.id}`}
                obj={object}
                color={object.id === focusedObjectId ? SELECTED_ACCENT : getObjectColor(object, index, colorMode)}
                opacity={object.id === focusedObjectId ? 0.65 : 0.38}
                onClick={() => onObjectActivate?.(object.id)}
              />
            ))
        : null}

      {debugOptions.showExactPoints && exactHighlight && exactHighlight.sampledPoints.length > 0 ? (
        <ObjectPointHighlight points={exactHighlight.sampledPoints} />
      ) : null}
    </>
  )
}

function SceneContent({
  glbUrl,
  objects,
  mode,
  path,
  currentStepIndex,
  targetLabel,
  focusedObjectId,
  selectedObjectIds,
  hoveredObjectId,
  displayMode,
  colorMode,
  cameraCommand,
  onObjectActivate,
  onObjectHover,
  debugOptions,
  exactHighlight,
  onPointCount,
  onGlbError,
}: {
  glbUrl: string
  objects: ObjectItem[]
  mode: "default" | "annotator"
  path?: { x: number; z: number }[]
  currentStepIndex: number
  targetLabel?: string
  focusedObjectId: string | null
  selectedObjectIds: string[]
  hoveredObjectId: string | null
  displayMode: SceneDisplayMode
  colorMode: SceneColorMode
  cameraCommand: CameraCommand | null
  onObjectActivate?: (objectId: string, options?: { additive?: boolean }) => void
  onObjectHover?: (objectId: string | null) => void
  debugOptions: SceneDebugOptions
  exactHighlight: ExactObjectHighlight | null
  onPointCount: (n: number) => void
  onGlbError: () => void
}) {
  const navActive = !!path && path.length > 0
  const targetLower = targetLabel?.toLowerCase()
  const objectById = useMemo(() => new Map(objects.map((object) => [object.id, object])), [objects])
  const focusedObject = focusedObjectId ? objectById.get(focusedObjectId) ?? null : null
  const shaderSelectionRegion = useMemo(() => {
    if (mode !== "annotator" || !focusedObject) return null
    return toFocusRegion(getObjectFocusMeta(focusedObject))
  }, [focusedObject, mode])
  const shaderHoverRegion = useMemo(() => {
    if (mode !== "annotator" || !hoveredObjectId || hoveredObjectId === focusedObjectId) return null
    const object = objectById.get(hoveredObjectId)
    return object ? toFocusRegion(getObjectFocusMeta(object)) : null
  }, [focusedObjectId, hoveredObjectId, mode, objectById])

  return (
    <>
      {navActive ? (
        <ChaseCamera path={path} currentStepIndex={currentStepIndex} />
      ) : (
        <ExploreCamera objects={objects} focusedObject={focusedObject} cameraCommand={cameraCommand} />
      )}

      <ambientLight intensity={0.35} color={0xffffff} />
      <hemisphereLight intensity={0.65} color={0xf6efe6} groundColor={0x4c4338} />
      <directionalLight position={[6, 8, 4]} intensity={0.65} color={0xffffff} />
      <fog attach="fog" args={[BG, 12, 30]} />

      <SceneGrid objects={objects} />

      <Suspense fallback={null}>
        <GlbSceneModel
          url={glbUrl}
          selectionRegion={shaderSelectionRegion}
          hoverRegion={shaderHoverRegion}
          sceneDisplayMode={displayMode}
          onLoad={onPointCount}
          onError={onGlbError}
        />
      </Suspense>

      {mode === "annotator" ? (
        <AnnotatorSelectionLayer
          objects={objects}
          focusedObjectId={focusedObjectId}
          selectedObjectIds={selectedObjectIds}
          hoveredObjectId={hoveredObjectId}
          onObjectActivate={onObjectActivate}
          onObjectHover={onObjectHover}
          debugOptions={debugOptions}
          exactHighlight={exactHighlight}
          displayMode={displayMode}
          colorMode={colorMode}
        />
      ) : (
        objects.map((object, index) => (
          <LegacyObjectBox
            key={object.id || `${object.label}-${index}`}
            obj={object}
            color={getObjectColor(object, index, colorMode)}
            opacity={targetLower && object.label.toLowerCase() === targetLower ? 0.68 : 0.42}
            onClick={() => onObjectActivate?.(object.id)}
          />
        ))
      )}

      {navActive ? <NavigationPath path={path} currentStepIndex={currentStepIndex} /> : null}
      <GizmoHelper alignment="bottom-right" margin={[82, 82]}>
        <GizmoViewport axisColors={["#ff8a5b", "#65d6ff", "#8cf0a8"]} labelColor="#f8fafc" />
      </GizmoHelper>
    </>
  )
}

interface HomeSceneInnerProps {
  glbUrl: string
  objects: ObjectItem[]
  mode: "default" | "annotator"
  path?: { x: number; z: number }[]
  currentStepIndex: number
  targetLabel?: string
  focusedObjectId?: string | null
  selectedObjectIds?: string[]
  hoveredObjectId?: string | null
  displayMode?: SceneDisplayMode
  colorMode?: SceneColorMode
  cameraCommand?: CameraCommand | null
  onObjectActivate?: (objectId: string, options?: { additive?: boolean }) => void
  onObjectHover?: (objectId: string | null) => void
  debugOptions: SceneDebugOptions
  exactHighlight: ExactObjectHighlight | null
  onPointCount: (n: number) => void
  onGlbError: () => void
}

export function HomeSceneInner({
  glbUrl,
  objects,
  mode,
  path,
  currentStepIndex,
  targetLabel,
  focusedObjectId = null,
  selectedObjectIds = [],
  hoveredObjectId = null,
  displayMode = "normal",
  colorMode = "natural",
  cameraCommand = null,
  onObjectActivate,
  onObjectHover,
  debugOptions,
  exactHighlight,
  onPointCount,
  onGlbError,
}: HomeSceneInnerProps) {
  const [canvasReady, setCanvasReady] = useState(false)

  return (
    <div className="h-full w-full bg-[#05070c]">
      <Canvas
        camera={{ position: [-2.4, 3.2, -2.8], fov: 48, near: 0.01, far: 1000 }}
        gl={{ antialias: true }}
        dpr={[1, 1.75]}
        onCreated={() => setCanvasReady(true)}
      >
        <color attach="background" args={[BG]} />
        {canvasReady ? (
          <SceneContent
            glbUrl={glbUrl}
            objects={objects}
            mode={mode}
            path={path}
            currentStepIndex={currentStepIndex}
            targetLabel={targetLabel}
            focusedObjectId={focusedObjectId}
            selectedObjectIds={selectedObjectIds}
            hoveredObjectId={hoveredObjectId}
            displayMode={displayMode}
            colorMode={colorMode}
            cameraCommand={cameraCommand}
            onObjectActivate={onObjectActivate}
            onObjectHover={onObjectHover}
            debugOptions={debugOptions}
            exactHighlight={exactHighlight}
            onPointCount={onPointCount}
            onGlbError={onGlbError}
          />
        ) : null}
      </Canvas>
    </div>
  )
}
