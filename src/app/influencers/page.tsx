import Link from "next/link";

const PERKS = [
  {
    title: "Launch Seeding",
    description:
      "Selected creators receive curated product drops to showcase authentic on-course experiences.",
  },
  {
    title: "Performance Bonuses",
    description:
      "Earn tiered payouts when your content drives member signups or qualified product sales.",
  },
  {
    title: "Co-Branded Campaigns",
    description:
      "Collaborate with our team on reels, events, and limited activations around key golf moments.",
  },
];

const REQUIREMENTS = [
  "Golf-focused or golf-adjacent audience with consistent posting cadence.",
  "Original content style aligned with premium-but-approachable brand positioning.",
  "Strong engagement quality across Instagram, TikTok, YouTube, or newsletter channels.",
];

export default function InfluencersPage() {
  return (
    <div className="min-h-screen bg-bone">
      <header className="fixed top-0 left-0 right-0 z-50 bg-bone/90 backdrop-blur-md border-b border-taupe/15">
        <div className="max-w-7xl mx-auto px-5 md:px-12 flex items-center justify-between h-14">
          <Link href="/" className="flex items-center gap-2 text-forest">
            <svg viewBox="0 0 1002 540" fill="currentColor" className="h-4 w-auto" aria-hidden="true">
              <path d="M0,0 H1002 V540 H0 Z M50,1 L998,269 L50,538 Z" fillRule="evenodd" />
            </svg>
            <span className="font-serif text-xl font-bold tracking-wide">mully.</span>
          </Link>
          <Link href="/login" className="text-sm tracking-wider uppercase text-forest font-medium hover:text-forest-dark transition-colors duration-300">
            Sign In
          </Link>
        </div>
      </header>

      <main className="pt-24 pb-20 px-5 md:px-12">
        <div className="max-w-5xl mx-auto">
          <section className="rounded-2xl border border-taupe/12 bg-cream p-7 md:p-10 mb-8">
            <span className="inline-flex items-center gap-2.5 text-[11px] tracking-[0.35em] uppercase text-sage font-medium mb-4">
              <span className="w-6 h-px bg-sage/40" />
              Creator Program
              <span className="w-6 h-px bg-sage/40" />
            </span>
            <h1 className="font-serif text-3xl md:text-4xl text-obsidian mb-3">
              Mully Reserve Influencers
            </h1>
            <p className="text-sm md:text-base text-charcoal/55 leading-relaxed max-w-3xl">
              We partner with creators who shape golf culture with credibility. If your audience
              trusts your recommendations, we can build a partnership that feels organic and performs.
            </p>
            <div className="mt-7 flex flex-wrap gap-3">
              <a
                href="mailto:Info@MyMully.com?subject=Influencer%20Partnership"
                className="inline-flex items-center justify-center h-11 px-7 rounded-xl bg-forest text-bone text-sm font-medium tracking-wider uppercase hover:bg-forest-dark transition-colors duration-300 btn-press"
              >
                Apply via Email
              </a>
              <Link
                href="/affiliates"
                className="inline-flex items-center justify-center h-11 px-7 rounded-xl border border-taupe/20 text-sm tracking-wider uppercase text-charcoal/65 hover:text-forest hover:border-forest/25 transition-all duration-300"
              >
                Affiliate Program
              </Link>
            </div>
          </section>

          <section className="grid md:grid-cols-3 gap-4 mb-8">
            {PERKS.map((item) => (
              <article key={item.title} className="rounded-xl border border-taupe/12 bg-bone-dark/40 p-5">
                <h2 className="font-serif text-xl text-obsidian mb-2">{item.title}</h2>
                <p className="text-sm text-charcoal/55 leading-relaxed">{item.description}</p>
              </article>
            ))}
          </section>

          <section className="rounded-2xl border border-taupe/12 bg-cream p-7 md:p-10">
            <h2 className="text-[11px] tracking-[0.25em] uppercase text-sage font-medium mb-5">
              What We Look For
            </h2>
            <div className="space-y-3">
              {REQUIREMENTS.map((item) => (
                <div key={item} className="flex items-start gap-3 rounded-xl border border-taupe/12 bg-bone p-4">
                  <span className="w-1.5 h-1.5 rounded-full bg-forest mt-2.5 shrink-0" />
                  <p className="text-sm text-charcoal/55 leading-relaxed">{item}</p>
                </div>
              ))}
            </div>
          </section>
        </div>
      </main>

      <footer className="py-8 px-6 bg-forest">
        <div className="max-w-6xl mx-auto flex flex-col md:flex-row md:items-center md:justify-between gap-3">
          <span className="flex items-center gap-2 text-bone">
            <svg viewBox="0 0 1002 540" fill="currentColor" className="h-3.5 w-auto" aria-hidden="true">
              <path d="M0,0 H1002 V540 H0 Z M50,1 L998,269 L50,538 Z" fillRule="evenodd" />
            </svg>
            <span className="font-serif text-lg font-bold tracking-wide">mully.</span>
          </span>
          <p className="text-xs text-bone/35">&copy; {new Date().getFullYear()} Mully Group, Inc. All rights reserved.</p>
        </div>
      </footer>
    </div>
  );
}
