"use client"

import dynamic from "next/dynamic"

const HeroFuturistic = dynamic(
  () => import("@/components/blocks/hero-futuristic").then((mod) => mod.HeroFuturistic),
  { ssr: false }
)

export function Hero() {
  return (
    <section className="relative">
      <HeroFuturistic />
    </section>
  )
}
