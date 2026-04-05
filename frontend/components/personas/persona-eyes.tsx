"use client"

import type { CSSProperties } from "react"
import { useEffect, useMemo, useState } from "react"

import { cn } from "@/lib/utils"

type PersonaEyeTheme = {
  star: string
  center: string
  glow: string
}

export interface PersonaEyesProps {
  isBlinking?: boolean
  size?: number
  className?: string
  autoBlink?: boolean
  colorTheme?: Partial<PersonaEyeTheme>
}

const STAR_PATH = "M 50 0 L 64 36 L 92 50 L 64 64 L 50 100 L 36 64 L 8 50 L 36 36 Z"

const DEFAULT_THEME: PersonaEyeTheme = {
  star: "#FFC45A",
  center: "#FFB347",
  glow: "rgba(255, 196, 90, 0.38)",
}

function PersonaEye({
  side,
  theme,
}: {
  side: "left" | "right"
  theme: PersonaEyeTheme
}) {
  return (
    <div className={cn("persona-chat-eye", side === "left" ? "persona-chat-eye-left" : "persona-chat-eye-right")}>
      <div className="persona-chat-eye__blink-shell">
        <svg
          viewBox="0 0 100 100"
          className="persona-chat-eye__svg"
          role="presentation"
          focusable="false"
        >
          <path
            d={STAR_PATH}
            fill={theme.star}
          />
          <circle
            cx="50"
            cy="50"
            r="12.5"
            fill={theme.center}
          />
        </svg>
      </div>
    </div>
  )
}

export function PersonaEyes({
  isBlinking,
  size = 116,
  className,
  autoBlink = true,
  colorTheme,
}: PersonaEyesProps) {
  const [autoBlinking, setAutoBlinking] = useState(false)
  const theme = useMemo(() => ({ ...DEFAULT_THEME, ...colorTheme }), [colorTheme])

  useEffect(() => {
    if (typeof isBlinking === "boolean" || !autoBlink) {
      return
    }

    let blinkTimer: ReturnType<typeof window.setTimeout> | null = null
    let resetTimer: ReturnType<typeof window.setTimeout> | null = null

    const scheduleBlink = () => {
      blinkTimer = window.setTimeout(() => {
        setAutoBlinking(true)
        resetTimer = window.setTimeout(() => {
          setAutoBlinking(false)
          scheduleBlink()
        }, 220)
      }, 2500 + Math.random() * 1700)
    }

    scheduleBlink()

    return () => {
      if (blinkTimer) window.clearTimeout(blinkTimer)
      if (resetTimer) window.clearTimeout(resetTimer)
    }
  }, [autoBlink, isBlinking])

  const blinking = typeof isBlinking === "boolean" ? isBlinking : autoBlinking

  const style = {
    "--persona-eye-width": `${size}px`,
    "--persona-eye-gap": `${Math.max(10, Math.round(size * 0.16))}px`,
    "--persona-eye-glow": theme.glow,
  } as CSSProperties

  return (
    <div
      className={cn("persona-chat-eyes", className)}
      data-blinking={blinking ? "true" : "false"}
      style={style}
      aria-hidden="true"
    >
      <PersonaEye side="left" theme={theme} />
      <PersonaEye side="right" theme={theme} />

      <style jsx global>{`
        .persona-chat-eyes {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: var(--persona-eye-gap);
        }

        .persona-chat-eye {
          width: var(--persona-eye-width);
          flex-shrink: 0;
          transform-origin: center;
          filter:
            drop-shadow(0 0 10px var(--persona-eye-glow))
            drop-shadow(0 12px 22px rgba(255, 122, 0, 0.12));
        }

        .persona-chat-eye-left {
          transform: rotate(-8deg) translateY(-1px);
        }

        .persona-chat-eye-right {
          transform: rotate(8deg) translateY(1px);
        }

        .persona-chat-eye__blink-shell {
          transform-origin: center;
        }

        .persona-chat-eye__svg {
          display: block;
          width: 100%;
          height: auto;
          overflow: visible;
        }

        .persona-chat-eyes[data-blinking="true"] .persona-chat-eye__blink-shell {
          animation: persona-chat-asterisk-blink 180ms both;
        }

        .persona-chat-eyes[data-blinking="true"] .persona-chat-eye-right .persona-chat-eye__blink-shell {
          animation-delay: 40ms;
        }

        @keyframes persona-chat-asterisk-blink {
          0%, 100% {
            transform: scaleY(1);
            opacity: 1;
          }
          46% {
            transform: scaleY(0.08);
            opacity: 0.84;
          }
          58% {
            transform: scaleY(0.08);
            opacity: 0.84;
          }
        }

        @media (prefers-reduced-motion: reduce) {
          .persona-chat-eyes[data-blinking="true"] .persona-chat-eye__blink-shell {
            animation: none;
          }
        }
      `}</style>
    </div>
  )
}
