"use client"

import { useCallback, useEffect, useState } from "react"
import { PackageOpen, ShieldCheck, Fingerprint, Lock } from "lucide-react"
import { RoleSelector } from "@/components/marketplace/role-selector"
import { ContractCard, type Contract } from "@/components/marketplace/contract-card"
import { CreateContractDialog } from "@/components/marketplace/create-contract-dialog"
import { ContractDetail } from "@/components/marketplace/contract-detail"
import { BalanceCard } from "@/components/marketplace/balance-card"
import { WorldIDVerifyButton } from "@/components/world-id/WorldIDVerifyButton"

interface Profile {
  id: string
  clerk_id: string
  role: "business" | "consumer"
  display_name: string
  balance_cents: number
}

export default function MarketplacePage() {
  const [humanVerified, setHumanVerified] = useState(false)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [profileLoading, setProfileLoading] = useState(true)
  const [roleLoading, setRoleLoading] = useState(false)

  const [contracts, setContracts] = useState<Contract[]>([])
  const [myContracts, setMyContracts] = useState<Contract[]>([])
  const [selectedContract, setSelectedContract] = useState<string | null>(null)

  const fetchProfile = useCallback(async () => {
    try {
      const res = await fetch("/api/marketplace/profile")
      if (res.ok) {
        const data = await res.json()
        setProfile(data.profile)
      }
    } catch {
      // Profile fetch failed
    } finally {
      setProfileLoading(false)
    }
  }, [])

  const fetchContracts = useCallback(async () => {
    if (!profile) return
    try {
      const res = await fetch("/api/marketplace/contracts")
      if (res.ok) {
        const data = await res.json()
        setContracts(data.contracts)
      }
    } catch {
      // Contracts fetch failed
    }
  }, [profile])

  const fetchMyContracts = useCallback(async () => {
    if (!profile || profile.role !== "business") return
    try {
      const res = await fetch("/api/marketplace/contracts?mine=true")
      if (res.ok) {
        const data = await res.json()
        setMyContracts(data.contracts)
      }
    } catch {
      // My contracts fetch failed
    }
  }, [profile])

  useEffect(() => {
    fetchProfile()
  }, [fetchProfile])

  useEffect(() => {
    if (profile) {
      fetchContracts()
      fetchMyContracts()
    }
  }, [profile, fetchContracts, fetchMyContracts])

  async function handleRoleSelect(
    role: "business" | "consumer",
    displayName: string
  ) {
    setRoleLoading(true)
    try {
      const res = await fetch("/api/marketplace/profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role, display_name: displayName }),
      })
      if (res.ok) {
        const data = await res.json()
        setProfile(data.profile)
      }
    } catch {
      // Profile creation failed
    } finally {
      setRoleLoading(false)
    }
  }

  function refreshAll() {
    fetchContracts()
    fetchMyContracts()
  }

  if (!humanVerified) {
    return (
      <main className="flex min-h-full items-center justify-center bg-background px-6 py-16">
        <div className="w-full max-w-lg">
          <div className="mb-8 text-center">
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-mango/10">
              <ShieldCheck className="h-7 w-7 text-mango" />
            </div>
            <h1 className="text-2xl font-semibold tracking-tight text-foreground">
              Verify your humanity
            </h1>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              The wayfr marketplace requires proof of personhood before you can
              participate. This protects every transaction from bots and fraud.
            </p>
          </div>

          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-6 backdrop-blur-sm">
            <div className="mb-5 rounded-xl border border-white/5 bg-white/[0.02] px-4 py-3">
              <p className="text-xs leading-5 text-muted-foreground">
                Scan the QR code with the{" "}
                <span className="font-medium text-foreground">World App</span>{" "}
                to prove you&apos;re a real human. Your identity stays private
                — only a zero-knowledge proof is shared.
              </p>
            </div>
            <WorldIDVerifyButton onVerified={() => setHumanVerified(true)} />
          </div>

          <div className="mt-8 grid grid-cols-3 gap-4">
            <FeatureChip
              icon={<Fingerprint className="h-4 w-4" />}
              label="Unique human"
            />
            <FeatureChip
              icon={<Lock className="h-4 w-4" />}
              label="Zero knowledge"
            />
            <FeatureChip
              icon={<ShieldCheck className="h-4 w-4" />}
              label="On-chain trust"
            />
          </div>
        </div>
      </main>
    )
  }

  if (profileLoading) {
    return (
      <main className="flex min-h-full items-center justify-center bg-background">
        <p className="text-sm text-muted-foreground">Loading...</p>
      </main>
    )
  }

  if (!profile) {
    return (
      <main className="min-h-full bg-background">
        <RoleSelector onSelect={handleRoleSelect} loading={roleLoading} />
      </main>
    )
  }

  if (selectedContract) {
    return (
      <main className="min-h-full bg-background">
        <ContractDetail
          contractId={selectedContract}
          userRole={profile.role}
          onBack={() => {
            setSelectedContract(null)
            refreshAll()
          }}
        />
      </main>
    )
  }

  if (profile.role === "business") {
    return (
      <main className="min-h-full bg-background">
        <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6">
          <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="text-[10px] font-mono uppercase tracking-[0.2em] text-muted-foreground">
                marketplace
              </p>
              <h1 className="text-xl font-semibold tracking-tight text-foreground">
                Your Contracts
              </h1>
            </div>
            <CreateContractDialog onCreated={refreshAll} />
          </div>

          <div className="mb-8">
            <BalanceCard role="business" />
          </div>

          {myContracts.length > 0 ? (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {myContracts.map((c) => (
                <ContractCard
                  key={c.id}
                  contract={c}
                  showBusiness={false}
                  onClick={() => setSelectedContract(c.id)}
                />
              ))}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center rounded-xl border border-border/50 bg-card px-4 py-16">
              <PackageOpen className="mb-3 size-8 text-muted-foreground" />
              <p className="mb-1 text-sm font-medium text-foreground">
                No contracts yet
              </p>
              <p className="text-xs text-muted-foreground">
                Create your first contract to start collecting recordings.
              </p>
            </div>
          )}
        </div>
      </main>
    )
  }

  // Consumer view
  return (
    <main className="min-h-full bg-background">
      <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6">
        <div className="mb-6">
          <p className="text-[10px] font-mono uppercase tracking-[0.2em] text-muted-foreground">
            marketplace
          </p>
          <h1 className="text-xl font-semibold tracking-tight text-foreground">
            Available Contracts
          </h1>
        </div>

        <div className="mb-8">
          <BalanceCard role="consumer" />
        </div>

        {contracts.length > 0 ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {contracts.map((c) => (
              <ContractCard
                key={c.id}
                contract={c}
                onClick={() => setSelectedContract(c.id)}
              />
            ))}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center rounded-xl border border-border/50 bg-card px-4 py-16">
            <PackageOpen className="mb-3 size-8 text-muted-foreground" />
            <p className="mb-1 text-sm font-medium text-foreground">
              No contracts available
            </p>
            <p className="text-xs text-muted-foreground">
              Check back later — businesses post new contracts regularly.
            </p>
          </div>
        )}
      </div>
    </main>
  )
}

function FeatureChip({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <div className="flex flex-col items-center gap-1.5 rounded-xl border border-white/5 bg-white/[0.02] px-3 py-3">
      <span className="text-mango">{icon}</span>
      <span className="text-[10px] font-medium text-muted-foreground">{label}</span>
    </div>
  )
}
