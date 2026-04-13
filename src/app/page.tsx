import Image from "next/image";
import {
  ScrollReveal,
  StatCounter,
  ScrollChevron,
  FadeInSection,
  LogoLink,
} from "./components/ClientComponents";
import { EmailCTA } from "./components/EmailCTA";

export default function Home() {
  return (
    <div className="min-h-screen bg-bone">
      {/* ─── HEADER ─── */}
      <header className="fixed top-0 left-0 right-0 z-50 bg-bone/90 backdrop-blur-md header-grass">
        <div className="max-w-7xl mx-auto px-6 md:px-12 flex items-center justify-between h-16">
          <LogoLink />
          <a
            href="/login"
            className="text-xs sm:text-sm tracking-wider uppercase text-forest font-medium hover:text-forest-dark transition-colors duration-300 shrink-0 mr-4 md:mr-0"
          >
            Sign In
          </a>
        </div>
      </header>

      {/* ─── HERO ─── */}
      <section className="relative min-h-[82vh] md:h-[84vh] flex items-center px-6 md:px-12 lg:px-20 pt-20 pb-12 md:pt-16 md:pb-0 overflow-hidden">
        <Image
          src="https://cdn.shopify.com/s/files/1/0561/0530/4256/files/ChatGPT_Image_Feb_24_2026_03_08_18_PM.png?v=1771963720"
          alt=""
          aria-hidden="true"
          fill
          preload
          fetchPriority="high"
          sizes="100vw"
          draggable={false}
          className="absolute inset-0 w-full h-full object-cover pointer-events-none select-none"
        />

        {/* Layer 2: Soft scrim for left-side text readability */}
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background: "linear-gradient(105deg, rgba(245,241,232,0.88) 0%, rgba(245,241,232,0.65) 35%, rgba(245,241,232,0.15) 55%, transparent 70%)",
          }}
        />
        {/* Layer 2b: Mobile scrim — centered content needs broader coverage */}
        <div
          className="absolute inset-0 pointer-events-none md:hidden"
          style={{
            background: "linear-gradient(180deg, rgba(245,241,232,0.75) 0%, rgba(245,241,232,0.60) 50%, rgba(245,241,232,0.40) 80%, transparent 100%)",
          }}
        />

        {/* ── Two-column hero content ── */}
        <div className="relative max-w-7xl mx-auto w-full grid md:grid-cols-2 gap-6 md:gap-12 lg:gap-20 items-center z-10">

          {/* LEFT COLUMN — headline, subtext, CTA */}
          <div className="max-w-lg text-center md:text-left mx-auto md:mx-0">
            {/* Mobile member card — compact, above headline */}
            <div className="md:hidden flex justify-center mb-5 animate-fade-up">
              <MemberCard size="sm" />
            </div>

            <div className="animate-fade-up mb-5 md:mb-8">
              <span className="inline-flex items-center gap-2.5 text-[11px] tracking-[0.35em] uppercase text-sage font-medium">
                <span className="w-8 h-px bg-sage/40" />
                Mully Reserve
                <span className="w-8 h-px bg-sage/40" />
              </span>
            </div>

            <h1 className="font-serif text-3xl md:text-5xl lg:text-[4.25rem] text-forest leading-[1.05] tracking-tight mb-4 md:mb-6 animate-fade-up-delay-1">
              Access the Best<br />
              of Golf
            </h1>

            <p className="text-base md:text-xl text-charcoal/55 leading-relaxed mb-7 md:mb-10 max-w-xs sm:max-w-sm mx-auto md:mx-0 animate-fade-up-delay-2">
              Live the private club life without country club costs.
            </p>

            <div className="animate-fade-up-delay-3">
              <EmailCTA variant="hero" />
              <p className="text-[11px] text-charcoal/40 tracking-wide mt-1">
                Complimentary access &middot; No credit card required
              </p>
            </div>
          </div>

          {/* RIGHT COLUMN — Desktop member card */}
          <div className="hidden md:flex items-center justify-center animate-fade-up-delay-2">
            <div className="member-card-glow">
              <div className="member-card-float">
                <MemberCard size="lg" />
              </div>
            </div>
          </div>
        </div>

        {/* Scroll indicator */}
        <div className="absolute bottom-6 left-1/2 -translate-x-1/2">
          <ScrollChevron />
        </div>
      </section>

      {/* ─── SOCIAL PROOF STRIP ─── */}
      <FadeInSection initialOpacity={0.15}>
        <section className="py-16 md:py-20 px-6 md:px-12 border-b border-taupe/15 bg-bone-dark/50">
          <div className="max-w-5xl mx-auto grid grid-cols-2 md:grid-cols-4 gap-8 md:gap-4">
            <StatCounter end={100} suffix="K+" label="Orders Shipped" />
            <StatCounter end={40} suffix="+" label="Brand Partners" />
            <StatCounter end={250} prefix="$" suffix="+" label="Annual Savings" />
            <StatCounter end={96} suffix="%" label="Renewal Rate" />
          </div>
        </section>
      </FadeInSection>

      {/* ─── WHAT IS MULLY RESERVE ─── */}
      <section id="reserve" className="py-24 md:py-36 px-6 md:px-12">
        <div className="max-w-6xl mx-auto">
          <ScrollReveal>
            <div className="max-w-3xl mx-auto text-center mb-20">
              <span className="inline-flex items-center gap-2 text-xs tracking-[0.3em] uppercase text-sage font-medium mb-6">
                <span className="w-6 h-px bg-sage/50" />
                The Program
                <span className="w-6 h-px bg-sage/50" />
              </span>
              <h2 className="font-serif text-3xl md:text-5xl text-obsidian leading-tight mb-8">
                What is Mully Reserve?
              </h2>
              <p className="text-lg text-charcoal/65 leading-relaxed">
                Mully Reserve brings you the curated products, expert services,
                and experiences you&rsquo;d expect from a top-tier club, all in
                one place, at a fraction of the cost. No membership fees.
                No&nbsp;gatekeeping. Just access.
              </p>
            </div>
          </ScrollReveal>

          <div className="grid md:grid-cols-3 gap-6 lg:gap-8">
            <ScrollReveal delay={0}>
              <BenefitCard
                image="https://cdn.shopify.com/s/files/1/0561/0530/4256/files/ChatGPT_Image_Feb_24_2026_02_24_48_PM.png?v=1771961106"
                title="Curated Partner Access"
                description="Exclusive access to vetted partners across gear, training, and lifestyle. Every partner is hand-selected."
              />
            </ScrollReveal>
            <ScrollReveal delay={0.12}>
              <BenefitCard
                image="https://cdn.shopify.com/s/files/1/0561/0530/4256/files/Colorado_Hoodie.webp?v=1771960357"
                title="Reserve Pricing"
                description="Members-only pricing on premium gear. No markups. Just honest value."
                overlay={
                  <div
                    className="rounded-lg px-3 py-2.5"
                    style={{
                      background: "rgba(245,241,232,0.82)",
                      backdropFilter: "blur(16px) saturate(1.4)",
                      WebkitBackdropFilter: "blur(16px) saturate(1.4)",
                      border: "1px solid rgba(255,255,255,0.35)",
                      boxShadow: "0 4px 16px -4px rgba(0,0,0,0.12), inset 0 1px 0 rgba(255,255,255,0.50)",
                    }}
                  >
                    <p className="text-[9px] tracking-[0.12em] uppercase text-charcoal/45 mb-1">Greyson Colorado Hoodie</p>
                    <div className="flex items-baseline gap-2">
                      <span className="text-[11px] text-charcoal/30 line-through">$170</span>
                      <span className="text-sm text-forest font-semibold">$144</span>
                    </div>
                    <div className="flex items-center gap-1.5 mt-1.5 pt-1.5 border-t border-taupe/10">
                      <svg className="w-3 h-3 text-forest/50 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 18.75a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m3 0h6m-9 0H3.375a1.125 1.125 0 01-1.125-1.125V14.25m17.25 4.5a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m3 0H21M3.375 14.25h3.504c.576 0 1.09.22 1.49.588m0 0a3.012 3.012 0 015.171 0m-5.171 0H3.375m9.504 0h4.524c.577 0 1.09-.22 1.49-.588M14.25 14.25v-2.25m0 0h3.375a1.125 1.125 0 001.125-1.125v-3.375" />
                      </svg>
                      <span className="text-[8px] tracking-[0.1em] uppercase text-forest/50 font-medium">Free express shipping</span>
                    </div>
                  </div>
                }
              />
            </ScrollReveal>
            <ScrollReveal delay={0.24}>
              <BenefitCard
                image="https://cdn.shopify.com/s/files/1/0561/0530/4256/files/ChatGPT_Image_Feb_24_2026_02_25_26_PM.png?v=1771961138"
                title="Club-Level Service"
                description="Concierge support, styling, and exclusive events. The full club experience without the club membership."
              />
            </ScrollReveal>
          </div>
        </div>
      </section>

      {/* ─── PHILOSOPHY BANNER ─── */}
      <section className="relative py-28 md:py-40 px-6 md:px-12 bg-forest overflow-hidden">
        {/* Decorative oversized quote marks */}
        <div className="absolute top-8 left-6 md:left-16 pointer-events-none">
          <span className="font-serif text-[12rem] md:text-[18rem] leading-none text-bone/[0.03] select-none">
            &ldquo;
          </span>
        </div>
        {/* Subtle pattern overlay */}
        <div
          className="absolute inset-0 opacity-[0.03] pointer-events-none"
          style={{
            backgroundImage: `radial-gradient(circle at 1px 1px, #F5F1E8 0.5px, transparent 0)`,
            backgroundSize: "32px 32px",
          }}
        />
        <ScrollReveal>
          <div className="relative max-w-4xl mx-auto text-center">
            <blockquote className="font-serif text-3xl md:text-5xl lg:text-6xl text-bone/95 leading-[1.15] mb-8">
              You don&rsquo;t buy status.
              <br />
              You build it.
            </blockquote>
            <div className="flex items-center justify-center gap-3 mb-6">
              <span className="w-12 h-px bg-sage/40" />
              <MullyMark className="w-5 h-5 text-sage/60" />
              <span className="w-12 h-px bg-sage/40" />
            </div>
            <p className="text-sage text-base md:text-lg tracking-wide max-w-lg mx-auto">
              Progress takes intention. Mully Reserve is for those who
              understand that.
            </p>
          </div>
        </ScrollReveal>
      </section>

      {/* ─── MEMBERSHIP TIERS ─── */}
      <section id="tiers" className="py-24 md:py-36 px-6 md:px-12 bg-cream relative overflow-hidden">
        {/* Subtle gradient blobs for glass card refraction */}
        <div className="absolute top-1/4 -left-32 w-96 h-96 bg-forest/[0.04] rounded-full blur-3xl pointer-events-none" />
        <div className="absolute bottom-1/3 -right-24 w-80 h-80 bg-sage/[0.06] rounded-full blur-3xl pointer-events-none" />
        <div className="absolute top-2/3 left-1/3 w-64 h-64 bg-taupe/[0.08] rounded-full blur-3xl pointer-events-none" />

        <div className="max-w-6xl mx-auto relative">
          <ScrollReveal>
            <div className="text-center mb-20">
              <span className="inline-flex items-center gap-2 text-xs tracking-[0.3em] uppercase text-sage font-medium mb-6">
                <span className="w-6 h-px bg-sage/50" />
                Membership
                <span className="w-6 h-px bg-sage/50" />
              </span>
              <h2 className="font-serif text-3xl md:text-5xl text-obsidian leading-tight mb-6">
                Choose Your Level
              </h2>
              <p className="text-lg text-charcoal/65 max-w-xl mx-auto">
                The full club experience. A fraction of the cost.
              </p>
            </div>
          </ScrollReveal>

          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-5 lg:gap-4 items-stretch">
            {/* ── Tier 1 — Free ── */}
            <ScrollReveal delay={0}>
              <div className="rounded-2xl p-7 md:p-8 flex flex-col card-hover h-full glass-card glass-card-light">
                <div className="h-5 mb-3" />
                <span className="text-[11px] tracking-[0.25em] uppercase text-sage font-medium">
                  Free
                </span>
                <div className="mt-2 mb-5">
                  <span className="font-serif text-3xl text-obsidian">$0</span>
                </div>
                <div className="border-t border-taupe/12 pt-5 flex-1 flex flex-col">
                  <ul className="space-y-3 flex-1">
                    <TierFeature text="Browse Reserve pricing" />
                    <TierFeature text="Drop notifications" />
                    <TierFeature text="Community access" />
                  </ul>
                  <a
                    href="/login"
                    className="mt-8 block w-full text-center h-12 leading-[3rem] rounded-xl border border-forest/80 text-forest text-sm font-medium tracking-wider uppercase hover:bg-forest hover:text-bone transition-all duration-300 btn-press"
                  >
                    Sign Up Free
                  </a>
                </div>
              </div>
            </ScrollReveal>

            {/* ── Tier 2 — Reserve Access ($99/yr) ── */}
            <ScrollReveal delay={0.08}>
              <div className="rounded-2xl p-7 md:p-8 flex flex-col card-hover h-full glass-card glass-card-light">
                <div className="h-5 mb-3" />
                <span className="text-[11px] tracking-[0.25em] uppercase text-forest font-medium">
                  Reserve Access
                </span>
                <div className="mt-2 mb-5">
                  <span className="font-serif text-3xl text-obsidian">$99</span>
                  <span className="text-charcoal/40 text-sm ml-1">/year</span>
                </div>
                <div className="border-t border-taupe/12 pt-5 flex-1 flex flex-col">
                  <ul className="space-y-3 flex-1">
                    <TierFeature text="Reserve pricing on all gear" />
                    <TierFeature text="Early drop access" />
                    <TierFeature text="Partner benefits" />
                    <TierFeature text="Free 2-day shipping" />
                    <TierFeature text="USGA Handicap (soon)" />
                  </ul>
                  <a
                    href="/login"
                    className="mt-8 block w-full text-center h-12 leading-[3rem] rounded-xl bg-forest text-bone text-sm font-medium tracking-wider uppercase hover:bg-forest-dark transition-all duration-300 btn-press"
                  >
                    Join Now
                  </a>
                </div>
              </div>
            </ScrollReveal>

            {/* ── Tier 3 — Reserve Member ($249/qtr, Featured) ── */}
            <ScrollReveal delay={0.16}>
              <div className="relative h-full">
                {/* Badge — lives outside overflow-hidden so it never clips */}
                <div className="absolute -top-3 left-1/2 -translate-x-1/2 z-20">
                  <span className="inline-block bg-sage text-bone text-[10px] tracking-[0.2em] uppercase font-semibold px-4 py-1.5 rounded-full shadow-sm whitespace-nowrap">
                    Most Popular
                  </span>
                </div>

                <div className="rounded-2xl overflow-hidden relative flex flex-col card-hover h-full glass-card glass-card-dark">
                  <Image
                    src="https://cdn.shopify.com/s/files/1/0561/0530/4256/files/Untitled_design_17.png?v=1771516197"
                    alt=""
                    aria-hidden="true"
                    width={176}
                    height={176}
                    sizes="176px"
                    draggable={false}
                    className="absolute -top-4 -left-4 w-44 h-44 object-cover object-right-bottom opacity-[0.18] -rotate-6 pointer-events-none select-none"
                  />

                  {/* Content — layered above the background image */}
                  <div className="relative z-10 p-7 md:p-8 flex flex-col flex-1">
                    <div className="h-5 mb-3" />
                    <span className="text-[11px] tracking-[0.25em] uppercase text-bone/80 font-medium">
                      Reserve Member
                    </span>
                    <div className="mt-2 mb-5">
                      <span className="font-serif text-3xl text-bone">$249</span>
                      <span className="text-bone/45 text-sm ml-1">/quarter</span>
                    </div>
                    <div className="border-t border-bone/10 pt-5 flex-1 flex flex-col">
                      <ul className="space-y-3 flex-1">
                        <TierFeature text="Everything in Access" light />
                        <TierFeature text="Quarterly curated box" light />
                        <TierFeature text="Guaranteed access windows" light />
                        <TierFeature text="Concierge support" light />
                        <TierFeature text="Invite-only events" light />
                      </ul>
                      <a
                        href="/login"
                        className="mt-8 block w-full text-center h-12 leading-[3rem] rounded-xl bg-bone text-forest text-sm font-medium tracking-wider uppercase hover:bg-bone-dark transition-all duration-300 btn-press"
                      >
                        Join Now
                      </a>
                    </div>
                  </div>
                </div>
              </div>
            </ScrollReveal>

            {/* ── Tier 4 — Reserve Black ── */}
            <ScrollReveal delay={0.24}>
              <div className="rounded-2xl p-7 md:p-8 flex flex-col card-hover h-full relative overflow-hidden glass-card glass-card-light">
                <div className="absolute top-0 left-0 right-0 h-1 bg-obsidian" />
                <div className="h-5 mb-3" />
                <span className="text-[11px] tracking-[0.25em] uppercase text-charcoal/50 font-medium">
                  Reserve Black
                </span>
                <div className="mt-2 mb-5">
                  <span className="font-serif text-3xl text-obsidian">Invite Only</span>
                </div>
                <div className="border-t border-taupe/12 pt-5 flex-1 flex flex-col">
                  <ul className="space-y-3 flex-1">
                    <TierFeature text="Everything in Member" />
                    <TierFeature text="$1,000 quarterly credit" />
                    <TierFeature text="Personal stylist" />
                    <TierFeature text="Concierge phone line" />
                    <TierFeature text="Invite-only experiences" />
                  </ul>
                  <div className="mt-8 block w-full text-center h-12 leading-[3rem] rounded-xl border border-charcoal/15 text-charcoal/40 text-sm font-medium tracking-wider uppercase cursor-default">
                    By Invitation
                  </div>
                </div>
              </div>
            </ScrollReveal>
          </div>

          {/* Reassurance — reduces friction */}
          <ScrollReveal delay={0.3}>
            <p className="text-center text-sm text-charcoal/40 mt-12">
              Start free. Upgrade or cancel anytime. No commitments.
            </p>
          </ScrollReveal>
        </div>
      </section>

      {/* ─── HOW IT WORKS ─── */}
      <section className="py-24 md:py-36 px-6 md:px-12 bg-bone">
        <div className="max-w-5xl mx-auto">
          <ScrollReveal>
            <div className="text-center mb-20">
              <span className="inline-flex items-center gap-2 text-xs tracking-[0.3em] uppercase text-sage font-medium mb-6">
                <span className="w-6 h-px bg-sage/50" />
                Simple
                <span className="w-6 h-px bg-sage/50" />
              </span>
              <h2 className="font-serif text-3xl md:text-5xl text-obsidian leading-tight">
                How It Works
              </h2>
            </div>
          </ScrollReveal>

          <div className="grid md:grid-cols-3 gap-12 md:gap-0">
            <ScrollReveal delay={0} className="step-connector">
              <StepCard
                number="01"
                icon={<EnvelopeIcon />}
                title="Unlock Access"
                description="Enter your email to claim your complimentary Reserve Access. No credit card. No commitments."
              />
            </ScrollReveal>
            <ScrollReveal delay={0.15} className="step-connector">
              <StepCard
                number="02"
                icon={<KeyIcon />}
                title="Access Activates"
                description="Reserve access attaches to your account automatically. Partner benefits and pricing unlock instantly."
              />
            </ScrollReveal>
            <ScrollReveal delay={0.3} className="step-connector">
              <StepCard
                number="03"
                icon={<BellIcon />}
                title="Private Releases"
                description="When curated products and experiences become available, you&rsquo;ll be the first to know. High signal, low noise."
              />
            </ScrollReveal>
          </div>
        </div>
      </section>

      {/* ─── RECENT RELEASES ─── */}
      <section className="py-24 md:py-36 px-6 md:px-12 bg-cream">
        <div className="max-w-6xl mx-auto">
          <ScrollReveal>
            <div className="text-center mb-16">
              <span className="inline-flex items-center gap-2 text-xs tracking-[0.3em] uppercase text-sage font-medium mb-6">
                <span className="w-6 h-px bg-sage/50" />
                The Drop
                <span className="w-6 h-px bg-sage/50" />
              </span>
              <h2 className="font-serif text-3xl md:text-5xl text-obsidian leading-tight mb-6">
                Recent Releases
              </h2>
              <p className="text-lg text-charcoal/65 max-w-xl mx-auto">
                A look at what Reserve members have accessed. Updated
                periodically. No&nbsp;spam.
              </p>
            </div>
          </ScrollReveal>

          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
            <ScrollReveal delay={0}>
              <ReleaseCard
                name="Forrester WindBlocker"
                category="Stitch"
                tag="Reserve Priced"
                image="https://cdn.shopify.com/s/files/1/0561/0530/4256/files/FO_WindBlockerM_Black-1.jpg?v=1775579847"
              />
            </ScrollReveal>
            <ScrollReveal delay={0.12}>
              <ReleaseCard
                name="Celtic Polo"
                category="Quiet Golf"
                tag="Available"
                image="https://cdn.shopify.com/s/files/1/0561/0530/4256/files/celticpoloslatefront_3b541e30-412e-4873-85c7-cb8b8b618e68.jpg?v=1771520789"
              />
            </ScrollReveal>
            <ScrollReveal delay={0.24}>
              <ReleaseCard
                name="Golf Tour Trouser"
                category="Rhone"
                tag="Available"
                image="https://cdn.shopify.com/s/files/1/0561/0530/4256/files/GolfTourTrouser-TidalGreen-102181-355_2_2000x_395dbcbe-7daa-4221-bfba-4f32b89f8a89.webp?v=1771520721"
              />
            </ScrollReveal>
          </div>

          <ScrollReveal>
            <div className="text-center mt-12">
              <a
                href="#"
                className="inline-flex items-center gap-2 text-sm tracking-wider uppercase text-forest font-medium group link-hover-underline"
              >
                <span className="group-hover:text-forest-dark transition-colors duration-300">
                  View All Past Drops
                </span>
                <svg
                  className="w-4 h-4 transition-transform duration-300 group-hover:translate-x-1"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M17 8l4 4m0 0l-4 4m4-4H3"
                  />
                </svg>
              </a>
            </div>
          </ScrollReveal>
        </div>
      </section>

      {/* ─── FINAL CTA ─── */}
      <section className="py-28 md:py-40 px-6 md:px-12 bg-bone relative overflow-hidden">
        {/* Decorative background elements */}
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-none">
          <div
            className="w-[600px] h-[600px] rounded-full opacity-[0.04]"
            style={{
              background:
                "radial-gradient(circle, #1F3D2B 0%, transparent 70%)",
            }}
          />
        </div>

        <ScrollReveal>
          <div className="relative max-w-4xl mx-auto">
            <div className="grid md:grid-cols-2 gap-12 md:gap-16 items-center">
              {/* Left: Message */}
              <div className="text-center md:text-left">
                <h2 className="font-serif text-3xl md:text-5xl lg:text-[3.5rem] text-obsidian leading-tight mb-6">
                  Built for players
                  <br />
                  who care.
                </h2>
                <p className="text-lg text-charcoal/60 leading-relaxed mb-4">
                  Earn your edge. Join Mully Reserve and get access to what
                  matters. Without the noise.
                </p>
                <p className="text-sm text-sage italic">
                  &ldquo;Taste. Earned.&rdquo;
                </p>
              </div>

              {/* Right: CTA */}
              <div className="bg-cream rounded-2xl p-8 md:p-10 border border-taupe/20 shadow-sm">
                <h3 className="font-serif text-xl text-obsidian mb-2">
                  Unlock Reserve Access
                </h3>
                <p className="text-sm text-charcoal/50 mb-6">
                  Complimentary. No credit card required.
                </p>
                <EmailCTA variant="bottom" />
                <p className="text-xs text-taupe/70 mt-4 text-center">
                  Join 2,400+ members already inside.
                </p>
              </div>
            </div>
          </div>
        </ScrollReveal>
      </section>

      {/* ─── FOOTER ─── */}
      <footer className="py-16 px-6 md:px-12 bg-forest">
        <div className="max-w-6xl mx-auto">
          {/* Top — Logo + Nav columns */}
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-10 mb-14">
            {/* Logo */}
            <div className="col-span-2 md:col-span-4 lg:col-span-1 mb-4 lg:mb-0">
              <span className="flex items-center gap-2 text-bone mb-3">
                <svg viewBox="0 0 1002 540" fill="currentColor" className="h-5 w-auto" aria-hidden="true"><path d="M0,0 H1002 V540 H0 Z M50,1 L998,269 L50,538 Z" fillRule="evenodd" /></svg>
                <span className="font-serif text-2xl font-bold tracking-wide">mully.</span>
              </span>
              <p className="text-sm text-bone/50 leading-relaxed max-w-xs">
                Members-only access to the best golf has to offer.
              </p>
            </div>

            {/* Company */}
            <div>
              <h4 className="text-xs tracking-[0.25em] uppercase text-bone/70 font-medium mb-4">
                Company
              </h4>
              <ul className="space-y-2.5">
                <FooterLink href="https://outings-self.vercel.app">Outings &amp; Groups</FooterLink>
                <FooterLink href="/blog">Blog</FooterLink>
                <FooterLink href="/faq">FAQ</FooterLink>
                <FooterLink href="/login">Log In</FooterLink>
              </ul>
            </div>

            {/* Partners */}
            <div>
              <h4 className="text-xs tracking-[0.25em] uppercase text-bone/70 font-medium mb-4">
                Partners
              </h4>
              <ul className="space-y-2.5">
                <FooterLink href="/affiliates">Affiliates</FooterLink>
                <FooterLink href="/influencers">Influencers</FooterLink>
              </ul>
            </div>

            {/* Policies */}
            <div>
              <h4 className="text-xs tracking-[0.25em] uppercase text-bone/70 font-medium mb-4">
                Policies
              </h4>
              <ul className="space-y-2.5">
                <FooterLink href="/returns">Returns</FooterLink>
                <FooterLink href="/policies/privacy">Privacy Policy</FooterLink>
                <FooterLink href="/policies/shipping">Shipping Policy</FooterLink>
                <FooterLink href="/policies/terms">Terms of Service</FooterLink>
              </ul>
            </div>
          </div>

          {/* Contact + Socials */}
          <div className="border-t border-bone/15 pt-8 flex flex-col md:flex-row md:items-center md:justify-between gap-6">
            <div>
              <p className="text-sm text-bone/70 mb-1">
                Info@MyMully.com
              </p>
              <p className="text-xs text-bone/40">
                555 Friendly St., Pontiac, MI 48341
              </p>
            </div>

            {/* Social icons */}
            <div className="flex items-center gap-4">
              <a href="https://instagram.com/Mullybox" target="_blank" rel="noopener noreferrer" className="text-bone/50 hover:text-bone transition-colors duration-300" aria-label="Instagram">
                <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24"><path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 100 12.324 6.162 6.162 0 000-12.324zM12 16a4 4 0 110-8 4 4 0 010 8zm6.406-11.845a1.44 1.44 0 100 2.881 1.44 1.44 0 000-2.881z"/></svg>
              </a>
              <a href="https://tiktok.com/@Mullybox" target="_blank" rel="noopener noreferrer" className="text-bone/50 hover:text-bone transition-colors duration-300" aria-label="TikTok">
                <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24"><path d="M19.59 6.69a4.83 4.83 0 01-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 01-2.88 2.5 2.89 2.89 0 01-2.89-2.89 2.89 2.89 0 012.89-2.89c.28 0 .54.04.79.1v-3.5a6.37 6.37 0 00-.79-.05A6.34 6.34 0 003.15 15.2a6.34 6.34 0 0010.86 4.48V13a8.28 8.28 0 005.58 2.16V11.7a4.83 4.83 0 01-3.77-1.24V6.69h3.77z"/></svg>
              </a>
              <a href="https://facebook.com/Mullybox" target="_blank" rel="noopener noreferrer" className="text-bone/50 hover:text-bone transition-colors duration-300" aria-label="Facebook">
                <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24"><path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/></svg>
              </a>
              <a href="https://x.com/MyMully" target="_blank" rel="noopener noreferrer" className="text-bone/50 hover:text-bone transition-colors duration-300" aria-label="X">
                <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>
              </a>
              <a href="https://youtube.com/@Mullybox" target="_blank" rel="noopener noreferrer" className="text-bone/50 hover:text-bone transition-colors duration-300" aria-label="YouTube">
                <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24"><path d="M23.498 6.186a3.016 3.016 0 00-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 00.502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 002.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 002.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/></svg>
              </a>
            </div>
          </div>

          {/* Copyright */}
          <div className="mt-8">
            <p className="text-xs text-bone/25">
              &copy; {new Date().getFullYear()} Mully Group, Inc. All rights
              reserved.
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}

