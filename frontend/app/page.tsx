import Link from "next/link"
import { Navbar } from "@/components/nav/Navbar"
import { Hero } from "@/components/landing/Hero"
import { SocialProof } from "@/components/landing/SocialProof"
import { Stats } from "@/components/landing/Stats"
import { Features } from "@/components/landing/Features"
import { HowItWorks } from "@/components/landing/HowItWorks"
import { FinalCTA } from "@/components/landing/FinalCTA"

export default function Home() {
  return (
    <main className="relative min-h-screen bg-background">
      <Navbar />
      <Hero />
      <SocialProof />
      <Stats />
      <Features />
      <HowItWorks />
      <FinalCTA />

      {/* Footer */}
      <footer className="border-t border-border/30 py-12">
        <div className="mx-auto flex max-w-6xl flex-col items-center gap-6 px-6 sm:flex-row sm:justify-between">
          <div className="text-center sm:text-left">
            <span className="text-lg font-bold text-mango">wayfr</span>
            <p className="mt-1 text-sm text-muted-foreground">
              Made with AI for the 253 million.
            </p>
          </div>
          <nav className="flex items-center gap-6 text-sm text-muted-foreground">
            <Link href="/dashboard" className="transition-colors hover:text-foreground">Dashboard</Link>
            <Link href="/capture" className="transition-colors hover:text-foreground">Capture</Link>
            <Link href="/verify" className="transition-colors hover:text-foreground">Report</Link>
          </nav>
        </div>
      </footer>
    </main>
  )
}
