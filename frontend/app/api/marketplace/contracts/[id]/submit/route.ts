import { auth } from "@clerk/nextjs/server"
import { NextResponse } from "next/server"

import { getSupabase } from "@/lib/supabase-server"
import type { Contract, Profile } from "@/lib/marketplace-types"

const MAX_VIDEO_MB = 500

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { userId } = await auth()
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { id: contractId } = await params
  const supabase = getSupabase()

  const { data: profile } = await supabase
    .from("profiles")
    .select("id, role")
    .eq("clerk_id", userId)
    .maybeSingle<Pick<Profile, "id" | "role">>()

  if (!profile || profile.role !== "consumer") {
    return NextResponse.json(
      { error: "Only consumer accounts can submit recordings" },
      { status: 403 }
    )
  }

  const { data: contract } = await supabase
    .from("contracts")
    .select("*")
    .eq("id", contractId)
    .maybeSingle<Contract>()

  if (!contract) {
    return NextResponse.json(
      { error: "Contract not found" },
      { status: 404 }
    )
  }
  if (contract.status !== "open") {
    return NextResponse.json(
      { error: "Contract is no longer accepting submissions" },
      { status: 409 }
    )
  }
  if (contract.filled_slots >= contract.total_slots) {
    return NextResponse.json(
      { error: "All slots for this contract are filled" },
      { status: 409 }
    )
  }

  const { data: existing } = await supabase
    .from("contract_submissions")
    .select("id")
    .eq("contract_id", contractId)
    .eq("consumer_id", profile.id)
    .maybeSingle<{ id: string }>()

  if (existing) {
    return NextResponse.json(
      { error: "You have already submitted to this contract" },
      { status: 409 }
    )
  }

  const formData = await request.formData()
  const file = formData.get("video") as File | null

  if (!file) {
    return NextResponse.json(
      { error: "video file is required" },
      { status: 400 }
    )
  }
  if (!file.type.startsWith("video/")) {
    return NextResponse.json(
      { error: "File must be a video" },
      { status: 400 }
    )
  }
  if (file.size > MAX_VIDEO_MB * 1024 * 1024) {
    return NextResponse.json(
      { error: `Video too large (max ${MAX_VIDEO_MB}MB)` },
      { status: 400 }
    )
  }

  const submissionId = crypto.randomUUID()
  const ext = file.name?.split(".").pop() || "webm"
  const storagePath = `${contractId}/${submissionId}.${ext}`

  const buffer = Buffer.from(await file.arrayBuffer())
  const { error: uploadError } = await supabase.storage
    .from("marketplace-recordings")
    .upload(storagePath, buffer, {
      contentType: file.type,
      upsert: false,
    })

  if (uploadError) {
    return NextResponse.json(
      { error: `Upload failed: ${uploadError.message}` },
      { status: 500 }
    )
  }

  const feePercent = Number(contract.platform_fee_percent)
  const priceCents = Number(contract.price_per_recording_cents)
  const platformFeeCents = Math.round(priceCents * (feePercent / 100))
  const payoutCents = priceCents - platformFeeCents

  const { error: subError } = await supabase
    .from("contract_submissions")
    .insert({
      id: submissionId,
      contract_id: contractId,
      consumer_id: profile.id,
      video_storage_path: storagePath,
      payout_cents: payoutCents,
      platform_fee_cents: platformFeeCents,
    } as never)

  if (subError) {
    await supabase.storage
      .from("marketplace-recordings")
      .remove([storagePath])
    return NextResponse.json(
      { error: `Submission failed: ${subError.message}` },
      { status: 500 }
    )
  }

  const newFilledSlots = contract.filled_slots + 1
  const updates: Record<string, unknown> = {
    filled_slots: newFilledSlots,
    updated_at: new Date().toISOString(),
  }
  if (newFilledSlots >= contract.total_slots) {
    updates.status = "filled"
  }

  await supabase
    .from("contracts")
    .update(updates as never)
    .eq("id", contractId)

  // Credit consumer balance
  const { data: consumerProfile } = await supabase
    .from("profiles")
    .select("balance_cents")
    .eq("id", profile.id)
    .single<{ balance_cents: number }>()

  await supabase
    .from("profiles")
    .update({
      balance_cents: (consumerProfile?.balance_cents ?? 0) + payoutCents,
      updated_at: new Date().toISOString(),
    } as never)
    .eq("id", profile.id)

  await supabase.from("transactions").insert({
    profile_id: profile.id,
    type: "payout",
    amount_cents: payoutCents,
    reference_id: submissionId,
    description: `Payout for contract: ${contract.title}`,
  } as never)

  // Debit business balance
  const { data: businessProfile } = await supabase
    .from("profiles")
    .select("balance_cents")
    .eq("id", contract.business_id)
    .single<{ balance_cents: number }>()

  await supabase
    .from("profiles")
    .update({
      balance_cents: (businessProfile?.balance_cents ?? 0) - priceCents,
      updated_at: new Date().toISOString(),
    } as never)
    .eq("id", contract.business_id)

  await supabase.from("transactions").insert({
    profile_id: contract.business_id,
    type: "escrow_lock",
    amount_cents: -priceCents,
    reference_id: submissionId,
    description: `Payment for recording: ${contract.title}`,
  } as never)

  return NextResponse.json(
    {
      submission_id: submissionId,
      payout_cents: payoutCents,
      platform_fee_cents: platformFeeCents,
      slots_remaining: contract.total_slots - newFilledSlots,
    },
    { status: 201 }
  )
}
