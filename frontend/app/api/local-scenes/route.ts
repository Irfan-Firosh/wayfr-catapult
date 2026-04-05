import { readdir, stat } from "node:fs/promises"
import path from "node:path"

import { NextResponse } from "next/server"

export const runtime = "nodejs"

function getSceneRoot() {
  if (process.env.SCENE_DATA_DIR) {
    return process.env.SCENE_DATA_DIR
  }

  return path.resolve(process.cwd(), "..", "backend", "data", "scenes")
}

function isValidHomeId(homeId: string) {
  return /^[a-zA-Z0-9-]+$/.test(homeId)
}

/** GET — home IDs under the scene data dir that have a scene.glb file (same paths as GET /api/local-scenes/[homeId]). */
export async function GET() {
  const root = getSceneRoot()
  const homeIds: string[] = []

  try {
    const entries = await readdir(root, { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      if (!isValidHomeId(entry.name)) continue
      const glbPath = path.join(root, entry.name, "scene.glb")
      try {
        const st = await stat(glbPath)
        if (st.isFile()) homeIds.push(entry.name)
      } catch {
        /* no glb */
      }
    }
    homeIds.sort()
  } catch {
    /* missing root or unreadable */
  }

  return NextResponse.json({ home_ids: homeIds })
}
