import { createClient } from "@supabase/supabase-js"

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const key =
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_KEY

if (!url) {
  throw new Error("NEXT_PUBLIC_SUPABASE_URL is not set")
}
if (!key) {
  throw new Error(
    "SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_SERVICE_KEY) is not set"
  )
}

const client = createClient(url, key, {
  auth: { persistSession: false },
})

/** Lazy-style accessor used by marketplace routes. */
export function getSupabase() {
  return client
}

/** Direct export used by persona routes. */
export const supabaseServer = client
