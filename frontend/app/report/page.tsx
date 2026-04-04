"use client"

import { useState } from "react"
import { Navbar } from "@/components/nav/Navbar"
import { BlurFade } from "@/components/ui/blur-fade"
import { ShimmerButton } from "@/components/ui/shimmer-button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { toast } from "sonner"
import { MapPin, CheckCircle2 } from "lucide-react"
import { cn } from "@/lib/utils"

type Severity = "low" | "medium" | "high" | "critical"

const severityOptions: { value: Severity; label: string; color: string }[] = [
  { value: "low",      label: "Low",      color: "border-green-500/40 bg-green-500/10 text-green-400" },
  { value: "medium",   label: "Medium",   color: "border-mango/40 bg-mango-subtle text-mango" },
  { value: "high",     label: "High",     color: "border-orange-500/40 bg-orange-500/10 text-orange-400" },
  { value: "critical", label: "Critical", color: "border-destructive/40 bg-destructive/10 text-destructive" },
]

export default function ReportPage() {
  const [severity, setSeverity] = useState<Severity>("medium")
  const [submitted, setSubmitted] = useState(false)
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    await new Promise((r) => setTimeout(r, 1500))
    setLoading(false)
    setSubmitted(true)
    toast.success("Item reported", { description: "Active users nearby have been alerted." })
  }

  return (
    <main className="min-h-screen bg-background">
      <Navbar />

      <div className="mx-auto max-w-lg px-6 pt-24 pb-16">
        <BlurFade delay={0.1}>
          <div className="mb-2 flex items-center gap-2">
            <Badge variant="outline" className="border-green-500/30 bg-green-500/10 text-green-400 text-xs">
              ✓ Verified Human
            </Badge>
            <span className="text-xs text-muted-foreground">3 reports remaining today</span>
          </div>
          <h1 className="text-2xl font-bold">Report an obstacle</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            3+ verified reports at the same location auto-verify the obstacle for all users.
          </p>
        </BlurFade>

        {!submitted ? (
          <BlurFade delay={0.2}>
            <form onSubmit={handleSubmit} className="mt-8 space-y-5">
              {/* Location */}
              <div className="rounded-2xl border border-mango/10 bg-card/60 backdrop-blur-xl p-4">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <MapPin className="h-4 w-4 text-mango" />
                  GPS location
                </div>
                <p className="mt-1 font-mono text-xs text-muted-foreground">
                  40.4237° N, 86.9212° W — West Lafayette, IN
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Auto-detected from your device. Accurate to ±5m.
                </p>
              </div>

              {/* Type */}
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Obstacle type</label>
                <Select required>
                  <SelectTrigger className="border-mango/20 bg-card">
                    <SelectValue placeholder="Select obstacle type" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="construction">Construction zone</SelectItem>
                    <SelectItem value="wet_floor">Wet floor</SelectItem>
                    <SelectItem value="broken_sidewalk">Broken sidewalk</SelectItem>
                    <SelectItem value="missing_curb_cut">Missing curb cut</SelectItem>
                    <SelectItem value="obstacle">Obstacle</SelectItem>
                    <SelectItem value="step">Step / level change</SelectItem>
                    <SelectItem value="vehicle_blocking">Vehicle blocking path</SelectItem>
                    <SelectItem value="other">Other</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Severity */}
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Severity</label>
                <div className="grid grid-cols-4 gap-2">
                  {severityOptions.map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => setSeverity(opt.value)}
                      className={cn(
                        "rounded-lg border px-2 py-2 text-xs font-medium transition-all",
                        severity === opt.value
                          ? opt.color
                          : "border-border bg-card text-muted-foreground hover:border-mango/30"
                      )}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Notes */}
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Notes (optional)</label>
                <Textarea
                  placeholder="Describe the obstacle — e.g. 'Large crack spanning full sidewalk width'"
                  className="border-mango/20 bg-card resize-none"
                  rows={3}
                />
              </div>

              {/* Photo (stub) */}
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Photo (optional)</label>
                <Input
                  type="file"
                  accept="image/*"
                  className="border-mango/20 bg-card text-sm text-muted-foreground file:text-mango file:border-0 file:bg-transparent"
                />
              </div>

              <ShimmerButton
                shimmerColor="#F5A623"
                background="oklch(0.735 0.152 71)"
                className="w-full justify-center py-3 text-sm font-semibold text-background"
                type="submit"
                disabled={loading}
              >
                {loading ? (
                  <span className="flex items-center gap-2">
                    <span className="h-4 w-4 animate-spin rounded-full border-2 border-background/30 border-t-background" />
                    Submitting...
                  </span>
                ) : (
                  "Submit report"
                )}
              </ShimmerButton>

              <p className="text-center text-xs text-muted-foreground">
                Your report will be attested on World Chain — an immutable record that
                a verified human flagged this obstacle.
              </p>
            </form>
          </BlurFade>
        ) : (
          <BlurFade delay={0.1}>
            <div className="mt-8 rounded-2xl border border-green-500/20 bg-green-500/5 backdrop-blur-xl p-8 text-center">
              <CheckCircle2 className="mx-auto h-10 w-10 text-green-400" />
              <h2 className="mt-4 text-xl font-bold text-green-400">Obstacle reported</h2>
              <p className="mt-2 text-sm text-muted-foreground">
                Confirmed by 2 others at this location. 1 more needed to auto-verify.
              </p>
              <div className="mt-4 rounded-lg border border-border bg-background/30 px-4 py-2 font-mono text-xs text-muted-foreground">
                on-chain: 0x7f3c...a8d2 · World Chain
              </div>
              <p className="mt-4 text-xs text-muted-foreground">
                Active wayfr users within 100m have been alerted about this obstacle.
              </p>
            </div>
          </BlurFade>
        )}
      </div>
    </main>
  )
}
