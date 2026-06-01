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

/**
 * Top-of-hero brand lockup: the Mully wordmark sitting above the page subtitle,
 * reads as "Mully  /  for simulator clubs".
 */
function MullyLockup() {
  return (
    <Link
      href="/"
      className="inline-flex items-center gap-3 text-bone hover:text-ember transition-colors duration-300"
      aria-label="Back to Mully home"
    >
      <svg
        viewBox="0 0 1002 540"
        fill="currentColor"
        className="h-4 md:h-5 w-auto"
        aria-hidden="true"
      >
        <path d="M0,0 H1002 V540 H0 Z M50,1 L998,269 L50,538 Z" fillRule="evenodd" />
      </svg>
      <span className="font-serif text-lg md:text-xl font-bold tracking-wide leading-none">
        mully.
      </span>
      <span className="hidden sm:inline-flex items-center gap-3 ml-1">
        <span className="w-8 h-px bg-bone/30" />
        <span className="text-[10px] md:text-[11px] tracking-[0.32em] uppercase text-bone/55 font-medium">
          for simulator clubs
        </span>
      </span>
    </Link>
  );
}

/**
 * Inline icon set for the kit inclusions. Single-color, 24x24, currentColor.
 */
function KitIcon({ name, className }: { name: string; className?: string }) {
  const common = {
    width: 28,
    height: 28,
    viewBox: "0 0 24 24",
    fill: "none" as const,
    stroke: "currentColor",
    strokeWidth: 1.5,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
    className,
  };
  switch (name) {
    case "slatwall":
      // Wall with horizontal slats and a hanging tag
      return (
        <svg {...common}>
          <rect x="3" y="3" width="18" height="18" rx="1.5" />
          <path d="M3 8h18M3 12h18M3 16h18" />
          <path d="M14 5.5v3M14 8.5l-1.5 2.5h3z" />
        </svg>
      );
    case "signage":
      // Mounted plaque
      return (
        <svg {...common}>
          <rect x="3" y="7" width="18" height="10" rx="1.5" />
          <path d="M12 7V4M9 4h6" />
          <path d="M7 12h10" />
        </svg>
      );
    case "pos":
      // Card reader / terminal
      return (
        <svg {...common}>
          <rect x="5" y="3" width="14" height="18" rx="2" />
          <path d="M8 7h8" />
          <rect x="8" y="10" width="8" height="5" rx="0.5" />
          <circle cx="12" cy="18" r="0.8" fill="currentColor" stroke="none" />
        </svg>
      );
    case "box":
      // Subscription box
      return (
        <svg {...common}>
          <path d="M3 7l9-4 9 4-9 4-9-4z" />
          <path d="M3 7v10l9 4 9-4V7" />
          <path d="M12 11v10" />
          <path d="M8 5l8 4" />
        </svg>
      );
    case "book":
      // Field guide / open book
      return (
        <svg {...common}>
          <path d="M3 5a2 2 0 0 1 2-2h5v17H5a2 2 0 0 0-2 2V5z" />
          <path d="M21 5a2 2 0 0 0-2-2h-5v17h5a2 2 0 0 1 2 2V5z" />
          <path d="M6 8h2M6 11h2M16 8h2M16 11h2" />
        </svg>
      );
    case "inventory":
      // Stacked apparel
      return (
        <svg {...common}>
          <path d="M4 8l4-3 2 1.5h4L16 5l4 3-2 1.5v9H6v-9L4 8z" />
          <path d="M10 5a2 2 0 0 0 4 0" />
        </svg>
      );
    default:
      return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// DATA
// ─────────────────────────────────────────────────────────────────────────────

const FREE_INCLUSIONS = [
  {
    icon: "inventory",
    title: "$3,000 of retail-ready inventory",
    body: "Ships in your first kit. Curated by Mully to match your members. Yours, on your books, full markup yours to keep.",
    badge: "First kit",
  },
  {
    icon: "slatwall",
    title: "Slatwall display fixture",
    body: "A merchandised, brand-consistent wall, sized to your space. Installed by Mully.",
  },
  {
    icon: "signage",
    title: "Laser-cut acrylic signage",
    body: "Your club's mark, paired with the Powered by Mully signature. Built to live above the rack.",
  },
  {
    icon: "pos",
    title: "Square POS reader",
    body: "Tap, chip, or swipe. Pre-paired to your account so members buy without leaving the bay.",
  },
  {
    icon: "box",
    title: "Mullybox quarterly display",
    body: "An always-on shelf for the seasonal box. Members touch the product before they subscribe.",
  },
  {
    icon: "book",
    title: "Mully Field Guide",
    body: "A printed playbook for staff. Pricing, restock requests, embroidery, returns, and ideas for moving slow pieces.",
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
    a: "$3,000 of retail-ready inventory tuned to your members, plus the slatwall fixture, your laser-cut signage, a Square reader, the Mullybox display, your portal access, and Mully support. The hardware and signage are a free inclusion for founding partners. No setup fees, no per-item charges.",
  },
  {
    q: "Do I need to buy inventory?",
    a: "The $3,000 of starter inventory is yours, on your books, included in the kit. You keep the full markup on every sale. When pieces move, restock anytime from your portal, or push more units through your online storefront to keep the rack fresh.",
  },
  {
    q: "Who owns the hardware?",
    a: "You do, for as long as you are an active partner. The slatwall, signage, POS, and Mullybox display are a free inclusion for founding partners. Quarters two through four ship fresh inventory only.",
  },
  {
    q: "How does the POS connect to my existing system?",
    a: "The Square reader runs as a standalone register tied to your Mully account so we can track sell-through and reconcile inventory. If you already run Square, we can link to your existing account on the onboarding call.",
  },
  {
    q: "What if a piece does not sell?",
    a: "The Field Guide ships with proven plays for moving slower inventory, from staff incentives and bay-side bundles to embroidery promos and member emails. If something still will not move, swap it from the portal on your next ship.",
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
    q: "What is your return policy?",
    a: "Inventory can be returned within 30 days of purchase for a refund, no questions asked. The POS reader, slatwall fixture, signage, and Mullybox display can be returned anytime for a full refund of the hardware, in working condition.",
  },
  {
    q: "What if I want to cancel?",
    a: "Cancel anytime. We ask that you either return the kit hardware in working condition or pay a $1,000 hardware buyout. Inventory you have already purchased stays yours, or you can return any inventory within 30 days for a refund.",
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

        {/* Top-right brand lockup */}
        <div className="relative max-w-6xl mx-auto px-6 md:px-12 pt-7 md:pt-9 flex justify-end">
          <MullyLockup />
        </div>

        <div className="relative max-w-6xl mx-auto px-6 md:px-12 pt-20 md:pt-32 pb-28 md:pb-40">
          <div className="max-w-3xl">
            <EyebrowLeft>The Mully Starter Kit</EyebrowLeft>
            <h1 className="mt-7 font-serif text-[40px] md:text-[68px] leading-[1.04] tracking-tight text-bone">
              A pro shop in a box,
              <span className="block text-bone/65">
                designed for simulator owners.
              </span>
            </h1>
            <p className="mt-7 max-w-xl text-base md:text-lg leading-relaxed text-bone/75">
              One click. We ship the fixtures, signage, POS reader, and Mullybox display already built for your wall, plus $3,000 of retail-ready inventory for $2,000. Touchless to install, touchless to restock.
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
            <p className="text-[11px] tracking-[0.28em] uppercase text-sage">You receive</p>
            <p className="mt-3 font-serif text-3xl md:text-4xl text-bone">$3,000</p>
            <p className="mt-2 text-sm text-bone/65 leading-relaxed">Of retail-ready inventory, yours to sell.</p>
          </div>
          <div>
            <p className="text-[11px] tracking-[0.28em] uppercase text-sage">Revenue streams</p>
            <p className="mt-3 font-serif text-3xl md:text-4xl text-bone">3</p>
            <p className="mt-2 text-sm text-bone/65 leading-relaxed">Boutique, Mullybox, online storefront.</p>
          </div>
          <div>
            <p className="text-[11px] tracking-[0.28em] uppercase text-sage">Commitment</p>
            <p className="mt-3 font-serif text-3xl md:text-4xl text-bone">None</p>
            <p className="mt-2 text-sm text-bone/65 leading-relaxed">Cancel anytime. Return the kit, or keep it for $1,000.</p>
          </div>
        </div>
      </section>

      {/* ─── Q1 KIT CONTENTS ─── */}
      <section className="py-24 md:py-32 px-6 md:px-12 bg-bone">
        <div className="max-w-6xl mx-auto">
          <div className="max-w-2xl">
            <Eyebrow>What you are buying</Eyebrow>
            <h2 className="mt-6 font-serif text-3xl md:text-5xl leading-[1.08] tracking-tight text-forest-dark">
              $3,000 of inventory.
              <span className="block text-forest-dark/55">Plus a free pro shop around it.</span>
            </h2>
            <p className="mt-5 text-base md:text-lg text-forest-dark/70 leading-relaxed">
              Your quarterly fee buys $3,000 of retail-ready apparel and accessories, tuned to your members. The fixtures, signage, and POS that surround it are a free inclusion for founding partners.
            </p>
          </div>

          {/* Headline card: the inventory you are buying */}
          <div className="mt-14 rounded-2xl bg-forest-dark text-bone overflow-hidden border border-forest-dark/10">
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 p-8 md:p-12">
              <div className="lg:col-span-7">
                <span className="inline-flex items-center gap-2 text-[11px] tracking-[0.32em] uppercase text-ember font-medium">
                  <span className="w-6 h-px bg-ember/50" />
                  What you pay for
                </span>
                <h3 className="mt-5 font-serif text-3xl md:text-4xl leading-tight text-bone">
                  $3,000 of retail-ready inventory
                </h3>
                <p className="mt-4 text-base text-bone/70 leading-relaxed max-w-xl">
                  Curated apparel and accessories, picked by Mully to match your members. The inventory is yours, on your books, and you keep the full markup on every sale. Restock anytime from the portal.
                </p>
              </div>
              <div className="lg:col-span-5 flex items-center justify-center lg:justify-end">
                <div className="text-right">
                  <p className="font-serif text-6xl md:text-7xl text-bone leading-none">$3K</p>
                  <p className="mt-3 text-[11px] tracking-[0.32em] uppercase text-bone/55">
                    Of inventory you own
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* Free inclusions grid */}
          <div className="mt-16">
            <div className="flex items-end justify-between flex-wrap gap-4 mb-8">
              <div>
                <span className="inline-flex items-center gap-2 text-[11px] tracking-[0.32em] uppercase text-ember font-medium">
                  <span className="w-6 h-px bg-ember/50" />
                  What ships in your first kit
                </span>
                <h3 className="mt-4 font-serif text-2xl md:text-3xl text-forest-dark leading-tight">
                  Everything you need to open the shop, in one box.
                </h3>
              </div>
              <p className="text-xs md:text-sm text-forest-dark/55 italic max-w-xs">
                Quarters two through four ship fresh inventory only. The hardware stays with the club.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {FREE_INCLUSIONS.map((item) => (
                <div
                  key={item.title}
                  className="bg-white border border-forest-dark/8 rounded-2xl p-7 hover:border-forest-dark/20 transition-colors duration-300"
                >
                  <div className="flex items-center justify-between mb-4">
                    <div className="w-11 h-11 rounded-full bg-cream flex items-center justify-center text-forest">
                      <KitIcon name={item.icon} />
                    </div>
                    <span className="text-[10px] tracking-[0.28em] uppercase text-ember/80 font-medium">
                      {item.badge ?? "Included"}
                    </span>
                  </div>
                  <h4 className="font-serif text-lg text-forest-dark leading-tight mb-2">
                    {item.title}
                  </h4>
                  <p className="text-sm text-forest-dark/65 leading-relaxed">
                    {item.body}
                  </p>
                </div>
              ))}
            </div>
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
            $2,000 per quarter. Cancel anytime.
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
