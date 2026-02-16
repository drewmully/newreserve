import {
  ScrollReveal,
  StatCounter,
  ScrollChevron,
} from "./components/ClientComponents";

export default function Home() {
  return (
    <div className="min-h-screen bg-bone">
      {/* ─── HEADER ─── */}
      <header className="fixed top-0 left-0 right-0 z-50 bg-bone/90 backdrop-blur-md border-b border-taupe/20">
        <div className="max-w-7xl mx-auto px-6 md:px-12 flex items-center justify-between h-16">
          <a href="/" className="flex items-center gap-2.5">
            <MullyMark className="w-7 h-7" />
            <span className="font-serif text-xl tracking-wide text-obsidian font-semibold">
              Mully
            </span>
          </a>
          <nav className="flex items-center gap-8">
            <a
              href="#reserve"
              className="hidden md:block text-sm tracking-wider uppercase text-charcoal/60 hover:text-forest transition-colors duration-300"
            >
              Reserve
            </a>
            <a
              href="#tiers"
              className="hidden md:block text-sm tracking-wider uppercase text-charcoal/60 hover:text-forest transition-colors duration-300"
            >
              Membership
            </a>
            <a
              href="/login"
              className="text-sm tracking-wider uppercase text-forest font-medium hover:text-forest-dark transition-colors duration-300"
            >
              Sign In
            </a>
          </nav>
        </div>
      </header>

      {/* ─── HERO ─── */}
      <section className="relative min-h-screen flex items-center justify-center px-6 md:px-12 pt-16 overflow-hidden">
        {/* Radial gradient backdrop for depth */}
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background:
              "radial-gradient(ellipse 80% 60% at 50% 40%, rgba(110,139,116,0.08) 0%, transparent 70%)",
          }}
        />

        {/* Subtle dot grid */}
        <div
          className="absolute inset-0 opacity-[0.025] pointer-events-none"
          style={{
            backgroundImage: `radial-gradient(circle at 1px 1px, #1F3D2B 1px, transparent 0)`,
            backgroundSize: "48px 48px",
          }}
        />

        {/* ── Floating decorative elements ── */}
        {/* Large golf ball - top right */}
        <div className="absolute top-[15%] right-[8%] hero-float-1 pointer-events-none hidden md:block">
          <GolfBallSVG className="w-32 lg:w-40 opacity-[0.04]" />
        </div>
        {/* Flag mark - bottom left */}
        <div className="absolute bottom-[20%] left-[6%] hero-float-2 pointer-events-none hidden md:block">
          <MullyMark className="w-20 lg:w-24 opacity-[0.05]" />
        </div>
        {/* Diamond - mid left */}
        <div className="absolute top-[35%] left-[12%] hero-float-3 pointer-events-none hidden lg:block">
          <DiamondSVG className="w-10 opacity-[0.06]" />
        </div>
        {/* Small circle - mid right */}
        <div className="absolute top-[60%] right-[15%] hero-float-4 pointer-events-none hidden lg:block">
          <div className="w-6 h-6 rounded-full border-2 border-forest opacity-[0.07]" />
        </div>
        {/* Cross accent - top left */}
        <div className="absolute top-[22%] left-[18%] hero-float-4 pointer-events-none hidden lg:block">
          <CrossSVG className="w-5 opacity-[0.06]" />
        </div>
        {/* Small dot cluster - bottom right */}
        <div className="absolute bottom-[30%] right-[10%] hero-float-3 pointer-events-none hidden md:block">
          <DotClusterSVG className="w-16 opacity-[0.04]" />
        </div>

        {/* ── Hero content ── */}
        <div className="relative max-w-4xl mx-auto text-center">
          <div className="animate-fade-up">
            <span className="inline-flex items-center gap-2 text-xs tracking-[0.35em] uppercase text-sage font-medium mb-8">
              <span className="w-8 h-px bg-sage/50" />
              Mully Reserve
              <span className="w-8 h-px bg-sage/50" />
            </span>
          </div>

          <h1 className="font-serif text-5xl md:text-7xl lg:text-[6.5rem] text-obsidian leading-[1.02] tracking-tight mb-8 animate-fade-up-delay-1">
            Progress, Earned.
          </h1>

          <p className="text-lg md:text-xl text-charcoal/65 max-w-2xl mx-auto leading-relaxed mb-14 animate-fade-up-delay-2">
            Members-only access to curated partner benefits, reserve pricing,
            and private club eligibility. No&nbsp;gimmicks. No&nbsp;hype. Just
            access built for players who care.
          </p>

          <div className="animate-fade-up-delay-3">
            <form className="flex flex-col sm:flex-row items-center gap-3 max-w-md mx-auto mb-5">
              <input
                type="email"
                placeholder="Your email"
                className="w-full sm:flex-1 h-13 px-5 rounded-xl bg-cream border border-taupe/40 text-obsidian placeholder:text-taupe text-base focus:border-forest focus:ring-2 focus:ring-forest/20 transition-all duration-300"
              />
              <button
                type="submit"
                className="w-full sm:w-auto h-13 px-8 rounded-xl bg-forest text-bone text-sm font-medium tracking-wider uppercase hover:bg-forest-dark transition-colors duration-300 cursor-pointer whitespace-nowrap"
              >
                Unlock Access
              </button>
            </form>
            <p className="text-xs text-taupe tracking-wide">
              Complimentary access &middot; No credit card required
            </p>
          </div>
        </div>

        {/* Scroll indicator */}
        <div className="absolute bottom-10 left-1/2 -translate-x-1/2">
          <ScrollChevron />
        </div>
      </section>

      {/* ─── SOCIAL PROOF STRIP ─── */}
      <section className="py-16 md:py-20 px-6 md:px-12 border-y border-taupe/15 bg-bone-dark/50">
        <div className="max-w-5xl mx-auto grid grid-cols-2 md:grid-cols-4 gap-8 md:gap-4">
          <StatCounter end={2400} suffix="+" label="Members" />
          <StatCounter end={40} suffix="+" label="Brand Partners" />
          <StatCounter end={12} label="Private Locations" />
          <StatCounter end={96} suffix="%" label="Renewal Rate" />
        </div>
      </section>

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
                Mully Reserve is a members-only access program built around
                curated partnerships, preferred pricing, and private club
                eligibility. It is not a rewards program. It is not a points
                system. It is access&mdash;earned, not bought.
              </p>
            </div>
          </ScrollReveal>

          <div className="grid md:grid-cols-3 gap-6 lg:gap-8">
            <ScrollReveal delay={0}>
              <BenefitCard
                icon={<PartnerIcon />}
                title="Curated Partner Access"
                description="Exclusive access to vetted partners across gear, fitting, training, and lifestyle. Every partner is hand-selected."
              />
            </ScrollReveal>
            <ScrollReveal delay={0.12}>
              <BenefitCard
                icon={<PricingIcon />}
                title="Reserve Pricing"
                description="Members-only pricing on select products and experiences. No markups. No inflated MSRPs. Just honest value."
              />
            </ScrollReveal>
            <ScrollReveal delay={0.24}>
              <BenefitCard
                icon={<ClubIcon />}
                title="Private Club Eligibility"
                description="Qualify for Mully&rsquo;s private club program. Tee times, events, and community&mdash;for those who earn it."
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
      <section id="tiers" className="py-24 md:py-36 px-6 md:px-12 bg-cream">
        <div className="max-w-6xl mx-auto">
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
                Private club perks. Without the country club cost.
              </p>
            </div>
          </ScrollReveal>

          <div className="grid md:grid-cols-3 gap-6 lg:gap-8">
            {/* Tier 1 - Reserve Access */}
            <ScrollReveal delay={0}>
              <div className="bg-bone rounded-2xl p-8 md:p-10 border border-taupe/25 flex flex-col card-hover h-full">
                <span className="text-xs tracking-[0.25em] uppercase text-sage font-medium mb-3">
                  Reserve Access
                </span>
                <div className="mb-6">
                  <span className="font-serif text-3xl text-obsidian">
                    Complimentary
                  </span>
                </div>
                <p className="text-sm text-charcoal/55 leading-relaxed mb-8 flex-1">
                  Your entry point. Unlock partner access, browse reserve-priced
                  products, and stay connected to private releases.
                </p>
                <ul className="space-y-3 mb-10">
                  <TierFeature text="Partner benefit access" />
                  <TierFeature text="Reserve pricing visibility" />
                  <TierFeature text="Private release notifications" />
                  <TierFeature text="Community access" />
                </ul>
                <a
                  href="#"
                  className="block w-full text-center h-12 leading-[3rem] rounded-xl border border-forest text-forest text-sm font-medium tracking-wider uppercase hover:bg-forest hover:text-bone transition-all duration-300"
                >
                  Get Started
                </a>
              </div>
            </ScrollReveal>

            {/* Tier 2 - Reserve Member (Featured) */}
            <ScrollReveal delay={0.12}>
              <div className="bg-forest rounded-2xl p-8 md:p-10 border border-forest flex flex-col relative card-hover h-full">
                <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                  <span className="inline-block bg-sage text-bone text-xs tracking-[0.2em] uppercase font-medium px-4 py-1.5 rounded-full shadow-sm">
                    Most Popular
                  </span>
                </div>
                <span className="text-xs tracking-[0.25em] uppercase text-sage font-medium mb-3">
                  Reserve Member
                </span>
                <div className="mb-6">
                  <span className="font-serif text-3xl text-bone">$199</span>
                  <span className="text-bone/50 text-sm ml-1">/quarter</span>
                </div>
                <p className="text-sm text-bone/55 leading-relaxed mb-8 flex-1">
                  For the serious player. Guaranteed access windows, quarterly
                  allowance, and priority on every drop.
                </p>
                <ul className="space-y-3 mb-10">
                  <TierFeature text="Everything in Reserve Access" light />
                  <TierFeature text="Guaranteed access windows" light />
                  <TierFeature text="$150 quarterly allowance" light />
                  <TierFeature text="Priority release access" light />
                  <TierFeature text="Private club eligibility" light />
                </ul>
                <a
                  href="#"
                  className="block w-full text-center h-12 leading-[3rem] rounded-xl bg-bone text-forest text-sm font-medium tracking-wider uppercase hover:bg-bone-dark transition-all duration-300"
                >
                  Join Now
                </a>
              </div>
            </ScrollReveal>

            {/* Tier 3 - Reserve Black */}
            <ScrollReveal delay={0.24}>
              <div className="bg-obsidian rounded-2xl p-8 md:p-10 border border-charcoal/60 flex flex-col card-hover h-full">
                <span className="text-xs tracking-[0.25em] uppercase text-taupe font-medium mb-3">
                  Reserve Black
                </span>
                <div className="mb-6">
                  <span className="font-serif text-3xl text-bone">
                    Invite Only
                  </span>
                </div>
                <p className="text-sm text-bone/35 leading-relaxed mb-8 flex-1">
                  The highest tier. Personal styling, concierge support, and
                  access to experiences money alone can&rsquo;t&nbsp;buy.
                </p>
                <ul className="space-y-3 mb-10">
                  <TierFeature text="Everything in Reserve Member" dark />
                  <TierFeature text="$1,000 quarterly credit" dark />
                  <TierFeature text="Personal stylist" dark />
                  <TierFeature text="Concierge phone support" dark />
                  <TierFeature text="Invite-only events" dark />
                </ul>
                <div className="block w-full text-center h-12 leading-[3rem] rounded-xl border border-charcoal/60 text-taupe text-sm font-medium tracking-wider uppercase cursor-default">
                  By Invitation
                </div>
              </div>
            </ScrollReveal>
          </div>
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
                name="Signature Tech Polo"
                category="Apparel"
                tag="Reserve Priced"
                pattern="topo-pattern"
              />
            </ScrollReveal>
            <ScrollReveal delay={0.12}>
              <ReleaseCard
                name="Graphite Capsule Collection"
                category="Limited Release"
                tag="Sold Out"
                pattern="topo-pattern-dark"
              />
            </ScrollReveal>
            <ScrollReveal delay={0.24}>
              <ReleaseCard
                name="Ventilated Mesh Cap"
                category="Accessories"
                tag="Available"
                pattern="topo-pattern-sage"
              />
            </ScrollReveal>
          </div>

          <ScrollReveal>
            <div className="text-center mt-12">
              <a
                href="#"
                className="inline-flex items-center gap-2 text-sm tracking-wider uppercase text-forest font-medium group"
              >
                <span className="border-b border-forest/30 pb-0.5 group-hover:border-forest transition-colors duration-300">
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

      {/* ─── PARTNER STRIP ─── */}
      <section className="py-14 px-6 md:px-12 border-y border-taupe/15 bg-bone">
        <ScrollReveal>
          <div className="max-w-5xl mx-auto">
            <p className="text-center text-xs tracking-[0.3em] uppercase text-taupe/70 font-medium mb-8">
              Trusted Partner Network
            </p>
            <div className="flex flex-wrap items-center justify-center gap-x-12 gap-y-4">
              {[
                "Titleist",
                "TravisMathew",
                "Club Champion",
                "Callaway",
                "Peter Millar",
                "G/FORE",
              ].map((name) => (
                <span
                  key={name}
                  className="text-sm md:text-base font-medium text-charcoal/25 tracking-wide"
                >
                  {name}
                </span>
              ))}
            </div>
          </div>
        </ScrollReveal>
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
                  matters&mdash;without the noise.
                </p>
                <p className="text-sm text-sage italic">
                  &ldquo;Taste. Earned.&rdquo;
                </p>
              </div>

              {/* Right: Form */}
              <div className="bg-cream rounded-2xl p-8 md:p-10 border border-taupe/20 shadow-sm">
                <h3 className="font-serif text-xl text-obsidian mb-2">
                  Unlock Reserve Access
                </h3>
                <p className="text-sm text-charcoal/50 mb-6">
                  Complimentary. No credit card required.
                </p>
                <form className="space-y-3">
                  <input
                    type="email"
                    placeholder="Your email"
                    className="w-full h-13 px-5 rounded-xl bg-bone border border-taupe/30 text-obsidian placeholder:text-taupe text-base focus:border-forest focus:ring-2 focus:ring-forest/20 transition-all duration-300"
                  />
                  <button
                    type="submit"
                    className="w-full h-13 rounded-xl bg-forest text-bone text-sm font-medium tracking-wider uppercase hover:bg-forest-dark transition-colors duration-300 cursor-pointer"
                  >
                    Get Started
                  </button>
                </form>
                <p className="text-xs text-taupe/70 mt-4 text-center">
                  Join 2,400+ members already inside.
                </p>
              </div>
            </div>
          </div>
        </ScrollReveal>
      </section>

      {/* ─── FOOTER ─── */}
      <footer className="py-16 px-6 md:px-12 bg-obsidian">
        <div className="max-w-6xl mx-auto">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-8 mb-12">
            <div className="flex items-center gap-2.5">
              <MullyMark className="w-6 h-6 text-bone" />
              <span className="font-serif text-lg tracking-wide text-bone font-semibold">
                Mully
              </span>
            </div>
            <div className="flex items-center gap-8">
              <a
                href="/terms"
                className="text-sm text-bone/40 hover:text-bone/70 transition-colors duration-300"
              >
                Terms
              </a>
              <a
                href="/privacy"
                className="text-sm text-bone/40 hover:text-bone/70 transition-colors duration-300"
              >
                Privacy
              </a>
              <a
                href="/contact"
                className="text-sm text-bone/40 hover:text-bone/70 transition-colors duration-300"
              >
                Contact
              </a>
            </div>
          </div>
          <div className="border-t border-charcoal pt-8">
            <p className="text-sm text-bone/30 mb-2">
              Mully Reserve is access&mdash;not a rewards program.
            </p>
            <p className="text-sm text-bone/20">
              High signal. Low noise. Rare drops.
            </p>
          </div>
          <div className="mt-8">
            <p className="text-xs text-bone/15">
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
        className="text-forest"
      />
      <path
        d="M7.5 4L21 9.5L7.5 15V4Z"
        fill="currentColor"
        className="text-forest"
      />
      <ellipse
        cx="6.25"
        cy="26"
        rx="4"
        ry="1"
        fill="currentColor"
        className="text-forest"
        opacity="0.3"
      />
    </svg>
  );
}

