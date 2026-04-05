import { WorldIDVerifyButton } from "@/components/world-id/WorldIDVerifyButton"
import { ShieldCheck, Fingerprint, Lock } from "lucide-react"
import Link from "next/link"

export default function VerifyPage() {
  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-background px-6 py-12">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(245,166,35,0.16),transparent_0_34%),radial-gradient(circle_at_bottom_right,rgba(255,245,232,0.08),transparent_0_30%)]" />
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[#F5A62373] to-transparent" />

      <div className="relative grid w-full max-w-5xl gap-12 lg:grid-cols-[1fr_minmax(320px,420px)] lg:items-center">
        {/* Left: Explanation */}
        <div>
          <Link
            href="/"
            className="text-sm font-bold tracking-tight text-mango transition-opacity hover:opacity-80"
          >
            wayfr
          </Link>
          <p className="mt-4 text-xs uppercase tracking-[0.3em] text-[rgba(245,166,35,0.8)]">
            Proof of Human
          </p>
          <h1 className="mt-3 text-4xl font-semibold tracking-[-0.04em] text-foreground lg:text-5xl">
            Verified by a real&nbsp;human.
          </h1>
          <p className="mt-5 max-w-lg text-base leading-7 text-muted-foreground">
            wayfr uses World ID to guarantee that every hazard report comes from
            a unique, verified person — not a bot. Zero-knowledge proofs keep
            your identity private while proving you&apos;re real.
          </p>

          <div className="mt-10 grid gap-5 sm:grid-cols-3">
            <Feature
              icon={<Fingerprint className="h-5 w-5" />}
              title="Unique Human"
              description="One person, one proof — Sybil-resistant by design"
            />
            <Feature
              icon={<Lock className="h-5 w-5" />}
              title="Zero Knowledge"
              description="Prove you're real without revealing who you are"
            />
            <Feature
              icon={<ShieldCheck className="h-5 w-5" />}
              title="On-chain Trust"
              description="Cryptographic verification backed by World Chain"
            />
          </div>
        </div>

        {/* Right: Verify card */}
        <div className="relative">
          <div className="absolute inset-0 rounded-[2rem] bg-[rgba(245,166,35,0.08)] blur-3xl" />
          <div className="relative rounded-[2rem] border border-white/10 bg-white/[0.03] p-8 backdrop-blur-sm">
            <div className="mb-6 flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-mango/15">
                <ShieldCheck className="h-5 w-5 text-mango" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-foreground">
                  World ID Verification
                </h2>
                <p className="text-xs text-muted-foreground">
                  Powered by zero-knowledge proofs
                </p>
              </div>
            </div>

            <div className="mb-6 rounded-xl border border-white/5 bg-white/[0.02] px-4 py-3">
              <p className="text-xs leading-5 text-muted-foreground">
                Clicking below will open the World ID widget. Scan the QR code
                with the{" "}
                <span className="font-medium text-foreground">World App</span>{" "}
                to complete verification. Your identity stays private.
              </p>
            </div>

            <WorldIDVerifyButton />
          </div>
        </div>
      </div>
    </main>
  )
}

function Feature({
  icon,
  title,
  description,
}: {
  icon: React.ReactNode
  title: string
  description: string
}) {
  return (
    <div className="space-y-2">
      <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-mango/10 text-mango">
        {icon}
      </div>
      <h3 className="text-sm font-medium text-foreground">{title}</h3>
      <p className="text-xs leading-relaxed text-muted-foreground">
        {description}
      </p>
    </div>
  )
}