/* ═══════════════════════════════════════════
   COMPONENTS
   ═══════════════════════════════════════════ */

function MullyMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 28 28"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
    >
      <rect
        x="5"
        y="3"
        width="2.5"
        height="22"
        rx="1.25"
        fill="currentColor"
      />
      <path d="M7.5 4L21 9.5L7.5 15V4Z" fill="currentColor" />
      <ellipse
        cx="6.25"
        cy="26"
        rx="4"
        ry="1"
        fill="currentColor"
        opacity="0.3"
      />
    </svg>
  );
}

/* ── Glassmorphic Reserve Member Card ── */
function MemberCard({ size = "lg" }: { size?: "sm" | "lg" }) {
  const isSmall = size === "sm";
  return (
    <div
      className={`relative ${isSmall ? "w-[240px] aspect-[1.6/1] rounded-xl" : "w-[360px] lg:w-[400px] aspect-[1.6/1] rounded-2xl"} overflow-hidden member-card-shimmer`}
      style={{
        background: "linear-gradient(135deg, rgba(255,255,255,0.35) 0%, rgba(255,255,255,0.18) 50%, rgba(255,255,255,0.25) 100%)",
        backdropFilter: "blur(18px) saturate(1.6)",
        WebkitBackdropFilter: "blur(18px) saturate(1.6)",
        border: "1px solid rgba(255,255,255,0.45)",
        boxShadow: isSmall
          ? "0 4px 20px -4px rgba(0,0,0,0.12), inset 0 1px 0 rgba(255,255,255,0.50)"
          : "0 8px 32px -4px rgba(0,0,0,0.15), 0 32px 72px -12px rgba(0,0,0,0.10), inset 0 1px 0 rgba(255,255,255,0.60), inset 0 0 0 0.5px rgba(255,255,255,0.30)",
      }}
    >
      <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-white/50 to-transparent" />
      <div className={`relative z-10 h-full flex flex-col justify-between ${isSmall ? "p-4" : "p-7"}`}>
        <div className="flex items-start justify-between">
          <div className={`flex items-center gap-1.5 text-forest ${isSmall ? "" : "gap-2"}`}>
            <svg viewBox="0 0 1002 540" fill="currentColor" className={`${isSmall ? "h-3" : "h-4"} w-auto`} aria-hidden="true">
              <path d="M0,0 H1002 V540 H0 Z M50,1 L998,269 L50,538 Z" fillRule="evenodd" />
            </svg>
            <span className={`font-serif font-bold tracking-wide ${isSmall ? "text-xs" : "text-sm"}`}>mully.</span>
          </div>
          <span className={`tracking-[0.2em] uppercase text-forest/40 font-medium ${isSmall ? "text-[7px]" : "text-[9px]"}`}>EST. 2026</span>
        </div>
        <div className="text-center">
          <span className={`tracking-[0.4em] uppercase text-forest/70 font-medium ${isSmall ? "text-[9px]" : "text-[11px]"}`}>
            Mully Reserve
          </span>
        </div>
        <div className="flex items-end justify-between">
          <div>
            <span className={`block tracking-[0.2em] uppercase text-forest/40 mb-0.5 ${isSmall ? "text-[7px]" : "text-[9px] mb-1"}`}>Member</span>
            <span className={`text-forest/80 tracking-widest font-light ${isSmall ? "text-xs" : "text-sm"}`}>0001 &nbsp;2847</span>
          </div>
          <span className={`tracking-[0.15em] uppercase text-forest/35 font-medium ${isSmall ? "text-[7px]" : "text-[9px]"}`}>
            Reserve Member
          </span>
        </div>
      </div>
    </div>
  );
}

