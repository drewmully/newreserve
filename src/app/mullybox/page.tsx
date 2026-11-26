import type { Metadata } from "next";
import Link from "next/link";
import { WaitlistForm } from "./WaitlistForm";

/**
 * Mullybox 2.0 coming-soon fallback.
 *
 * next.config.ts rewrites /mullybox (beforeFiles) to MULLYBOX_ORIGIN when that
 * env is set, and beforeFiles rewrites win over app routes. So setting
 * MULLYBOX_ORIGIN at launch replaces this page with the live app, no code
 * change needed. Do not set it before the app is ready or this page disappears.
 * Assets live in /public/mullybox-soon so the launch rewrite never touches them.
 */
export const metadata: Metadata = {
  title: "Mullybox 2.0 | Coming soon | Mully",
  description: "The mystery is back. No subscription. Open your Mullybox live on your phone and see what you got, right there.",
  alternates: { canonical: "https://www.mymully.com/mullybox" },
  openGraph: {
    title: "Mullybox 2.0 is coming soon",
    description: "The mystery is back. No subscription. Open it live on your phone.",
    url: "https://www.mymully.com/mullybox",
    images: [{ url: "https://www.mymully.com/mullybox-soon/course-wide.webp", width: 1672, height: 941 }],
  },
};

export default function MullyboxComingSoon() {
  return (
    <main className="relative min-h-[100svh] overflow-hidden bg-[#0c0a1c] text-[#f5f1e8]">
      <picture>
        <source media="(min-width: 768px)" srcSet="/mullybox-soon/course-wide.webp" />
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/mullybox-soon/course-tall.webp" alt="" aria-hidden="true" fetchPriority="high"
          className="absolute inset-0 h-full w-full object-cover object-[50%_30%] md:object-center"
        />
      </picture>
      <div aria-hidden="true" className="absolute inset-0 bg-gradient-to-b from-[#0c0a1c]/55 via-[#16112b]/70 to-[#0c0a1c] md:bg-gradient-to-r md:from-[#0c0a1c]/30 md:via-[#16112b]/80 md:to-[#0c0a1c]/95" />

      <div className="relative mx-auto flex min-h-[100svh] max-w-6xl flex-col px-5 pb-10 pt-6 md:px-10">
        <header className="flex items-center justify-between">
          <Link href="/" className="text-sm font-semibold uppercase tracking-[.22em] text-[#f5f1e8]/90 hover:text-white">Mully</Link>
          <Link href="/shop" className="text-xs font-semibold uppercase tracking-[.16em] text-[#f5f1e8]/75 underline-offset-4 hover:text-white hover:underline">Shop Mully</Link>
        </header>

        <section className="mt-auto pt-16 md:ml-auto md:mt-0 md:flex md:flex-1 md:items-center md:pt-0">
          <div className="max-w-[34rem] rounded-2xl border border-white/10 bg-[#16112b]/80 p-6 shadow-[0_30px_80px_rgba(0,0,0,.55)] backdrop-blur-md md:p-9">
            <p className="text-xs font-bold uppercase tracking-[.24em] text-[#22e1d0]">Mullybox 2.0</p>
            <h1 className="mt-3 text-[2.6rem] font-extrabold italic leading-[1.02] tracking-[-.02em] text-white md:text-6xl">
              The mystery <span className="text-[#ff3ea5]">is back.</span>
            </h1>
            <p className="mt-5 text-base leading-relaxed text-[#f5f1e8]/85 md:text-lg">
              No subscription. Open your box live on your phone and see what you got, right there. Every open has a shot at the really high end stuff, like Breitling, Omega and Vessel.
            </p>
            <div className="mt-6 border-l-2 border-[#ecc767] pl-4 text-sm leading-relaxed text-[#f5f1e8]/80">
              <p className="font-semibold text-[#ecc767]">Coming soon. Estimated launch Monday, Nov. 30 at 9am ET.</p>
              <p className="mt-1">Final partner approvals could move it, and this page will always have the latest.</p>
            </div>
            <WaitlistForm />
          </div>
        </section>
      </div>
    </main>
  );
}
