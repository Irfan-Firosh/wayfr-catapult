"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { useTheme } from "next-themes"
import { SignInButton, UserButton, useAuth } from "@clerk/nextjs"
import { Bot, LayoutDashboard, Moon, ScanSearch, ShieldCheck, Store, Sun } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarMenuButton,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuItem,
  SidebarRail,
  SidebarSeparator,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar"
import { cn } from "@/lib/utils"

const navigation = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/personas", label: "Personas", icon: Bot },
  { href: "/marketplace", label: "Marketplace", icon: Store },
  { href: "/setup", label: "Setup", icon: ScanSearch },
  { href: "/verify", label: "Verify", icon: ShieldCheck },
]

export function AppSidebar() {
  const pathname = usePathname()
  const { theme, setTheme } = useTheme()
  const { isSignedIn } = useAuth()
  const { state } = useSidebar()

  const isCollapsed = state === "collapsed"

  return (
    <Sidebar variant="inset" collapsible="icon">
      <SidebarHeader className="gap-3 p-3">
        <div className={cn("flex items-center gap-3", isCollapsed ? "justify-center" : "justify-between")}>
          <Link
            href="/"
            className={cn("flex min-w-0 items-center gap-3", isCollapsed && "justify-center")}
            title="Home"
          >
            <div className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-sidebar-primary text-sidebar-primary-foreground">
              <span className="text-sm font-semibold">w</span>
            </div>
            {!isCollapsed && (
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold tracking-tight">wayfr</p>
                <p className="text-[10px] uppercase tracking-[0.2em] text-sidebar-foreground/55">annotation</p>
              </div>
            )}
          </Link>
        </div>

        <div className={cn("hidden md:flex", isCollapsed ? "justify-center" : "justify-start")}>
          <SidebarTrigger className="text-sidebar-foreground/70" />
        </div>
      </SidebarHeader>

      <SidebarSeparator />

      <SidebarContent className="px-2 py-2">
        <SidebarMenu>
          {navigation.map((item) => {
            const isActive = pathname === item.href || pathname.startsWith(`${item.href}/`)
            const Icon = item.icon

            return (
              <SidebarMenuItem key={item.href}>
                <SidebarMenuButton
                  asChild
                  isActive={isActive}
                  className={cn(
                    "rounded-xl text-sidebar-foreground/78",
                    isActive && "bg-sidebar-accent text-sidebar-accent-foreground"
                  )}
                >
                  <Link href={item.href} title={item.label}>
                    <Icon className="h-4 w-4 shrink-0" />
                    <span>{item.label}</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            )
          })}
        </SidebarMenu>
      </SidebarContent>

      <SidebarSeparator />

      <SidebarFooter className="p-2">
        <div className={cn("flex items-center gap-2", isCollapsed ? "flex-col" : "justify-between")}>
          <Button
            variant="ghost"
            size="icon"
            className="rounded-xl text-sidebar-foreground/72"
            aria-label="Toggle theme"
            onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
          >
            <Sun className="h-4 w-4 rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
            <Moon className="absolute h-4 w-4 rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
          </Button>

          {isSignedIn ? (
            <UserButton />
          ) : (
            <SignInButton mode="redirect">
              <Button
                variant={isCollapsed ? "ghost" : "outline"}
                size={isCollapsed ? "icon" : "sm"}
                className="rounded-xl border-sidebar-border text-sidebar-foreground"
              >
                {isCollapsed ? "in" : "Sign in"}
              </Button>
            </SignInButton>
          )}
        </div>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}