function BenefitCard({
  icon,
  title,
  description,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
}) {
  return (
    <div className="bg-cream rounded-2xl p-8 md:p-10 border border-taupe/15 card-hover group h-full">
      <div className="w-14 h-14 rounded-2xl bg-forest/8 flex items-center justify-center mb-7 group-hover:bg-forest/12 transition-colors duration-300">
        {icon}
      </div>
      <h3 className="font-serif text-xl text-obsidian mb-3">{title}</h3>
      <p className="text-sm text-charcoal/55 leading-relaxed">{description}</p>
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
      ? "text-sage"
      : "text-forest";
  const textColor = dark
    ? "text-bone/45"
    : light
      ? "text-bone/65"
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
      <div className="w-14 h-14 rounded-2xl bg-forest/8 flex items-center justify-center mx-auto mb-5">
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

function ReleaseCard({
  name,
  category,
  tag,
  pattern,
}: {
  name: string;
  category: string;
  tag: string;
  pattern: string;
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
        <div
          className={`release-img-inner aspect-[4/3] ${pattern} relative flex items-center justify-center`}
        >
          <MullyMark className="w-14 h-14 text-bone opacity-10" />
        </div>
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

/* ═══════════════════════════════════════════
   HERO DECORATIVE SVGs
   ═══════════════════════════════════════════ */

function GolfBallSVG({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 120 120"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
    >
      <circle cx="60" cy="60" r="56" stroke="#1F3D2B" strokeWidth="1.5" />
      <circle cx="45" cy="40" r="3" fill="#1F3D2B" opacity="0.3" />
      <circle cx="60" cy="35" r="3" fill="#1F3D2B" opacity="0.3" />
      <circle cx="75" cy="40" r="3" fill="#1F3D2B" opacity="0.3" />
      <circle cx="50" cy="55" r="3" fill="#1F3D2B" opacity="0.3" />
      <circle cx="65" cy="50" r="3" fill="#1F3D2B" opacity="0.3" />
      <circle cx="80" cy="55" r="3" fill="#1F3D2B" opacity="0.3" />
      <circle cx="55" cy="70" r="3" fill="#1F3D2B" opacity="0.3" />
      <circle cx="70" cy="65" r="3" fill="#1F3D2B" opacity="0.3" />
      <circle cx="60" cy="82" r="3" fill="#1F3D2B" opacity="0.3" />
    </svg>
  );
}

function DiamondSVG({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
    >
      <path
        d="M12 2L22 12L12 22L2 12L12 2Z"
        stroke="#1F3D2B"
        strokeWidth="1.5"
      />
    </svg>
  );
}

function CrossSVG({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
    >
      <line
        x1="10"
        y1="2"
        x2="10"
        y2="18"
        stroke="#1F3D2B"
        strokeWidth="1.5"
      />
      <line
        x1="2"
        y1="10"
        x2="18"
        y2="10"
        stroke="#1F3D2B"
        strokeWidth="1.5"
      />
    </svg>
  );
}

function DotClusterSVG({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 60 40"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
    >
      <circle cx="8" cy="8" r="2" fill="#1F3D2B" />
      <circle cx="24" cy="8" r="2" fill="#1F3D2B" />
      <circle cx="40" cy="8" r="2" fill="#1F3D2B" />
      <circle cx="56" cy="8" r="2" fill="#1F3D2B" />
      <circle cx="8" cy="20" r="2" fill="#1F3D2B" />
      <circle cx="24" cy="20" r="2" fill="#1F3D2B" />
      <circle cx="40" cy="20" r="2" fill="#1F3D2B" />
      <circle cx="56" cy="20" r="2" fill="#1F3D2B" />
      <circle cx="8" cy="32" r="2" fill="#1F3D2B" />
      <circle cx="24" cy="32" r="2" fill="#1F3D2B" />
      <circle cx="40" cy="32" r="2" fill="#1F3D2B" />
      <circle cx="56" cy="32" r="2" fill="#1F3D2B" />
    </svg>
  );
}
