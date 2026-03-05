"use client";

import { useState } from "react";
import Link from "next/link";

/* ═══════════════════════════════════════════
   FAQ PAGE
   ═══════════════════════════════════════════ */

const FAQ_SECTIONS: { heading: string; items: { q: string; a: string }[] }[] = [
  {
    heading: "Membership",
    items: [
      {
        q: "What is Mully Reserve?",
        a: "Mully Reserve is a members-only platform built for the modern golfer. We offer curated gear drops, reserve pricing, concierge booking services, and a growing community of like-minded players\u2014all without the five-figure initiation fee of a traditional country club.",
      },
      {
        q: "What membership tiers do you offer?",
        a: "We offer three tiers. Reserve Access ($99/year) gives you reserve pricing, early drop access, and free 2-day shipping. Reserve Member ($249/quarter) adds a personalized fit profile, curated member boxes, concierge support, and invite-only events. Reserve Black is by invitation only and includes a quarterly credit, personal stylist, and concierge phone line.",
      },
      {
        q: "Can I change or cancel my membership anytime?",
        a: "Absolutely. You can upgrade, downgrade, or cancel from your Account page at any time. If you cancel, your benefits remain active through the end of your current billing period\u2014no proration, no surprise charges.",
      },
      {
        q: "Is there a free option?",
        a: "Yes. You can create a free account to browse the shop, join the community, and see retail pricing. Reserve pricing, shipping perks, and member-only drops are unlocked when you upgrade.",
      },
    ],
  },
  {
    heading: "Orders & Shipping",
    items: [
      {
        q: "How fast do orders ship?",
        a: "Reserve Access and above members receive free 2-day shipping on all orders. Free-tier orders ship standard (5\u20137 business days). All orders are processed within 1 business day.",
      },
      {
        q: "Do you ship internationally?",
        a: "We currently ship within the United States. International shipping is on our roadmap\u2014join the waitlist and we\u2019ll notify you when we expand.",
      },
      {
        q: "What is your return policy?",
        a: "We accept returns within 30 days of delivery for unworn, unwashed items in original packaging. Reserve Members get free return shipping. Visit our Refund Policy page for full details.",
      },
      {
        q: "Where are your products sourced from?",
        a: "We partner with 40+ premium golf brands including Titleist, Peter Millar, Greyson, and more. Every product is hand-selected and quality-verified by our team before it hits the shop.",
      },
    ],
  },
  {
    heading: "Fit Profile & Member Boxes",
    items: [
      {
        q: "What is a fit profile?",
        a: "Your fit profile stores your sizing preferences\u2014shirt, glove, waist, inseam, and shoe size. We use it to curate personalized product recommendations and to assemble your quarterly member box so every item fits right out of the box.",
      },
      {
        q: "Can I update my fit profile later?",
        a: "Yes. You can view and edit your fit profile anytime from the Account page. Changes apply immediately to future recommendations and boxes.",
      },
      {
        q: "What\u2019s in a member box?",
        a: "Each quarterly member box is a curated selection of 4\u20136 premium golf items tailored to your fit profile and style preferences. Think of it as a personal stylist for the course. Boxes ship at the start of each quarter for Reserve Member and above tiers.",
      },
    ],
  },
  {
    heading: "Account & Security",
    items: [
      {
        q: "How do I reset my password?",
        a: "On the login page, tap \u201cForgot password?\u201d and enter your email. You\u2019ll receive a reset link within minutes. If you don\u2019t see it, check your spam folder.",
      },
      {
        q: "Is my payment information secure?",
        a: "Yes. We never store your full card details. All payments are processed through Stripe with bank-level 256-bit SSL encryption. Your data is protected by PCI DSS Level 1 compliance.",
      },
      {
        q: "How do I delete my account?",
        a: "You can delete your account from the Account page under Account Actions. This is permanent\u2014your data, order history, and fit profile will be removed within 30 days per our Privacy Policy.",
      },
    ],
  },
  {
    heading: "Community & Events",
    items: [
      {
        q: "What is the Mully community?",
        a: "It\u2019s a members-only space where golfers share course reviews, gear recommendations, swing tips, and trip ideas. Think of it as your clubhouse\u2014without the dress code.",
      },
      {
        q: "What events do you host?",
        a: "Reserve Member and above tiers get access to invite-only events including outings, pro-ams, brand pop-ups, and demo days. Events are announced in the community feed and via email.",
      },
    ],
  },
];

