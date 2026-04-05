"use client"

import Link from "next/link"
import { Waves } from "@/components/ui/wave-background"
import { SparklesText } from "@/components/ui/sparkles-text"
import { ShimmerButton } from "@/components/ui/shimmer-button"
import { Meteors } from "@/components/ui/meteors"
import { BlurFade } from "@/components/ui/blur-fade"
import { Button } from "@/components/ui/button"
import { ArrowRight } from "lucide-react"

export function Hero() {
  return (
    <section className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden">
      {/* Wave background — mango tinted */}
      <Waves
        className="absolute inset-0 h-full w-full"
        strokeColor="#F5A623"
        backgroundColor="transparent"
        pointerSize={0.4}
      />

      {/* Meteor decoration */}
      <div className="absolute inset-0 overflow-hidden">
        <Meteors number={12} />
      </div>

      {/* Content */}
      <div className="relative z-10 mx-auto max-w-4xl px-6 text-center">
        <BlurFade delay={0.1}>
          <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-mango/20 bg-mango-subtle px-4 py-1.5 text-sm text-mango">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-mango opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-mango" />
            </span>
            2D → 3D → VLM → Audio. Under 1 second.
          </div>
        </BlurFade>

        <BlurFade delay={0.2}>
          <SparklesText
            className="text-5xl font-bold tracking-tight sm:text-7xl"
            sparklesCount={8}
            colors={{ first: "#F5A623", second: "#FDDDA0" }}
          >
            Navigate freely.
          </SparklesText>
        </BlurFade>

        <BlurFade delay={0.3}>
          <p className="mx-auto mt-6 max-w-2xl text-lg text-muted-foreground">
            Real-time AI navigation for the visually impaired. Obstacle detection,
            community-verified hazards, and caregiver monitoring — all through
            smart glasses.
          </p>
        </BlurFade>

        <BlurFade delay={0.4}>
          <div className="mt-10 flex flex-col items-center gap-4 sm:flex-row sm:justify-center">
            <Link href="/pipeline">
              <ShimmerButton
                shimmerColor="#F5A623"
                background="oklch(0.735 0.152 71)"
                className="px-8 py-3 text-sm font-semibold text-background"
              >
                View Live Pipeline
                <ArrowRight className="ml-2 h-4 w-4" />
              </ShimmerButton>
            </Link>
            <Link href="/dashboard">
              <Button
                variant="outline"
                size="lg"
                className="border-mango/30 text-foreground hover:border-mango/60 hover:bg-mango-subtle"
              >
                Caregiver Dashboard
              </Button>
            </Link>
          </div>
        </BlurFade>
      </div>

      {/* Bottom fade */}
      <div className="absolute bottom-0 left-0 right-0 h-32 bg-gradient-to-t from-background to-transparent" />
    </section>
  )
}
