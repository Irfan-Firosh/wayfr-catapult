"use client"

import Link from "next/link"
import { AnimatedGridPattern } from "@/components/ui/animated-grid-pattern"
import { TextAnimate } from "@/components/ui/text-animate"
import { InteractiveHoverButton } from "@/components/ui/interactive-hover-button"
import { BlurFade } from "@/components/ui/blur-fade"
import { Button } from "@/components/ui/button"
import { ArrowRight } from "lucide-react"

export function FinalCTA() {
  return (
    <section className="relative overflow-hidden py-40">
      <AnimatedGridPattern
        className="absolute inset-0 opacity-20 [mask-image:radial-gradient(ellipse_at_center,white_30%,transparent_70%)]"
        width={60}
        height={60}
        strokeDasharray={4}
        numSquares={30}
        maxOpacity={0.25}
      />

      <div className="relative z-10 mx-auto max-w-3xl px-6 text-center">
        <BlurFade delay={0.1}>
          <p className="font-mono text-sm uppercase tracking-widest text-mango">
            Built for the 253 million.
          </p>
        </BlurFade>

        <BlurFade delay={0.2}>
          <TextAnimate
            as="h2"
            className="mt-6 text-4xl font-bold tracking-tight sm:text-6xl"
            animation="blurInUp"
            by="word"
          >
            The world, described.
          </TextAnimate>
        </BlurFade>

        <BlurFade delay={0.3}>
          <p className="mx-auto mt-6 max-w-lg text-lg leading-relaxed text-muted-foreground">
            wayfr gives anyone with visual impairment the ability to
            navigate independently — with AI that sees, understands, and speaks.
          </p>
        </BlurFade>

        <BlurFade delay={0.4}>
          <div className="mt-12 flex flex-col items-center gap-4 sm:flex-row sm:justify-center">
            <Link href="/verify">
              <InteractiveHoverButton className="bg-mango text-background border-mango/50 font-semibold px-8">
                Report an obstacle
              </InteractiveHoverButton>
            </Link>
            <Link href="/dashboard">
              <Button
                variant="outline"
                size="lg"
                className="rounded-full border-border/60 hover:border-mango/40 hover:bg-mango/5 px-8"
              >
                Caregiver dashboard
                <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </Link>
          </div>
        </BlurFade>
      </div>
    </section>
  )
}
