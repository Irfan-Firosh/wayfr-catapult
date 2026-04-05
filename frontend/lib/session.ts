/** Returns the session ID: URL param takes priority, then localStorage, else generate new. */
export function getSessionId(): string {
  if (typeof window === "undefined") return "SERVER"

  const fromUrl = new URLSearchParams(window.location.search).get("session")
  if (fromUrl) {
    localStorage.setItem("wayfr_session", fromUrl)
    return fromUrl
  }

  const stored = localStorage.getItem("wayfr_session")
  if (stored) return stored

  const fresh = Array.from({ length: 6 }, () =>
    "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"[Math.floor(Math.random() * 36)]
  ).join("")
  localStorage.setItem("wayfr_session", fresh)
  return fresh
}

export function makeShareUrl(sessionId: string): string {
  const base = typeof window !== "undefined" ? window.location.origin : ""
  return `${base}/capture?session=${sessionId}`
}

export function makeDashboardUrl(sessionId: string): string {
  const base = typeof window !== "undefined" ? window.location.origin : ""
  return `${base}/dashboard?session=${sessionId}`
}
