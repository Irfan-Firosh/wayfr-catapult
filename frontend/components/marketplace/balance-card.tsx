"use client"

import { useEffect, useState } from "react"
import { ArrowDownRight, ArrowUpRight, Wallet } from "lucide-react"

import { cn } from "@/lib/utils"

interface Transaction {
  id: string
  type: string
  amount_cents: number
  description: string
  created_at: string
}

function formatCents(cents: number, absolute = false) {
  const value = absolute ? Math.abs(cents) : cents
  const prefix = value < 0 ? "-$" : "$"
  return `${prefix}${(Math.abs(value) / 100).toFixed(2)}`
}

export function BalanceCard({ role }: { role: "business" | "consumer" }) {
  const [balance, setBalance] = useState(0)
  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [expanded, setExpanded] = useState(false)

  useEffect(() => {
    fetch("/api/marketplace/balance")
      .then((r) => r.json())
      .then((data) => {
        if (data.balance_cents !== undefined) {
          setBalance(data.balance_cents)
          setTransactions(data.transactions || [])
        }
      })
      .catch(() => {})
  }, [])

  return (
    <div className="rounded-xl border border-border/50 bg-card">
      <button
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center justify-between px-4 py-3 text-left"
      >
        <div className="flex items-center gap-3">
          <div className="flex size-8 items-center justify-center rounded-lg bg-mango-500/15 text-mango-500">
            <Wallet className="size-4" />
          </div>
          <div>
            <p className="text-[10px] font-mono uppercase tracking-[0.2em] text-muted-foreground">
              {role === "consumer" ? "earnings" : "balance"}
            </p>
            <p className="text-lg font-semibold tracking-tight text-foreground">
              {formatCents(balance)}
            </p>
          </div>
        </div>
        {transactions.length > 0 && (
          <p className="text-[10px] text-muted-foreground">
            {expanded ? "Hide" : "View"} history
          </p>
        )}
      </button>

      {expanded && transactions.length > 0 && (
        <div className="border-t border-border/30 px-4 py-2">
          {transactions.slice(0, 10).map((tx) => (
            <div
              key={tx.id}
              className="flex items-center justify-between py-2"
            >
              <div className="flex items-center gap-2">
                <div
                  className={cn(
                    "flex size-6 items-center justify-center rounded-md",
                    tx.amount_cents >= 0
                      ? "bg-emerald-500/10 text-emerald-500"
                      : "bg-destructive/10 text-destructive"
                  )}
                >
                  {tx.amount_cents >= 0 ? (
                    <ArrowDownRight className="size-3" />
                  ) : (
                    <ArrowUpRight className="size-3" />
                  )}
                </div>
                <p className="text-xs text-muted-foreground line-clamp-1">
                  {tx.description}
                </p>
              </div>
              <p
                className={cn(
                  "ml-2 shrink-0 text-xs font-medium",
                  tx.amount_cents >= 0 ? "text-emerald-500" : "text-destructive"
                )}
              >
                {tx.amount_cents >= 0 ? "+" : "-"}
                {formatCents(tx.amount_cents, true)}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
