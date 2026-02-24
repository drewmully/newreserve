"use client";

import { useState } from "react";
import Link from "next/link";
import { useMembership } from "../context/MembershipContext";
import { SlideCart } from "../components/SlideCart";
import { UpgradeModal } from "../components/UpgradeModal";

/* ═══════════════════════════════════════════
   ACCOUNT PAGE
   ═══════════════════════════════════════════ */

export default function AccountPage() {
  const {
    isSignedIn,
    email,
    setEmail,
    username,
    setUsername,
    tier,
    tierLabel,
    setTier,
    cartCount,
    setCartOpen,
  } = useMembership();

  const [editingUsername, setEditingUsername] = useState(false);
  const [editingEmail, setEditingEmail] = useState(false);
  const [tempUsername, setTempUsername] = useState(username);
  const [tempEmail, setTempEmail] = useState(email);
  const [upgradeOpen, setUpgradeOpen] = useState(false);

  const handleSaveUsername = () => {
    setUsername(tempUsername);
    setEditingUsername(false);
  };

  const handleSaveEmail = () => {
    setEmail(tempEmail);
    setEditingEmail(false);
  };

  // Not signed in — redirect nudge
  if (!isSignedIn) {
    return (
      <div className="min-h-screen bg-bone">
        <header className="fixed top-0 left-0 right-0 z-50 bg-bone/90 backdrop-blur-md border-b border-taupe/20">
          <div className="max-w-7xl mx-auto px-6 md:px-12 flex items-center justify-between h-16">
            <Link href="/" className="flex items-center gap-2 text-forest">
              <svg viewBox="0 0 1002 540" fill="currentColor" className="h-5 w-auto" aria-hidden="true"><path d="M0,0 H1002 V540 H0 Z M50,1 L998,269 L50,538 Z" fillRule="evenodd" /></svg>
              <span className="font-serif text-2xl font-bold tracking-wide">mully.</span>
            </Link>
          </div>
        </header>
        <main className="pt-28 pb-24 px-6 md:px-12">
          <div className="max-w-md mx-auto text-center">
            <div className="w-16 h-16 rounded-2xl bg-forest/8 flex items-center justify-center mx-auto mb-6">
              <svg className="w-8 h-8 text-forest" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />
              </svg>
            </div>
            <h1 className="font-serif text-2xl text-obsidian mb-3">Your Account</h1>
            <p className="text-sm text-charcoal/55 leading-relaxed mb-8">
              Sign up or log in to access your account settings, order history, and membership details.
            </p>
            <Link
              href="/onboarding"
              className="inline-flex items-center justify-center h-12 px-10 rounded-xl bg-forest text-bone text-sm font-medium tracking-wider uppercase hover:bg-forest-dark transition-colors duration-300 btn-press"
            >
              Get Started
            </Link>
          </div>
        </main>
      </div>
    );
  }

  const isPaid = tier === "access" || tier === "member" || tier === "black";

  return (
    <div className="min-h-screen bg-bone">
      {/* ─── HEADER ─── */}
      <header className="fixed top-0 left-0 right-0 z-50 bg-bone/90 backdrop-blur-md border-b border-taupe/20">
        <div className="max-w-7xl mx-auto px-6 md:px-12 flex items-center justify-between h-16">
          <Link href="/" className="flex items-center gap-2 text-forest">
            <svg viewBox="0 0 1002 540" fill="currentColor" className="h-5 w-auto" aria-hidden="true"><path d="M0,0 H1002 V540 H0 Z M50,1 L998,269 L50,538 Z" fillRule="evenodd" /></svg>
            <span className="font-serif text-2xl font-bold tracking-wide">mully.</span>
          </Link>
          <div className="flex items-center gap-5">
            <button
              onClick={() => setCartOpen(true)}
              className="relative text-forest hover:text-forest-dark transition-colors duration-300 cursor-pointer"
              aria-label="Cart"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 10.5V6a3.75 3.75 0 10-7.5 0v4.5m11.356-1.993l1.263 12c.07.665-.45 1.243-1.119 1.243H4.25a1.125 1.125 0 01-1.12-1.243l1.264-12A1.125 1.125 0 015.513 7.5h12.974c.576 0 1.059.435 1.119 1.007zM8.625 10.5a.375.375 0 11-.75 0 .375.375 0 01.75 0zm7.5 0a.375.375 0 11-.75 0 .375.375 0 01.75 0z" />
              </svg>
              {cartCount > 0 && (
                <span className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-ember text-white text-[10px] font-medium flex items-center justify-center">
                  {cartCount}
                </span>
              )}
            </button>
            <Link href="/dashboard" className="text-forest hover:text-forest-dark transition-colors duration-300" aria-label="Dashboard">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25A2.25 2.25 0 0113.5 18v-2.25z" />
              </svg>
            </Link>
          </div>
        </div>
      </header>

      <main className="pt-28 pb-24 px-6 md:px-12">
        <div className="max-w-2xl mx-auto">
          {/* Back to dashboard */}
          <Link
            href="/dashboard"
            className="inline-flex items-center gap-1.5 text-sm text-charcoal/40 hover:text-forest transition-colors duration-300 mb-8"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
            </svg>
            Back to Dashboard
          </Link>

          <h1 className="font-serif text-3xl text-obsidian mb-10">Account</h1>

          {/* ── Profile ── */}
          <section className="mb-10">
            <h2 className="text-xs tracking-[0.25em] uppercase text-sage font-medium mb-5">Profile</h2>

            <div className="space-y-4">
              {/* Username */}
              <div className="bg-cream rounded-xl border border-taupe/15 p-5">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs text-charcoal/40 mb-1">Username</p>
                    {editingUsername ? (
                      <div className="flex items-center gap-2">
                        <input
                          type="text"
                          value={tempUsername}
                          onChange={(e) => setTempUsername(e.target.value)}
                          autoFocus
                          className="h-9 px-3 rounded-lg bg-bone border border-taupe/25 text-sm text-obsidian focus:border-forest/40 focus:ring-2 focus:ring-forest/10 transition-all duration-300 w-48"
                        />
                        <button
                          onClick={handleSaveUsername}
                          className="h-9 px-4 rounded-lg bg-forest text-bone text-xs font-medium tracking-wider uppercase hover:bg-forest-dark transition-colors duration-300 cursor-pointer"
                        >
                          Save
                        </button>
                        <button
                          onClick={() => { setTempUsername(username); setEditingUsername(false); }}
                          className="text-xs text-charcoal/40 hover:text-charcoal/60 transition-colors duration-300 cursor-pointer"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <p className="text-sm text-obsidian font-medium">{username || "Not set"}</p>
                    )}
                  </div>
                  {!editingUsername && (
                    <button
                      onClick={() => { setTempUsername(username); setEditingUsername(true); }}
                      className="text-xs text-forest hover:text-forest-dark transition-colors duration-300 cursor-pointer"
                    >
                      Edit
                    </button>
                  )}
                </div>
              </div>

              {/* Email */}
              <div className="bg-cream rounded-xl border border-taupe/15 p-5">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs text-charcoal/40 mb-1">Email</p>
                    {editingEmail ? (
                      <div className="flex items-center gap-2">
                        <input
                          type="email"
                          value={tempEmail}
                          onChange={(e) => setTempEmail(e.target.value)}
                          autoFocus
                          className="h-9 px-3 rounded-lg bg-bone border border-taupe/25 text-sm text-obsidian focus:border-forest/40 focus:ring-2 focus:ring-forest/10 transition-all duration-300 w-56"
                        />
                        <button
                          onClick={handleSaveEmail}
                          className="h-9 px-4 rounded-lg bg-forest text-bone text-xs font-medium tracking-wider uppercase hover:bg-forest-dark transition-colors duration-300 cursor-pointer"
                        >
                          Save
                        </button>
                        <button
                          onClick={() => { setTempEmail(email); setEditingEmail(false); }}
                          className="text-xs text-charcoal/40 hover:text-charcoal/60 transition-colors duration-300 cursor-pointer"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <p className="text-sm text-obsidian font-medium">{email || "Not set"}</p>
                    )}
                  </div>
                  {!editingEmail && (
                    <button
                      onClick={() => { setTempEmail(email); setEditingEmail(true); }}
                      className="text-xs text-forest hover:text-forest-dark transition-colors duration-300 cursor-pointer"
                    >
                      Edit
                    </button>
                  )}
                </div>
              </div>
            </div>
          </section>

          {/* ── Concierge Request ── */}
          {isPaid && <ConciergeRequestSection />}

          {/* ── Orders ── */}
          <section className="mb-10">
            <h2 className="text-xs tracking-[0.25em] uppercase text-sage font-medium mb-5">Orders</h2>

            <div className="bg-cream rounded-xl border border-taupe/15 p-8 text-center">
              <svg className="w-10 h-10 text-taupe/30 mx-auto mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 10.5V6a3.75 3.75 0 10-7.5 0v4.5m11.356-1.993l1.263 12c.07.665-.45 1.243-1.119 1.243H4.25a1.125 1.125 0 01-1.12-1.243l1.264-12A1.125 1.125 0 015.513 7.5h12.974c.576 0 1.059.435 1.119 1.007zM8.625 10.5a.375.375 0 11-.75 0 .375.375 0 01.75 0zm7.5 0a.375.375 0 11-.75 0 .375.375 0 01.75 0z" />
              </svg>
              <p className="text-sm text-charcoal/40 mb-1">No orders yet</p>
              <p className="text-xs text-charcoal/30 mb-5">Your order history will appear here once you make a purchase.</p>
              <Link
                href="/dashboard"
                className="inline-flex items-center justify-center h-9 px-5 rounded-lg border border-taupe/25 text-xs font-medium tracking-wider uppercase text-charcoal/50 hover:border-forest/30 hover:text-forest transition-all duration-300"
              >
                Browse Shop
              </Link>
            </div>
          </section>

          {/* ── Preferences ── */}
          <section className="mb-10">
            <h2 className="text-xs tracking-[0.25em] uppercase text-sage font-medium mb-5">Preferences</h2>

            <div className="space-y-4">
              <div className="bg-cream rounded-xl border border-taupe/15 p-5 flex items-center justify-between">
                <div>
                  <p className="text-sm text-obsidian font-medium">Email Notifications</p>
                  <p className="text-xs text-charcoal/40 mt-0.5">New drops, community activity, and order updates</p>
                </div>
                <ToggleSwitch />
              </div>
              <div className="bg-cream rounded-xl border border-taupe/15 p-5 flex items-center justify-between">
                <div>
                  <p className="text-sm text-obsidian font-medium">SMS Notifications</p>
                  <p className="text-xs text-charcoal/40 mt-0.5">Priority drop alerts and shipping updates</p>
                </div>
                <ToggleSwitch />
              </div>
            </div>
          </section>

          {/* ── Addresses ── */}
          <section className="mb-10">
            <h2 className="text-xs tracking-[0.25em] uppercase text-sage font-medium mb-5">Shipping Address</h2>

            <div className="bg-cream rounded-xl border border-taupe/15 p-8 text-center">
              <p className="text-sm text-charcoal/40 mb-1">No address saved</p>
              <p className="text-xs text-charcoal/30">You&rsquo;ll be prompted to enter a shipping address at checkout.</p>
            </div>
          </section>

          {/* ── Subscription Management (buried lower) ── */}
          <SubscriptionSection tier={tier} tierLabel={tierLabel} setTier={setTier} onUpgrade={() => setUpgradeOpen(true)} />

          {/* ── Danger Zone ── */}
          <section>
            <h2 className="text-xs tracking-[0.25em] uppercase text-charcoal/30 font-medium mb-5">Account</h2>
            <div className="flex items-center gap-4">
              <button className="text-xs text-charcoal/35 hover:text-charcoal/60 transition-colors duration-300 cursor-pointer underline underline-offset-2">
                Sign Out
              </button>
              <button className="text-xs text-ember/50 hover:text-ember transition-colors duration-300 cursor-pointer underline underline-offset-2">
                Delete Account
              </button>
            </div>
          </section>
        </div>
      </main>

      {/* ─── FOOTER ─── */}
      <footer className="py-10 px-6 md:px-12 bg-forest">
        <div className="max-w-6xl mx-auto flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <span className="flex items-center gap-2 text-bone">
            <svg viewBox="0 0 1002 540" fill="currentColor" className="h-4 w-auto" aria-hidden="true"><path d="M0,0 H1002 V540 H0 Z M50,1 L998,269 L50,538 Z" fillRule="evenodd" /></svg>
            <span className="font-serif text-xl font-bold tracking-wide">mully.</span>
          </span>
          <p className="text-xs text-bone/40">
            &copy; {new Date().getFullYear()} Mully Group, Inc. All rights reserved.
          </p>
        </div>
      </footer>

      <UpgradeModal
        open={upgradeOpen}
        onClose={() => setUpgradeOpen(false)}
        currentTier={tier}
        onSelectPlan={(t) => setTier(t)}
      />
      <SlideCart />
    </div>
  );
}

