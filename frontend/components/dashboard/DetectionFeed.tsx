"use client"

import { AnimatedList } from "@/components/ui/animated-list"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"

export interface Detection {
  id: string
  timestamp: string
  type: "obstacle" | "text" | "hazard_alert" | "scene"
  content: string
  urgency: "urgent" | "normal" | "low"
}

const urgencyConfig = {
  urgent: { label: "Urgent", className: "border-destructive/30 bg-destructive/10 text-destructive" },
  normal: { label: "Normal", className: "border-mango/30 bg-mango-subtle text-mango" },
  low:    { label: "Info",   className: "border-border bg-muted text-muted-foreground" },
}

function DetectionItem({ item }: { item: Detection }) {
  const cfg = urgencyConfig[item.urgency]
  return (
    <div className="flex items-start gap-3 rounded-lg border border-border bg-card px-3 py-2.5 text-sm">
      <span className="mt-0.5 font-mono text-xs text-muted-foreground shrink-0">
        {item.timestamp}
      </span>
      <p className="flex-1 text-foreground">{item.content}</p>
      <Badge variant="outline" className={cn("text-xs shrink-0", cfg.className)}>
        {cfg.label}
      </Badge>
    </div>
  )
}

const mockDetections: Detection[] = [
  { id: "1", timestamp: "10:32:07", type: "obstacle", content: "Curb drop 3 feet ahead on your right", urgency: "urgent" },
  { id: "2", timestamp: "10:32:04", type: "text",     content: "Sign reads: PULL TO OPEN",            urgency: "normal" },
  { id: "3", timestamp: "10:32:01", type: "obstacle", content: "Clear path ahead, continuing forward", urgency: "low" },
  { id: "4", timestamp: "10:31:58", type: "hazard_alert", content: "Community alert: Construction 32m ahead, verified by 4 people", urgency: "urgent" },
  { id: "5", timestamp: "10:31:54", type: "scene",    content: "Busy corridor with door 6 feet ahead", urgency: "low" },
  { id: "6", timestamp: "10:31:50", type: "obstacle", content: "Pole on your left, medium distance",  urgency: "normal" },
]

export function DetectionFeed() {
  return (
    <div className="rounded-xl border border-border bg-card">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <h3 className="text-sm font-semibold">Detection feed</h3>
        <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <span className="h-1.5 w-1.5 rounded-full bg-mango animate-pulse" />
          Live
        </span>
      </div>
      <ScrollArea className="h-72">
        <div className="p-3">
          <AnimatedList delay={800}>
            {mockDetections.map((d) => (
              <DetectionItem key={d.id} item={d} />
            ))}
          </AnimatedList>
        </div>
      </ScrollArea>
    </div>
  )
}
