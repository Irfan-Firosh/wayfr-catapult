"use client"

import { BentoGrid, BentoCard } from "@/components/ui/bento-grid"
import { Globe } from "@/components/ui/globe"
import { DotPattern } from "@/components/ui/dot-pattern"
import { Marquee } from "@/components/ui/marquee"
import { BorderBeam } from "@/components/ui/border-beam"
import { Particles } from "@/components/ui/particles"
import { BlurFade } from "@/components/ui/blur-fade"
import { Badge } from "@/components/ui/badge"
import { useTheme } from "next-themes"
import { cn } from "@/lib/utils"

const ocrSamples = [
  "EXIT →", "PULL TO OPEN", "WET FLOOR", "PLATFORM 3",
  "CAUTION: STEP", "PUSH", "ACCESSIBLE ROUTE", "MIND THE GAP",
  "CROSSWALK SIGNAL", "ELEVATOR", "RESTROOMS →", "EMERGENCY EXIT",
]

function ObstacleCard() {
  return (
    <div className="relative flex h-full flex-col justify-between overflow-hidden rounded-xl p-6">
      <DotPattern
        className="absolute inset-0 opacity-30 [mask-image:radial-gradient(ellipse_at_center,white,transparent_70%)]"
        cx={1}
        cy={1}
        cr={1}
      />
      <div className="relative z-10">
        <Badge variant="outline" className="border-mango/30 text-mango text-xs">
          Live detection
        </Badge>
        <h3 className="mt-3 text-xl font-bold">Obstacle Detection</h3>
        <p className="mt-2 text-sm text-muted-foreground">
          Custom VLM trained on Purdue RCAC GPUs identifies curbs, steps, poles, and construction zones in real time.
        </p>
      </div>
      <div className="relative z-10 mt-6 space-y-2">
        {[
          { label: "Curb drop", dist: "3 ft ahead", urgency: "high" },
          { label: "Pole", dist: "5 ft right", urgency: "medium" },
          { label: "Clear path", dist: "left", urgency: "low" },
        ].map((item) => (
          <div key={item.label} className="flex items-center justify-between rounded-lg border border-border bg-background/60 px-3 py-2 text-xs backdrop-blur">
            <span className="font-medium">{item.label}</span>
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground">{item.dist}</span>
              <span className={cn(
                "h-2 w-2 rounded-full",
                item.urgency === "high" ? "bg-destructive" : item.urgency === "medium" ? "bg-mango" : "bg-green-500"
              )} />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function HazardMapCard() {
  return (
    <div className="relative flex h-full flex-col items-center justify-between overflow-hidden rounded-xl p-6">
      <div className="relative z-10 self-start">
        <Badge variant="outline" className="border-mango/30 text-mango text-xs">
          Community verified
        </Badge>
        <h3 className="mt-3 text-xl font-bold">Hazard Map</h3>
        <p className="mt-2 text-sm text-muted-foreground">
          World ID-verified reports from real humans. Zero fake hazards.
        </p>
      </div>
      <div className="relative -mb-6 h-52 w-full">
        <Globe className="absolute inset-0" />
      </div>
    </div>
  )
}

function OCRCard() {
  return (
    <div className="relative flex h-full flex-col justify-between overflow-hidden rounded-xl p-6">
      <div className="relative z-10">
        <Badge variant="outline" className="border-mango/30 text-mango text-xs">
          Real-time OCR
        </Badge>
        <h3 className="mt-3 text-xl font-bold">Text Reading</h3>
        <p className="mt-2 text-sm text-muted-foreground">
          Signs, menus, labels — read aloud instantly via Google Cloud Vision.
        </p>
      </div>
      <div className="relative z-10 mt-4 space-y-2 overflow-hidden">
        <Marquee className="text-xs [--duration:20s]" pauseOnHover>
          {ocrSamples.map((s) => (
            <span key={s} className="mx-3 rounded-md border border-mango/20 bg-mango-subtle px-2 py-1 font-mono text-mango">
              {s}
            </span>
          ))}
        </Marquee>
        <Marquee className="text-xs [--duration:15s]" reverse pauseOnHover>
          {ocrSamples.slice().reverse().map((s) => (
            <span key={s} className="mx-3 rounded-md border border-mango/20 bg-mango-subtle px-2 py-1 font-mono text-mango">
              {s}
            </span>
          ))}
        </Marquee>
      </div>
    </div>
  )
}

function WorldIDCard() {
  const { theme } = useTheme()
  return (
    <div className="relative flex h-full flex-col justify-between overflow-hidden rounded-xl p-6">
      <Particles
        className="absolute inset-0"
        quantity={30}
        color="#F5A623"
        ease={80}
        staticity={40}
      />
      <div className="relative z-10">
        <Badge variant="outline" className="border-mango/30 text-mango text-xs">
          Zero fake reports
        </Badge>
        <h3 className="mt-3 text-xl font-bold">World ID Trust</h3>
        <p className="mt-2 text-sm text-muted-foreground">
          Every hazard report is verified by World ID — a ZK proof that you&apos;re a unique human. No bots, ever.
        </p>
      </div>
      <div className="relative z-10 mt-4 rounded-lg border border-green-500/30 bg-green-500/10 px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="text-green-500">✓</span>
          <span className="text-sm font-medium">Verified Human</span>
          <span className="ml-auto font-mono text-xs text-muted-foreground">0x7f3c...a8d2</span>
        </div>
      </div>
    </div>
  )
}

function CaregiverCard() {
  return (
    <div className="relative flex h-full flex-col justify-between overflow-hidden rounded-xl border border-mango/20 p-6">
      <BorderBeam size={80} duration={6} colorFrom="#F5A623" colorTo="#FDDDA0" />
      <div className="relative z-10">
        <Badge variant="outline" className="border-mango/30 text-mango text-xs">
          Live monitoring
        </Badge>
        <h3 className="mt-3 text-xl font-bold">Caregiver Dashboard</h3>
        <p className="mt-2 text-sm text-muted-foreground">
          Real-time location, detection feed, and hazard alerts for anyone you care about.
        </p>
      </div>
      <div className="relative z-10 mt-4 space-y-2">
        <div className="flex items-center gap-3 rounded-lg border border-border bg-background/60 px-3 py-2 backdrop-blur">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-mango opacity-75" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-mango" />
          </span>
          <span className="text-sm font-medium">Alex — Active</span>
          <span className="ml-auto text-xs text-muted-foreground">2.1 mph</span>
        </div>
        <p className="px-1 text-xs text-muted-foreground">
          10:32:07 · &quot;Curb drop 3ft ahead&quot;
        </p>
        <p className="px-1 text-xs text-muted-foreground">
          10:32:04 · Sign read: &quot;PULL TO OPEN&quot;
        </p>
      </div>
    </div>
  )
}

export function Features() {
  return (
    <section className="py-24">
      <div className="mx-auto max-w-6xl px-6">
        <BlurFade delay={0.1}>
          <div className="mb-16 text-center">
            <p className="text-sm font-medium uppercase tracking-widest text-mango">
              Features
            </p>
            <h2 className="mt-3 text-3xl font-bold tracking-tight sm:text-4xl">
              Everything a guide should be.
            </h2>
          </div>
        </BlurFade>

        <BlurFade delay={0.2}>
          <BentoGrid>
            <BentoCard
              name="Obstacle Detection"
              className="col-span-1 md:col-span-2 row-span-2"
              background={<ObstacleCard />}
              Icon={() => null}
              description=""
              href="/dashboard"
              cta="View dashboard"
            />
            <BentoCard
              name="Hazard Map"
              className="col-span-1 row-span-2"
              background={<HazardMapCard />}
              Icon={() => null}
              description=""
              href="/map"
              cta="Explore map"
            />
            <BentoCard
              name="Text Reading"
              className="col-span-1 md:col-span-2"
              background={<OCRCard />}
              Icon={() => null}
              description=""
              href="/#how-it-works"
              cta="Learn more"
            />
            <BentoCard
              name="World ID Trust"
              className="col-span-1"
              background={<WorldIDCard />}
              Icon={() => null}
              description=""
              href="/verify"
              cta="Verify now"
            />
            <BentoCard
              name="Caregiver Dashboard"
              className="col-span-1 md:col-span-2"
              background={<CaregiverCard />}
              Icon={() => null}
              description=""
              href="/dashboard"
              cta="Open dashboard"
            />
          </BentoGrid>
        </BlurFade>
      </div>
    </section>
  )
}
