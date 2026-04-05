"use client"

import { NumberTicker } from "@/components/ui/number-ticker"
import { BlurFade } from "@/components/ui/blur-fade"

const stats = [
  { value: 253, suffix: "M+", label: "people with visual impairment", prefix: "" },
  { value: 1010, suffix: "ms", label: "end-to-end latency target", prefix: "<" },
  { value: 4, suffix: "", label: "AI models in the pipeline", prefix: "" },
  { value: 100, suffix: "m", label: "community obstacle detection radius", prefix: "" },
]

export function Stats() {
  return (
    <section className="relative border-y border-mango/10 bg-card py-16">
      <div className="mx-auto max-w-6xl px-6">
        <div className="grid grid-cols-2 gap-8 lg:grid-cols-4">
          {stats.map((stat, i) => (
            <BlurFade key={stat.label} delay={0.1 * i}>
              <div className="text-center">
                <p className="text-4xl font-bold text-mango tabular-nums">
                  {stat.prefix}
                  <NumberTicker value={stat.value} />
                  {stat.suffix}
                </p>
                <p className="mt-2 text-sm text-muted-foreground">{stat.label}</p>
              </div>
            </BlurFade>
          ))}
        </div>
      </div>
    </section>
  )
}
