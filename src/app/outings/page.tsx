import Image from "next/image";
import { Navigation } from "@/components/outings/Navigation";
import { ScrollReveal } from "@/components/outings/ScrollReveal";
import { ContactForm } from "@/components/outings/ContactForm";
import { StickyBar } from "@/components/outings/StickyBar";

/* ── Shopify CDN images ── */
const IMG = {
  hero: "https://cdn.shopify.com/s/files/1/0561/0530/4256/files/ChatGPT_Image_Feb_11_2026_11_59_56_AM.png?v=1771257707",
  boxContents:
    "https://cdn.shopify.com/s/files/1/0561/0530/4256/files/2fccfbdb-2404-4526-ace9-9a0f1313d3b3.png?v=1771257707",
  grid1:
    "https://cdn.shopify.com/s/files/1/0561/0530/4256/files/ChatGPT_Image_Feb_10_2026_03_56_34_PM.png?v=1771257707",
  grid2:
    "https://cdn.shopify.com/s/files/1/0561/0530/4256/files/ChatGPT_Image_Feb_10_2026_03_40_21_PM.png?v=1771257707",
  grid3:
    "https://cdn.shopify.com/s/files/1/0561/0530/4256/files/ChatGPT_Image_Feb_10_2026_01_51_41_PM.png?v=1771258943",
  grid4:
    "https://cdn.shopify.com/s/files/1/0561/0530/4256/files/ChatGPT_Image_Feb_10_2026_03_14_47_PM.png?v=1771257707",
  unboxing:
    "https://cdn.shopify.com/s/files/1/0561/0530/4256/files/ChatGPT_Image_Feb_10_2026_04_48_19_PM.png?v=1771257707",
  founder:
    "https://cdn.shopify.com/s/files/1/0561/0530/4256/files/ChatGPT_Image_Feb_12_2026_08_53_22_AM.png?v=1771257707",
  lifestyle1:
    "https://cdn.shopify.com/s/files/1/0561/0530/4256/files/ChatGPT_Image_Feb_10_2026_03_35_39_PM.png?v=1771257707",
  lifestyle2:
    "https://cdn.shopify.com/s/files/1/0561/0530/4256/files/ChatGPT_Image_Feb_10_2026_03_49_24_PM.png?v=1771257707",
};

