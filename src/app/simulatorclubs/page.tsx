import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import BoutiqueCalculator from "./components/BoutiqueCalculator";
import FoundingPartnerForm from "./components/FoundingPartnerForm";

export const metadata: Metadata = {
  title: "Mully Boutique | For Simulator Clubs",
  description:
    "The pro shop your simulator club deserves. Without the buying, the inventory, or the risk. Mully installs and operates a curated retail boutique inside your sim club — selling through your existing POS.",
  openGraph: {
    title: "Mully Boutique | For Simulator Clubs",
    description:
      "A retail-as-a-service program for private indoor golf simulator clubs. Consigned inventory, embroidery, merchandising — operated by Mully, paid through your existing POS.",
    siteName: "Mully Reserve",
    type: "website",
    images: ["/simulatorclubs/atelier-installation.webp"],
  },
  alternates: { canonical: "/simulatorclubs" },
};

// ─────────────────────────────────────────────────────────────────────────────
// REUSABLE BLOCKS
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

const QUOTES = [
  {
    text: "Do you sell any of this stuff?",
    attribution: "A member at a Chicago sim club",
  },
  {
    text: "Can I get this hoodie with the club logo on it?",
    attribution: "A member at a Nashville sim club",
  },
  {
    text: "Where'd you get those headcovers? Those are sick.",
    attribution: "A member at a Denver sim club",
  },
];

const INSTALL_CARDS = [
  {
    title: "Curated Display Fixture",
    body:
      "A merchandised, brand-consistent display unit installed in your space — fit to your footprint and your aesthetic. Not a wire rack. A boutique fixture, designed to belong.",
    note: "We select the SKUs. We handle the visual merchandising. We refresh it quarterly.",
  },
  {
    title: "Consigned Inventory. Zero Capital.",
    body:
      "Every piece on your floor is Mully's until a member buys it. No purchase order. No minimum order quantity. No inventory on your books.",
    note: "You capture margin on sell-through. We absorb the risk if it doesn't move.",
  },
  {
    title: "On-Demand Embroidery",
    body:
      "The single most requested thing your members never get a clean answer on. Club logo digitized, approved colorways, turnaround defined.",
    note: "Members order at the point of sale. We handle fulfillment.",
  },
  {
    title: "Optional Self-Serve Kiosk",
    body:
      "At the Atelier tier, a slim self-serve kiosk lets members browse the catalog, choose embroidery, and complete a transaction without staff involvement.",
    note: "For clubs with high traffic and minimal front-desk bandwidth.",
  },
];

const FLOW_STEPS = [
  {
    label: "01",
    title: "Mully delivers and installs",
    body:
      "We ship the fixture, the inventory, and all branded materials. Installation takes two to three weeks. Your team's involvement: access and a thirty-minute walkthrough.",
  },
  {
    label: "02",
    title: "Members shop through your POS",
    body:
      "Every transaction runs through your existing point-of-sale system. No new software. No redirect. From your POS, it is a retail line item like anything else you sell.",
  },
  {
    label: "03",
    title: "Mully restocks quarterly",
    body:
      "We track sell-through remotely. Each quarter, we rotate underperformers, introduce new SKUs, and refresh the merchandising. You do not place orders or talk to reps.",
  },
  {
    label: "04",
    title: "You get paid on sell-through",
    body:
      "At the end of each settlement period, you receive your margin on everything that sold. The inventory that didn't sell goes back to us. No loss. No write-down.",
  },
];

