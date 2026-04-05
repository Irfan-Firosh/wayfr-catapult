import type { Metadata } from "next"
import { ClerkGate } from "@/components/clerk-gate"
import { Outfit, Geist_Mono } from "next/font/google"
import { ThemeProvider } from "@/components/theme-provider"
import { Toaster } from "@/components/ui/sonner"
import "./globals.css"

const outfitSans = Outfit({
  variable: "--font-outfit",
  subsets: ["latin"],
  display: "swap",
})

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
})

export const metadata: Metadata = {
  title: "wayfr — Navigate freely.",
  description:
    "3D spatial annotation for real-world scenes. Shared room meshes, local-first scene history, persona overlays, and guided navigation.",
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html
      lang="en"
      className={`${outfitSans.variable} ${geistMono.variable}`}
      data-scroll-behavior="smooth"
      suppressHydrationWarning
    >
      <body className="min-h-full antialiased" suppressHydrationWarning>
        <ThemeProvider
          attribute="class"
          defaultTheme="dark"
          enableSystem={false}
          disableTransitionOnChange
        >
          <ClerkGate
            appearance={{
              variables: {
                colorPrimary: "#F5A623",
                colorBackground: "var(--background)",
                colorInputBackground: "var(--card)",
                colorInputText: "var(--foreground)",
                colorText: "var(--foreground)",
                colorTextSecondary: "var(--muted-foreground)",
                colorNeutral: "#B8AA96",
                colorDanger: "#F87171",
                colorSuccess: "#F5A623",
                borderRadius: "0.625rem",
              },
              elements: {
                card: "border border-border/60 bg-card/92 shadow-[0_24px_80px_rgba(0,0,0,0.25)] backdrop-blur-xl",
                rootBox: "w-full",
                headerTitle: "text-foreground",
                headerSubtitle: "text-muted-foreground",
                socialButtonsBlockButton:
                  "border border-border/60 bg-card/60 text-foreground hover:bg-card",
                socialButtonsBlockButtonText: "text-foreground",
                formButtonPrimary:
                  "bg-[#F5A623] text-[#1A1208] hover:bg-[#ffb84b] shadow-none",
                formFieldInput:
                  "border border-border/60 bg-background text-foreground placeholder:text-muted-foreground",
                formFieldLabel: "text-foreground",
                footerActionLink: "text-[#F5A623] hover:text-[#ffbf5d]",
                dividerLine: "bg-border/60",
                dividerText: "text-muted-foreground",
                identityPreviewText: "text-foreground",
                formResendCodeLink: "text-[#F5A623] hover:text-[#ffbf5d]",
                otpCodeFieldInput:
                  "border border-border/60 bg-background text-foreground",
                alertText: "text-foreground",
                alert: "border border-red-500/25 bg-red-500/10 text-foreground",
              },
            }}
          >
            {children}
            <Toaster />
          </ClerkGate>
        </ThemeProvider>
      </body>
    </html>
  )
}