export default function OutingsPage() {
  return (
    <>
      <Navigation />
      <StickyBar />

      {/* ═══════════════════════════════════════════
          HERO — split layout: text left, image right
          ═══════════════════════════════════════════ */}
      <section
        id="hero"
        className="relative min-h-screen flex items-center overflow-hidden pt-[72px]"
      >
        <div className="max-w-[1200px] mx-auto px-6 md:px-10 w-full">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 lg:gap-16 items-center py-16 md:py-0">
            {/* Left: copy */}
            <div>
              <p
                className="text-[11px] uppercase tracking-[0.25em] text-muted mb-5 animate-fade-in-up"
                style={{ animationDelay: "0.1s", animationFillMode: "both" }}
              >
                Curated gift boxes for golf outings
              </p>

              <h1
                className="font-serif text-[clamp(40px,6vw,72px)] leading-[1.05] tracking-[-0.02em] text-cream mb-6 animate-fade-in-up"
                style={{ animationDelay: "0.3s", animationFillMode: "both" }}
              >
                Your outing deserves better than a sleeve of balls
                <span className="gold-shimmer"> and a koozie</span>
              </h1>

              <p
                className="text-lg md:text-xl leading-[1.6] text-muted mb-8 max-w-lg animate-fade-in-up"
                style={{ animationDelay: "0.5s", animationFillMode: "both" }}
              >
                We build premium, custom-branded gift boxes your guests actually
                keep. Delivered to your event, ready to impress.
              </p>

              <div
                className="flex flex-col sm:flex-row gap-4 animate-fade-in-up"
                style={{ animationDelay: "0.7s", animationFillMode: "both" }}
              >
                <a href="#contact" className="btn-filled">
                  Build Your Box
                </a>
                <a href="#the-box" className="btn-primary">
                  <span>See What&apos;s Inside</span>
                </a>
              </div>
            </div>

            {/* Right: hero image */}
            <div
              className="animate-fade-in"
              style={{ animationDelay: "0.6s", animationFillMode: "both" }}
            >
              <div className="img-container aspect-[4/5] lg:aspect-[3/4] rounded-sm">
                <Image
                  src={IMG.hero}
                  alt="Man on a golf course holding open a custom Mully gift box"
                  width={600}
                  height={800}
                  priority
                  className="w-full h-full object-cover"
                />
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ═══════════════════════════════════════════
          BUILT FOR — event type chips
          ═══════════════════════════════════════════ */}
      <section className="py-12 border-y border-border bg-surface-raised">
        <div className="max-w-[1200px] mx-auto px-6 md:px-10">
          <div className="flex flex-wrap items-center justify-center gap-x-8 gap-y-3 text-[12px] uppercase tracking-[0.12em] text-muted">
            <span className="text-cream/50">Built for</span>
            {[
              "Corporate Outings",
              "Charity Tournaments",
              "Member-Guests",
              "Club Championships",
              "Weddings",
              "Bachelor Parties",
            ].map((type) => (
              <span key={type}>{type}</span>
            ))}
          </div>
        </div>
      </section>

      {/* ═══════════════════════════════════════════
          HOW IT WORKS — 3 steps
          ═══════════════════════════════════════════ */}
      <section id="how-it-works" className="py-24 md:py-36">
        <div className="max-w-[1200px] mx-auto px-6 md:px-10">
          <ScrollReveal>
            <h2 className="font-serif text-[clamp(32px,4.5vw,52px)] leading-[1.08] tracking-[-0.02em] text-cream mb-4 text-center">
              Three steps. Zero hassle.
            </h2>
          </ScrollReveal>

          <ScrollReveal delay={1}>
            <p className="text-base text-muted text-center max-w-lg mx-auto mb-16">
              Tell us about your event and we handle the rest.
            </p>
          </ScrollReveal>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-10 md:gap-8">
            {[
              {
                step: "01",
                title: "Share your event details",
                desc: "Date, headcount, vibe, budget. Takes two minutes.",
              },
              {
                step: "02",
                title: "We curate your box",
                desc: "Our team builds a custom collection branded to your event.",
              },
              {
                step: "03",
                title: "Show up and impress",
                desc: "Boxes arrive at your venue, perfectly packed and ready to go.",
              },
            ].map((item, i) => (
              <ScrollReveal key={item.step} delay={(i + 1) as 1 | 2 | 3}>
                <div className="text-center">
                  <div className="inline-flex items-center justify-center w-12 h-12 rounded-full border border-gold/30 mb-5">
                    <span className="text-[13px] font-medium text-gold">
                      {item.step}
                    </span>
                  </div>
                  <h3 className="font-serif text-xl text-cream mb-3">
                    {item.title}
                  </h3>
                  <p className="text-[15px] leading-[1.6] text-muted max-w-xs mx-auto">
                    {item.desc}
                  </p>
                </div>
              </ScrollReveal>
            ))}
          </div>
        </div>
      </section>

      {/* ═══════════════════════════════════════════
          THE BOX — product showcase with images
          ═══════════════════════════════════════════ */}
      <section id="the-box" className="bg-surface-raised">
        {/* 4-image grid strip */}
        <ScrollReveal>
          <div className="grid grid-cols-2 md:grid-cols-4">
            {[IMG.grid1, IMG.grid2, IMG.grid3, IMG.grid4].map((src, i) => (
              <div key={i} className="img-container aspect-square">
                <Image
                  src={src}
                  alt={`Mully gift box product shot ${i + 1}`}
                  width={400}
                  height={400}
                  className="w-full h-full object-cover"
                />
              </div>
            ))}
          </div>
        </ScrollReveal>

        {/* Content: image + description */}
        <div className="max-w-[1200px] mx-auto px-6 md:px-10 py-24 md:py-36">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 lg:gap-20 items-center">
            {/* Left: box contents image */}
            <ScrollReveal>
              <div className="img-container aspect-square rounded-sm">
                <Image
                  src={IMG.boxContents}
                  alt="Open Mully box showing custom quarter-zip, YETI tumbler, leather headcover, and braided belt"
                  width={600}
                  height={600}
                  className="w-full h-full object-cover"
                />
              </div>
            </ScrollReveal>

            {/* Right: description */}
            <div>
              <ScrollReveal>
                <p className="text-[11px] uppercase tracking-[0.2em] text-muted mb-4">
                  What goes in the box
                </p>
              </ScrollReveal>

              <ScrollReveal delay={1}>
                <h2 className="font-serif text-[clamp(32px,4.5vw,48px)] leading-[1.08] tracking-[-0.02em] text-cream mb-6">
                  Premium gear, branded to your event
                </h2>
              </ScrollReveal>

              <ScrollReveal delay={2}>
                <p className="text-base leading-[1.7] text-muted mb-8">
                  Every box is built around your event. Hand-picked apparel,
                  accessories, and gear — branded with your logo and packed in
                  our signature green box.
                </p>
              </ScrollReveal>

              <ScrollReveal delay={3}>
                <ul className="space-y-4">
                  {[
                    "Custom quarter-zip or polo",
                    "YETI drinkware",
                    "Leather accessories & headcovers",
                    "Embroidered golf towel",
                    "Premium headwear",
                    "Event-branded packaging & welcome card",
                  ].map((item) => (
                    <li key={item} className="flex items-center gap-3">
                      <span className="w-1.5 h-1.5 rounded-full bg-gold shrink-0" />
                      <span className="text-[15px] text-cream/80">{item}</span>
                    </li>
                  ))}
                </ul>
              </ScrollReveal>
            </div>
          </div>

          {/* Second image: hands unboxing */}
          <ScrollReveal className="mt-20">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 lg:gap-20 items-center">
              <div className="order-2 lg:order-1">
                <h3 className="font-serif text-2xl md:text-3xl text-cream mb-4">
                  Every detail, dialed in
                </h3>
                <p className="text-base leading-[1.7] text-muted mb-6">
                  From the tissue paper to the branded box tape, we obsess over
                  presentation. Your guests should feel something when they open
                  it — not just see it.
                </p>
                <a href="#contact" className="btn-primary">
                  <span>Build Your Box</span>
                </a>
              </div>
              <div className="img-container aspect-[4/3] rounded-sm order-1 lg:order-2">
                <Image
                  src={IMG.unboxing}
                  alt="Top-down view of hands opening a custom branded Mully gift box"
                  width={600}
                  height={450}
                  className="w-full h-full object-cover"
                />
              </div>
            </div>
          </ScrollReveal>
        </div>
      </section>

      {/* ═══════════════════════════════════════════
          LIFESTYLE BREAK — 2-image visual strip
          ═══════════════════════════════════════════ */}
      <ScrollReveal>
        <div className="grid grid-cols-1 md:grid-cols-2">
          <div className="img-container aspect-[16/9]">
            <Image
              src={IMG.lifestyle1}
              alt="Mully gift box lifestyle shot"
              width={800}
              height={450}
              className="w-full h-full object-cover"
            />
          </div>
          <div className="img-container aspect-[16/9]">
            <Image
              src={IMG.lifestyle2}
              alt="Mully gift box on the course"
              width={800}
              height={450}
              className="w-full h-full object-cover"
            />
          </div>
        </div>
      </ScrollReveal>

      {/* ═══════════════════════════════════════════
          PACKAGES — 3 tiers
          ═══════════════════════════════════════════ */}
      <section id="packages" className="py-24 md:py-36">
        <div className="max-w-[1200px] mx-auto px-6 md:px-10">
          <ScrollReveal>
            <h2 className="font-serif text-[clamp(32px,4.5vw,52px)] leading-[1.08] tracking-[-0.02em] text-cream mb-4 text-center">
              Built for any budget
            </h2>
          </ScrollReveal>

          <ScrollReveal delay={1}>
            <p className="text-base text-muted text-center max-w-xl mx-auto mb-14">
              Every package is fully customizable. Tell us about your event and
              we&apos;ll build the right option for your group.
            </p>
          </ScrollReveal>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
            {[
              {
                name: "The Birdie",
                price: "From $45",
                unit: "per box",
                desc: "The essentials, elevated. Premium accessories and gear your guests will love.",
                features: [
                  "Premium golf balls & tees",
                  "Custom ball marker",
                  "Embroidered golf towel",
                  "Event-branded packaging",
                ],
                highlight: false,
              },
              {
                name: "The Eagle",
                price: "From $85",
                unit: "per box",
                desc: "Our most popular. Branded gear, drinkware, and merchandise that sets the tone.",
                features: [
                  "Branded YETI drinkware",
                  "Branded cap or visor",
                  "Embroidered golf towel",
                  "Divot tool & accessories",
                  "Everything in Birdie",
                ],
                highlight: true,
              },
              {
                name: "The Albatross",
                price: "Custom",
                unit: "$125+ per box",
                desc: "The full experience. Fully custom apparel, top-shelf gear, and white-glove delivery.",
                features: [
                  "Custom quarter-zip or polo",
                  "YETI drinkware",
                  "Premium leather accessories",
                  "Keepsake box & welcome card",
                  "Everything in Eagle",
                ],
                highlight: false,
              },
            ].map((pkg, i) => (
              <ScrollReveal key={pkg.name} delay={(i + 1) as 1 | 2 | 3}>
                <div
                  className={`o-card-hover relative p-8 md:p-9 border rounded-sm h-full flex flex-col ${
                    pkg.highlight
                      ? "border-gold/30 bg-gold/[0.03]"
                      : "border-border bg-surface"
                  }`}
                >
                  {pkg.highlight && (
                    <div className="absolute -top-3 left-8 bg-gold text-background text-[10px] uppercase tracking-[0.12em] font-semibold px-3 py-1">
                      Most Popular
                    </div>
                  )}

                  <h3 className="font-serif text-2xl text-cream mb-2">
                    {pkg.name}
                  </h3>
                  <div className="flex items-baseline gap-2 mb-4">
                    <span className="font-serif text-2xl text-gold">
                      {pkg.price}
                    </span>
                    <span className="text-[13px] text-muted">{pkg.unit}</span>
                  </div>
                  <p className="text-[14px] leading-[1.6] text-muted mb-6">
                    {pkg.desc}
                  </p>

                  <ul className="space-y-2.5 mb-8 flex-1">
                    {pkg.features.map((f) => (
                      <li key={f} className="flex items-start gap-2.5">
                        <span className="w-1 h-1 rounded-full bg-cream/40 mt-2 shrink-0" />
                        <span className="text-[13px] text-cream/70">{f}</span>
                      </li>
                    ))}
                  </ul>

                  <a
                    href="#contact"
                    className={`text-center text-[12px] ${
                      pkg.highlight ? "btn-filled" : "btn-primary"
                    }`}
                  >
                    {pkg.highlight ? (
                      "Get a Quote"
                    ) : (
                      <span>Get a Quote</span>
                    )}
                  </a>
                </div>
              </ScrollReveal>
            ))}
          </div>
        </div>
      </section>

      {/* ═══════════════════════════════════════════
          FOUNDER — personal touch
          ═══════════════════════════════════════════ */}
      <section className="bg-surface-raised py-24 md:py-36">
        <div className="max-w-[1200px] mx-auto px-6 md:px-10">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 lg:gap-20 items-center">
            <ScrollReveal>
              <div className="img-container aspect-[3/4] max-w-md mx-auto lg:mx-0 rounded-sm">
                <Image
                  src={IMG.founder}
                  alt="Mully founder"
                  width={450}
                  height={600}
                  className="w-full h-full object-cover"
                />
              </div>
            </ScrollReveal>

            <div>
              <ScrollReveal>
                <p className="text-[11px] uppercase tracking-[0.2em] text-muted mb-4">
                  Why we started this
                </p>
              </ScrollReveal>

              <ScrollReveal delay={1}>
                <blockquote className="font-serif text-[clamp(22px,3vw,32px)] leading-[1.25] tracking-[-0.01em] text-cream mb-6">
                  &ldquo;I&apos;ve played in dozens of outings where the gift
                  bag was an afterthought — a logo&apos;d koozie and a sleeve of
                  range balls. We started Mully because your guests deserve
                  better than that.&rdquo;
                </blockquote>
              </ScrollReveal>

              <ScrollReveal delay={2}>
                <div className="gold-line w-12 mb-4" />
                <p className="text-cream font-medium">Drew Amato</p>
                <p className="text-[13px] text-muted mt-0.5">
                  Founder, Mully
                </p>
              </ScrollReveal>
            </div>
          </div>
        </div>
      </section>

      {/* ═══════════════════════════════════════════
          CONTACT FORM — simplified, prominent
          ═══════════════════════════════════════════ */}
      <section id="contact" className="py-24 md:py-36">
        <div className="max-w-[1200px] mx-auto px-6 md:px-10">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 lg:gap-20">
            {/* Left: copy */}
            <div className="flex flex-col justify-center">
              <ScrollReveal>
                <h2 className="font-serif text-[clamp(32px,4.5vw,52px)] leading-[1.08] tracking-[-0.02em] text-cream mb-5">
                  Let&apos;s build your box
                </h2>
              </ScrollReveal>

              <ScrollReveal delay={1}>
                <p className="text-base leading-[1.7] text-muted mb-8 max-w-md">
                  Tell us about your event and we&apos;ll send custom package
                  options within 24 hours. No commitment — just great options.
                </p>
              </ScrollReveal>

              <ScrollReveal delay={2}>
                <div className="space-y-3">
                  {[
                    "Fully customized to your event",
                    "Free design mockup with your branding",
                    "No minimums, no commitments",
                    "Book 4+ weeks out for best availability",
                  ].map((item) => (
                    <div key={item} className="flex items-center gap-3">
                      <span className="w-1.5 h-1.5 rounded-full bg-gold shrink-0" />
                      <span className="text-[14px] text-cream/70">{item}</span>
                    </div>
                  ))}
                </div>
              </ScrollReveal>
            </div>

            {/* Right: form */}
            <ScrollReveal delay={1}>
              <div className="p-8 md:p-10 border border-border rounded-sm bg-surface-raised">
                <h3 className="font-serif text-2xl text-cream mb-6">
                  Tell us about your event
                </h3>
                <ContactForm />
              </div>
            </ScrollReveal>
          </div>
        </div>
      </section>

      {/* ═══════════════════════════════════════════
          FOOTER
          ═══════════════════════════════════════════ */}
      <footer className="border-t border-border py-10">
        <div className="max-w-[1200px] mx-auto px-6 md:px-10">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-6">
              <span className="font-serif text-lg text-cream">mully</span>
              <span className="text-[12px] text-muted hidden sm:inline">
                Premium curated gift boxes for golf outings
              </span>
            </div>
            <div className="flex items-center gap-5 text-[12px] text-muted">
              <a
                href="#how-it-works"
                className="hover:text-cream transition-colors"
              >
                How It Works
              </a>
              <a
                href="#the-box"
                className="hover:text-cream transition-colors"
              >
                The Box
              </a>
              <a
                href="#packages"
                className="hover:text-cream transition-colors"
              >
                Packages
              </a>
              <a
                href="#contact"
                className="hover:text-cream transition-colors"
              >
                Contact
              </a>
            </div>
          </div>
          <div className="mt-8 pt-6 border-t border-border">
            <p className="text-[11px] text-muted/50 text-center">
              &copy; 2026 Mully. All rights reserved.
            </p>
          </div>
        </div>
      </footer>
    </>
  );
}
