"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useMembership } from "../context/MembershipContext";

/* ═══════════════════════════════════════════
   ONBOARDING — Preferences → Plan Selection
   ═══════════════════════════════════════════ */

const HANDICAP_OPTIONS = [
  "Scratch or better",
  "1 – 5",
  "6 – 10",
  "11 – 15",
  "16 – 20",
  "21 – 30",
  "30+",
  "I don't keep one",
];

const INTEREST_OPTIONS = [
  { id: "gear", label: "Gear & Equipment", icon: GearIcon },
  { id: "apparel", label: "Apparel & Style", icon: ApparelIcon },
  { id: "experiences", label: "Curated Experiences", icon: ExperienceIcon },
  { id: "training", label: "Training & Coaching", icon: TrainingIcon },
  { id: "community", label: "Community & Events", icon: CommunityIcon },
];

export default function OnboardingPage() {
  const router = useRouter();
  const { email, setEmail, username, setUsername, setTier, signIn } = useMembership();
  const [step, setStep] = useState(1);

  // Step 1 state
  const [editingEmail, setEditingEmail] = useState(false);
  const [handicap, setHandicap] = useState("");
  const [interests, setInterests] = useState<string[]>([]);
  const toggleInterest = (id: string) => {
    setInterests((prev) =>
      prev.includes(id) ? prev.filter((i) => i !== id) : [...prev, id]
    );
  };

  const canAdvance = handicap || interests.length > 0;

  return (
    <div className="min-h-screen bg-bone">
      {/* Header */}
      <header className="fixed top-0 left-0 right-0 z-50 bg-bone/90 backdrop-blur-md border-b border-taupe/20">
        <div className="max-w-7xl mx-auto px-6 md:px-12 flex items-center justify-center h-16">
          <span className="flex items-center gap-2 text-forest">
            <svg viewBox="0 0 1002 540" fill="currentColor" className="h-5 w-auto" aria-hidden="true"><path d="M0,0 H1002 V540 H0 Z M50,1 L998,269 L50,538 Z" fillRule="evenodd" /></svg>
            <span className="font-serif text-2xl font-bold tracking-wide">mully.</span>
          </span>
        </div>
      </header>

      <main className="pt-28 pb-24 px-6 md:px-12">
        <div className="max-w-2xl mx-auto">
          {/* Progress */}
          <div className="flex items-center gap-3 mb-12">
            <div className={`h-1 flex-1 rounded-full transition-colors duration-500 ${step >= 1 ? "bg-forest" : "bg-taupe/25"}`} />
            <div className={`h-1 flex-1 rounded-full transition-colors duration-500 ${step >= 2 ? "bg-forest" : "bg-taupe/25"}`} />
          </div>

          {/* Step 1: Preferences */}
          {step === 1 && (
            <div className="animate-fade-up">
              <span className="inline-flex items-center gap-2 text-xs tracking-[0.3em] uppercase text-sage font-medium mb-4">
                <span className="w-6 h-px bg-sage/50" />
                Step 1 of 2
                <span className="w-6 h-px bg-sage/50" />
              </span>
              <h1 className="font-serif text-3xl md:text-4xl text-obsidian leading-tight mb-3">
                Tell us about your game.
              </h1>
              <p className="text-base text-charcoal/55 leading-relaxed mb-8">
                We&rsquo;ll personalize your Reserve experience based on your preferences.
              </p>

              {/* Email — pre-filled and greyed out, with option to edit */}
              <div className="mb-8">
                <h3 className="text-sm font-medium text-obsidian tracking-wide mb-4">
                  Your email
                </h3>
                {email && !editingEmail ? (
                  <div className="flex items-center gap-3 max-w-sm">
                    <div className="flex-1 h-11 px-4 rounded-xl bg-taupe/10 border border-taupe/15 flex items-center">
                      <span className="text-sm text-charcoal/50">{email}</span>
                    </div>
                    <button
                      onClick={() => setEditingEmail(true)}
                      className="text-xs text-charcoal/40 hover:text-forest transition-colors duration-300 cursor-pointer whitespace-nowrap"
                    >
                      Edit
                    </button>
                  </div>
                ) : (
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    onBlur={() => email && setEditingEmail(false)}
                    placeholder="you@example.com"
                    autoFocus={editingEmail}
                    className="w-full max-w-sm h-11 px-4 rounded-xl bg-cream border border-taupe/25 text-obsidian text-sm placeholder:text-charcoal/30 focus:border-forest/40 focus:ring-2 focus:ring-forest/10 transition-all duration-300"
                  />
                )}
              </div>

              {/* Username — for community */}
              <div className="mb-10">
                <h3 className="text-sm font-medium text-obsidian tracking-wide mb-2">
                  Choose a username
                </h3>
                <p className="text-xs text-charcoal/40 mb-4">This is how you&rsquo;ll appear in the community.</p>
                <input
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="e.g. jack_m"
                  className="w-full max-w-sm h-11 px-4 rounded-xl bg-cream border border-taupe/25 text-obsidian text-sm placeholder:text-charcoal/30 focus:border-forest/40 focus:ring-2 focus:ring-forest/10 transition-all duration-300"
                />
              </div>

              {/* Handicap */}
              <div className="mb-10">
                <h3 className="text-sm font-medium text-obsidian tracking-wide mb-4">
                  What&rsquo;s your handicap?
                </h3>
                <div className="flex flex-wrap gap-2">
                  {HANDICAP_OPTIONS.map((opt) => (
                    <button
                      key={opt}
                      onClick={() => setHandicap(opt)}
                      className={`px-4 py-2.5 rounded-xl text-sm transition-all duration-300 cursor-pointer border ${
                        handicap === opt
                          ? "bg-forest text-bone border-forest"
                          : "bg-cream border-taupe/25 text-charcoal/70 hover:border-forest/40"
                      }`}
                    >
                      {opt}
                    </button>
                  ))}
                </div>
              </div>

              {/* Interests */}
              <div className="mb-10">
                <h3 className="text-sm font-medium text-obsidian tracking-wide mb-4">
                  What are you most interested in?
                </h3>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                  {INTEREST_OPTIONS.map(({ id, label, icon: Icon }) => (
                    <button
                      key={id}
                      onClick={() => toggleInterest(id)}
                      className={`flex items-center gap-3 px-4 py-4 rounded-xl text-sm transition-all duration-300 cursor-pointer border text-left ${
                        interests.includes(id)
                          ? "bg-forest text-bone border-forest"
                          : "bg-cream border-taupe/25 text-charcoal/70 hover:border-forest/40"
                      }`}
                    >
                      <Icon active={interests.includes(id)} />
                      <span>{label}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Continue */}
              <div className="flex items-center justify-between">
                <button
                  onClick={() => setStep(2)}
                  className="text-sm text-charcoal/40 hover:text-charcoal/60 transition-colors duration-300 cursor-pointer"
                >
                  Skip for now
                </button>
                <button
                  onClick={() => setStep(2)}
                  disabled={!canAdvance}
                  className={`h-12 px-10 rounded-xl text-sm font-medium tracking-wider uppercase transition-all duration-300 cursor-pointer btn-press ${
                    canAdvance
                      ? "bg-forest text-bone hover:bg-forest-dark"
                      : "bg-taupe/25 text-charcoal/30 cursor-not-allowed"
                  }`}
                >
                  Continue
                </button>
              </div>
            </div>
          )}

          {/* Step 2: Plan Selection */}
          {step === 2 && (
            <div className="animate-fade-up">
              <span className="inline-flex items-center gap-2 text-xs tracking-[0.3em] uppercase text-sage font-medium mb-4">
                <span className="w-6 h-px bg-sage/50" />
                Step 2 of 2
                <span className="w-6 h-px bg-sage/50" />
              </span>
              <h1 className="font-serif text-3xl md:text-4xl text-obsidian leading-tight mb-3">
                Choose your membership.
              </h1>
              <p className="text-base text-charcoal/55 leading-relaxed mb-10">
                Start free or unlock the full Reserve experience. Upgrade anytime.
              </p>

              <div className="space-y-5">
                {/* ── Reserve Access ── */}
                <div className="bg-cream rounded-2xl p-7 md:p-8 border border-taupe/20">
                  <span className="text-[11px] tracking-[0.25em] uppercase text-forest font-medium">
                    Reserve Access
                  </span>
                  <div className="mt-2 mb-5">
                    <span className="font-serif text-3xl text-obsidian">$99</span>
                    <span className="text-charcoal/40 text-sm ml-1">/year</span>
                  </div>
                  <div className="border-t border-taupe/12 pt-5">
                    <ul className="grid grid-cols-2 gap-x-6 gap-y-2.5 mb-6">
                      <FeatureItem text="Reserve pricing unlocked" />
                      <FeatureItem text="Early access to drops" />
                      <FeatureItem text="USGA Handicap (coming soon)" />
                      <FeatureItem text="Partner benefit access" />
                      <FeatureItem text="Free 2-day shipping" />
                    </ul>
                    <button
                      onClick={() => { signIn(); setTier("access"); router.push("/dashboard"); }}
                      className="h-12 px-10 rounded-xl bg-forest text-bone text-sm font-medium tracking-wider uppercase hover:bg-forest-dark transition-all duration-300 cursor-pointer btn-press"
                    >
                      Join Reserve Access
                    </button>
                  </div>
                </div>

                {/* ── Reserve Member (Featured) ── */}
                <div className="relative">
                  {/* Badge — outside overflow-hidden so it never clips */}
                  <div className="absolute -top-3 left-7 z-20">
                    <span className="inline-block bg-sage text-bone text-[10px] tracking-[0.2em] uppercase font-semibold px-4 py-1.5 rounded-full shadow-sm">
                      Most Popular
                    </span>
                  </div>
                  <div className="bg-forest rounded-2xl overflow-hidden relative shadow-xl shadow-forest/20 ring-1 ring-sage/20">
                    {/* Decorative box image — atmospheric bg, top-left */}
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src="https://cdn.shopify.com/s/files/1/0561/0530/4256/files/Untitled_design_17.png?v=1771516197"
                      alt=""
                      aria-hidden="true"
                      draggable={false}
                      className="absolute -top-4 -left-4 w-44 h-44 object-cover object-right-bottom opacity-[0.18] -rotate-6 pointer-events-none select-none"
                    />
                    <div className="relative z-10 p-7 md:p-8">
                      <span className="text-[11px] tracking-[0.25em] uppercase text-sage font-medium">
                        Reserve Member
                      </span>
                      <div className="mt-2 mb-5">
                        <span className="font-serif text-3xl text-bone">$249</span>
                        <span className="text-bone/45 text-sm ml-1">/quarter</span>
                      </div>
                      <div className="border-t border-bone/10 pt-5">
                        <ul className="grid grid-cols-2 gap-x-6 gap-y-2.5 mb-6">
                          <FeatureItem text="Everything in Access" light />
                          <FeatureItem text="Guaranteed access windows" light />
                          <FeatureItem text="Priority release access" light />
                          <FeatureItem text="Concierge booking support" light />
                          <FeatureItem text="Invite-only events" light />
                        </ul>
                        <button
                          onClick={() => { signIn(); setTier("member"); router.push("/dashboard"); }}
                          className="h-12 px-10 rounded-xl bg-bone text-forest text-sm font-medium tracking-wider uppercase hover:bg-bone-dark transition-all duration-300 cursor-pointer btn-press"
                        >
                          Join Reserve Member
                        </button>
                      </div>
                    </div>
                  </div>
                </div>

                {/* ── Reserve Black ── */}
                <div className="bg-cream rounded-2xl p-7 md:p-8 border border-taupe/20 relative overflow-hidden">
                  <div className="absolute top-0 left-0 right-0 h-1 bg-obsidian" />
                  <span className="text-[11px] tracking-[0.25em] uppercase text-charcoal/50 font-medium">
                    Reserve Black
                  </span>
                  <div className="mt-2 mb-5">
                    <span className="font-serif text-3xl text-obsidian">Invite Only</span>
                  </div>
                  <div className="border-t border-taupe/12 pt-5">
                    <ul className="grid grid-cols-2 gap-x-6 gap-y-2.5 mb-6">
                      <FeatureItem text="Everything in Member" />
                      <FeatureItem text="$1,000 quarterly credit" />
                      <FeatureItem text="Personal stylist" />
                      <FeatureItem text="Concierge phone line" />
                      <FeatureItem text="Invite-only experiences" />
                    </ul>
                    <div className="inline-block h-12 px-10 leading-[3rem] rounded-xl border border-charcoal/15 text-charcoal/40 text-sm font-medium tracking-wider uppercase cursor-default">
                      By Invitation
                    </div>
                  </div>
                </div>
              </div>

              {/* Reassurance */}
              <p className="text-center text-sm text-charcoal/40 mt-8">
                Start free &mdash; upgrade or cancel anytime. No commitments.
              </p>

              {/* Start Free */}
              <div className="mt-4 text-center">
                <button
                  onClick={() => { signIn(); setTier("free"); router.push("/dashboard"); }}
                  className="text-sm text-charcoal/40 hover:text-charcoal/60 underline underline-offset-4 decoration-charcoal/20 hover:decoration-charcoal/40 transition-all duration-300 cursor-pointer"
                >
                  Or start free
                </button>
              </div>

              {/* Back */}
              <div className="mt-8">
                <button
                  onClick={() => setStep(1)}
                  className="text-sm text-charcoal/40 hover:text-charcoal/60 transition-colors duration-300 cursor-pointer flex items-center gap-1.5"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
                  </svg>
                  Back to preferences
                </button>
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

/* ═══════════════════════════════════════════
   COMPONENTS
   ═══════════════════════════════════════════ */

function FeatureItem({ text, light }: { text: string; light?: boolean }) {
  return (
    <li className="flex items-center gap-2">
      <svg
        className={`w-3.5 h-3.5 shrink-0 ${light ? "text-sage" : "text-forest"}`}
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={2.5}
      >
        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
      </svg>
      <span className={`text-sm ${light ? "text-bone/65" : "text-charcoal/65"}`}>{text}</span>
    </li>
  );
}

/* ═══════════════════════════════════════════
   ICONS
   ═══════════════════════════════════════════ */

function GearIcon({ active }: { active: boolean }) {
  return (
    <svg className={`w-5 h-5 shrink-0 ${active ? "text-bone/70" : "text-sage"}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M11.42 15.17l-5.386 3.107A1.531 1.531 0 014.5 17.3V3.75A1.5 1.5 0 016 2.25h12a1.5 1.5 0 011.5 1.5v13.55a1.531 1.531 0 01-1.534.977L12.58 15.17a1.5 1.5 0 00-1.16 0z" />
    </svg>
  );
}

function ApparelIcon({ active }: { active: boolean }) {
  return (
    <svg className={`w-5 h-5 shrink-0 ${active ? "text-bone/70" : "text-sage"}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 10.5V6a3.75 3.75 0 10-7.5 0v4.5m11.356-1.993l1.263 12c.07.665-.45 1.243-1.119 1.243H4.25a1.125 1.125 0 01-1.12-1.243l1.264-12A1.125 1.125 0 015.513 7.5h12.974c.576 0 1.059.435 1.119 1.007zM8.625 10.5a.375.375 0 11-.75 0 .375.375 0 01.75 0zm7.5 0a.375.375 0 11-.75 0 .375.375 0 01.75 0z" />
    </svg>
  );
}

function ExperienceIcon({ active }: { active: boolean }) {
  return (
    <svg className={`w-5 h-5 shrink-0 ${active ? "text-bone/70" : "text-sage"}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M11.48 3.499a.562.562 0 011.04 0l2.125 5.111a.563.563 0 00.475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 00-.182.557l1.285 5.385a.562.562 0 01-.84.61l-4.725-2.885a.563.563 0 00-.586 0L6.982 20.54a.562.562 0 01-.84-.61l1.285-5.386a.562.562 0 00-.182-.557l-4.204-3.602a.563.563 0 01.321-.988l5.518-.442a.563.563 0 00.475-.345L11.48 3.5z" />
    </svg>
  );
}

function TrainingIcon({ active }: { active: boolean }) {
  return (
    <svg className={`w-5 h-5 shrink-0 ${active ? "text-bone/70" : "text-sage"}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M4.26 10.147a60.438 60.438 0 00-.491 6.347A48.627 48.627 0 0112 20.904a48.627 48.627 0 018.232-4.41 60.46 60.46 0 00-.491-6.347m-15.482 0a50.57 50.57 0 00-2.658-.813A59.905 59.905 0 0112 3.493a59.902 59.902 0 0110.399 5.84c-.896.248-1.783.52-2.658.814m-15.482 0A50.697 50.697 0 0112 13.489a50.702 50.702 0 017.74-3.342M6.75 15a.75.75 0 100-1.5.75.75 0 000 1.5zm0 0v-3.675A55.378 55.378 0 0112 8.443m-7.007 11.55A5.981 5.981 0 006.75 15.75v-1.5" />
    </svg>
  );
}

function CommunityIcon({ active }: { active: boolean }) {
  return (
    <svg className={`w-5 h-5 shrink-0 ${active ? "text-bone/70" : "text-sage"}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M18 18.72a9.094 9.094 0 003.741-.479 3 3 0 00-4.682-2.72m.94 3.198l.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0112 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 016 18.719m12 0a5.971 5.971 0 00-.941-3.197m0 0A5.995 5.995 0 0012 12.75a5.995 5.995 0 00-5.058 2.772m0 0a3 3 0 00-4.681 2.72 8.986 8.986 0 003.74.477m.94-3.197a5.971 5.971 0 00-.94 3.197M15 6.75a3 3 0 11-6 0 3 3 0 016 0zm6 3a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0zm-13.5 0a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0z" />
    </svg>
  );
}
