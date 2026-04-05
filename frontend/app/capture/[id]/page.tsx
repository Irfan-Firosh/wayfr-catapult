"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { useParams } from "next/navigation"
import { CheckCircle2, Loader2, AlertCircle, Video } from "lucide-react"

type Status = "loading" | "ready" | "recording" | "previewing" | "uploading" | "done" | "error"

export default function PhoneCapturePage() {
  const { id } = useParams<{ id: string }>()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const previewUrlRef = useRef<string | null>(null)

  const [status, setStatus] = useState<Status>("loading")
  const [file, setFile] = useState<File | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [error, setError] = useState("")
  const [uploadProgress, setUploadProgress] = useState(0)

  useEffect(() => {
    return () => {
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current)
    }
  }, [])

  useEffect(() => {
    async function validate() {
      try {
        const res = await fetch(`/api/capture/${id}`)
        if (!res.ok) {
          setError("This capture link is invalid.")
          setStatus("error")
          return
        }
        const data = await res.json()
        if (data.status === "expired") {
          setError("This capture session has expired. Please generate a new QR code on your laptop.")
          setStatus("error")
          return
        }
        if (data.status === "uploaded") {
          setError("A video has already been submitted for this session.")
          setStatus("error")
          return
        }
        setStatus("ready")
      } catch {
        setError("Could not reach the server. Make sure you're on the same network.")
        setStatus("error")
      }
    }
    if (id) validate()
  }, [id])

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0]
    if (!selected) return

    if (!selected.type.startsWith("video/")) {
      setError("Please select a video file.")
      setStatus("error")
      return
    }

    setFile(selected)
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current)
    const url = URL.createObjectURL(selected)
    previewUrlRef.current = url
    setPreviewUrl(url)
    setStatus("previewing")
  }, [])

  const handleSubmit = useCallback(async () => {
    if (!file) return
    setStatus("uploading")
    setUploadProgress(0)

    try {
      const formData = new FormData()
      formData.append("video", file)

      const xhr = new XMLHttpRequest()
      xhr.open("POST", `/api/capture/${id}/upload`)

      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) {
          setUploadProgress(Math.round((e.loaded / e.total) * 100))
        }
      }

      await new Promise<void>((resolve, reject) => {
        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            resolve()
          } else {
            try {
              const body = JSON.parse(xhr.responseText)
              reject(new Error(body.error || `Upload failed (${xhr.status})`))
            } catch {
              reject(new Error(`Upload failed (${xhr.status})`))
            }
          }
        }
        xhr.onerror = () => reject(new Error("Network error during upload"))
        xhr.send(formData)
      })

      setStatus("done")
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed")
      setStatus("error")
    }
  }, [file, id])

  const handleRetake = useCallback(() => {
    setFile(null)
    setPreviewUrl(null)
    setError("")
    if (previewUrlRef.current) {
      URL.revokeObjectURL(previewUrlRef.current)
      previewUrlRef.current = null
    }
    if (fileInputRef.current) fileInputRef.current.value = ""
    setStatus("ready")
  }, [])

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center bg-background px-6 py-10">
      <div className="w-full max-w-sm space-y-6">
        {/* Logo */}
        <div className="text-center">
          <p className="text-2xl font-bold tracking-tight text-foreground">wayfr</p>
          <p className="mt-1 text-sm text-muted-foreground">Record your space</p>
        </div>

        {/* Loading */}
        {status === "loading" && (
          <div className="flex flex-col items-center gap-3 py-12">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            <p className="text-sm text-muted-foreground">Connecting...</p>
          </div>
        )}

        {/* Ready to record */}
        {status === "ready" && (
          <div className="space-y-4">
            <div className="rounded-2xl border border-border bg-card p-6 text-center">
              <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-mango-100">
                <Video className="h-8 w-8 text-mango-700" />
              </div>
              <h2 className="text-lg font-semibold text-foreground">Record a walkthrough</h2>
              <p className="mt-2 text-sm text-muted-foreground">
                Walk slowly through your space. The video will be sent to your laptop for 3D processing.
              </p>
            </div>

            <button
              onClick={() => fileInputRef.current?.click()}
              className="w-full rounded-2xl bg-[#F5A623] px-6 py-4 text-base font-semibold text-[#1A1208] transition-colors active:bg-[#e09518]"
            >
              Open Camera
            </button>

            <input
              ref={fileInputRef}
              type="file"
              accept="video/*"
              capture="environment"
              className="hidden"
              onChange={handleFileChange}
            />

            <p className="text-center text-xs text-muted-foreground">
              Tip: hold your phone steady and walk slowly for best results
            </p>
          </div>
        )}

        {/* Preview */}
        {status === "previewing" && file && (
          <div className="space-y-4">
            <div className="overflow-hidden rounded-2xl border border-border bg-black">
              <video
                src={previewUrl ?? undefined}
                controls
                playsInline
                className="aspect-video w-full object-cover"
              />
            </div>

            <div className="rounded-xl border border-border bg-card px-4 py-3">
              <p className="text-xs text-muted-foreground">
                {file.name} &middot; {(file.size / (1024 * 1024)).toFixed(1)} MB
              </p>
            </div>

            <button
              onClick={handleSubmit}
              className="w-full rounded-2xl bg-[#F5A623] px-6 py-4 text-base font-semibold text-[#1A1208] transition-colors active:bg-[#e09518]"
            >
              Send to laptop
            </button>

            <button
              onClick={handleRetake}
              className="w-full rounded-xl border border-border bg-card px-4 py-3 text-sm font-medium text-foreground transition-colors active:bg-card/80"
            >
              Re-record
            </button>
          </div>
        )}

        {/* Uploading */}
        {status === "uploading" && (
          <div className="rounded-2xl border border-border bg-card p-8 text-center space-y-4">
            <Loader2 className="mx-auto h-10 w-10 animate-spin text-mango-500" />
            <div>
              <p className="font-semibold text-foreground">Sending video...</p>
              <p className="mt-1 text-sm text-muted-foreground">{uploadProgress}%</p>
            </div>
            <div className="mx-auto h-2 w-full max-w-[200px] overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-[#F5A623] transition-all duration-300"
                style={{ width: `${uploadProgress}%` }}
              />
            </div>
          </div>
        )}

        {/* Done */}
        {status === "done" && (
          <div className="rounded-2xl border border-green-500/20 bg-green-500/5 p-8 text-center space-y-3">
            <CheckCircle2 className="mx-auto h-12 w-12 text-green-500" />
            <h2 className="text-lg font-semibold text-foreground">Video sent!</h2>
            <p className="text-sm text-muted-foreground">
              Your laptop has received the recording. You can close this tab.
            </p>
          </div>
        )}

        {/* Error */}
        {status === "error" && (
          <div className="rounded-2xl border border-destructive/30 bg-destructive/5 p-6 space-y-4">
            <div className="flex items-start gap-3">
              <AlertCircle className="h-5 w-5 text-destructive mt-0.5 shrink-0" />
              <div>
                <p className="font-semibold text-destructive text-sm">Something went wrong</p>
                <p className="text-sm text-muted-foreground mt-1">{error}</p>
              </div>
            </div>
            {error && !error.includes("expired") && !error.includes("already") && (
              <button
                onClick={handleRetake}
                className="w-full rounded-xl border border-border bg-card px-4 py-3 text-sm font-medium text-foreground transition-colors active:bg-card/80"
              >
                Try again
              </button>
            )}
          </div>
        )}
      </div>
    </main>
  )
}
