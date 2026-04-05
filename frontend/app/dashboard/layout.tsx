import { AppSidebar } from "@/components/dashboard/app-sidebar"
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar"

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <SidebarProvider defaultOpen={false}>
      <AppSidebar />
      <SidebarInset className="min-h-0 flex flex-1 flex-col overflow-hidden bg-background">
        <header className="sticky top-0 z-30 flex h-12 shrink-0 items-center gap-3 border-b border-border/50 bg-background/85 px-4 backdrop-blur-xl md:hidden">
          <SidebarTrigger />
          <p className="text-sm font-semibold tracking-tight text-foreground">wayfr</p>
        </header>
        <div className="relative min-h-0 flex-1">{children}</div>
      </SidebarInset>
    </SidebarProvider>
  )
}
