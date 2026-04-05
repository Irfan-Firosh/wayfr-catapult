"use client"

import { useState } from "react"
import { Navbar } from "@/components/nav/Navbar"
import { BlurFade } from "@/components/ui/blur-fade"
import { ShimmerButton } from "@/components/ui/shimmer-button"
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
          <p className="mb-2 text-xs text-muted-foreground">3 annotations remaining today</p>
          <h1 className="text-2xl font-bold">Add a scene annotation</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Repeated annotations at the same location strengthen the shared scene for everyone.
          </p>
        </BlurFade>

        {!submitted ? (
          <BlurFade delay={0.2}>
            <form onSubmit={handleSubmit} className="mt-8 space-y-5">
              {/* Location */}
              <div className="rounded-2xl border border-mango/10 bg-card/60 backdrop-blur-xl p-4">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <MapPin className="h-4 w-4 text-mango" />
                  Scene location
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
                <label className="text-sm font-medium">Annotation type</label>
                <Select required>
                  <SelectTrigger className="border-mango/20 bg-card">
                    <SelectValue placeholder="Select annotation type" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="object">Object</SelectItem>
                    <SelectItem value="surface">Surface</SelectItem>
                    <SelectItem value="landmark">Landmark</SelectItem>
                    <SelectItem value="persona_note">Persona note</SelectItem>
                    <SelectItem value="scene_context">Scene context</SelectItem>
                    <SelectItem value="path">Path cue</SelectItem>
                    <SelectItem value="other">Other</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Severity */}
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Priority</label>
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
                  placeholder="Describe the scene detail — e.g. 'White table next to the window'"
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
                Your annotation will be added to the shared scene history for nearby wayfr users.
              </p>
            </form>
          </BlurFade>
        ) : (
          <BlurFade delay={0.1}>
            <div className="mt-8 rounded-2xl border border-green-500/20 bg-green-500/5 backdrop-blur-xl p-8 text-center">
              <CheckCircle2 className="mx-auto h-10 w-10 text-green-400" />
              <h2 className="mt-4 text-xl font-bold text-green-400">Annotation saved</h2>
              <p className="mt-2 text-sm text-muted-foreground">
                Confirmed by 2 others at this location. 1 more needed to strengthen the scene.
              </p>
              <p className="mt-4 text-xs text-muted-foreground">
                Active wayfr users within 100m can now see this scene update.
              </p>
            </div>
          </BlurFade>
        )}
      </div>
    </main>
  )
}
