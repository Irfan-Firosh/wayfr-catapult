import Link from "next/link"
import { AppSidebar } from "@/components/dashboard/app-sidebar"
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar"

export default function SetupLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <SidebarProvider defaultOpen={false}>
      <AppSidebar />
      <SidebarInset className="bg-background">
        <header className="sticky top-0 z-30 flex h-12 items-center gap-3 border-b border-border/50 bg-background/85 px-4 backdrop-blur-xl md:hidden">
          <SidebarTrigger />
          <Link
            href="/"
            className="text-sm font-semibold tracking-tight text-foreground hover:text-foreground/90"
          >
            wayfr
          </Link>
        </header>
        {children}
      </SidebarInset>
    </SidebarProvider>
  )
}