function BenefitCard({
  image,
  title,
  description,
  overlay,
  children,
}: {
  image: string;
  title: string;
  description: string;
  overlay?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <div className="bg-cream rounded-2xl overflow-hidden border border-taupe/15 card-hover group h-full">
      <div className="relative aspect-[3/2] overflow-hidden">
        <Image
          src={image}
          alt={title}
          fill
          sizes="(min-width: 1024px) 360px, (min-width: 768px) 33vw, 100vw"
          className="w-full h-full object-cover transition-transform duration-600 group-hover:scale-105"
          draggable={false}
        />
        {overlay && (
          <div className="absolute top-3 right-3 z-10">
            {overlay}
          </div>
        )}
      </div>
      <div className="p-6 md:p-7">
        <h3 className="font-serif text-lg text-obsidian mb-2">{title}</h3>
        <p className="text-sm text-charcoal/50 leading-relaxed">{description}</p>
        {children}
      </div>
    </div>
  );
}

function TierFeature({
  text,
  light,
  dark,
}: {
  text: string;
  light?: boolean;
  dark?: boolean;
}) {
  const checkColor = dark
    ? "text-taupe"
    : light
      ? "text-bone/80"
      : "text-forest";
  const textColor = dark
    ? "text-bone/45"
    : light
      ? "text-bone/80"
      : "text-charcoal/65";

  return (
    <li className="flex items-start gap-3">
      <svg
        className={`w-4 h-4 mt-0.5 shrink-0 ${checkColor}`}
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={2.5}
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M5 13l4 4L19 7"
        />
      </svg>
      <span className={`text-sm ${textColor}`}>{text}</span>
    </li>
  );
}