export default function FAQPage() {
  return (
    <div className="min-h-screen bg-bone">
      {/* ─── HEADER ─── */}
      <header className="fixed top-0 left-0 right-0 z-50 bg-bone/90 backdrop-blur-md border-b border-taupe/15">
        <div className="max-w-7xl mx-auto px-5 md:px-12 flex items-center justify-between h-14">
          <Link href="/" className="flex items-center gap-2 text-forest">
            <svg viewBox="0 0 1002 540" fill="currentColor" className="h-4 w-auto" aria-hidden="true"><path d="M0,0 H1002 V540 H0 Z M50,1 L998,269 L50,538 Z" fillRule="evenodd" /></svg>
            <span className="font-serif text-xl font-bold tracking-wide">mully.</span>
          </Link>
          <Link href="/login" className="text-sm tracking-wider uppercase text-forest font-medium hover:text-forest-dark transition-colors duration-300">
            Sign In
          </Link>
        </div>
      </header>

      <main className="pt-24 pb-20 px-5 md:px-12">
        <div className="max-w-2xl mx-auto">
          {/* Page header */}
          <div className="text-center mb-14">
            <span className="inline-flex items-center gap-2.5 text-[11px] tracking-[0.35em] uppercase text-sage font-medium mb-4">
              <span className="w-6 h-px bg-sage/40" />
              Support
              <span className="w-6 h-px bg-sage/40" />
            </span>
            <h1 className="font-serif text-3xl md:text-4xl text-obsidian mb-3">Frequently Asked Questions</h1>
            <p className="text-sm text-charcoal/50 leading-relaxed max-w-md mx-auto">
              Everything you need to know about Mully Reserve. Can&rsquo;t find your answer? Reach out to <a href="mailto:Info@MyMully.com" className="text-forest hover:text-forest-dark transition-colors duration-300 underline underline-offset-2">Info@MyMully.com</a>.
            </p>
          </div>

          {/* FAQ sections */}
          <div className="space-y-10">
            {FAQ_SECTIONS.map((section) => (
              <div key={section.heading}>
                <h2 className="text-[11px] tracking-[0.25em] uppercase text-sage font-medium mb-4">
                  {section.heading}
                </h2>
                <div className="rounded-xl border border-taupe/12 bg-cream overflow-hidden divide-y divide-taupe/10">
                  {section.items.map((item) => (
                    <AccordionItem key={item.q} question={item.q} answer={item.a} />
                  ))}
                </div>
              </div>
            ))}
          </div>

          {/* Bottom CTA */}
          <div className="mt-16 text-center">
            <p className="text-sm text-charcoal/40 mb-4">Still have questions?</p>
            <a
              href="mailto:Info@MyMully.com"
              className="inline-flex items-center justify-center h-11 px-8 rounded-xl bg-forest text-bone text-sm font-medium tracking-wider uppercase hover:bg-forest-dark transition-colors duration-300 btn-press"
            >
              Contact Us
            </a>
          </div>
        </div>
      </main>

      {/* ─── FOOTER ─── */}
      <footer className="py-8 px-6 bg-forest">
        <div className="max-w-6xl mx-auto flex flex-col md:flex-row md:items-center md:justify-between gap-3">
          <span className="flex items-center gap-2 text-bone">
            <svg viewBox="0 0 1002 540" fill="currentColor" className="h-3.5 w-auto" aria-hidden="true"><path d="M0,0 H1002 V540 H0 Z M50,1 L998,269 L50,538 Z" fillRule="evenodd" /></svg>
            <span className="font-serif text-lg font-bold tracking-wide">mully.</span>
          </span>
          <div className="flex items-center gap-6">
            <Link href="/returns" className="text-xs text-bone/40 hover:text-bone transition-colors duration-300">Returns</Link>
            <Link href="/policies/terms" className="text-xs text-bone/40 hover:text-bone transition-colors duration-300">Terms</Link>
            <Link href="/policies/privacy" className="text-xs text-bone/40 hover:text-bone transition-colors duration-300">Privacy</Link>
          </div>
          <p className="text-xs text-bone/35">&copy; {new Date().getFullYear()} Mully Group, Inc. All rights reserved.</p>
        </div>
      </footer>
    </div>
  );
}

/* ── Accordion Item ── */

function AccordionItem({ question, answer }: { question: string; answer: string }) {
  const [open, setOpen] = useState(false);

  return (
    <div>
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between gap-4 px-5 py-4 text-left cursor-pointer group"
      >
        <span className="text-sm font-medium text-obsidian group-hover:text-forest transition-colors duration-300">
          {question}
        </span>
        <svg
          className={`w-4 h-4 text-charcoal/30 shrink-0 transition-transform duration-300 ${open ? "rotate-180" : ""}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
        </svg>
      </button>
      {open && (
        <div className="px-5 pb-4 animate-fade-up">
          <p className="text-sm text-charcoal/55 leading-relaxed">{answer}</p>
        </div>
      )}
    </div>
  );
}
