import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import BoutiqueCalculator from "./components/BoutiqueCalculator";
import FoundingPartnerForm from "./components/FoundingPartnerForm";

export const metadata: Metadata = {
  title: "Mully Boutique | For Simulator Clubs",
  description:
    "The pro shop your simulator club deserves. Mully installs and operates a curated retail boutique inside your sim club — selling through your existing POS.",
  openGraph: {
    title: "Mully Boutique | For Simulator Clubs",
    description:
      "A retail-as-a-service program for private indoor golf simulator clubs. Consigned inventory, embroidery, merchandising — operated by Mully.",
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

const INSTALL_CARDS = [
  {
    title: "Curated Display Fixture",
    body: "A merchandised, brand-consistent display, sized to your space. Not a wire rack.",
  },
  {
    title: "Consigned Inventory. Zero Capital.",
    body: "Every piece is Mully's until a member buys it. No PO. No MOQ. No inventory on your books.",
  },
  {
    title: "On-Demand Embroidery",
    body: "Club logo digitized, approved colorways, turnaround defined. Members order at POS.",
  },
  {
    title: "Optional Self-Serve Kiosk",
    body: "Atelier tier. Members browse, embroider, check out — without staff.",
  },
];

const FLOW_STEPS = [
  { label: "01", title: "Mully delivers and installs", body: "Fixture, inventory, branded materials. Two to three weeks. Your involvement: access and a 30-minute walkthrough." },
  { label: "02", title: "Members shop through your POS", body: "A retail line item like anything else you sell. No new software." },
  { label: "03", title: "Mully restocks quarterly", body: "We rotate underperformers and refresh merchandising. You never call a rep." },
  { label: "04", title: "You get paid on sell-through", body: "Margin settled each period. Unsold goes back. No write-down." },
];

const TIERS = [
  {
    key: "starter" as const,
    name: "Starter",
    price: "No monthly fee",
    priceNote: "Revenue share on sell-through.",
    bestFor: "Sim clubs under 100 members. Retail without commitment.",
    branding: "Mully-branded. Your club name optional.",
    bullets: [
      "Curated Mully gift box at your front desk",
      "Optional email program for your members",
      "Co-branded landing page on request",
      "Quarterly SKU refresh on the gift box",
      "Mully-managed returns and restocking",
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
    bestFor: "Established sim clubs with 100–500 members.",
    branding: "Co-branded — \"[Your Club] Pro Shop, curated by Mully.\"",
    bullets: [
      "Custom display fixture, installed and merchandised",
      "Full consigned inventory — no capital, no minimums",
      "On-demand embroidery with your logo on file",
      "Quarterly sell-through settlements",
      "Quarterly inventory refresh",
      "Dedicated club contact at Mully",
      "Access to the full 40+ brand roster",
      "12-month term · 24-month founding rate lock",
    ],
    cta: "Apply for Boutique",
    highlighted: true,
  },
  {
    key: "atelier" as const,
    name: "Atelier",
    price: "$2,000/month",
    priceNote: "Plus one-time setup, scoped at signing.",
    bestFor: "Flagship sim clubs with 300+ members.",
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
      "White-label option: Mully never appears member-facing",
    ],
    cta: "Inquire about Atelier",
    highlighted: false,
  },
];

const BRANDS = [
  "Rhone", "Greyson", "Quiet Golf", "Penfold", "Cuater", "Field Day",
  "Will Leather", "Devereux", "Bogey Boys", "Holderness & Bourne", "Linksoul",
  "Manors", "Eastside Golf", "Malbon", "Birds of Condor", "Random Golf Club",
  "Roger Federer Collection", "Travis Mathew", "Peter Millar", "G/FORE",
  "TRENDYGOLF", "Sligo Wear", "Criquet", "Stitch Golf",
];

const FAQ = [
  {
    q: "Does this require integration with our POS?",
    a: "No. Mully Boutique sells through your existing POS as a standard retail SKU. We set up the catalog during installation. If your system can ring a retail item, it can run the boutique.",
  },
  {
    q: "Who owns the inventory on the floor?",
    a: "Mully — until a member buys it. Everything is on consignment. It does not appear on your balance sheet or affect your working capital.",
  },
  {
    q: "What if items don't sell?",
    a: "We rotate them out at the quarterly refresh. You absorb no loss, no markdown, no awkward overstock. If something isn't moving, that is our problem.",
  },
  {
    q: "Can we use our own branding instead of Mully's?",
    a: "Yes — at the Atelier tier. Full white-label lets you operate the boutique entirely under your club's name. Boutique tier is co-branded. Starter is Mully-primary.",
  },
  {
    q: "How long does installation take?",
    a: "Two to three weeks from contract. Atelier installations with custom fixtures may run four to six weeks.",
  },
  {
    q: "What is the contract length?",
    a: "Boutique and Atelier require a 12-month minimum. Founding partners receive 24-month rate locks. Starter has no contract minimum.",
  },
  {
    q: "Do you handle member returns?",
    a: "Yes, fully. Your staff processes returns through the POS. Mully handles the back-end — nothing sits in your office waiting for resolution.",
  },
  {
    q: "Can we do private-label capsule drops?",
    a: "Yes — at the Atelier tier. Your logo, your colorways, your direction. Mully's sourcing and production. Seasonal drops exclusive to your members.",
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
              A curated retail boutique inside your sim club. Consigned inventory.
              On-demand embroidery. Sold through your existing POS.
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
              Ten founding spots. 2026 cohort. Locked pricing.
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

      {/* ─── SECTION 2: THE BOUTIQUE ─── */}
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
          </div>

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
                <p className="text-sm md:text-base text-charcoal/70 leading-relaxed">
                  {c.body}
                </p>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* ─── SECTION 3: HOW IT WORKS ─── */}
      <section id="how-it-works" className="py-20 md:py-28 px-6 md:px-12 bg-cream">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-12 md:mb-16">
            <div className="mb-5">
              <Eyebrow>Operations</Eyebrow>
            </div>
            <h2 className="font-serif text-3xl md:text-5xl text-forest leading-[1.1] tracking-tight">
              We run the boutique. You run the club.
            </h2>
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

      {/* ─── SECTION 4: CALCULATOR ─── */}
      <section className="py-20 md:py-28 px-6 md:px-12">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-10 md:mb-14">
            <div className="mb-5">
              <Eyebrow>The Numbers</Eyebrow>
            </div>
            <h2 className="font-serif text-3xl md:text-5xl text-forest leading-[1.1] tracking-tight mb-5">
              Put your numbers in.
              <span className="block text-forest/65">The figure tends to surprise operators.</span>
            </h2>
            <p className="text-base md:text-lg text-charcoal/65 max-w-2xl mx-auto leading-relaxed">
              Members spend roughly $1,200 a year on golf apparel. Almost none of it
              happens at the club — because until now, the club had nothing worth buying.
            </p>
          </div>

          <BoutiqueCalculator />
        </div>
      </section>

      {/* ─── SECTION 5: TIERS ─── */}
      <section className="py-20 md:py-28 px-6 md:px-12 bg-cream">
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-12 md:mb-16">
            <div className="mb-5">
              <Eyebrow>Partnership Tiers</Eyebrow>
            </div>
            <h2 className="font-serif text-3xl md:text-5xl text-forest leading-[1.1] tracking-tight">
              Three ways in. One operating model.
            </h2>
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

      {/* ─── SECTION 6: BRAND WALL ─── */}
      <section className="py-20 md:py-28 px-6 md:px-12">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-10 md:mb-14">
            <div className="mb-5">
              <Eyebrow>The Brands</Eyebrow>
            </div>
            <h2 className="font-serif text-3xl md:text-5xl text-forest leading-[1.1] tracking-tight mb-5">
              Forty brands worth wearing.
              <span className="block text-forest/65">Assembled by editors who play the game.</span>
            </h2>
            <p className="text-base md:text-lg text-charcoal/65 max-w-2xl mx-auto leading-relaxed">
              The hardest part of running a pro shop isn&apos;t the fixture. It&apos;s the buying.
              Open a Mully Boutique and you inherit the roster.
            </p>
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

      {/* ─── SECTION 7: WHY NOW (with member-experience image) ─── */}
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
              Indoor golf grew.
              <span className="block text-bone/55">Retail didn&apos;t.</span>
            </h2>
            <div className="space-y-5 text-base text-bone/75 leading-relaxed">
              <p>
                Sim clubs grew 70% in three years. ARPU competes with boutique fitness.
                Member expectations followed.
              </p>
              <p>
                Bay utilization has a ceiling. Dues are political. F&amp;B is operational.
                Retail, with the right model, is passive margin.
              </p>
              <p className="text-bone font-medium">
                Apparel is the most under-monetized lever in the category.
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

      {/* ─── SECTION 8: PILOT OFFER + FORM ─── */}
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
            <h2 className="font-serif text-3xl md:text-5xl text-bone leading-[1.08] tracking-tight mb-5">
              Ten simulator clubs. Locked pricing.
              <span className="block text-bone/65">A boutique built alongside you.</span>
            </h2>
            <p className="text-base md:text-lg text-bone/70 leading-relaxed max-w-2xl mx-auto">
              Ten founding partners for 2026. 24-month price lock. Priority on new brands.
              A say in how the product gets built.
            </p>
          </div>

          <div className="rounded-2xl border border-bone/12 bg-forest-dark p-7 md:p-10">
            <FoundingPartnerForm />
          </div>
        </div>
      </section>

      {/* ─── SECTION 9: FAQ ─── */}
      <section className="py-20 md:py-28 px-6 md:px-12">
        <div className="max-w-3xl mx-auto">
          <div className="text-center mb-12 md:mb-14">
            <div className="mb-5">
              <Eyebrow>Frequently Asked</Eyebrow>
            </div>
            <h2 className="font-serif text-3xl md:text-5xl text-forest leading-[1.1] tracking-tight">
              Questions operators ask
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

      {/* ─── SECTION 10: FOOTER CTA ─── */}
      <section className="py-20 md:py-24 px-6 md:px-12 bg-forest-dark text-bone text-center">
        <div className="max-w-4xl mx-auto">
          <h2 className="font-serif text-3xl md:text-5xl text-bone leading-[1.08] tracking-tight mb-8">
            The boutique your members already wear.
            <span className="block text-bone/55">Now in your clubhouse.</span>
          </h2>
          <a
            href="#apply"
            className="inline-flex items-center justify-center h-12 px-9 rounded-xl bg-ember text-forest-dark text-sm font-semibold tracking-wider uppercase hover:bg-ember/90 transition-colors duration-300"
          >
            Apply for a Founding Partnership
          </a>
          <p className="text-[11px] text-bone/40 mt-5 tracking-wide">
            Ten founding partners. 2026 cohort.
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
            &copy; 2026 Mully Group, Inc. ·{" "}
            <a href="mailto:boutique@mymully.com" className="hover:text-ember transition-colors">
              boutique@mymully.com
            </a>
          </p>
        </div>
      </footer>
    </div>
  );
}
