import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import StarterKitCalculator from "./components/StarterKitCalculator";
import StarterKitApplyButton from "./components/StarterKitApplyButton";

export const metadata: Metadata = {
  title: "Mully Starter Kit | For Simulator Clubs",
  description:
    "A pro shop in a box for indoor golf simulator clubs. One quarterly fee. Hardware, fresh inventory, and three revenue streams. Powered by Mully.",
  openGraph: {
    title: "Mully Starter Kit | For Simulator Clubs",
    description:
      "A pro shop in a box for indoor golf simulator clubs. Hardware, fresh inventory each quarter, and three revenue streams. Powered by Mully.",
    siteName: "Mully Reserve",
    type: "website",
    images: ["/simulatorclubs/starter-kit-hero.webp"],
  },
  alternates: { canonical: "/simulatorclubs" },
};

// ─────────────────────────────────────────────────────────────────────────────
// SHARED BLOCKS
// ─────────────────────────────────────────────────────────────────────────────

function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-2.5 text-[11px] tracking-[0.32em] uppercase text-sage font-medium">
      <span className="w-8 h-px bg-sage/40" />
      <span>{children}</span>
      <span className="w-8 h-px bg-sage/40" />
    </span>
  );
}

function EyebrowLeft({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-2.5 text-[11px] tracking-[0.32em] uppercase text-sage font-medium">
      <span>{children}</span>
      <span className="w-10 h-px bg-sage/40" />
    </span>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// DATA
// ─────────────────────────────────────────────────────────────────────────────

const KIT_ITEMS = [
  {
    title: "Slatwall display fixture",
    body: "A merchandised, brand-consistent wall, sized to your space. Installed by Mully.",
  },
  {
    title: "$3,000 in starter inventory",
    body: "Curated apparel and accessories tuned to your club. Restocked at the start of each quarter.",
  },
  {
    title: "Laser-cut acrylic signage",
    body: "Your club's mark, paired with the Powered by Mully signature. Built to live above the rack.",
  },
  {
    title: "Square POS reader",
    body: "Tap, chip, or swipe. Pre-paired to your account so members buy without leaving the bay.",
  },
  {
    title: "Mullybox quarterly display",
    body: "An always-on shelf for the seasonal box. Members touch the product before they subscribe.",
  },
  {
    title: "Mully Field Guide",
    body: "A printed playbook for staff. Pricing, restock requests, embroidery, returns, and the rest.",
  },
];

const REVENUE_STREAMS = [
  {
    label: "Stream one",
    title: "The in-club boutique",
    body: "Members shop the slatwall on the way to their bay. You keep your full markup on every piece sold through your POS.",
    detail: "Default markup is 2x cost. You set the price.",
  },
  {
    label: "Stream two",
    title: "Mullybox quarterly subscription",
    body: "Members subscribe to the seasonal box on the display. Mully ships, supports, and renews. You earn $50 on every box, every quarter.",
    detail: "$50 commission per active Mullybox member, paid quarterly.",
  },
  {
    label: "Stream three",
    title: "Club-branded online storefront",
    body: "A co-branded shop your members reach from a QR code on the wall. Mully fulfills every order. You earn 25 percent of revenue.",
    detail: "25 percent commission on all online orders from your club's storefront.",
  },
];

const HOW_IT_WORKS = [
  {
    n: "01",
    title: "Apply",
    body: "Tell us about your club in five short steps. Most operators finish in under ten minutes.",
  },
  {
    n: "02",
    title: "Onboarding call",
    body: "We confirm the kit, your accent color, and your member sizing. You approve the merchandising plan.",
  },
  {
    n: "03",
    title: "Install",
    body: "Mully ships and installs the fixture, signage, POS, and first quarter of inventory. Two hours on site.",
  },
  {
    n: "04",
    title: "Operate",
    body: "Members shop. The portal tracks sell-through. Each quarter ships fresh inventory and pays out your commissions.",
  },
];

const PORTAL_FEATURES = [
  {
    title: "Real-time sell-through",
    body: "Unit sales, top sellers, and dead stock for every quarter, live.",
  },
  {
    title: "One-click restock requests",
    body: "Sold out of mediums in the forest hoodie? Request a refill without an email thread.",
  },
  {
    title: "Preview next quarter",
    body: "See the upcoming assortment before it ships. Swap pieces that did not fit your members.",
  },
  {
    title: "Commission tracking",
    body: "Mullybox and online storefront earnings, updated as orders land.",
  },
];

const FAQ = [
  {
    q: "What does $2,000 per quarter cover?",
    a: "The hardware install in quarter one, $3,000 in starter inventory, all quarterly restocks for the year, the Square reader, the Mullybox display, your portal access, and Mully support. There are no setup fees and no per-item charges.",
  },
  {
    q: "Do I need to buy inventory?",
    a: "No. The starter inventory and every quarterly restock are included in the $2,000 fee. You are not carrying inventory on your books.",
  },
  {
    q: "Who owns the hardware?",
    a: "You do. Quarter one ships the slatwall, signage, POS, and Mullybox display. Quarters two through four ship fresh inventory only. The hardware stays with the club.",
  },
  {
    q: "How does the POS connect to my existing system?",
    a: "The Square reader runs as a standalone register tied to your Mully account so we can track sell-through and reconcile inventory. If you already run Square, we can link to your existing account on the onboarding call.",
  },
  {
    q: "What if a piece does not sell?",
    a: "Tell us in the portal. We swap it on the next quarterly ship. You are not stuck with dead stock.",
  },
  {
    q: "How are Mullybox and online commissions paid?",
    a: "Quarterly, by ACH, the week after each quarter closes. The portal shows running totals so you always know what is coming.",
  },
  {
    q: "Can I use my own apparel brands?",
    a: "The starter assortment is curated by Mully. We will absolutely feature pieces your members already wear when we plan your quarters.",
  },
  {
    q: "What if I want to cancel?",
    a: "The annual commitment is one year. After that, the program continues quarter to quarter and you can pause anytime between shipments.",
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// PAGE
// ─────────────────────────────────────────────────────────────────────────────

export default function SimulatorClubsPage() {
  return (
    <div className="min-h-screen bg-bone text-forest-dark antialiased">
      {/* ─── HERO ─── */}
      <section className="relative isolate overflow-hidden bg-obsidian text-bone">
        <Image
          src="/simulatorclubs/starter-kit-hero.webp"
          alt="A Mully Starter Kit slatwall display inside a private indoor golf simulator club, lit by warm amber pendants"
          fill
          priority
          sizes="100vw"
          className="object-cover object-center opacity-65"
        />
        <div className="absolute inset-0 bg-gradient-to-b from-obsidian/55 via-obsidian/40 to-obsidian/85" />

        <div className="relative max-w-6xl mx-auto px-6 md:px-12 pt-28 md:pt-40 pb-28 md:pb-40">
          <div className="max-w-3xl">
            <EyebrowLeft>For simulator clubs</EyebrowLeft>
            <h1 className="mt-7 font-serif text-[40px] md:text-[68px] leading-[1.04] tracking-tight text-bone">
              A pro shop in a box.
              <span className="block text-bone/65">
                One quarterly fee. Three revenue streams.
              </span>
            </h1>
            <p className="mt-7 max-w-xl text-base md:text-lg leading-relaxed text-bone/75">
              The Mully Starter Kit installs a complete merchandising program inside your club. Hardware, fresh inventory each quarter, and a portal that runs it all. Two thousand dollars per quarter, billed quarterly.
            </p>

            <div className="mt-10 flex flex-col sm:flex-row sm:items-center gap-4">
              <StarterKitApplyButton className="inline-flex items-center justify-center h-12 px-9 rounded-xl bg-ember text-forest-dark text-sm font-semibold tracking-wider uppercase hover:bg-ember/90 transition-colors duration-300">
                Apply for a founding kit
              </StarterKitApplyButton>
              <a
                href="#calculator"
                className="inline-flex items-center justify-center h-12 px-7 rounded-xl border border-bone/30 text-bone text-sm font-medium tracking-wide hover:border-bone/55 hover:bg-bone/5 transition-colors duration-300"
              >
                Run the numbers
              </a>
            </div>

            <p className="mt-8 text-[11px] tracking-[0.28em] uppercase text-bone/45">
              Powered by Mully
            </p>
          </div>
        </div>
      </section>

      {/* ─── PRICING STRIP ─── */}
      <section className="py-12 md:py-16 px-6 md:px-12 bg-forest text-bone border-y border-bone/10">
        <div className="max-w-6xl mx-auto grid grid-cols-1 md:grid-cols-4 gap-8 md:gap-10">
          <div>
            <p className="text-[11px] tracking-[0.28em] uppercase text-sage">Quarterly fee</p>
            <p className="mt-3 font-serif text-3xl md:text-4xl text-bone">$2,000</p>
            <p className="mt-2 text-sm text-bone/65 leading-relaxed">Billed at the start of each quarter.</p>
          </div>
          <div>
            <p className="text-[11px] tracking-[0.28em] uppercase text-sage">Starter inventory</p>
            <p className="mt-3 font-serif text-3xl md:text-4xl text-bone">$3,000</p>
            <p className="mt-2 text-sm text-bone/65 leading-relaxed">Shipped in quarter one. Included.</p>
          </div>
          <div>
            <p className="text-[11px] tracking-[0.28em] uppercase text-sage">Revenue streams</p>
            <p className="mt-3 font-serif text-3xl md:text-4xl text-bone">3</p>
            <p className="mt-2 text-sm text-bone/65 leading-relaxed">Boutique, Mullybox, online storefront.</p>
          </div>
          <div>
            <p className="text-[11px] tracking-[0.28em] uppercase text-sage">Commitment</p>
            <p className="mt-3 font-serif text-3xl md:text-4xl text-bone">1 year</p>
            <p className="mt-2 text-sm text-bone/65 leading-relaxed">Then quarter to quarter, pause anytime.</p>
          </div>
        </div>
      </section>

      {/* ─── Q1 KIT CONTENTS ─── */}
      <section className="py-24 md:py-32 px-6 md:px-12 bg-bone">
        <div className="max-w-6xl mx-auto">
          <div className="max-w-2xl">
            <Eyebrow>What ships in quarter one</Eyebrow>
            <h2 className="mt-6 font-serif text-3xl md:text-5xl leading-[1.08] tracking-tight text-forest-dark">
              Everything you need to open the boutique.
            </h2>
            <p className="mt-5 text-base md:text-lg text-forest-dark/70 leading-relaxed">
              Quarter one installs the full kit. Quarters two through four ship fresh inventory only. The hardware stays with the club.
            </p>
          </div>

          <div className="mt-16 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {KIT_ITEMS.map((item, i) => (
              <div
                key={item.title}
                className="bg-white border border-forest-dark/8 rounded-2xl p-7 hover:border-forest-dark/20 transition-colors duration-300"
              >
                <p className="font-serif text-xl text-ember mb-1">
                  {String(i + 1).padStart(2, "0")}
                </p>
                <h3 className="font-serif text-xl text-forest-dark leading-tight mb-2">
                  {item.title}
                </h3>
                <p className="text-sm text-forest-dark/65 leading-relaxed">
                  {item.body}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ─── THREE REVENUE STREAMS ─── */}
      <section className="py-24 md:py-32 px-6 md:px-12 bg-forest-dark text-bone">
        <div className="max-w-6xl mx-auto">
          <div className="max-w-2xl">
            <Eyebrow>How the kit earns</Eyebrow>
            <h2 className="mt-6 font-serif text-3xl md:text-5xl leading-[1.08] tracking-tight text-bone">
              Three ways the same wall pays you back.
            </h2>
            <p className="mt-5 text-base md:text-lg text-bone/65 leading-relaxed">
              Most clubs recover the quarterly fee from the boutique alone. Mullybox and the online storefront stack on top.
            </p>
          </div>

          <div className="mt-16 grid grid-cols-1 md:grid-cols-3 gap-6">
            {REVENUE_STREAMS.map((s) => (
              <div
                key={s.title}
                className="bg-forest border border-bone/10 rounded-2xl p-8 flex flex-col"
              >
                <p className="text-[11px] tracking-[0.28em] uppercase text-sage mb-5">
                  {s.label}
                </p>
                <h3 className="font-serif text-2xl text-bone leading-snug mb-4">
                  {s.title}
                </h3>
                <p className="text-sm text-bone/70 leading-relaxed mb-6 flex-1">
                  {s.body}
                </p>
                <p className="text-sm text-ember leading-snug border-t border-bone/10 pt-5">
                  {s.detail}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ─── ROI CALCULATOR ─── */}
      <section id="calculator" className="py-24 md:py-32 px-6 md:px-12 bg-cream">
        <div className="max-w-6xl mx-auto">
          <div className="max-w-2xl mb-14">
            <Eyebrow>Your numbers</Eyebrow>
            <h2 className="mt-6 font-serif text-3xl md:text-5xl leading-[1.08] tracking-tight text-forest-dark">
              See the math on your club.
            </h2>
            <p className="mt-5 text-base md:text-lg text-forest-dark/70 leading-relaxed">
              Adjust sell-through, your markup, and active members. The three revenue streams add together into a quarterly take-home.
            </p>
          </div>

          <StarterKitCalculator />
        </div>
      </section>

      {/* ─── HOW IT WORKS ─── */}
      <section className="py-24 md:py-32 px-6 md:px-12 bg-bone">
        <div className="max-w-6xl mx-auto">
          <div className="max-w-2xl">
            <Eyebrow>How it works</Eyebrow>
            <h2 className="mt-6 font-serif text-3xl md:text-5xl leading-[1.08] tracking-tight text-forest-dark">
              From application to first sale in under a month.
            </h2>
          </div>

          <div className="mt-16 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            {HOW_IT_WORKS.map((step) => (
              <div
                key={step.n}
                className="bg-white border border-forest-dark/8 rounded-2xl p-7"
              >
                <p className="font-serif text-3xl text-ember/80 mb-4">{step.n}</p>
                <h3 className="font-serif text-xl text-forest-dark mb-2">
                  {step.title}
                </h3>
                <p className="text-sm text-forest-dark/65 leading-relaxed">
                  {step.body}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ─── CLUB PORTAL ─── */}
      <section className="py-24 md:py-32 px-6 md:px-12 bg-forest text-bone">
        <div className="max-w-6xl mx-auto grid grid-cols-1 lg:grid-cols-12 gap-12 lg:gap-16 items-start">
          <div className="lg:col-span-5">
            <Eyebrow>The club portal</Eyebrow>
            <h2 className="mt-6 font-serif text-3xl md:text-5xl leading-[1.08] tracking-tight text-bone">
              Run the boutique without leaving your desk.
            </h2>
            <p className="mt-5 text-base md:text-lg text-bone/70 leading-relaxed">
              Every kit comes with a private dashboard for your team. Watch sales as they happen, request restocks, preview what is coming next, and see your commissions stack up.
            </p>
          </div>
          <div className="lg:col-span-7 grid grid-cols-1 md:grid-cols-2 gap-5">
            {PORTAL_FEATURES.map((f) => (
              <div
                key={f.title}
                className="bg-forest-dark/60 border border-bone/10 rounded-2xl p-6"
              >
                <h3 className="font-serif text-lg text-bone mb-2">{f.title}</h3>
                <p className="text-sm text-bone/65 leading-relaxed">{f.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ─── FAQ ─── */}
      <section className="py-24 md:py-32 px-6 md:px-12 bg-bone">
        <div className="max-w-4xl mx-auto">
          <div className="text-center mb-14">
            <Eyebrow>Questions</Eyebrow>
            <h2 className="mt-6 font-serif text-3xl md:text-5xl leading-[1.08] tracking-tight text-forest-dark">
              The honest answers.
            </h2>
          </div>

          <div className="divide-y divide-forest-dark/10 border-y border-forest-dark/10">
            {FAQ.map((item) => (
              <details
                key={item.q}
                className="group py-6 px-2"
              >
                <summary className="flex items-start justify-between gap-6 cursor-pointer list-none">
                  <span className="font-serif text-lg md:text-xl text-forest-dark leading-snug">
                    {item.q}
                  </span>
                  <span className="text-ember text-2xl leading-none mt-1 transition-transform duration-300 group-open:rotate-45">
                    +
                  </span>
                </summary>
                <p className="mt-4 text-sm md:text-base text-forest-dark/70 leading-relaxed pr-10">
                  {item.a}
                </p>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* ─── FINAL CTA ─── */}
      <section className="py-20 md:py-28 px-6 md:px-12 bg-forest-dark text-bone text-center">
        <div className="max-w-3xl mx-auto">
          <h2 className="font-serif text-3xl md:text-5xl text-bone leading-[1.08] tracking-tight mb-7">
            Open the boutique your members already wear.
            <span className="block text-bone/55">Powered by Mully.</span>
          </h2>
          <p className="text-base text-bone/65 leading-relaxed mb-9 max-w-xl mx-auto">
            Apply in five steps. We will be in touch within two business days to schedule your onboarding call.
          </p>
          <StarterKitApplyButton className="inline-flex items-center justify-center h-12 px-9 rounded-xl bg-ember text-forest-dark text-sm font-semibold tracking-wider uppercase hover:bg-ember/90 transition-colors duration-300">
            Apply for a founding kit
          </StarterKitApplyButton>
          <p className="text-[11px] text-bone/40 mt-5 tracking-wide">
            $2,000 per quarter. One year commitment.
          </p>
        </div>
      </section>

      {/* ─── FOOTER ─── */}
      <footer className="py-10 px-6 bg-forest border-t border-bone/10">
        <div className="max-w-6xl mx-auto flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div className="flex items-center gap-3">
            <Link href="/" className="flex items-center gap-2 text-bone">
              <svg viewBox="0 0 1002 540" fill="currentColor" className="h-3.5 w-auto" aria-hidden="true">
                <path d="M0,0 H1002 V540 H0 Z M50,1 L998,269 L50,538 Z" fillRule="evenodd" />
              </svg>
              <span className="font-serif text-lg font-bold tracking-wide">mully.</span>
            </Link>
            <span className="text-xs text-bone/50 italic">
              Mully Starter Kit. A B2B program from Mully Reserve.
            </span>
          </div>
          <p className="text-xs text-bone/35">
            &copy; 2026 Mully Group, Inc. ·{" "}
            <a href="mailto:clubs@mymully.com" className="hover:text-ember transition-colors">
              clubs@mymully.com
            </a>
          </p>
        </div>
      </footer>
    </div>
  );
}
