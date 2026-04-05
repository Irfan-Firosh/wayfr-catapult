import { Card } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { AlertTriangle, MapPin } from "lucide-react"
import { cn } from "@/lib/utils"

interface Hazard {
  id: string
  type: string
  severity: "low" | "medium" | "high" | "critical"
  distanceM: number
  direction: string
  description: string
  verifiedCount: number
}

const severityConfig = {
  critical: { color: "text-destructive", bg: "bg-destructive/10 border-destructive/30" },
  high:     { color: "text-orange-500",  bg: "bg-orange-500/10 border-orange-500/30" },
  medium:   { color: "text-mango",       bg: "bg-mango-subtle border-mango/30" },
  low:      { color: "text-green-500",   bg: "bg-green-500/10 border-green-500/30" },
}

const mockHazards: Hazard[] = [
  { id: "1", type: "Construction", severity: "high", distanceM: 32, direction: "ahead", description: "Major sidewalk construction", verifiedCount: 4 },
  { id: "2", type: "Wet floor", severity: "medium", distanceM: 67, direction: "left", description: "Building entrance slippery", verifiedCount: 3 },
]

export function NearbyHazards() {
  return (
    <Card className="border-border bg-card p-5">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Nearby hazards</h3>
        <Badge variant="outline" className="border-mango/30 text-mango text-xs">
          {mockHazards.length} active
        </Badge>
      </div>

      {mockHazards.length > 0 && (
        <Alert className="mt-3 border-orange-500/30 bg-orange-500/10">
          <AlertTriangle className="h-4 w-4 text-orange-500" />
          <AlertDescription className="text-xs text-orange-400">
            {mockHazards.length} verified hazards within 100m
          </AlertDescription>
        </Alert>
      )}

      <div className="mt-4 space-y-2">
        {mockHazards.map((h) => {
          const cfg = severityConfig[h.severity]
          return (
            <div key={h.id} className={cn("rounded-lg border px-3 py-3", cfg.bg)}>
              <div className="flex items-center justify-between">
                <span className={cn("text-sm font-medium", cfg.color)}>{h.type}</span>
                <div className="flex items-center gap-1 text-xs text-muted-foreground">
                  <MapPin className="h-3 w-3" />
                  {h.distanceM}m {h.direction}
                </div>
              </div>
              <p className="mt-0.5 text-xs text-muted-foreground">{h.description}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Verified by {h.verifiedCount} people
              </p>
            </div>
          )
        })}
      </div>
    </Card>
  )
}
