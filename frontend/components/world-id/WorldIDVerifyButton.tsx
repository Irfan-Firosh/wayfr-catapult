"use client"

import { useState, useCallback, useEffect } from "react"
import {
  IDKitRequestWidget,
  deviceLegacy,
  type RpContext,
  type IDKitResult,
  type IDKitErrorCodes,
} from "@worldcoin/idkit"
import { Button } from "@/components/ui/button"
import { ShieldCheck, Loader2 } from "lucide-react"

const APP_ID = process.env.NEXT_PUBLIC_WORLD_APP_ID as `app_${string}`
const RP_ID = process.env.NEXT_PUBLIC_WORLD_RP_ID ?? ""
const ACTION = "verify-human"

interface WorldIDVerifyButtonProps {
  onVerified?: () => void
}

export function WorldIDVerifyButton({ onVerified }: WorldIDVerifyButtonProps = {}) {
  const [open, setOpen] = useState(false)
  const [verified, setVerified] = useState(false)
  const [loading, setLoading] = useState(false)
  const [rpContext, setRpContext] = useState<RpContext | null>(null)
  const [error, setError] = useState<string | null>(null)

  const fetchRpSignature = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch("/api/world-id/rp-signature", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: ACTION }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error ?? "Failed to generate RP signature")
      }
      const { sig, nonce, created_at, expires_at } = await res.json()
      setRpContext({
        rp_id: RP_ID,
        nonce,
        created_at,
        expires_at,
        signature: sig,
      })
      setOpen(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (verified) {
      const timer = setTimeout(() => setError(null), 3000)
      return () => clearTimeout(timer)
    }
  }, [verified])

  const handleVerify = useCallback(async (result: IDKitResult) => {
    const res = await fetch("/api/world-id/verify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ idkitResponse: result }),
    })
    if (!res.ok) {
      throw new Error("Backend verification failed")
    }
  }, [])

  const handleSuccess = useCallback(() => {
    setVerified(true)
    setOpen(false)
    onVerified?.()
  }, [onVerified])

  const handleError = useCallback((code: IDKitErrorCodes) => {
    setError(`Verification error: ${code}`)
    setOpen(false)
  }, [])

  if (verified) {
    return (
      <div className="relative overflow-hidden rounded-2xl border border-emerald-500/30 bg-emerald-500/10 px-6 py-5">
        <div className="absolute inset-0 bg-gradient-to-br from-emerald-500/5 to-transparent" />
        <div className="relative flex items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-emerald-500/20">
            <ShieldCheck className="h-5 w-5 text-emerald-400" />
          </div>
          <div>
            <p className="text-sm font-semibold text-emerald-300">
              Verified Human
            </p>
            <p className="text-xs text-emerald-400/70">
              Proof of personhood confirmed via World ID
            </p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      <Button
        onClick={fetchRpSignature}
        disabled={loading}
        size="lg"
        className="gap-2.5 rounded-xl bg-black text-white border border-white/15 hover:bg-white/10 transition-all h-12 px-6"
      >
        {loading ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <WorldcoinLogo className="h-5 w-5" />
        )}
        {loading ? "Preparing..." : "Verify with World ID"}
      </Button>

      {error && (
        <p className="text-xs text-red-400">{error}</p>
      )}

      {rpContext && APP_ID && (
        <IDKitRequestWidget
          open={open}
          onOpenChange={setOpen}
          app_id={APP_ID}
          action={ACTION}
          rp_context={rpContext}
          allow_legacy_proofs={true}
          preset={deviceLegacy()}
          environment="production"
          handleVerify={handleVerify}
          onSuccess={handleSuccess}
          onError={handleError}
        />
      )}
    </div>
  )
}

function WorldcoinLogo({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M16 32C24.8366 32 32 24.8366 32 16C32 7.16344 24.8366 0 16 0C7.16344 0 0 7.16344 0 16C0 24.8366 7.16344 32 16 32Z"
        fill="currentColor"
      />
      <path
        d="M8.4 15.9999C8.4 18.3145 9.49 20.3763 11.1984 21.685C11.4926 21.2035 11.8339 20.7523 12.2174 20.3387C11.0452 19.3423 10.3 17.7592 10.3 15.9999C10.3 14.2406 11.0452 12.6575 12.2174 11.6611C11.8339 11.2475 11.4926 10.7963 11.1984 10.3148C9.49 11.6235 8.4 13.6853 8.4 15.9999Z"
        fill="black"
      />
      <path
        d="M16 10.1C14.9391 10.1 13.9217 10.5214 13.1716 11.2716C12.4214 12.0217 12 13.0391 12 14.1V17.9C12 18.9609 12.4214 19.9783 13.1716 20.7284C13.9217 21.4786 14.9391 21.9 16 21.9C17.0609 21.9 18.0783 21.4786 18.8284 20.7284C19.5786 19.9783 20 18.9609 20 17.9V14.1C20 13.0391 19.5786 12.0217 18.8284 11.2716C18.0783 10.5214 17.0609 10.1 16 10.1Z"
        fill="black"
      />
      <path
        d="M19.7826 20.3387C20.1661 20.7523 20.5074 21.2035 20.8016 21.685C22.51 20.3763 23.6 18.3145 23.6 15.9999C23.6 13.6853 22.51 11.6235 20.8016 10.3148C20.5074 10.7963 20.1661 11.2475 19.7826 11.6611C20.9548 12.6575 21.7 14.2406 21.7 15.9999C21.7 17.7592 20.9548 19.3423 19.7826 20.3387Z"
        fill="black"
      />
    </svg>
  )
}
