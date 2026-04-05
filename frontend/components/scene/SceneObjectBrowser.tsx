"use client"

import type { MouseEvent } from "react"
import { EyeOff, Layers3, Pin, Search, Sparkles } from "lucide-react"

import type { ObjectItem } from "@/components/scene/HomeSceneViewer"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"

type GroupedLabel = {
  label: string
  objects: ObjectItem[]
}

interface SceneObjectBrowserProps {
  objects: ObjectItem[]
  query: string
  selectedObjectIds: string[]
  focusedObjectId: string | null
  pinnedObjectIds: string[]
  hiddenLabels: string[]
  hiddenObjectIds: string[]
  onQueryChange: (value: string) => void
  onSelectObject: (objectId: string, additive?: boolean) => void
  onSelectLabel: (label: string) => void
  onHoverObject?: (objectId: string | null) => void
  onTogglePin: (objectId: string) => void
  onHideObject: (objectId: string) => void
  onToggleLabelVisibility: (label: string) => void
  onResetVisibility: () => void
  className?: string
  listClassName?: string
}

export function SceneObjectBrowser({
  objects,
  query,
  selectedObjectIds,
  focusedObjectId,
  pinnedObjectIds,
  hiddenLabels,
  hiddenObjectIds,
  onQueryChange,
  onSelectObject,
  onSelectLabel,
  onHoverObject,
  onTogglePin,
  onHideObject,
  onToggleLabelVisibility,
  onResetVisibility,
  className,
  listClassName,
}: SceneObjectBrowserProps) {
  const grouped = objects.reduce<Map<string, ObjectItem[]>>((map, object) => {
    const key = object.label.trim().toLowerCase()
    const current = map.get(key) ?? []
    current.push(object)
    map.set(key, current)
    return map
  }, new Map())

  const groupedLabels: GroupedLabel[] = Array.from(grouped.entries())
    .map(([label, labelObjects]) => ({
      label,
      objects: [...labelObjects].sort((left, right) => {
        const leftPinned = pinnedObjectIds.includes(left.id) ? 1 : 0
        const rightPinned = pinnedObjectIds.includes(right.id) ? 1 : 0
        if (leftPinned !== rightPinned) return rightPinned - leftPinned
        return (right.n_observations ?? 0) - (left.n_observations ?? 0)
      }),
    }))
    .sort((left, right) => {
      if (left.objects.length !== right.objects.length) return right.objects.length - left.objects.length
      return left.label.localeCompare(right.label)
    })

  const visibleCount = objects.length
  const selectedCount = selectedObjectIds.length
  const hiddenCount = hiddenLabels.length + hiddenObjectIds.length

  return (
    <Card className={cn("border-border/60 bg-card/58 shadow-none backdrop-blur-2xl", className)}>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="text-lg">Objects</CardTitle>
            <CardDescription>{visibleCount} visible in the current scene view</CardDescription>
          </div>
          <Button variant="outline" size="sm" className="rounded-full" onClick={onResetVisibility}>
            Reset view
          </Button>
        </div>

        <div className="relative pt-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            placeholder="Search objects or classes"
            className="rounded-2xl border-border/70 bg-background/55 pl-10"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2 pt-1 text-xs text-muted-foreground">
          <span className="rounded-full border border-border/60 bg-background/44 px-3 py-1.5">
            {selectedCount} selected
          </span>
          <span className="rounded-full border border-border/60 bg-background/44 px-3 py-1.5">
            {groupedLabels.length} classes
          </span>
          {hiddenCount > 0 ? (
            <span className="rounded-full border border-red-500/25 bg-red-500/8 px-3 py-1.5 text-red-400">
              {hiddenCount} hidden
            </span>
          ) : null}
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        <div className={cn("max-h-[760px] space-y-3 overflow-y-auto pr-1", listClassName)}>
          {groupedLabels.length > 0 ? (
            groupedLabels.map((group) => {
              const classSelected = group.objects.some((object) => selectedObjectIds.includes(object.id))
              const classHidden = hiddenLabels.includes(group.label)

              return (
                <div key={group.label} className="rounded-3xl border border-border/55 bg-background/40 p-3">
                  <div className="flex items-center justify-between gap-3">
                    <button
                      type="button"
                      onClick={() => onSelectLabel(group.label)}
                      className={cn(
                        "flex min-w-0 items-center gap-2 rounded-full border px-3 py-1.5 text-left transition-colors",
                        classSelected
                          ? "border-mango/35 bg-mango/10 text-mango"
                          : "border-border/60 bg-background/50 text-foreground hover:bg-mango/6"
                      )}
                    >
                      <Layers3 className="h-3.5 w-3.5 shrink-0" />
                      <span className="truncate font-medium capitalize">{group.label}</span>
                      <Badge className="border-border/60 bg-background/70 text-[10px] text-muted-foreground">
                        {group.objects.length}
                      </Badge>
                    </button>

                    <Button
                      variant="ghost"
                      size="icon"
                      className={cn("h-8 w-8 rounded-full", classHidden ? "text-red-400" : "text-muted-foreground")}
                      onClick={() => onToggleLabelVisibility(group.label)}
                    >
                      <EyeOff className="h-4 w-4" />
                    </Button>
                  </div>

                  <div className="mt-3 space-y-2">
                    {group.objects.map((object) => {
                      const isFocused = object.id === focusedObjectId
                      const isSelected = selectedObjectIds.includes(object.id)
                      const isPinned = pinnedObjectIds.includes(object.id)

                      return (
                        <div
                          key={object.id}
                          onMouseEnter={() => onHoverObject?.(object.id)}
                          onMouseLeave={() => onHoverObject?.(null)}
                          className={cn(
                            "flex items-start gap-2 rounded-2xl border p-2 transition-colors",
                            isFocused
                              ? "border-mango/45 bg-mango/12"
                              : isSelected
                                ? "border-sky-300/40 bg-sky-300/10"
                                : "border-border/60 bg-background/48 hover:bg-background/60"
                          )}
                        >
                          <button
                            type="button"
                            onClick={(event: MouseEvent<HTMLButtonElement>) => onSelectObject(object.id, event.shiftKey)}
                            onFocus={() => onHoverObject?.(object.id)}
                            onBlur={() => onHoverObject?.(null)}
                            className="min-w-0 flex-1 rounded-xl px-1 py-1 text-left"
                          >
                            <div className="min-w-0">
                              <div className="flex items-center gap-2">
                                <p className="truncate font-medium capitalize text-foreground">{object.label}</p>
                                {isFocused ? (
                                  <span className="rounded-full border border-mango/30 bg-mango/10 px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.14em] text-mango">
                                    Focus
                                  </span>
                                ) : null}
                                {isPinned ? <Sparkles className="h-3.5 w-3.5 text-mango" /> : null}
                              </div>
                              <p className="mt-1 text-xs text-muted-foreground">
                                {object.n_observations} frames
                              </p>
                            </div>
                          </button>

                          <div className="flex shrink-0 items-center gap-1 self-center">
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className={cn("h-8 w-8 rounded-full", isPinned ? "text-mango" : "text-muted-foreground")}
                              onClick={() => onTogglePin(object.id)}
                            >
                              <Pin className="h-4 w-4" />
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 rounded-full text-muted-foreground"
                              onClick={() => onHideObject(object.id)}
                            >
                              <EyeOff className="h-4 w-4" />
                            </Button>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )
            })
          ) : (
            <div className="rounded-2xl border border-border/60 bg-background/40 px-4 py-6 text-sm text-muted-foreground">
              No objects match the current search.
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
