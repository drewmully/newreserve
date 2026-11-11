import type { Metadata } from "next";
import Link from "next/link";
import { MullyWordmark } from "../shop/components/MullyWordmark";
import { canonical } from "@/lib/seo";
import { joinSource } from "@/lib/shopSignup";
import { JoinForm } from "./JoinForm";

/**
 * /join: newsletter signup for people who got a forwarded editorial email.
 * Posts to /api/editorial/drop-signup with a whitelisted source (default
 * "forwarded"; `?source=` may pick another JOIN_SOURCES value).
 */
export const metadata: Metadata = {
  alternates: canonical("/join"),
  title: "Get The Mully Edit | Mully",
  description: "A twice-weekly guide to golf style, gear and the stories behind them.",
};

export default async function JoinPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const raw = Array.isArray(params.source) ? params.source[0] : params.source;
  const source = joinSource(raw);
  return (
    <div className="flex min-h-dvh flex-col bg-cream text-charcoal">
      <header className="px-6 pt-6 md:px-10 md:pt-8">
        <Link href="/" aria-label="Mully home" className="inline-flex min-h-11 items-center">
          <MullyWordmark accent="#6E8B74" className="text-2xl" />
        </Link>
      </header>
      <main className="flex flex-1 items-center px-6 py-12 md:px-10 md:py-20">
        <div className="mx-auto w-full max-w-xl">
          <p className="mb-4 text-[11px] font-semibold uppercase tracking-[.18em] text-sage">The Mully Edit</p>
          <h1 className="font-serif text-[2.6rem] leading-[1.05] text-forest md:text-6xl">Get The Mully Edit.</h1>
          <p className="mt-4 text-lg leading-relaxed text-charcoal/80 md:text-xl">A twice-weekly guide to golf style, gear and the stories behind them.</p>
          <JoinForm source={source} />
        </div>
      </main>
      <footer className="border-t border-forest/10 px-6 pb-24 pt-6 text-xs text-charcoal/60 md:px-10">
        <nav aria-label="Footer" className="flex flex-wrap gap-x-5 gap-y-2">
          <Link className="inline-flex min-h-11 items-center hover:text-forest" href="/">mymully.com</Link>
          <Link className="inline-flex min-h-11 items-center hover:text-forest" href="/lp/editorial">Read the edit</Link>
          <Link className="inline-flex min-h-11 items-center hover:text-forest" href="/policies/privacy">Privacy policy</Link>
        </nav>
      </footer>
    </div>
  );
}
