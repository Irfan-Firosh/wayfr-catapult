import { SignUp } from "@clerk/nextjs"

export default function SignUpPage() {
  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-background px-6 py-12">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(245,166,35,0.16),transparent_0_34%),radial-gradient(circle_at_bottom_left,rgba(255,245,232,0.08),transparent_0_30%)]" />
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[#F5A62373] to-transparent" />
      <div className="relative grid w-full max-w-6xl gap-10 lg:grid-cols-[minmax(280px,440px)_minmax(340px,480px)] lg:items-center">
        <div className="hidden lg:block">
          <p className="text-xs uppercase tracking-[0.3em] text-[rgba(245,166,35,0.8)]">Create account</p>
          <h1 className="mt-4 text-5xl font-semibold tracking-[-0.05em] text-foreground">
            Start a better wayfinding workflow.
          </h1>
          <p className="mt-5 max-w-md text-base leading-7 text-muted-foreground">
            Create your account to manage hazard reports, live captures, and shared caregiver
            visibility in one place.
          </p>
        </div>
        <div className="relative">
          <div className="absolute inset-0 rounded-[2rem] bg-[rgba(245,166,35,0.1)] blur-3xl" />
          <div className="relative rounded-[2rem] border border-white/10 bg-white/[0.03] p-3 backdrop-blur-sm">
            <SignUp />
          </div>
        </div>
      </div>
    </main>
  )
}
