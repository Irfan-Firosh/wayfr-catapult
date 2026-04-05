"use client"

import Link from "next/link"
import { useTheme } from "next-themes"
import { Moon, Sun } from "lucide-react"
import { Button } from "@/components/ui/button"

export function Navbar() {
  const { theme, setTheme } = useTheme()

  return (
    <header className="fixed top-0 left-0 right-0 z-50 border-b border-mango/10 bg-background/80 backdrop-blur-md">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-6">
        {/* Logo */}
        <Link href="/" className="flex items-center gap-2">
          <span className="text-lg font-semibold tracking-tight text-mango">
            wayfr
          </span>
        </Link>

        {/* Nav links */}
        <nav className="hidden items-center gap-6 text-sm text-muted-foreground md:flex">
          <Link href="/#how-it-works" className="transition-colors hover:text-foreground">
            How it works
          </Link>
          <Link href="/pipeline" className="transition-colors hover:text-foreground">
            Pipeline
          </Link>
          <Link href="/map" className="transition-colors hover:text-foreground">
            Hazard map
          </Link>
          <Link href="/dashboard" className="transition-colors hover:text-foreground">
            Dashboard
          </Link>
          <Link href="/capture" className="transition-colors hover:text-foreground">
            Capture
          </Link>
        </nav>

        {/* Actions */}
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="icon"
            aria-label="Toggle theme"
            onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
          >
            <Sun className="h-4 w-4 rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
            <Moon className="absolute h-4 w-4 rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
          </Button>
          <Link href="/verify">
            <Button
              size="sm"
              className="bg-mango-500 text-background hover:bg-mango-700 font-medium"
            >
              Report item
            </Button>
          </Link>
        </div>
      </div>
    </header>
  )
}
