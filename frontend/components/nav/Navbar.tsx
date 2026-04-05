"use client"

import Link from "next/link"
import { useState } from "react"
import { useTheme } from "next-themes"
import { useAuth, UserButton, SignInButton } from "@clerk/nextjs"
import { Moon, Sun, Menu } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Sheet,
  SheetContent,
  SheetTrigger,
  SheetTitle,
} from "@/components/ui/sheet"

const navLinks = [
  { href: "/setup", label: "Setup" },
  { href: "/dashboard", label: "Dashboard" },
]

export function Navbar() {
  const { theme, setTheme } = useTheme()
  const { isSignedIn } = useAuth()
  const [open, setOpen] = useState(false)

  return (
    <>
      <header className="fixed top-0 left-0 right-0 z-50 border-b border-border/40 bg-background/60 backdrop-blur-xl">
        <div className="relative mx-auto grid h-14 max-w-6xl grid-cols-[auto_1fr_auto] items-center px-6">
          {/* Logo */}
          <Link
            href="/"
            className="flex items-center gap-2 transition-transform hover:scale-105"
          >
            <span className="text-lg font-bold tracking-tight text-mango">
              wayfr
            </span>
          </Link>

          {/* Desktop nav */}
          <nav className="absolute left-1/2 hidden -translate-x-1/2 items-center gap-8 text-sm md:flex">
            {navLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="relative text-muted-foreground transition-colors hover:text-foreground after:absolute after:-bottom-1 after:left-0 after:h-px after:w-0 after:bg-mango after:transition-all hover:after:w-full"
              >
                {link.label}
              </Link>
            ))}
          </nav>

          {/* Actions */}
          <div className="flex items-center justify-self-end gap-2">
            <Button
              variant="ghost"
              size="icon"
              className="h-9 w-9"
              aria-label="Toggle theme"
              onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
            >
              <Sun className="h-4 w-4 rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
              <Moon className="absolute h-4 w-4 rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
            </Button>

            {isSignedIn ? (
              <>
                <UserButton />
              </>
            ) : (
              <>
                <SignInButton mode="redirect">
                  <Button
                    size="sm"
                    variant="outline"
                    className="rounded-full border-border/60 px-5 hidden sm:inline-flex"
                  >
                    Sign in
                  </Button>
                </SignInButton>
                <Link href="/sign-up">
                  <Button
                    size="sm"
                    className="bg-mango text-background hover:bg-mango/90 font-medium rounded-full px-5"
                  >
                    Get started
                  </Button>
                </Link>
              </>
            )}

            {/* Mobile menu */}
            <Sheet open={open} onOpenChange={setOpen}>
              <SheetTrigger
                className="inline-flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground md:hidden"
              >
                <Menu className="h-4 w-4" />
              </SheetTrigger>
              <SheetContent side="right" className="w-72 bg-background/95 backdrop-blur-xl">
                <SheetTitle className="text-lg font-bold text-mango mb-6">
                  wayfr
                </SheetTitle>
                <nav className="flex flex-col gap-4">
                  {navLinks.map((link) => (
                    <Link
                      key={link.href}
                      href={link.href}
                      onClick={() => setOpen(false)}
                      className="text-sm text-muted-foreground transition-colors hover:text-foreground py-2 border-b border-border/30"
                    >
                      {link.label}
                    </Link>
                  ))}
                  {isSignedIn ? (
                    <div className="mt-4">
                      <UserButton />
                    </div>
                  ) : (
                    <>
                      <SignInButton mode="redirect">
                        <Button variant="outline" className="mt-4 w-full rounded-full">
                          Sign in
                        </Button>
                      </SignInButton>
                      <Link href="/sign-up" onClick={() => setOpen(false)}>
                        <Button className="w-full bg-mango text-background hover:bg-mango/90 rounded-full">
                          Get started
                        </Button>
                      </Link>
                    </>
                  )}
                </nav>
              </SheetContent>
            </Sheet>
          </div>
        </div>
      </header>
    </>
  )
}