function StepCard({
  number,
  icon,
  title,
  description,
}: {
  number: string;
  icon: React.ReactNode;
  title: string;
  description: string;
}) {
  return (
    <div className="text-center px-4">
      <div className="w-14 h-14 rounded-2xl bg-forest/8 flex items-center justify-center mx-auto mb-5 icon-hover-shift">
        {icon}
      </div>
      <span className="font-serif text-xs tracking-[0.2em] text-forest/30 uppercase block mb-3">
        Step {number}
      </span>
      <h3 className="font-serif text-xl text-obsidian mb-3">{title}</h3>
      <p className="text-sm text-charcoal/55 leading-relaxed max-w-xs mx-auto">
        {description}
      </p>
    </div>
  );
}

function FooterLink({
  href,
  children,
}: {
  href: string;
  children: React.ReactNode;
}) {
  return (
    <li>
      <a
        href={href}
        className="text-sm text-bone/50 hover:text-bone transition-colors duration-300 link-hover-underline"
      >
        {children}
      </a>
    </li>
  );
}

function ReleaseCard({
  name,
  category,
  tag,
  image,
  pattern,
}: {
  name: string;
  category: string;
  tag: string;
  image?: string;
  pattern?: string;
}) {
  const tagStyle =
    tag === "Available"
      ? "bg-forest/10 text-forest"
      : tag === "Sold Out"
        ? "bg-charcoal/10 text-charcoal/50"
        : "bg-sage/15 text-sage";

  return (
    <div className="group bg-bone rounded-2xl border border-taupe/15 overflow-hidden card-hover h-full">
      <div className="release-img-wrap">
        {image ? (
          <div className="release-img-inner aspect-[4/3] relative bg-cream">
            <Image
              src={image}
              alt={name}
              fill
              sizes="(min-width: 1024px) 360px, (min-width: 640px) 50vw, 100vw"
              className="w-full h-full object-cover"
              draggable={false}
            />
          </div>
        ) : (
          <div
            className={`release-img-inner aspect-[4/3] ${pattern || ""} relative flex items-center justify-center`}
          >
            <MullyMark className="w-14 h-14 text-bone opacity-10" />
          </div>
        )}
      </div>
      <div className="p-6">
        <span className="text-xs tracking-[0.2em] uppercase text-sage font-medium">
          {category}
        </span>
        <h4 className="font-serif text-lg text-obsidian mt-1.5 mb-3">
          {name}
        </h4>
        <span
          className={`inline-block text-xs tracking-wider uppercase font-medium px-3 py-1 rounded-full ${tagStyle}`}
        >
          {tag}
        </span>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════
   ICONS
   ═══════════════════════════════════════════ */

function PartnerIcon() {
  return (
    <svg
      className="w-6 h-6 text-forest"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={1.5}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z"
      />
    </svg>
  );
}

function PricingIcon() {
  return (
    <svg
      className="w-6 h-6 text-forest"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={1.5}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M9.568 3H5.25A2.25 2.25 0 003 5.25v4.318c0 .597.237 1.17.659 1.591l9.581 9.581c.699.699 1.78.872 2.607.33a18.095 18.095 0 005.223-5.223c.542-.827.369-1.908-.33-2.607L11.16 3.66A2.25 2.25 0 009.568 3z"
      />
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M6 6h.008v.008H6V6z"
      />
    </svg>
  );
}

function ClubIcon() {
  return (
    <svg
      className="w-6 h-6 text-forest"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={1.5}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M3 3v1.5M3 21v-6m0 0l2.77-.693a9 9 0 016.208.682l.108.054a9 9 0 006.086.71l3.114-.732a48.524 48.524 0 01-.005-10.499l-3.11.732a9 9 0 01-6.085-.711l-.108-.054a9 9 0 00-6.208-.682L3 4.5M3 15V4.5"
      />
    </svg>
  );
}

function EnvelopeIcon() {
  return (
    <svg
      className="w-6 h-6 text-forest"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={1.5}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75"
      />
    </svg>
  );
}

function KeyIcon() {
  return (
    <svg
      className="w-6 h-6 text-forest"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={1.5}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M15.75 5.25a3 3 0 013 3m3 0a6 6 0 01-7.029 5.912c-.563-.097-1.159.026-1.563.43L10.5 17.25H8.25v2.25H6v2.25H2.25v-2.818c0-.597.237-1.17.659-1.591l6.499-6.499c.404-.404.527-1 .43-1.563A6 6 0 1121.75 8.25z"
      />
    </svg>
  );
}

function BellIcon() {
  return (
    <svg
      className="w-6 h-6 text-forest"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={1.5}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M14.857 17.082a23.848 23.848 0 005.454-1.31A8.967 8.967 0 0118 9.75v-.7V9A6 6 0 006 9v.75a8.967 8.967 0 01-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 01-5.714 0m5.714 0a3 3 0 11-5.714 0"
      />
    </svg>
  );
}

