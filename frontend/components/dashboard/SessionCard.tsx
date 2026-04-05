"use client"

import { Card } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { BorderBeam } from "@/components/ui/border-beam"
import { PulsatingButton } from "@/components/ui/pulsating-button"
import { MapPin, Gauge, Clock } from "lucide-react"

interface SessionCardProps {
  name: string
  status: "active" | "paused" | "ended"
  speedMph: number
  lastSeen: string
  nearbyHazards: number
  lastDetection: string
}

export function SessionCard({
  name,
  status,
  speedMph,
  lastSeen,
  nearbyHazards,
  lastDetection,
}: SessionCardProps) {
  const isActive = status === "active"

  return (
    <Card className="relative overflow-hidden border-mango/20 bg-card p-6">
      {isActive && (
        <BorderBeam size={120} duration={5} colorFrom="#F5A623" colorTo="#FDDDA0" />
      )}

      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs text-muted-foreground">Active session</p>
          <h2 className="mt-1 text-xl font-bold">{name}</h2>
        </div>
        {isActive ? (
          <PulsatingButton
            pulseColor="#F5A623"
            className="bg-mango-subtle border border-mango/30 px-3 py-1 text-xs font-medium text-mango"
          >
            ● Active
          </PulsatingButton>
        ) : (
          <Badge variant="secondary">{status}</Badge>
        )}
      </div>

      <div className="mt-5 grid grid-cols-3 gap-3">
        <div className="rounded-lg border border-border bg-background/50 p-3">
          <Gauge className="h-4 w-4 text-mango" />
          <p className="mt-1 text-lg font-semibold">{speedMph}</p>
          <p className="text-xs text-muted-foreground">mph</p>
        </div>
        <div className="rounded-lg border border-border bg-background/50 p-3">
          <Clock className="h-4 w-4 text-mango" />
          <p className="mt-1 text-lg font-semibold">{lastSeen}</p>
          <p className="text-xs text-muted-foreground">last seen</p>
        </div>
        <div className="rounded-lg border border-border bg-background/50 p-3">
          <MapPin className="h-4 w-4 text-mango" />
          <p className="mt-1 text-lg font-semibold">{nearbyHazards}</p>
          <p className="text-xs text-muted-foreground">hazards</p>
        </div>
      </div>

      {lastDetection && (
        <p className="mt-4 rounded-md bg-mango-subtle border border-mango/20 px-3 py-2 text-xs text-mango font-mono">
          ▶ &quot;{lastDetection}&quot;
        </p>
      )}
    </Card>
  )
}
