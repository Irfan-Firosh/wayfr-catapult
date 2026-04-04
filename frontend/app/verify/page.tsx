"use client"

import { useState } from "react"
import Link from "next/link"
import { Navbar } from "@/components/nav/Navbar"
import { ShimmerButton } from "@/components/ui/shimmer-button"
import { Particles } from "@/components/ui/particles"
import { BlurFade } from "@/components/ui/blur-fade"
import { Button } from "@/components/ui/button"
import { ArrowRight, ShieldCheck } from "lucide-react"

export default function VerifyPage() {
  const [verified, setVerified] = useState(false)
  const [verifying, setVerifying] = useState(false)

  async function handleVerify() {
    setVerifying(true)
    // Stub: real World ID MiniKit flow wired in backend integration step
    await new Promise((r) => setTimeout(r, 1800))
    setVerified(true)
    setVerifying(false)
  }

  return (
    <main className="relative flex min-h-screen flex-col bg-background">
      <Navbar />

      <div className="relative flex flex-1 items-center justify-center px-6">
        {verified && (
          <Particles
            className="absolute inset-0"
            quantity={80}
            color="#F5A623"
            ease={60}
            staticity={30}
          />
        )}

        <div className="relative z-10 mx-auto w-full max-w-md">
          {!verified ? (
            <BlurFade delay={0.1}>
              <div className="rounded-2xl border border-mango/15 bg-card/60 backdrop-blur-xl p-8 shadow-xl">
                <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-mango-subtle border border-mango/30">
                  <ShieldCheck className="h-6 w-6 text-mango" />
                </div>

                <h1 className="mt-5 text-2xl font-bold">Verify you&apos;re human</h1>
                <p className="mt-2 text-sm text-muted-foreground">
                  wayfr uses World ID to ensure every hazard report comes from a real,
                  unique person. Blind users depend on this data for their safety.
                </p>

                <div className="mt-6 rounded-xl border border-border/40 bg-background/30 backdrop-blur p-4 text-sm text-muted-foreground">
                  <p className="font-medium text-foreground">What World ID does:</p>
                  <ul className="mt-2 space-y-1">
                    <li>✓ Proves you&apos;re a unique human via iris scan</li>
                    <li>✓ Zero personal data stored — ZK proof only</li>
                    <li>✓ Allows up to 5 hazard reports per day</li>
                  </ul>
                </div>

                <div className="mt-6">
                  <ShimmerButton
                    shimmerColor="#F5A623"
                    background="oklch(0.735 0.152 71)"
                    className="w-full justify-center py-3 text-sm font-semibold text-background"
                    onClick={handleVerify}
                    disabled={verifying}
                  >
                    {verifying ? (
                      <span className="flex items-center gap-2">
                        <span className="h-4 w-4 animate-spin rounded-full border-2 border-background/30 border-t-background" />
                        Verifying...
                      </span>
                    ) : (
                      <span className="flex items-center gap-2">
                        Verify with World ID
                        <ArrowRight className="h-4 w-4" />
                      </span>
                    )}
                  </ShimmerButton>
                </div>

                <p className="mt-4 text-center text-xs text-muted-foreground">
                  Already verified?{" "}
                  <Link href="/report" className="text-mango hover:underline">
                    Skip to report →
                  </Link>
                </p>
              </div>
            </BlurFade>
          ) : (
            <BlurFade delay={0.1}>
              <div className="rounded-2xl border border-green-500/20 bg-green-500/5 backdrop-blur-xl p-8 text-center shadow-xl">
                <div className="flex h-14 w-14 mx-auto items-center justify-center rounded-full border border-green-500/40 bg-green-500/20 text-2xl">
                  ✓
                </div>
                <h1 className="mt-4 text-2xl font-bold text-green-400">Verified Human</h1>
                <p className="mt-2 text-sm text-muted-foreground">
                  World ID confirmed. You have 5 hazard reports available today.
                </p>
                <div className="mt-6 rounded-lg border border-border bg-background/30 px-4 py-2 font-mono text-xs text-muted-foreground">
                  nullifier: 0x7f3c...a8d2
                </div>
                <Link href="/report" className="mt-6 block">
                  <Button className="w-full bg-mango-500 text-background hover:bg-mango-700">
                    Submit a hazard report
                    <ArrowRight className="ml-2 h-4 w-4" />
                  </Button>
                </Link>
              </div>
            </BlurFade>
          )}
        </div>
      </div>
    </main>
  )
}