const TIERS = [
  {
    key: "starter" as const,
    name: "Starter",
    price: "No monthly fee",
    priceNote: "Revenue share on sell-through.",
    bestFor: "Sim clubs exploring retail without commitment. Under 100 members.",
    branding: "Mully-branded. Your club name optional.",
    bullets: [
      "Curated Mully gift box at your front desk",
      "Optional email program for your members",
      "Co-branded landing page on request",
      "Quarterly SKU refresh on the gift box",
      "Mully-managed returns and restocking",
      "Access to embroidery ordering portal",
      "Founding partner pricing locked at sign-up",
    ],
    cta: "Start with the gift box",
    highlighted: false,
  },
  {
    key: "boutique" as const,
    name: "Boutique",
    price: "$995/month",
    priceNote: "Plus revenue share negotiated at signing.",
    bestFor: "Established sim clubs with 100–500 members. Retail as a real revenue line.",
    branding: "Co-branded — \"[Your Club] Pro Shop, curated by Mully.\"",
    bullets: [
      "Custom display fixture, installed and merchandised",
      "Full consigned inventory — no capital, no minimums",
      "On-demand embroidery with your logo on file",
      "Quarterly sell-through settlements",
      "Quarterly inventory refresh and merchandising",
      "Dedicated club contact at Mully",
      "Full returns management — handled by Mully",
      "Access to the full 40+ brand roster",
      "12-month term · 24-month founding partner rate lock",
    ],
    cta: "Apply for Boutique",
    highlighted: true,
  },
  {
    key: "atelier" as const,
    name: "Atelier",
    price: "$2,000/month",
    priceNote: "Plus one-time setup fee, scoped at signing.",
    bestFor: "Flagship sim clubs with 300+ members. Brand-led operators.",
    branding: "White-label optional. Full operating silence available.",
    bullets: [
      "Everything in Boutique, plus:",
      "Expanded footprint — custom fixture scoped to your space",
      "Dedicated Mully merchandiser",
      "Self-serve POS kiosk option",
      "Custom embroidery library — up to 3 colorways",
      "Annual capsule drop — exclusive to your club",
      "Private-label capsule program available",
      "Priority access to new brand additions",
      "Co-branded signage and packaging",
      "Quarterly business review with partnership team",
      "White-label option: Mully never appears member-facing",
    ],
    cta: "Inquire about Atelier",
    highlighted: false,
  },
];

const BRANDS = [
  "Rhone",
  "Greyson",
  "Quiet Golf",
  "Penfold",
  "Cuater",
  "Field Day",
  "Will Leather",
  "Devereux",
  "Bogey Boys",
  "Holderness & Bourne",
  "Linksoul",
  "Manors",
  "Eastside Golf",
  "Malbon",
  "Birds of Condor",
  "Random Golf Club",
  "Roger Federer Collection",
  "Travis Mathew",
  "Peter Millar",
  "G/FORE",
  "TRENDYGOLF",
  "Sligo Wear",
  "Criquet",
  "Stitch Golf",
];

