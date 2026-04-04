"use client"

import { Marquee } from "@/components/ui/marquee"

const items = [
  "4 AI models in parallel",
  "< 860ms latency",
  "World ID verified",
  "Purdue RCAC trained",
  "PostGIS hazard map",
  "ElevenLabs TTS",
  "Real-time caregiver dashboard",
  "On-chain attestations",
  "WCAG 2.1 AA",
  "Zero stored frames",
]

export function SocialProof() {
  return (
    <section className="relative overflow-hidden border-y border-border/30 py-8">
      <div className="pointer-events-none absolute inset-y-0 left-0 z-10 w-24 bg-gradient-to-r from-background to-transparent" />
      <div className="pointer-events-none absolute inset-y-0 right-0 z-10 w-24 bg-gradient-to-l from-background to-transparent" />
      <Marquee className="[--duration:35s]" pauseOnHover>
        {items.map((item) => (
          <span
            key={item}
            className="mx-6 flex items-center gap-2 text-sm text-muted-foreground"
          >
            <span className="h-1 w-1 rounded-full bg-mango" />
            {item}
          </span>
        ))}
      </Marquee>
    </section>
  )
}
