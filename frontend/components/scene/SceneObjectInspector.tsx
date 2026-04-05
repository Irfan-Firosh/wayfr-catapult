"use client"

import { EyeOff, Focus, Pin, ScanSearch, Sparkles } from "lucide-react"

import type { ObjectItem, SceneDisplayMode } from "@/components/scene/HomeSceneViewer"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { cn } from "@/lib/utils"

interface SceneObjectInspectorProps {
  focusedObject: ObjectItem | null
  selectedObjects: ObjectItem[]
  pinnedObjectIds: string[]
  displayMode: SceneDisplayMode
  onClearSelection: () => void
  onToggleIsolate: () => void
  onTogglePin: (objectId: string) => void
  onHideObject: (objectId: string) => void
  onHideLabel: (label: string) => void
  className?: string
}

export function SceneObjectInspector({
  focusedObject,
  selectedObjects,
  pinnedObjectIds,
  displayMode,
  onClearSelection,
  onToggleIsolate,
  onTogglePin,
  onHideObject,
  onHideLabel,
  className,
}: SceneObjectInspectorProps) {
  const multipleSelected = selectedObjects.length > 1
  const focusedPinned = focusedObject ? pinnedObjectIds.includes(focusedObject.id) : false

  return (
    <Card className={cn("border-border/60 bg-card/58 shadow-none backdrop-blur-2xl", className)}>
      <CardHeader className="pb-3">
        <CardTitle className="text-lg">Inspector</CardTitle>
        <CardDescription>
          {focusedObject ? "Focus an object to inspect its geometry." : "Select an object to inspect its geometry."}
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        {focusedObject ? (
          <>
            <div className="rounded-3xl border border-mango/20 bg-mango/8 p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-mango/80">Focused object</p>
                  <h3 className="mt-2 text-2xl font-semibold capitalize text-foreground">{focusedObject.label}</h3>
                  <p className="mt-1 text-sm text-muted-foreground">{selectedObjects.length} selected</p>
                </div>
                {focusedPinned ? <Sparkles className="mt-1 h-5 w-5 text-mango" /> : null}
              </div>

              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <div className="rounded-2xl border border-border/60 bg-background/45 px-3 py-3">
                  <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Track</p>
                  <p className="mt-2 text-lg font-semibold text-foreground">{focusedObject.track_id ?? "n/a"}</p>
                </div>
                <div className="rounded-2xl border border-border/60 bg-background/45 px-3 py-3">
                  <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Frames</p>
                  <p className="mt-2 text-lg font-semibold text-foreground">{focusedObject.n_observations} frames</p>
                </div>
              </div>

              <div className="mt-4 grid gap-3 sm:grid-cols-3">
                <div className="rounded-2xl border border-border/60 bg-background/45 px-3 py-3">
                  <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">X</p>
                  <p className="mt-1 text-sm text-foreground">{focusedObject.x.toFixed(2)}</p>
                </div>
                <div className="rounded-2xl border border-border/60 bg-background/45 px-3 py-3">
                  <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Y</p>
                  <p className="mt-1 text-sm text-foreground">{focusedObject.y.toFixed(2)}</p>
                </div>
                <div className="rounded-2xl border border-border/60 bg-background/45 px-3 py-3">
                  <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Z</p>
                  <p className="mt-1 text-sm text-foreground">{focusedObject.z.toFixed(2)}</p>
                </div>
              </div>
            </div>

            <div className="grid gap-2 sm:grid-cols-2">
              <Button variant="outline" className="rounded-full" onClick={onToggleIsolate}>
                <Focus className="mr-2 h-4 w-4" />
                {displayMode === "isolate" ? "Exit isolate" : "Isolate focus"}
              </Button>
              <Button variant="outline" className="rounded-full" onClick={onClearSelection}>
                <ScanSearch className="mr-2 h-4 w-4" />
                Clear selection
              </Button>
              <Button variant="outline" className="rounded-full" onClick={() => onTogglePin(focusedObject.id)}>
                <Pin className="mr-2 h-4 w-4" />
                {focusedPinned ? "Unpin object" : "Pin object"}
              </Button>
              <Button variant="outline" className="rounded-full" onClick={() => onHideObject(focusedObject.id)}>
                <EyeOff className="mr-2 h-4 w-4" />
                Hide instance
              </Button>
            </div>

            <Button variant="outline" className="w-full rounded-full" onClick={() => onHideLabel(focusedObject.label)}>
              <EyeOff className="mr-2 h-4 w-4" />
              Hide class &quot;{focusedObject.label}&quot;
            </Button>

            {multipleSelected ? (
              <div className="rounded-2xl border border-sky-300/20 bg-sky-300/8 px-4 py-3 text-sm text-sky-100">
                {selectedObjects.length} objects are selected. The first active focus stays centered while the rest stay
                grouped in the scene.
              </div>
            ) : null}
          </>
        ) : (
          <div className="rounded-2xl border border-border/60 bg-background/40 px-4 py-6 text-sm text-muted-foreground">
            Select an object from the sidebar or click directly in the scene to inspect it here.
          </div>
        )}
      </CardContent>
    </Card>
  )
}