/* ═══════════════════════════════════════════
   CONCIERGE REQUEST FORM
   ═══════════════════════════════════════════ */

const DEPARTMENTS = [
  { value: "concierge", label: "Concierge Services", description: "Guest play, travel, and experience bookings" },
  { value: "styling", label: "Styling & Recommendations", description: "Personal styling advice and product curation" },
  { value: "partnerships", label: "Partnerships", description: "Brand partnerships and collaboration inquiries" },
  { value: "general", label: "General Inquiry", description: "Questions, feedback, or anything else" },
];

function ConciergeRequestSection() {
  const [department, setDepartment] = useState("");
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [submitted, setSubmitted] = useState(false);

  const canSubmit = department && subject.trim() && message.trim();

  const handleSubmit = () => {
    if (!canSubmit) return;
    setSubmitted(true);
  };

  const handleReset = () => {
    setDepartment("");
    setSubject("");
    setMessage("");
    setSubmitted(false);
  };

  return (
    <section className="mb-10">
      <h2 className="text-xs tracking-[0.25em] uppercase text-sage font-medium mb-5">Concierge Request</h2>

      {submitted ? (
        <div className="bg-cream rounded-2xl border border-taupe/15 p-8 text-center animate-fade-up">
          <div className="w-12 h-12 rounded-2xl bg-forest/10 flex items-center justify-center mx-auto mb-4">
            <svg className="w-6 h-6 text-forest" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <h3 className="font-serif text-lg text-obsidian mb-2">Request Submitted</h3>
          <p className="text-sm text-charcoal/50 leading-relaxed mb-5 max-w-sm mx-auto">
            Our concierge team has received your request and will respond within 24 hours via email.
          </p>
          <button
            onClick={handleReset}
            className="text-xs text-forest hover:text-forest-dark transition-colors duration-300 cursor-pointer underline underline-offset-2"
          >
            Submit another request
          </button>
        </div>
      ) : (
        <div className="bg-cream rounded-2xl border border-taupe/15 p-6">
          <p className="text-sm text-charcoal/50 leading-relaxed mb-5">
            Our concierge team is here to help. Select a department and tell us how we can assist.
          </p>

          {/* Department select */}
          <div className="mb-4">
            <label className="text-xs tracking-wide uppercase text-charcoal/50 font-medium mb-2 block">
              Department
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {DEPARTMENTS.map((dept) => (
                <button
                  key={dept.value}
                  onClick={() => setDepartment(dept.value)}
                  className={`text-left px-4 py-3 rounded-xl border transition-all duration-300 cursor-pointer ${
                    department === dept.value
                      ? "bg-forest text-bone border-forest"
                      : "bg-bone border-taupe/20 hover:border-forest/30"
                  }`}
                >
                  <p className={`text-sm font-medium ${department === dept.value ? "text-bone" : "text-obsidian"}`}>
                    {dept.label}
                  </p>
                  <p className={`text-xs mt-0.5 ${department === dept.value ? "text-bone/55" : "text-charcoal/40"}`}>
                    {dept.description}
                  </p>
                </button>
              ))}
            </div>
          </div>

          {/* Subject */}
          <div className="mb-4">
            <label className="text-xs tracking-wide uppercase text-charcoal/50 font-medium mb-2 block">
              Subject
            </label>
            <input
              type="text"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="Brief summary of your request"
              className="w-full h-11 px-4 rounded-xl bg-bone border border-taupe/25 text-obsidian text-sm placeholder:text-charcoal/30 focus:border-forest/40 focus:ring-2 focus:ring-forest/10 transition-all duration-300"
            />
          </div>

          {/* Message */}
          <div className="mb-5">
            <label className="text-xs tracking-wide uppercase text-charcoal/50 font-medium mb-2 block">
              Message
            </label>
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="How can we help?"
              rows={4}
              className="w-full px-4 py-3 rounded-xl bg-bone border border-taupe/25 text-obsidian text-sm placeholder:text-charcoal/30 focus:border-forest/40 focus:ring-2 focus:ring-forest/10 transition-all duration-300 resize-none"
            />
          </div>

          <button
            onClick={handleSubmit}
            disabled={!canSubmit}
            className={`h-11 px-8 rounded-xl text-sm font-medium tracking-wider uppercase transition-all duration-300 cursor-pointer btn-press ${
              canSubmit
                ? "bg-forest text-bone hover:bg-forest-dark"
                : "bg-taupe/25 text-charcoal/30 cursor-not-allowed"
            }`}
          >
            Submit Request
          </button>
        </div>
      )}
    </section>
  );
}

