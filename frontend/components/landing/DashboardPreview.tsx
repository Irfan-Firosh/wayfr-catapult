import Image from "next/image"

export function DashboardPreview() {
  return (
    <section className="relative -mt-12 pb-8">
      <div className="mx-auto max-w-6xl px-6">
        <div className="mb-4">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-mango/90">
              Dashboard Preview
            </p>
            <h2 className="mt-2 text-xl font-semibold tracking-tight text-foreground sm:text-2xl">
              Local mesh, external annotations, previous GLBs.
            </h2>
          </div>
        </div>

        <div className="overflow-hidden rounded-[2rem] border border-border/60 bg-card/70 p-2 shadow-[0_32px_110px_rgba(0,0,0,0.14)] backdrop-blur-xl dark:shadow-[0_36px_120px_rgba(0,0,0,0.32)]">
          <Image
            src="/hero-light.png"
            alt="wayfr hero preview"
            width={1600}
            height={1000}
            priority
            className="h-auto w-full rounded-[1.5rem] border border-black/5 object-cover dark:hidden"
          />
          <Image
            src="/hero-dark.png"
            alt="wayfr hero preview"
            width={1600}
            height={1000}
            priority
            className="hidden h-auto w-full rounded-[1.5rem] border border-white/5 object-cover dark:block"
          />
        </div>
      </div>
    </section>
  )
}

export default DashboardPreview
