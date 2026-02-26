"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMembership, type FitProfile, type StoreCreditState, type SubscriptionsState } from "../context/MembershipContext";
import { SlideCart } from "../components/SlideCart";
import { UpgradeModal, PillButton, FIT_SHIRT_SIZES, FIT_GLOVE_HANDS, FIT_GLOVE_SIZES, FIT_WAIST_SIZES, FIT_SHOE_SIZES, FIT_PANTS_INSEAMS, FIT_SHORTS_INSEAMS } from "../components/UpgradeModal";

/* ═══════════════════════════════════════════
   ACCOUNT PAGE — Redesigned
   Clean, low cognitive-load layout
   ═══════════════════════════════════════════ */

export default function AccountPage() {
  const router = useRouter();
  const {
    isSignedIn,
    authLoading,
    email,
    setEmail,
    username,
    setUsername,
    tier,
    tierLabel,
    setTier,
    cartCount,
    setCartOpen,
    fitProfile,
    setFitProfile,
    signOut,
    storeCredit,
    subscriptions,
    refreshStoreCredit,
    refreshSubscriptionStatus,
  } = useMembership();

  const [upgradeOpen, setUpgradeOpen] = useState(false);

  useEffect(() => {
    if (!authLoading && !isSignedIn) {
      router.replace("/login");
    }
  }, [authLoading, isSignedIn, router]);

  useEffect(() => {
    if (isSignedIn) {
      void refreshStoreCredit();
      void refreshSubscriptionStatus();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSignedIn]);

  if (authLoading || !isSignedIn) {
    return (
      <div className="min-h-screen bg-bone flex items-center justify-center">
        <div className="w-5 h-5 border-2 border-forest/30 border-t-forest rounded-full animate-spin" />
      </div>
    );
  }

  const isPaid = tier === "access" || tier === "member" || tier === "black";

  return (
    <div className="min-h-screen bg-bone">
      <AccountHeader cartCount={cartCount} onCartOpen={() => setCartOpen(true)} />

      <main className="pt-24 pb-20 px-5 md:px-12">
        <div className="max-w-xl mx-auto">
          {/* ── Back link ── */}
          <Link
            href="/dashboard"
            className="inline-flex items-center gap-1.5 text-xs text-charcoal/35 hover:text-forest transition-colors duration-300 mb-6"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
            </svg>
            Dashboard
          </Link>

          {/* ── Page title + tier badge ── */}
          <div className="flex items-center gap-3 mb-10">
            <h1 className="font-serif text-2xl md:text-3xl text-obsidian">Account</h1>
            <span className={`text-[10px] tracking-[0.15em] uppercase font-medium px-2.5 py-1 rounded-full ${
              isPaid ? "bg-forest/10 text-forest" : "bg-taupe/15 text-charcoal/40"
            }`}>
              {tierLabel}
            </span>
          </div>

          {/* ═══ PROFILE ═══ */}
          <ProfileSection
            username={username}
            email={email}
            onSaveUsername={setUsername}
            onSaveEmail={setEmail}
          />

          {/* ═══ FIT PROFILE ═══ */}
          <FitProfileSection fitProfile={fitProfile} onSave={setFitProfile} />

          {/* ═══ MEMBERSHIP ═══ */}
          <SubscriptionSection
            tier={tier}
            tierLabel={tierLabel}
            setTier={setTier}
            onUpgrade={() => setUpgradeOpen(true)}
            subscriptions={subscriptions}
          />

          {/* ═══ WALLET ═══ */}
          <WalletSection storeCredit={storeCredit} />

          {/* ═══ NOTIFICATIONS ═══ */}
          <NotificationSection />

          {/* ═══ ORDERS ═══ */}
          <section className="mb-10">
            <SectionLabel>Orders</SectionLabel>
            <div className="rounded-xl border border-taupe/12 bg-cream p-6 text-center">
              <p className="text-sm text-charcoal/40 mb-1">No orders yet</p>
              <p className="text-xs text-charcoal/25 mb-4">Your history will appear here after your first purchase.</p>
              <Link
                href="/dashboard"
                className="inline-flex items-center justify-center h-9 px-5 rounded-lg border border-taupe/20 text-xs font-medium tracking-wider uppercase text-charcoal/45 hover:border-forest/30 hover:text-forest transition-all duration-300"
              >
                Browse Shop
              </Link>
            </div>
          </section>

          {/* ═══ ACCOUNT ACTIONS ═══ */}
          <div className="pt-6 border-t border-taupe/10 flex items-center gap-5">
            <button
              onClick={() => void signOut()}
              className="text-xs text-charcoal/30 hover:text-charcoal/55 transition-colors duration-300 cursor-pointer"
            >
              Sign Out
            </button>
            <button className="text-xs text-ember/40 hover:text-ember transition-colors duration-300 cursor-pointer">
              Delete Account
            </button>
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
          <p className="text-xs text-bone/35">
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
   HEADER
   ═══════════════════════════════════════════ */

function AccountHeader({ cartCount, onCartOpen }: { cartCount: number; onCartOpen: () => void }) {
  return (
    <header className="fixed top-0 left-0 right-0 z-50 bg-bone/90 backdrop-blur-md border-b border-taupe/15">
      <div className="max-w-7xl mx-auto px-5 md:px-12 flex items-center justify-between h-14">
        <Link href="/" className="flex items-center gap-2 text-forest">
          <svg viewBox="0 0 1002 540" fill="currentColor" className="h-4.5 w-auto" aria-hidden="true"><path d="M0,0 H1002 V540 H0 Z M50,1 L998,269 L50,538 Z" fillRule="evenodd" /></svg>
          <span className="font-serif text-xl font-bold tracking-wide">mully.</span>
        </Link>
        <div className="flex items-center gap-4">
          <button
            onClick={onCartOpen}
            className="relative text-forest hover:text-forest-dark transition-colors duration-300 cursor-pointer p-1"
            aria-label="Cart"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 10.5V6a3.75 3.75 0 10-7.5 0v4.5m11.356-1.993l1.263 12c.07.665-.45 1.243-1.119 1.243H4.25a1.125 1.125 0 01-1.12-1.243l1.264-12A1.125 1.125 0 015.513 7.5h12.974c.576 0 1.059.435 1.119 1.007zM8.625 10.5a.375.375 0 11-.75 0 .375.375 0 01.75 0zm7.5 0a.375.375 0 11-.75 0 .375.375 0 01.75 0z" />
            </svg>
            {cartCount > 0 && (
              <span className="absolute -top-0.5 -right-0.5 w-4 h-4 rounded-full bg-ember text-white text-[10px] font-medium flex items-center justify-center">
                {cartCount}
              </span>
            )}
          </button>
          <Link href="/dashboard" className="text-forest hover:text-forest-dark transition-colors duration-300 p-1" aria-label="Dashboard">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25A2.25 2.25 0 0113.5 18v-2.25z" />
            </svg>
          </Link>
        </div>
      </div>
    </header>
  );
}

/* ═══════════════════════════════════════════
   SECTION LABEL
   ═══════════════════════════════════════════ */

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="text-[11px] tracking-[0.25em] uppercase text-sage font-medium mb-4">{children}</h2>
  );
}

/* ═══════════════════════════════════════════
   PROFILE SECTION
   Consolidated username + email in one card
   ═══════════════════════════════════════════ */

function ProfileSection({
  username,
  email,
  onSaveUsername,
  onSaveEmail,
}: {
  username: string;
  email: string;
  onSaveUsername: (v: string) => void;
  onSaveEmail: (v: string) => void;
}) {
  const [editingField, setEditingField] = useState<"username" | "email" | null>(null);
  const [tempValue, setTempValue] = useState("");

  function startEdit(field: "username" | "email") {
    setTempValue(field === "username" ? username : email);
    setEditingField(field);
  }

  function save() {
    if (!editingField) return;
    if (editingField === "username") onSaveUsername(tempValue);
    else onSaveEmail(tempValue);
    setEditingField(null);
  }

  function cancel() {
    setEditingField(null);
  }

  return (
    <section className="mb-8">
      <SectionLabel>Profile</SectionLabel>
      <div className="rounded-xl border border-taupe/12 bg-cream overflow-hidden">
        {/* Username row */}
        <div className="px-5 py-4 flex items-center justify-between gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-[11px] text-charcoal/35 mb-0.5">Username</p>
            {editingField === "username" ? (
              <div className="flex items-center gap-2 mt-1">
                <input
                  type="text"
                  value={tempValue}
                  onChange={(e) => setTempValue(e.target.value)}
                  autoFocus
                  className="h-9 px-3 rounded-lg bg-bone border border-taupe/25 text-sm text-obsidian focus:border-forest/40 focus:ring-2 focus:ring-forest/10 transition-all duration-300 w-full max-w-[220px]"
                  onKeyDown={(e) => { if (e.key === "Enter") save(); if (e.key === "Escape") cancel(); }}
                />
                <button onClick={save} className="h-9 px-3.5 rounded-lg bg-forest text-bone text-xs font-medium tracking-wider uppercase hover:bg-forest-dark transition-colors duration-300 cursor-pointer shrink-0">Save</button>
                <button onClick={cancel} className="text-xs text-charcoal/35 hover:text-charcoal/55 transition-colors duration-300 cursor-pointer shrink-0">Cancel</button>
              </div>
            ) : (
              <p className="text-sm text-obsidian font-medium truncate">{username || "Not set"}</p>
            )}
          </div>
          {editingField !== "username" && (
            <button onClick={() => startEdit("username")} className="text-xs text-forest/60 hover:text-forest transition-colors duration-300 cursor-pointer shrink-0">Edit</button>
          )}
        </div>

        <div className="h-px bg-taupe/10 mx-5" />

        {/* Email row */}
        <div className="px-5 py-4 flex items-center justify-between gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-[11px] text-charcoal/35 mb-0.5">Email</p>
            {editingField === "email" ? (
              <div className="flex items-center gap-2 mt-1">
                <input
                  type="email"
                  value={tempValue}
                  onChange={(e) => setTempValue(e.target.value)}
                  autoFocus
                  className="h-9 px-3 rounded-lg bg-bone border border-taupe/25 text-sm text-obsidian focus:border-forest/40 focus:ring-2 focus:ring-forest/10 transition-all duration-300 w-full max-w-[260px]"
                  onKeyDown={(e) => { if (e.key === "Enter") save(); if (e.key === "Escape") cancel(); }}
                />
                <button onClick={save} className="h-9 px-3.5 rounded-lg bg-forest text-bone text-xs font-medium tracking-wider uppercase hover:bg-forest-dark transition-colors duration-300 cursor-pointer shrink-0">Save</button>
                <button onClick={cancel} className="text-xs text-charcoal/35 hover:text-charcoal/55 transition-colors duration-300 cursor-pointer shrink-0">Cancel</button>
              </div>
            ) : (
              <p className="text-sm text-obsidian font-medium truncate">{email || "Not set"}</p>
            )}
          </div>
          {editingField !== "email" && (
            <button onClick={() => startEdit("email")} className="text-xs text-forest/60 hover:text-forest transition-colors duration-300 cursor-pointer shrink-0">Edit</button>
          )}
        </div>
      </div>
    </section>
  );
}

/* ═══════════════════════════════════════════
   FIT PROFILE SECTION
   States: empty → editing → viewing
   ═══════════════════════════════════════════ */

function FitProfileSection({ fitProfile, onSave }: { fitProfile: FitProfile; onSave: (p: FitProfile) => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<FitProfile>(fitProfile);

  const hasAny = Object.values(fitProfile).some((v) => v !== "");
  const filledCount = Object.values(fitProfile).filter((v) => v !== "").length;
  const totalFields = 7;
  const isComplete = filledCount === totalFields;

  function startEditing() {
    setDraft({ ...fitProfile });
    setEditing(true);
  }

  function handleSave() {
    onSave(draft);
    setEditing(false);
  }

  function handleCancel() {
    setDraft({ ...fitProfile });
    setEditing(false);
  }

  function updateDraft(key: keyof FitProfile, value: string) {
    setDraft((prev) => ({
      ...prev,
      [key]: prev[key] === value ? "" : value,
      // Clear glove size if hand changes
      ...(key === "gloveHand" && prev.gloveHand !== value ? { gloveSize: "" } : {}),
    }));
  }

  /* ── EMPTY STATE ── */
  if (!hasAny && !editing) {
    return (
      <section className="mb-8">
        <SectionLabel>Fit Profile</SectionLabel>
        <div className="rounded-xl border border-dashed border-taupe/20 bg-cream/60 p-6 text-center">
          <div className="w-11 h-11 rounded-xl bg-forest/8 flex items-center justify-center mx-auto mb-3">
            <svg className="w-5.5 h-5.5 text-forest" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />
            </svg>
          </div>
          <h3 className="text-sm font-medium text-obsidian mb-1">Set up your fit profile</h3>
          <p className="text-xs text-charcoal/40 leading-relaxed mb-5 max-w-xs mx-auto">
            Help us get your sizing right. We&rsquo;ll use this for curated drops, member boxes, and product recommendations.
          </p>
          <button
            onClick={startEditing}
            className="inline-flex items-center justify-center h-10 px-6 rounded-xl bg-forest text-bone text-xs font-medium tracking-wider uppercase hover:bg-forest-dark transition-colors duration-300 btn-press cursor-pointer"
          >
            Add Preferences
          </button>
        </div>
      </section>
    );
  }

  /* ── EDITING STATE ── */
  if (editing) {
    return (
      <section className="mb-8">
        <SectionLabel>Fit Profile</SectionLabel>
        <div className="rounded-xl border border-forest/15 bg-cream p-5 space-y-6 animate-fade-up">
          {/* Tops */}
          <div>
            <h3 className="text-xs font-medium text-obsidian tracking-wide uppercase mb-2.5">Shirt</h3>
            <div className="flex flex-wrap gap-1.5">
              {FIT_SHIRT_SIZES.map((s) => (
                <PillButton key={s} label={s} active={draft.shirtSize === s} onClick={() => updateDraft("shirtSize", s)} />
              ))}
            </div>
          </div>

          <div>
            <h3 className="text-xs font-medium text-obsidian tracking-wide uppercase mb-2.5">Glove hand</h3>
            <div className="flex flex-wrap gap-1.5 mb-2">
              {FIT_GLOVE_HANDS.map((h) => (
                <PillButton key={h} label={h} active={draft.gloveHand === h} onClick={() => updateDraft("gloveHand", h)} />
              ))}
            </div>
            {draft.gloveHand && (
              <>
                <h3 className="text-xs font-medium text-obsidian tracking-wide uppercase mb-2.5 mt-4">Glove size</h3>
                <div className="flex flex-wrap gap-1.5 animate-fade-up">
                  {FIT_GLOVE_SIZES.map((s) => (
                    <PillButton key={s} label={s} active={draft.gloveSize === s} onClick={() => updateDraft("gloveSize", s)} />
                  ))}
                </div>
              </>
            )}
          </div>

          <div className="h-px bg-taupe/12" />

          {/* Bottoms */}
          <div>
            <h3 className="text-xs font-medium text-obsidian tracking-wide uppercase mb-2.5">Waist</h3>
            <div className="flex flex-wrap gap-1.5">
              {FIT_WAIST_SIZES.map((s) => (
                <PillButton key={s} label={s} active={draft.waistSize === s} onClick={() => updateDraft("waistSize", s)} />
              ))}
            </div>
          </div>

          <div>
            <h3 className="text-xs font-medium text-obsidian tracking-wide uppercase mb-2.5">Pants inseam</h3>
            <div className="flex flex-wrap gap-1.5">
              {FIT_PANTS_INSEAMS.map((s) => (
                <PillButton key={s} label={s} active={draft.pantsInseam === s} onClick={() => updateDraft("pantsInseam", s)} />
              ))}
            </div>
          </div>

          <div>
            <h3 className="text-xs font-medium text-obsidian tracking-wide uppercase mb-2.5">Shorts inseam</h3>
            <div className="flex flex-wrap gap-1.5">
              {FIT_SHORTS_INSEAMS.map((s) => (
                <PillButton key={s} label={s} active={draft.shortsInseam === s} onClick={() => updateDraft("shortsInseam", s)} />
              ))}
            </div>
          </div>

          <div>
            <h3 className="text-xs font-medium text-obsidian tracking-wide uppercase mb-2.5">Shoe size</h3>
            <div className="flex flex-wrap gap-1.5">
              {FIT_SHOE_SIZES.map((s) => (
                <PillButton key={s} label={s} active={draft.shoeSize === s} onClick={() => updateDraft("shoeSize", s)} />
              ))}
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-3 pt-2">
            <button
              onClick={handleSave}
              className="h-10 px-6 rounded-xl bg-forest text-bone text-xs font-medium tracking-wider uppercase hover:bg-forest-dark transition-colors duration-300 btn-press cursor-pointer"
            >
              Save Profile
            </button>
            <button
              onClick={handleCancel}
              className="text-xs text-charcoal/40 hover:text-charcoal/60 transition-colors duration-300 cursor-pointer"
            >
              Cancel
            </button>
          </div>
        </div>
      </section>
    );
  }

  /* ── VIEW STATE (has preferences) ── */
  return (
    <section className="mb-8">
      <SectionLabel>Fit Profile</SectionLabel>
      <div className="rounded-xl border border-taupe/12 bg-cream overflow-hidden">
        {/* Summary grid */}
        <div className="px-5 py-4">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              {isComplete ? (
                <span className="flex items-center gap-1 text-[10px] tracking-wide text-forest/70 font-medium">
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                  Complete
                </span>
              ) : (
                <span className="text-[10px] tracking-wide text-charcoal/35 font-medium">
                  {filledCount}/{totalFields} set
                </span>
              )}
            </div>
            <button
              onClick={startEditing}
              className="text-xs text-forest/60 hover:text-forest transition-colors duration-300 cursor-pointer"
            >
              Edit
            </button>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-3">
            <FitField label="Shirt" value={fitProfile.shirtSize} />
            <FitField label="Glove" value={fitProfile.gloveHand && fitProfile.gloveSize ? `${fitProfile.gloveHand}, ${fitProfile.gloveSize}` : fitProfile.gloveHand || fitProfile.gloveSize} />
            <FitField label="Waist" value={fitProfile.waistSize} />
            <FitField label="Pants" value={fitProfile.pantsInseam} />
            <FitField label="Shorts" value={fitProfile.shortsInseam} />
            <FitField label="Shoe" value={fitProfile.shoeSize} />
          </div>
        </div>

        {/* Complete prompt */}
        {!isComplete && (
          <>
            <div className="h-px bg-taupe/10 mx-5" />
            <button
              onClick={startEditing}
              className="w-full px-5 py-3 text-left flex items-center gap-2 text-xs text-forest/70 hover:text-forest hover:bg-forest/[0.03] transition-all duration-300 cursor-pointer"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
              </svg>
              Complete your fit profile
            </button>
          </>
        )}
      </div>
    </section>
  );
}

function FitField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[10px] text-charcoal/30 mb-0.5">{label}</p>
      {value ? (
        <p className="text-sm text-obsidian font-medium">{value}</p>
      ) : (
        <p className="text-sm text-charcoal/20">&mdash;</p>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════
   NOTIFICATION SECTION
   ═══════════════════════════════════════════ */

function NotificationSection() {
  return (
    <section className="mb-8">
      <SectionLabel>Notifications</SectionLabel>
      <div className="rounded-xl border border-taupe/12 bg-cream overflow-hidden">
        <div className="px-5 py-3.5 flex items-center justify-between">
          <div>
            <p className="text-sm text-obsidian">Email</p>
            <p className="text-[11px] text-charcoal/35 mt-0.5">Drops, community, and order updates</p>
          </div>
          <ToggleSwitch />
        </div>
        <div className="h-px bg-taupe/10 mx-5" />
        <div className="px-5 py-3.5 flex items-center justify-between">
          <div>
            <p className="text-sm text-obsidian">SMS</p>
            <p className="text-[11px] text-charcoal/35 mt-0.5">Priority alerts and shipping</p>
          </div>
          <ToggleSwitch />
        </div>
      </div>
    </section>
  );
}

/* ═══════════════════════════════════════════
   SUBSCRIPTION SECTION
   Shows tier info + Loop-driven action button.
   ═══════════════════════════════════════════ */

function SubscriptionSection({
  tier,
  tierLabel,
  onUpgrade,
  subscriptions,
}: {
  tier: string;
  tierLabel: string;
  setTier: (t: "free" | "access" | "member" | "black") => void;
  onUpgrade: () => void;
  subscriptions: SubscriptionsState | null;
}) {
  const tierPricing: Record<string, string> = {
    free: "Free",
    access: "$99/year",
    member: "$249/quarter",
    black: "By Invitation",
  };

  const isPaid = tier !== "free";

  return (
    <section className="mb-8">
      <SectionLabel>Membership</SectionLabel>
      <div className={`rounded-xl border overflow-hidden ${isPaid ? "bg-forest border-forest" : "bg-cream border-taupe/12"}`}>
        {/* Plan overview */}
        <div className="px-5 py-4">
          <div className="flex items-start justify-between">
            <div>
              <h3 className={`font-serif text-lg mb-0.5 ${isPaid ? "text-bone" : "text-obsidian"}`}>
                {tierLabel}
              </h3>
              <p className={`text-sm ${isPaid ? "text-bone/45" : "text-charcoal/40"}`}>
                {tierPricing[tier]}
              </p>
            </div>
            {tier === "free" && (
              <button
                onClick={onUpgrade}
                className="h-9 px-5 rounded-lg bg-forest text-bone text-xs font-medium tracking-wider uppercase hover:bg-forest-dark transition-colors duration-300 btn-press cursor-pointer"
              >
                Upgrade
              </button>
            )}
          </div>
        </div>

        {/* Loop subscription action */}
        <div className={`border-t px-5 py-4 ${isPaid ? "border-bone/10" : "border-taupe/10"}`}>
          {subscriptions === null ? (
            <div className="h-9 w-44 rounded-lg bg-taupe/15 animate-pulse" />
          ) : subscriptions.mullybox_active ? (
            <a
              href={subscriptions.manage_url ?? "#"}
              target="_blank"
              rel="noopener noreferrer"
              className={`inline-flex items-center justify-center h-9 px-5 rounded-lg border text-xs font-medium tracking-wider uppercase transition-all duration-300 ${
                isPaid
                  ? "border-bone/20 text-bone hover:bg-bone/10"
                  : "border-forest/20 text-forest hover:bg-forest/5"
              }`}
            >
              Manage Subscription
            </a>
          ) : (
            <a
              href={subscriptions.next_unblock_url ?? "#"}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center justify-center h-9 px-5 rounded-lg bg-forest text-bone text-xs font-medium tracking-wider uppercase hover:bg-forest-dark transition-all duration-300 btn-press"
            >
              Next Unblock
            </a>
          )}
        </div>
      </div>
    </section>
  );
}

/* ═══════════════════════════════════════════
   WALLET SECTION
   ═══════════════════════════════════════════ */

function WalletSection({ storeCredit }: { storeCredit: StoreCreditState | null }) {
  return (
    <section className="mb-8">
      <SectionLabel>Wallet</SectionLabel>
      <div className="rounded-xl border border-taupe/12 bg-cream overflow-hidden">
        <div className="px-5 py-4 flex items-center justify-between">
          <div>
            <p className="text-[11px] text-charcoal/35 mb-0.5">Store Credit</p>
            {storeCredit === null ? (
              <div className="h-5 w-20 rounded bg-taupe/15 animate-pulse" />
            ) : (
              <p className="text-sm font-medium text-obsidian">
                ${(storeCredit.balance_cents / 100).toFixed(2)}{" "}
                <span className="text-xs text-charcoal/30 font-normal">{storeCredit.currency}</span>
              </p>
            )}
          </div>
        </div>
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
      className={`relative w-10 h-[22px] rounded-full transition-colors duration-300 cursor-pointer shrink-0 ${
        on ? "bg-forest" : "bg-taupe/30"
      }`}
      role="switch"
      aria-checked={on}
    >
      <div
        className={`absolute top-[2px] w-[18px] h-[18px] rounded-full bg-bone shadow-sm transition-transform duration-300 ${
          on ? "translate-x-[20px]" : "translate-x-[2px]"
        }`}
      />
    </button>
  );
}