const FAQ = [
  {
    q: "Does this require integration with our POS system?",
    a: "No. Mully Boutique sells through your existing POS as a standard retail SKU. There is no software integration, no API connection, and no new system for staff to learn. We set up the product catalog within your current system during installation. If your system can ring a retail item, it can run the boutique.",
  },
  {
    q: "Who owns the inventory on the floor?",
    a: "Mully does — until a member buys it. Every piece in the display is on consignment. It does not appear on your balance sheet or affect your working capital. When a member purchases, ownership transfers at the point of sale and the margin flows to you through our settlement process.",
  },
  {
    q: "What if items don't sell?",
    a: "We rotate them out. At each quarterly refresh, underperforming SKUs go back to Mully and are replaced with new selections. You absorb no loss, no markdown, and no awkward overstock situation. If something isn't moving, that is our problem to solve, not yours.",
  },
  {
    q: "Can we use our own branding instead of Mully's?",
    a: "Yes — at the Atelier tier. The full white-label option lets you operate the boutique entirely under your club's name. Mully provides the infrastructure, the inventory, and the operations; your club is the brand your members see. At the Boutique tier, the model is co-branded. At Starter, Mully branding is primary.",
  },
  {
    q: "How long does installation take?",
    a: "Two to three weeks from contract signing. That includes fixture sourcing, inventory selection and shipment, club logo digitization for the embroidery program, POS catalog setup, and a walkthrough with your team. Atelier installations with custom fixture builds may extend to four to six weeks.",
  },
  {
    q: "What is the contract length?",
    a: "Boutique and Atelier require a 12-month minimum term. After the initial term, the agreement converts to month-to-month at current pricing unless renewed. Founding partners receive 24-month rate locks. The Starter tier has no contract minimum.",
  },
  {
    q: "Do you handle member returns?",
    a: "Yes, fully. Your staff processes returns through the POS the same way any return would work — and Mully handles the back-end. The item comes back to us, the member's account is settled, and nothing sits in your back office waiting for resolution.",
  },
  {
    q: "Can we do private-label capsule drops under our own club name?",
    a: "Yes — at the Atelier tier. The private-label capsule program allows your club to offer a limited collection under your own brand: your logo, your colorways, your creative direction, Mully's sourcing and production. Typically seasonal drops — a spring kit, a holiday gift set — exclusive to your members.",
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// PAGE
// ─────────────────────────────────────────────────────────────────────────────

export default function SimulatorClubsPage() {
  return (
    <div className="min-h-screen bg-bone">
      {/* ─── HEADER ─── */}
      <header className="fixed top-0 left-0 right-0 z-50 bg-bone/90 backdrop-blur-md border-b border-taupe/15">
        <div className="max-w-7xl mx-auto px-5 md:px-12 flex items-center justify-between h-14">
          <Link href="/" className="flex items-center gap-2 text-forest">
            <svg viewBox="0 0 1002 540" fill="currentColor" className="h-4 w-auto" aria-hidden="true">
              <path d="M0,0 H1002 V540 H0 Z M50,1 L998,269 L50,538 Z" fillRule="evenodd" />
            </svg>
            <span className="font-serif text-xl font-bold tracking-wide">mully.</span>
          </Link>
          <a
            href="#apply"
            className="text-[11px] tracking-[0.28em] uppercase text-forest font-medium hover:text-forest-dark transition-colors duration-300"
          >
            Apply
          </a>
        </div>
      </header>

      {/* ─── HERO ─── */}
      <section
        className="relative min-h-[88vh] md:min-h-screen flex flex-col justify-center px-6 md:px-12 lg:px-20 pt-24 pb-12 md:pt-28 md:pb-16"
        style={{ backgroundColor: "#F5F3EF" }}
      >
        <div className="relative max-w-7xl mx-auto w-full grid md:grid-cols-[45%_55%] gap-8 md:gap-12 lg:gap-20 items-center z-10">
          {/* LEFT — copy */}
          <div className="max-w-xl text-center md:text-left mx-auto md:mx-0">
            <div className="mb-6 md:mb-8">
              <EyebrowLeft>Mully Boutique · For Simulator Clubs</EyebrowLeft>
            </div>

            <h1 className="font-serif text-3xl sm:text-5xl md:text-[3.25rem] lg:text-6xl text-forest leading-[1.05] tracking-tight mb-5 md:mb-7">
              The pro shop your simulator club deserves.
              <span className="block text-forest/70 mt-3">
                Without the buying, the inventory, or the risk.
              </span>
            </h1>

            <p className="text-sm md:text-lg text-charcoal leading-relaxed mb-6 md:mb-7 max-w-md mx-auto md:mx-0">
              Mully installs and operates a curated retail boutique inside your sim club —
              consigned inventory, on-demand embroidery, zero capital — selling directly
              through your existing POS.
            </p>

            <div className="flex flex-col sm:flex-row gap-3 sm:items-center mb-6">
              <a
                href="#apply"
                className="inline-flex items-center justify-center h-12 px-7 rounded-xl bg-forest text-bone text-sm font-medium tracking-wider uppercase hover:bg-forest-dark transition-colors duration-300"
              >
                Apply for a Founding Partnership
              </a>
              <a
                href="#how-it-works"
                className="inline-flex items-center justify-center h-12 px-5 text-sm tracking-wider uppercase text-forest hover:text-forest-dark transition-colors duration-300"
              >
                See how it works →
              </a>
            </div>

            <p className="text-[11px] text-charcoal/50 tracking-wide">
              Currently onboarding founding simulator club partners for 2026.
              Ten spots. Locked pricing.
            </p>
          </div>

          {/* RIGHT — hero image */}
          <div className="flex items-center justify-center">
            <div className="relative w-full max-w-2xl aspect-[16/9] rounded-2xl overflow-hidden bg-[#162b1e] border border-[#F5F1E8]/10 shadow-2xl">
              <Image
                src="/simulatorclubs/boutique-fixture.webp"
                alt="A curated Mully Boutique display fixture installed inside a private simulator club — folded premium golf apparel on warm oak shelving with brushed brass details, a forest-green quarterly box on a low plinth, sim bays softly visible in the background."
                fill
                priority
                sizes="(min-width: 1024px) 36rem, (min-width: 768px) 32rem, 100vw"
                className="object-cover"
              />
            </div>
          </div>
        </div>
      </section>

      {/* ─── SECTION 2: THE CATEGORY GAP ─── */}
      <section className="py-20 md:py-28 px-6 md:px-12">
        <div className="max-w-5xl mx-auto text-center">
          <div className="mb-6">
            <Eyebrow>The Retail Gap</Eyebrow>
          </div>
          <h2 className="font-serif text-3xl md:text-5xl text-forest leading-[1.1] tracking-tight mb-10 md:mb-12">
            Country clubs have pro shops.
            <span className="block text-forest/65">
              Simulator clubs have a rack of logo hats.
            </span>
          </h2>
          <div className="space-y-6 text-base md:text-lg text-charcoal/75 leading-relaxed max-w-3xl mx-auto text-left">
            <p>
              Indoor golf didn&apos;t grow slowly. In three years, the private simulator
              club model went from a novelty to a legitimate membership category — with
              dues structures, F&amp;B programs, wait lists, and members who treat the
              sim bay like a second office.
            </p>
            <p>The membership model caught up. The retail experience didn&apos;t.</p>
            <p>
              Country clubs have spent decades building pro shop infrastructure — brand
              relationships, buying calendars, merchandising staff, consignment programs.
              Their members walk in knowing where to spend. The pro shop is a revenue
              center and a retention tool.
            </p>
            <p>
              Most simulator clubs inherited none of that. Their members are golfers
              with taste and money, wearing Greyson and Rhone and Quiet Golf to every
              session — gear they bought somewhere else, from someone else, with zero
              margin coming back to the club.
            </p>
            <p className="text-forest font-medium">Mully Boutique exists to close that gap.</p>
          </div>
        </div>
      </section>

      {/* ─── SECTION 3: QUOTES (dark) ─── */}
      <section className="py-20 md:py-28 px-6 md:px-12 bg-forest-dark text-bone">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-12 md:mb-16">
            <span className="inline-flex items-center gap-2.5 text-[11px] tracking-[0.32em] uppercase text-ember font-medium">
              <span className="w-8 h-px bg-ember/40" />
              <span>What Your Members Are Already Saying</span>
              <span className="w-8 h-px bg-ember/40" />
            </span>
          </div>
          <div className="grid md:grid-cols-3 gap-6 md:gap-8 mb-12">
            {QUOTES.map((q) => (
              <figure key={q.attribution} className="rounded-2xl border border-bone/12 p-7 md:p-8">
                <blockquote className="font-serif italic text-xl md:text-2xl text-bone leading-snug mb-6">
                  &ldquo;{q.text}&rdquo;
                </blockquote>
                <figcaption className="text-[11px] tracking-[0.22em] uppercase text-bone/45">
                  — {q.attribution}
                </figcaption>
              </figure>
            ))}
          </div>
          <p className="text-center font-serif text-2xl md:text-3xl text-bone/85 max-w-3xl mx-auto leading-snug">
            Your members are already shopping. They&apos;re just not shopping here.
          </p>
        </div>
      </section>

      {/* ─── SECTION 4: WHAT WE INSTALL ─── */}
      <section className="py-20 md:py-28 px-6 md:px-12">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-12 md:mb-16">
            <div className="mb-5">
              <Eyebrow>The Boutique</Eyebrow>
            </div>
            <h2 className="font-serif text-3xl md:text-5xl text-forest leading-[1.1] tracking-tight">
              Everything that makes a pro shop work.
              <span className="block text-forest/65">None of what makes it complicated.</span>
            </h2>
            <p className="text-base text-charcoal/60 mt-6 max-w-2xl mx-auto leading-relaxed">
              Four core components — modular, scalable, sized to the space you have.
            </p>
          </div>

          {/* Atelier image as the visual anchor for this section */}
          <div className="relative w-full aspect-[16/9] rounded-2xl overflow-hidden bg-[#162b1e] mb-12 md:mb-16 shadow-xl">
            <Image
              src="/simulatorclubs/atelier-installation.webp"
              alt="A full Atelier-tier Mully Boutique installation inside a private simulator club — a built-in oak display wall with brushed brass shelving, curated folded golf apparel in earth tones, a forest-green subscription box on a center plinth, a slim self-serve kiosk, and sim bays softly visible at both edges."
              fill
              sizes="(min-width: 1024px) 64rem, 100vw"
              className="object-cover"
            />
          </div>

          <div className="grid md:grid-cols-2 gap-5">
            {INSTALL_CARDS.map((c) => (
              <article key={c.title} className="rounded-2xl border border-taupe/15 bg-cream p-7 md:p-8">
                <h3 className="font-serif text-2xl text-obsidian mb-3">{c.title}</h3>
                <p className="text-sm md:text-base text-charcoal/70 leading-relaxed mb-3">
                  {c.body}
                </p>
                <p className="text-sm text-charcoal/50 leading-relaxed italic">{c.note}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* ─── SECTION 5: HOW INVISIBLE ─── */}
      <section id="how-it-works" className="py-20 md:py-28 px-6 md:px-12 bg-cream">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-12 md:mb-16">
            <div className="mb-5">
              <Eyebrow>Operations</Eyebrow>
            </div>
            <h2 className="font-serif text-3xl md:text-5xl text-forest leading-[1.1] tracking-tight mb-6">
              We run the boutique. You run the club.
            </h2>
            <p className="text-base md:text-lg text-charcoal/65 max-w-2xl mx-auto leading-relaxed">
              The model is designed around a single constraint: simulator club operators
              did not come from golf retail and should not have to act like they did.
            </p>
          </div>

          <div className="grid md:grid-cols-4 gap-5 mb-12">
            {FLOW_STEPS.map((step) => (
              <article key={step.label} className="rounded-2xl border border-taupe/15 bg-bone p-6">
                <p className="font-serif text-3xl text-ember mb-4 tabular-nums">{step.label}</p>
                <h3 className="font-serif text-lg text-obsidian mb-3 leading-snug">{step.title}</h3>
                <p className="text-sm text-charcoal/60 leading-relaxed">{step.body}</p>
              </article>
            ))}
          </div>

          {/* Three "zero" callouts */}
          <div className="rounded-2xl border border-forest/15 bg-forest text-bone p-8 md:p-10">
            <div className="grid md:grid-cols-3 gap-6 text-center">
              {[
                { label: "Zero", note: "capital deployed" },
                { label: "Zero", note: "inventory on your books" },
                { label: "Zero", note: "brand compromise — unless you want ours" },
              ].map((item, i) => (
                <div key={i}>
                  <p className="font-serif text-4xl md:text-5xl text-ember tabular-nums">{item.label}</p>
                  <p className="text-sm text-bone/70 mt-2 tracking-wide">{item.note}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ─── SECTION 6: ECONOMICS + CALCULATOR ─── */}
      <section className="py-20 md:py-28 px-6 md:px-12">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-10 md:mb-14">
            <div className="mb-5">
              <Eyebrow>The Numbers</Eyebrow>
            </div>
            <h2 className="font-serif text-3xl md:text-5xl text-forest leading-[1.1] tracking-tight mb-6">
              Retail is the only obvious lever left
              <span className="block text-forest/65">once your bays are full.</span>
            </h2>
            <div className="max-w-3xl mx-auto space-y-5 text-base md:text-lg text-charcoal/70 leading-relaxed text-left mt-8">
              <p>
                Bay capacity is a ceiling. Once you&apos;re at utilization, the only
                growth levers are dues, F&amp;B, and retail. Dues are politically
                sensitive. F&amp;B is operationally demanding. Retail, with the right
                model, is passive margin.
              </p>
              <p>
                Your members spend roughly $1,200 per year on golf apparel. Almost none
                of that spend happens at the club, because until now the club had
                nothing worth buying.
              </p>
              <p className="text-charcoal/80">
                Put your numbers in. The figure tends to surprise operators.
              </p>
            </div>
          </div>

          <BoutiqueCalculator />
        </div>
      </section>

      {/* ─── SECTION 7: TIERS ─── */}
      <section className="py-20 md:py-28 px-6 md:px-12 bg-cream">
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-12 md:mb-16">
            <div className="mb-5">
              <Eyebrow>Partnership Tiers</Eyebrow>
            </div>
            <h2 className="font-serif text-3xl md:text-5xl text-forest leading-[1.1] tracking-tight mb-5">
              Three ways in. One operating model.
            </h2>
            <p className="text-base md:text-lg text-charcoal/60 max-w-2xl mx-auto leading-relaxed">
              Every tier runs on the same consigned inventory model. The difference
              is scale, branding, and what Mully brings to your floor.
            </p>
          </div>

          <div className="grid lg:grid-cols-3 gap-5 lg:gap-6 items-stretch">
            {TIERS.map((t) => (
              <article
                key={t.key}
                className={`relative rounded-2xl p-7 md:p-8 flex flex-col ${
                  t.highlighted
                    ? "bg-forest text-bone border-2 border-ember/40 shadow-xl lg:scale-[1.02]"
                    : "bg-bone border border-taupe/15"
                }`}
              >
                {t.highlighted && (
                  <span className="absolute -top-3 left-1/2 -translate-x-1/2 inline-flex items-center gap-2 text-[10px] tracking-[0.28em] uppercase bg-ember text-forest-dark font-semibold px-3 py-1 rounded-full">
                    Recommended
                  </span>
                )}

                <div className="mb-5">
                  <p className={`text-[11px] tracking-[0.28em] uppercase font-medium mb-3 ${t.highlighted ? "text-ember" : "text-sage"}`}>
                    Tier
                  </p>
                  <h3 className={`font-serif text-3xl mb-3 ${t.highlighted ? "text-bone" : "text-obsidian"}`}>
                    {t.name}
                  </h3>
                  <p className={`font-serif text-2xl mb-1 tabular-nums ${t.highlighted ? "text-ember" : "text-forest"}`}>
                    {t.price}
                  </p>
                  <p className={`text-xs leading-relaxed ${t.highlighted ? "text-bone/55" : "text-charcoal/50"}`}>
                    {t.priceNote}
                  </p>
                </div>

                <div className="space-y-3 mb-6 text-sm leading-relaxed">
                  <div>
                    <p className={`text-[10px] tracking-[0.24em] uppercase mb-1 ${t.highlighted ? "text-bone/45" : "text-charcoal/40"}`}>
                      Best For
                    </p>
                    <p className={t.highlighted ? "text-bone/85" : "text-charcoal/70"}>{t.bestFor}</p>
                  </div>
                  <div>
                    <p className={`text-[10px] tracking-[0.24em] uppercase mb-1 ${t.highlighted ? "text-bone/45" : "text-charcoal/40"}`}>
                      Branding
                    </p>
                    <p className={t.highlighted ? "text-bone/85" : "text-charcoal/70"}>{t.branding}</p>
                  </div>
                </div>

                <ul className="space-y-2.5 mb-6 flex-1">
                  {t.bullets.map((b) => (
                    <li
                      key={b}
                      className={`flex gap-2.5 text-sm leading-relaxed ${t.highlighted ? "text-bone/85" : "text-charcoal/70"}`}
                    >
                      <span className={`shrink-0 mt-[7px] w-1 h-1 rounded-full ${t.highlighted ? "bg-ember" : "bg-sage"}`} />
                      <span>{b}</span>
                    </li>
                  ))}
                </ul>

                <a
                  href="#apply"
                  className={`inline-flex items-center justify-center h-11 px-6 rounded-xl text-sm font-medium tracking-wider uppercase transition-colors duration-300 ${
                    t.highlighted
                      ? "bg-ember text-forest-dark hover:bg-ember/90"
                      : "border border-forest/30 text-forest hover:bg-forest hover:text-bone"
                  }`}
                >
                  {t.cta}
                </a>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* ─── SECTION 8: BRAND WALL ─── */}
      <section className="py-20 md:py-28 px-6 md:px-12">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-10 md:mb-14">
            <div className="mb-5">
              <Eyebrow>The Brands</Eyebrow>
            </div>
            <h2 className="font-serif text-3xl md:text-5xl text-forest leading-[1.1] tracking-tight mb-6">
              Forty brands worth wearing.
              <span className="block text-forest/65">Assembled by editors who play the game.</span>
            </h2>
            <div className="space-y-5 text-base md:text-lg text-charcoal/70 leading-relaxed max-w-3xl mx-auto text-left">
              <p>
                The hardest part of running a pro shop isn&apos;t the fixture. It&apos;s
                the buying.
              </p>
              <p>
                Mully has spent four years building those relationships. The brands on
                our roster work with us because of volume, editorial curation, and a
                membership base that buys repeatedly. That access doesn&apos;t transfer
                to a club ordering twelve pieces a quarter through a rep who&apos;s
                never heard of you.
              </p>
              <p>
                When you open a Mully Boutique, you inherit the roster. No club rep
                replicates this. No wholesale platform gets you here.
              </p>
            </div>
          </div>

          <div className="rounded-2xl border border-taupe/15 bg-cream p-8 md:p-12">
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-x-6 gap-y-5 text-center">
              {BRANDS.map((brand) => (
                <span
                  key={brand}
                  className="font-serif text-sm md:text-base text-charcoal/65 tracking-wide"
                >
                  {brand}
                </span>
              ))}
            </div>
            <p className="text-xs text-charcoal/40 mt-8 text-center italic">
              A selection of current brands. Roster updated quarterly.
            </p>
          </div>
        </div>
      </section>

      {/* ─── SECTION 9: WHY NOW (with member-experience image) ─── */}
      <section className="py-20 md:py-28 px-6 md:px-12 bg-forest-dark text-bone">
        <div className="max-w-6xl mx-auto grid md:grid-cols-2 gap-10 md:gap-14 items-center">
          <div>
            <div className="mb-5">
              <span className="inline-flex items-center gap-2.5 text-[11px] tracking-[0.32em] uppercase text-ember font-medium">
                <span>The Moment</span>
                <span className="w-10 h-px bg-ember/40" />
              </span>
            </div>
            <h2 className="font-serif text-3xl md:text-5xl text-bone leading-[1.1] tracking-tight mb-7">
              Indoor golf grew. Member expectations followed.
              <span className="block text-bone/55">Retail didn&apos;t.</span>
            </h2>
            <div className="space-y-5 text-base text-bone/75 leading-relaxed">
              <p>
                Indoor golf simulator clubs grew 70% over the past three years. The
                membership model, once experimental, is now the dominant format for the
                category. Private sim clubs operate with multi-year wait lists and ARPU
                that competes with boutique fitness.
              </p>
              <p>
                <span className="text-bone font-medium">Member expectations shifted.</span>{" "}
                The golfer joining a private sim club today has been to Five Iron. They
                know what a well-run golf space looks like. They expect the experience
                to be complete.
              </p>
              <p>
                <span className="text-bone font-medium">Retention is the battleground.</span>{" "}
                Bay utilization is high. Competition is increasing. Retail, done correctly,
                is an experience layer — another reason to come in, another thing members
                associate with your brand.
              </p>
              <p>
                <span className="text-bone font-medium">Apparel is the most under-monetized lever in the category.</span>{" "}
                Food, beverage, events, referrals — they&apos;re all running. The window
                to own retail is right now, before it becomes table stakes.
              </p>
            </div>
          </div>
          <div className="relative w-full aspect-[4/5] rounded-2xl overflow-hidden bg-[#0F1F16] border border-bone/10 shadow-2xl">
            <Image
              src="/simulatorclubs/member-experience.webp"
              alt="A member at a private simulator club examining a folded forest-green sweater at a Mully Boutique display fixture — three-quarter back view, warm pendant lighting, leather lounge chair softly visible, sim bay screen glowing green in the background."
              fill
              sizes="(min-width: 768px) 32rem, 100vw"
              className="object-cover"
            />
          </div>
        </div>
      </section>

      {/* ─── SECTION 10: PILOT OFFER + FORM ─── */}
      <section id="apply" className="py-20 md:py-28 px-6 md:px-12 bg-forest text-bone">
        <div className="max-w-4xl mx-auto">
          <div className="text-center mb-10 md:mb-14">
            <div className="mb-5">
              <span className="inline-flex items-center gap-2.5 text-[11px] tracking-[0.32em] uppercase text-ember font-medium">
                <span className="w-8 h-px bg-ember/40" />
                <span>Founding Partnerships · 2026</span>
                <span className="w-8 h-px bg-ember/40" />
              </span>
            </div>
            <h2 className="font-serif text-3xl md:text-5xl text-bone leading-[1.08] tracking-tight mb-6">
              Ten simulator clubs. Locked pricing.
              <span className="block text-bone/65">A boutique built alongside you.</span>
            </h2>
            <p className="text-base md:text-lg text-bone/70 leading-relaxed max-w-2xl mx-auto">
              We are onboarding ten founding simulator club partners for 2026. Locked
              pricing for 24 months, priority access to new brand additions, and the
              opportunity to shape the Mully Boutique product as we build it.
            </p>
          </div>

          <div className="rounded-2xl border border-bone/12 bg-forest-dark p-7 md:p-10">
            <FoundingPartnerForm />
          </div>
        </div>
      </section>

      {/* ─── SECTION 11: FAQ ─── */}
      <section className="py-20 md:py-28 px-6 md:px-12">
        <div className="max-w-3xl mx-auto">
          <div className="text-center mb-12 md:mb-14">
            <div className="mb-5">
              <Eyebrow>Frequently Asked</Eyebrow>
            </div>
            <h2 className="font-serif text-3xl md:text-5xl text-forest leading-[1.1] tracking-tight">
              The questions operators ask
              <span className="block text-forest/65">before they sign.</span>
            </h2>
          </div>

          <div className="divide-y divide-taupe/15 border-y border-taupe/15">
            {FAQ.map((item, i) => (
              <details
                key={i}
                className="group py-6"
                {...(i === 0 ? { open: true } : {})}
              >
                <summary className="flex items-center justify-between cursor-pointer list-none">
                  <h3 className="font-serif text-lg md:text-xl text-obsidian pr-6 leading-snug">
                    {item.q}
                  </h3>
                  <span className="shrink-0 w-7 h-7 rounded-full border border-sage/30 flex items-center justify-center text-sage transition-transform duration-300 group-open:rotate-45">
                    <svg width="11" height="11" viewBox="0 0 11 11" fill="none" aria-hidden="true">
                      <path d="M5.5 1V10M1 5.5H10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                    </svg>
                  </span>
                </summary>
                <p className="text-sm md:text-base text-charcoal/65 leading-relaxed mt-4 pr-10">
                  {item.a}
                </p>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* ─── SECTION 12: FOOTER CTA ─── */}
      <section className="py-20 md:py-24 px-6 md:px-12 bg-forest-dark text-bone text-center">
        <div className="max-w-4xl mx-auto">
          <h2 className="font-serif text-3xl md:text-5xl text-bone leading-[1.08] tracking-tight mb-8">
            Mully is the boutique your members already wear.
            <span className="block text-bone/55">Now in your clubhouse.</span>
          </h2>
          <a
            href="#apply"
            className="inline-flex items-center justify-center h-12 px-9 rounded-xl bg-ember text-forest-dark text-sm font-semibold tracking-wider uppercase hover:bg-ember/90 transition-colors duration-300"
          >
            Apply for a Founding Partnership
          </a>
          <p className="text-[11px] text-bone/40 mt-5 tracking-wide">
            Ten founding partners. 2026 cohort. Applications reviewed weekly.
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
              Mully Boutique — a B2B service from Mully Reserve.
            </span>
          </div>
          <p className="text-xs text-bone/35">
            &copy; {new Date().getFullYear()} Mully Group, Inc. ·{" "}
            <a href="mailto:boutique@mymully.com" className="hover:text-ember transition-colors">
              boutique@mymully.com
            </a>
          </p>
        </div>
      </footer>
    </div>
  );
}
