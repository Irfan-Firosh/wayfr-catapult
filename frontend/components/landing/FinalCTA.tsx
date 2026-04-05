import Link from "next/link"
import { RetroGrid } from "@/components/ui/retro-grid"
import { ShimmerButton } from "@/components/ui/shimmer-button"
import { BlurFade } from "@/components/ui/blur-fade"
import { Button } from "@/components/ui/button"
import { ArrowRight } from "lucide-react"

export function FinalCTA() {
  return (
    <section className="relative overflow-hidden py-32">
      <RetroGrid
        className="absolute inset-0 opacity-30"
        angle={65}
        cellSize={60}
        lightLineColor="oklch(0.735 0.152 71)"
        darkLineColor="oklch(0.735 0.152 71)"
      />
      <div className="absolute inset-0 bg-gradient-to-t from-background via-transparent to-background" />

      <div className="relative z-10 mx-auto max-w-3xl px-6 text-center">
        <BlurFade delay={0.1}>
          <p className="font-mono text-sm uppercase tracking-widest text-mango">
            Built for the 253 million.
          </p>
          <h2 className="mt-4 text-4xl font-bold tracking-tight sm:text-5xl">
            The world, described.
          </h2>
          <p className="mt-5 text-lg text-muted-foreground">
            wayfr gives anyone with visual impairment the ability to navigate independently —
            with AI that sees, understands, and speaks.
          </p>
        </BlurFade>

        <BlurFade delay={0.2}>
          <div className="mt-10 flex flex-col items-center gap-4 sm:flex-row sm:justify-center">
            <Link href="/verify">
              <ShimmerButton
                shimmerColor="#F5A623"
                background="oklch(0.735 0.152 71)"
                className="px-8 py-3 text-sm font-semibold text-background"
              >
                Report an obstacle
                <ArrowRight className="ml-2 h-4 w-4" />
              </ShimmerButton>
            </Link>
            <Link href="/dashboard">
              <Button
                variant="outline"
                size="lg"
                className="border-mango/30 hover:border-mango/60 hover:bg-mango-subtle"
              >
                Caregiver dashboard
              </Button>
            </Link>
          </div>
        </BlurFade>
      </div>
    </section>
  )
}