/* ═══════════════════════════════════════════
   SUBSCRIPTION MANAGEMENT
   ═══════════════════════════════════════════ */

function SubscriptionSection({
  tier,
  tierLabel,
  setTier,
  onUpgrade,
}: {
  tier: string;
  tierLabel: string;
  setTier: (t: "free" | "access" | "member" | "black") => void;
  onUpgrade: () => void;
}) {
  const [showManage, setShowManage] = useState(false);
  const [cancelStep, setCancelStep] = useState<"idle" | "confirm" | "done">("idle");

  const tierPricing: Record<string, string> = {
    free: "Free",
    access: "$99/year",
    member: "$249/quarter",
    black: "By Invitation",
  };

  // Calculate "active until" date
  const getActiveUntilDate = () => {
    const d = new Date();
    if (tier === "member") {
      // Quarterly — end of current quarter
      const quarterEnd = new Date(d.getFullYear(), Math.ceil((d.getMonth() + 1) / 3) * 3, 0);
      return quarterEnd.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
    }
    // Annual — end of current period
    const yearEnd = new Date(d.getFullYear() + 1, d.getMonth(), d.getDate());
    return yearEnd.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
  };

  const canDowngrade = tier === "member"; // member can downgrade to access

  const handleCancel = () => {
    setCancelStep("done");
  };

  const handleDowngrade = () => {
    setTier("access");
    setShowManage(false);
    setCancelStep("idle");
  };

  const handleKeep = () => {
    setCancelStep("idle");
    setShowManage(false);
  };

  const isPaid = tier !== "free";

  return (
    <section className="mb-10">
      <h2 className="text-xs tracking-[0.25em] uppercase text-charcoal/30 font-medium mb-5">Subscription</h2>

      <div className={`rounded-2xl border ${isPaid ? "bg-forest border-forest" : "bg-cream border-taupe/15"}`}>
        {/* Plan overview */}
        <div className="p-6">
          <div className="flex items-start justify-between">
            <div>
              <p className={`text-xs tracking-[0.2em] uppercase font-medium mb-1 ${isPaid ? "text-sage" : "text-sage"}`}>
                Current Plan
              </p>
              <h3 className={`font-serif text-xl mb-1 ${isPaid ? "text-bone" : "text-obsidian"}`}>
                {tierLabel}
              </h3>
              <p className={`text-sm ${isPaid ? "text-bone/50" : "text-charcoal/45"}`}>
                {tierPricing[tier]}
              </p>
            </div>
            {tier === "free" ? (
              <button
                onClick={onUpgrade}
                className="h-9 px-5 rounded-lg bg-forest text-bone text-xs font-medium tracking-wider uppercase hover:bg-forest-dark transition-colors duration-300 flex items-center btn-press cursor-pointer"
              >
                Upgrade
              </button>
            ) : (
              <button
                onClick={() => { setShowManage(!showManage); setCancelStep("idle"); }}
                className={`text-xs transition-colors duration-300 cursor-pointer ${
                  isPaid ? "text-bone/40 hover:text-bone/70" : "text-charcoal/35 hover:text-charcoal/60"
                }`}
              >
                {showManage ? "Close" : "Manage"}
              </button>
            )}
          </div>

          {isPaid && !showManage && (
            <div className="mt-4 pt-4 border-t border-bone/15">
              <p className="text-xs text-bone/35">
                Member since February 2026
              </p>
            </div>
          )}
        </div>

        {/* Expanded manage panel */}
        {showManage && isPaid && (
          <div className={`border-t ${isPaid ? "border-bone/10" : "border-taupe/15"}`}>
            {cancelStep === "idle" && (
              <div className="p-6 animate-tab-in">
                <div className="space-y-3">
                  {/* Upgrade option */}
                  {tier !== "black" && (
                    <button
                      onClick={() => { setShowManage(false); onUpgrade(); }}
                      className="block w-full text-left bg-bone/10 hover:bg-bone/15 rounded-xl p-4 transition-colors duration-300 cursor-pointer"
                    >
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-sm font-medium text-bone">Upgrade Plan</p>
                          <p className="text-xs text-bone/45 mt-0.5">
                            {tier === "access" ? "Unlock priority access, concierge support, and events" : "View available plans"}
                          </p>
                        </div>
                        <svg className="w-4 h-4 text-bone/40" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
                        </svg>
                      </div>
                    </button>
                  )}

                  {/* Cancel option */}
                  <button
                    onClick={() => setCancelStep("confirm")}
                    className="w-full text-left bg-bone/5 hover:bg-bone/10 rounded-xl p-4 transition-colors duration-300 cursor-pointer"
                  >
                    <p className="text-sm text-bone/50">Cancel Membership</p>
                  </button>
                </div>
              </div>
            )}

            {cancelStep === "confirm" && (
              <div className="p-6 animate-tab-in">
                <h4 className="font-serif text-lg text-bone mb-2">Before you go&hellip;</h4>
                <p className="text-sm text-bone/50 leading-relaxed mb-5">
                  We&rsquo;d hate to see you leave. Here&rsquo;s what you&rsquo;ll lose access to:
                </p>

                <ul className="space-y-2 mb-6">
                  <li className="flex items-center gap-2.5">
                    <svg className="w-4 h-4 text-bone/30 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                    <span className="text-sm text-bone/45">Reserve pricing on all products</span>
                  </li>
                  <li className="flex items-center gap-2.5">
                    <svg className="w-4 h-4 text-bone/30 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                    <span className="text-sm text-bone/45">Free 2-day shipping</span>
                  </li>
                  <li className="flex items-center gap-2.5">
                    <svg className="w-4 h-4 text-bone/30 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                    <span className="text-sm text-bone/45">Early and priority drop access</span>
                  </li>
                  {tier === "member" && (
                    <li className="flex items-center gap-2.5">
                      <svg className="w-4 h-4 text-bone/30 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                      </svg>
                      <span className="text-sm text-bone/45">Concierge support and invite-only events</span>
                    </li>
                  )}
                </ul>

                {/* Downgrade option */}
                {canDowngrade && (
                  <div className="bg-bone/10 rounded-xl p-5 mb-5">
                    <p className="text-sm font-medium text-bone mb-1">
                      Consider downgrading instead?
                    </p>
                    <p className="text-xs text-bone/45 leading-relaxed mb-4">
                      Keep Reserve pricing and free shipping with Reserve Access at just $99/year. A fraction of your current plan.
                    </p>
                    <button
                      onClick={handleDowngrade}
                      className="h-10 px-6 rounded-xl bg-bone text-forest text-xs font-medium tracking-wider uppercase hover:bg-bone-dark transition-colors duration-300 cursor-pointer btn-press"
                    >
                      Downgrade to Access: $99/yr
                    </button>
                  </div>
                )}

                <p className="text-xs text-bone/35 leading-relaxed mb-5">
                  If you cancel, your benefits remain active through{" "}
                  <span className="text-bone/55 font-medium">{getActiveUntilDate()}</span>.
                  You won&rsquo;t be charged again after that date.
                </p>

                <div className="flex items-center gap-3">
                  <button
                    onClick={handleKeep}
                    className="h-10 px-6 rounded-xl bg-bone text-forest text-sm font-medium tracking-wider uppercase hover:bg-bone-dark transition-colors duration-300 cursor-pointer btn-press"
                  >
                    Keep My Membership
                  </button>
                  <button
                    onClick={handleCancel}
                    className="text-xs text-bone/30 hover:text-bone/50 transition-colors duration-300 cursor-pointer underline underline-offset-2"
                  >
                    Confirm cancellation
                  </button>
                </div>
              </div>
            )}

            {cancelStep === "done" && (
              <div className="p-6 animate-tab-in">
                <div className="flex items-start gap-3 mb-4">
                  <svg className="w-5 h-5 text-bone/40 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <div>
                    <h4 className="text-sm font-medium text-bone mb-1">Cancellation confirmed</h4>
                    <p className="text-xs text-bone/45 leading-relaxed">
                      Your {tierLabel} benefits will remain active through{" "}
                      <span className="text-bone/60 font-medium">{getActiveUntilDate()}</span>.
                      You can resubscribe anytime from this page.
                    </p>
                  </div>
                </div>
                <button
                  onClick={handleKeep}
                  className="text-xs text-bone/35 hover:text-bone/55 transition-colors duration-300 cursor-pointer underline underline-offset-2"
                >
                  Changed your mind? Resubscribe
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

/* ═══════════════════════════════════════════
   TOGGLE SWITCH
   ═══════════════════════════════════════════ */

function ToggleSwitch() {
  const [on, setOn] = useState(true);
  return (
    <button
      onClick={() => setOn(!on)}
      className={`relative w-11 h-6 rounded-full transition-colors duration-300 cursor-pointer ${
        on ? "bg-forest" : "bg-taupe/30"
      }`}
      role="switch"
      aria-checked={on}
    >
      <div
        className={`absolute top-0.5 w-5 h-5 rounded-full bg-bone shadow-sm transition-transform duration-300 ${
          on ? "translate-x-[22px]" : "translate-x-0.5"
        }`}
      />
    </button>
  );
}
