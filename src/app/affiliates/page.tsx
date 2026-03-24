import Link from "next/link";

const BENEFITS = [
  {
    title: "Commission on Qualified Sales",
    description:
      "Earn competitive payouts when your audience shops from Mully Reserve through your unique link.",
  },
  {
    title: "Creative Assets Included",
    description:
      "Get campaign-ready visuals, copy blocks, and launch calendars tailored to golf seasonality.",
  },
  {
    title: "Dedicated Partner Support",
    description:
      "Work with our team to optimize placements, track results, and unlock limited-time bonuses.",
  },
];

const PROCESS = [
  {
    title: "Apply",
    description:
      "Tell us about your audience, channels, and where you plan to feature Mully Reserve.",
  },
  {
    title: "Get Approved",
    description:
      "Our team reviews applications weekly and confirms fit based on quality and relevance.",
  },
  {
    title: "Launch",
    description:
      "Receive your affiliate link and assets, then start driving traffic and earning commission.",
  },
];

export default function AffiliatesPage() {
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
              Partnerships
              <span className="w-6 h-px bg-sage/40" />
            </span>
            <h1 className="font-serif text-3xl md:text-4xl text-obsidian mb-3">
              Mully Reserve Affiliates
            </h1>
            <p className="text-sm md:text-base text-charcoal/55 leading-relaxed max-w-3xl">
              Partner with Mully Reserve and monetize your golf audience with a premium brand built
              around modern membership. We are looking for trusted publishers, communities, and
              creators who care about quality recommendations.
            </p>
            <div className="mt-7 flex flex-wrap gap-3">
              <a
                href="mailto:info@Mullybox.com?subject=Affiliate%20Application"
                className="inline-flex items-center justify-center h-11 px-7 rounded-xl bg-forest text-bone text-sm font-medium tracking-wider uppercase hover:bg-forest-dark transition-colors duration-300 btn-press"
              >
                Apply via Email
              </a>
              <Link
                href="/influencers"
                className="inline-flex items-center justify-center h-11 px-7 rounded-xl border border-taupe/20 text-sm tracking-wider uppercase text-charcoal/65 hover:text-forest hover:border-forest/25 transition-all duration-300"
              >
                Influencer Program
              </Link>
            </div>
          </section>

          <section className="grid md:grid-cols-3 gap-4 mb-8">
            {BENEFITS.map((item) => (
              <article key={item.title} className="rounded-xl border border-taupe/12 bg-bone-dark/40 p-5">
                <h2 className="font-serif text-xl text-obsidian mb-2">{item.title}</h2>
                <p className="text-sm text-charcoal/55 leading-relaxed">{item.description}</p>
              </article>
            ))}
          </section>

          <section className="rounded-2xl border border-taupe/12 bg-cream p-7 md:p-10">
            <h2 className="text-[11px] tracking-[0.25em] uppercase text-sage font-medium mb-5">
              How It Works
            </h2>
            <div className="grid md:grid-cols-3 gap-5">
              {PROCESS.map((step, index) => (
                <article key={step.title} className="rounded-xl border border-taupe/12 bg-bone p-5">
                  <p className="text-[11px] tracking-[0.18em] uppercase text-charcoal/35 mb-2">
                    Step {index + 1}
                  </p>
                  <h3 className="font-serif text-lg text-obsidian mb-2">{step.title}</h3>
                  <p className="text-sm text-charcoal/55 leading-relaxed">{step.description}</p>
                </article>
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
