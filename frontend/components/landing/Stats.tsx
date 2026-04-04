"use client"

import { NumberTicker } from "@/components/ui/number-ticker"
import { MagicCard } from "@/components/ui/magic-card"
import { BlurFade } from "@/components/ui/blur-fade"
import { useTheme } from "next-themes"

const stats = [
  { value: 253, suffix: "M+", label: "visually impaired worldwide", prefix: "" },
  { value: 1010, suffix: "ms", label: "end-to-end latency target", prefix: "<" },
  { value: 4, suffix: "", label: "AI models in pipeline", prefix: "" },
  { value: 100, suffix: "m", label: "hazard detection radius", prefix: "" },
]

export function Stats() {
  const { theme } = useTheme()

  return (
    <section className="relative py-20">
      <div className="mx-auto max-w-5xl px-6">
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {stats.map((stat, i) => (
            <BlurFade key={stat.label} delay={0.1 * i}>
              <MagicCard
                className="flex flex-col items-center justify-center p-8 rounded-2xl border-border/30"
                gradientColor={theme === "dark" ? "oklch(0.735 0.152 71 / 8%)" : "oklch(0.735 0.152 71 / 12%)"}
                gradientOpacity={0.15}
              >
                <p className="text-4xl font-bold text-mango tabular-nums lg:text-5xl">
                  {stat.prefix}
                  <NumberTicker value={stat.value} />
                  {stat.suffix}
                </p>
                <p className="mt-2 text-center text-sm text-muted-foreground">
                  {stat.label}
                </p>
              </MagicCard>
            </BlurFade>
          ))}
        </div>
      </div>
    </section>
  )
}
