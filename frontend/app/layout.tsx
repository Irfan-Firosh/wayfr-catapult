import type { Metadata } from "next"
import { ClerkProvider } from "@clerk/nextjs"
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
    "Real-time AI navigation for the visually impaired. Obstacle detection, community hazards, and caregiver monitoring — powered by four AI models in parallel.",
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
      suppressHydrationWarning
    >
      <body className="min-h-full antialiased">
        <ClerkProvider
          appearance={{
            variables: {
              colorPrimary: "#F5A623",
              colorBackground: "#0C0A08",
              colorInputBackground: "#141210",
              colorInputText: "#F5F0E8",
              colorText: "#F5F0E8",
              colorTextSecondary: "rgba(245, 240, 232, 0.72)",
              colorNeutral: "#B8AA96",
              colorDanger: "#F87171",
              colorSuccess: "#F5A623",
              borderRadius: "0.625rem",
            },
            elements: {
              card: "border border-white/10 bg-[#141210]/92 shadow-[0_24px_80px_rgba(0,0,0,0.45)] backdrop-blur-xl",
              rootBox: "w-full",
              headerTitle: "text-[#F5F0E8]",
              headerSubtitle: "text-[#D7C8B5]",
              socialButtonsBlockButton:
                "border border-white/10 bg-white/5 text-[#F5F0E8] hover:bg-white/10",
              socialButtonsBlockButtonText: "text-[#F5F0E8]",
              formButtonPrimary:
                "bg-[#F5A623] text-[#1A1208] hover:bg-[#ffb84b] shadow-none",
              formFieldInput:
                "border border-white/10 bg-[#110f0d] text-[#F5F0E8] placeholder:text-[#8C7B67]",
              formFieldLabel: "text-[#E9DBC9]",
              footerActionLink: "text-[#F5A623] hover:text-[#ffbf5d]",
              dividerLine: "bg-white/10",
              dividerText: "text-[#A08E79]",
              identityPreviewText: "text-[#F5F0E8]",
              formResendCodeLink: "text-[#F5A623] hover:text-[#ffbf5d]",
              otpCodeFieldInput:
                "border border-white/10 bg-[#110f0d] text-[#F5F0E8]",
              alertText: "text-[#F5F0E8]",
              alert: "border border-red-500/25 bg-red-500/10 text-[#F5F0E8]",
            },
          }}
        >
          <ThemeProvider
            attribute="class"
            defaultTheme="dark"
            enableSystem={false}
            disableTransitionOnChange
          >
            {children}
            <Toaster />
          </ThemeProvider>
        </ClerkProvider>
      </body>
    </html>
  )
}
