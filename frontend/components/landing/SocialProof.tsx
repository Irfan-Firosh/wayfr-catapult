import { Marquee } from "@/components/ui/marquee"
import { BlurFade } from "@/components/ui/blur-fade"

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
    <section className="relative overflow-hidden border-y border-mango/10 bg-card py-10">
      <BlurFade delay={0.1}>
        <Marquee className="[--duration:30s]" pauseOnHover>
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
        <Marquee className="mt-3 [--duration:25s]" reverse pauseOnHover>
          {items.slice().reverse().map((item) => (
            <span
              key={item}
              className="mx-6 flex items-center gap-2 text-sm text-muted-foreground"
            >
              <span className="h-1 w-1 rounded-full bg-mango/50" />
              {item}
            </span>
          ))}
        </Marquee>
      </BlurFade>
    </section>
  )
}
