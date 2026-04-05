import { Navbar } from "@/components/nav/Navbar"
import { Hero } from "@/components/landing/Hero"
import { HowItWorks } from "@/components/landing/HowItWorks"
import { Stats } from "@/components/landing/Stats"
import { FinalCTA } from "@/components/landing/FinalCTA"

export default function Home() {
  return (
    <main className="relative min-h-screen bg-background">
      <Navbar />
      <Hero />
      <Stats />
      <HowItWorks />
      <FinalCTA />

      <footer className="border-t border-mango/10 py-8 text-center text-sm text-muted-foreground">
        <p>
          wayfr — Built for the visually impaired.{" "}
          <span className="text-mango">Navigate freely.</span>
        </p>
      </footer>
    </main>
  )
}
