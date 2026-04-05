import Link from "next/link"
import { Navbar } from "@/components/nav/Navbar"
import { Hero } from "@/components/landing/Hero"
import { DashboardPreview } from "@/components/landing/DashboardPreview"

export default function Home() {
  return (
    <main className="relative min-h-screen bg-background">
      <Navbar />
      <Hero />
      <DashboardPreview />

      {/* Footer */}
      <footer className="pb-10 pt-2">
        <div className="mx-auto flex max-w-6xl flex-col items-center gap-6 px-6 sm:flex-row sm:justify-between">
          <div className="text-center sm:text-left">
            <span className="text-lg font-semibold tracking-tight text-mango">wayfr</span>
            <p className="mt-1 text-sm text-muted-foreground">
              3D annotation foundation for real-world guidance.
            </p>
          </div>
          <nav className="flex items-center gap-6 text-sm text-muted-foreground">
            <Link href="/setup" className="transition-colors hover:text-foreground">Setup</Link>
            <Link href="/dashboard" className="transition-colors hover:text-foreground">Dashboard</Link>
            <Link href="/report" className="transition-colors hover:text-foreground">Report</Link>
          </nav>
        </div>
      </footer>
    </main>
  )
}
