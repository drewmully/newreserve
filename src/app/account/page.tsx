"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMembership, type FitProfile, type StoreCreditState, type SubscriptionsState } from "../context/MembershipContext";
import { trackEvent } from "@/lib/tracking";
import { LOOP_CHANGE_PLAN_OPTIONS } from "@/lib/membershipConfig";

interface OrderLineItem {
  name: string;
  quantity: number;
  price: string;
}

interface OrderSummary {
  order_number: number;
  name: string;
  created_at: string;
  total_price: string;
  currency: string;
  financial_status: string;
  fulfillment_status: string;
  line_items: OrderLineItem[];
}

interface OrdersState {
  items: OrderSummary[];
  source: "loading" | "shopify" | "no_customer" | "unavailable";
}

interface LoopSubscriptionRecord extends Record<string, unknown> {
  id: string;
  status: string;
  price?: number;
  nextBillingDateEpoch?: number;
}
import { SlideCart } from "../components/SlideCart";
import { UpgradeModal, PillButton, FIT_SHIRT_SIZES, FIT_GLOVE_HANDS, FIT_GLOVE_SIZES, FIT_WAIST_SIZES, FIT_SHOE_SIZES, FIT_PANTS_INSEAMS, FIT_SHORTS_INSEAMS } from "../components/UpgradeModal";
import { ClubhouseNav, ClubhouseBottomNav } from "../components/ClubhouseNav";

/* ═══════════════════════════════════════════
   ACCOUNT PAGE — Redesigned
   Clean, low cognitive-load layout
   ═══════════════════════════════════════════ */

export default function AccountPage() {
  const router = useRouter();
  const {
    user,
    isSignedIn,
    authLoading,
    email,
    username,
    saveUsername,
    tier,
    tierLabel,
    setTier,
    fitProfile,
    setFitProfile,
    signOut,
    storeCredit,
    subscriptions,
    refreshStoreCredit,
    refreshSubscriptionStatus,
    messagingPreferences,
    saveMessagingPreferences,
  } = useMembership();

  const [orders, setOrders] = useState<OrdersState>({
    items: [],
    source: "loading",
  });

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

  useEffect(() => {
    if (!isSignedIn) return;
    void trackEvent("wallet_viewed", {
      properties: {
        page: "account",
      },
    });
  }, [isSignedIn]);

  useEffect(() => {
    if (!isSignedIn || !user) return;
    setOrders({ items: [], source: "loading" });
    user.getIdToken().then((token) =>
      fetch("/api/shopify/orders", {
        headers: { Authorization: `Bearer ${token}` },
      })
    ).then((res) => (res.ok ? res.json() : { orders: [], source: "unavailable" as const }))
      .then((data: { orders: OrderSummary[]; source?: OrdersState["source"] }) => {
        setOrders({
          items: data.orders ?? [],
          source: data.source ?? "shopify",
        });
      })
      .catch(() => setOrders({ items: [], source: "unavailable" }));
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
      <ClubhouseNav />

      <main className="pt-48 pb-20 px-5 md:px-12">
        <div className="max-w-xl mx-auto">
          {/* ── Back link ── */}
          <Link
            href="/home"
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
            onSaveUsername={saveUsername}
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
          <NotificationSection
            preferences={messagingPreferences}
            onSave={saveMessagingPreferences}
          />

          {/* ═══ ORDERS ═══ */}
          <OrdersSection orders={orders} />

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

      <ClubhouseBottomNav />

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
}: {
  username: string;
  email: string;
  onSaveUsername: (v: string) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [tempValue, setTempValue] = useState("");

  function startEdit() {
    setTempValue(username);
    setEditing(true);
  }

  function save() {
    void onSaveUsername(tempValue);
    setEditing(false);
  }

  function cancel() {
    setEditing(false);
  }

  return (
    <section className="mb-8">
      <SectionLabel>Profile</SectionLabel>
      <div className="rounded-xl border border-taupe/12 bg-cream overflow-hidden">
        {/* Username row */}
        <div className="px-5 py-4 flex items-center justify-between gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-[11px] text-charcoal/35 mb-0.5">Username</p>
            {editing ? (
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
          {!editing && (
            <button onClick={startEdit} className="text-xs text-forest/60 hover:text-forest transition-colors duration-300 cursor-pointer shrink-0">Edit</button>
          )}
        </div>

        <div className="h-px bg-taupe/10 mx-5" />

        {/* Email row — read-only */}
        <div className="px-5 py-4">
          <p className="text-[11px] text-charcoal/35 mb-0.5">Email</p>
          <p className="text-sm text-obsidian font-medium truncate">{email || "Not set"}</p>
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

function NotificationSection({
  preferences,
  onSave,
}: {
  preferences: { email_marketing: boolean; sms_marketing: boolean };
  onSave: (prefs: { email_marketing: boolean; sms_marketing: boolean }) => Promise<void>;
}) {
  return (
    <section className="mb-8">
      <SectionLabel>Notifications</SectionLabel>
      <div className="rounded-xl border border-taupe/12 bg-cream overflow-hidden">
        <div className="px-5 py-3.5 flex items-center justify-between">
          <div>
            <p className="text-sm text-obsidian">Email</p>
            <p className="text-[11px] text-charcoal/35 mt-0.5">Drops, community, and order updates</p>
          </div>
          <ToggleSwitch
            checked={preferences.email_marketing}
            onChange={(v) => void onSave({ ...preferences, email_marketing: v })}
          />
        </div>
        <div className="h-px bg-taupe/10 mx-5" />
        <div className="px-5 py-3.5 flex items-center justify-between">
          <div>
            <p className="text-sm text-obsidian">SMS</p>
            <p className="text-[11px] text-charcoal/35 mt-0.5">Priority alerts and shipping</p>
          </div>
          <ToggleSwitch
            checked={preferences.sms_marketing}
            onChange={(v) => void onSave({ ...preferences, sms_marketing: v })}
          />
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
  const [manageOpen, setManageOpen] = useState(false);

  const tierPricing: Record<string, string> = {
    free: "Free",
    access: "$99/year",
    member: "$249/quarter",
    black: "By Invitation",
  };

  const isPaid = tier !== "free";
  const isActive = subscriptions?.status.toUpperCase() === "ACTIVE";
  const isStale = subscriptions?.isStale === true;

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

        {/* Loop subscription status */}
        <div className={`border-t px-5 py-4 ${isPaid ? "border-bone/10" : "border-taupe/10"}`}>
          {subscriptions === null ? (
            <div className="space-y-2.5">
              <div className="h-5 w-20 rounded-full bg-taupe/15 animate-pulse" />
              <div className="h-9 w-44 rounded-lg bg-taupe/15 animate-pulse" />
            </div>
          ) : (
            <div className="space-y-3">
              {/* Status badge + count */}
              <div className="flex items-center gap-2.5">
                {isActive ? (
                  <span className="inline-flex items-center gap-1.5 text-[10px] tracking-[0.12em] uppercase font-medium px-2.5 py-1 rounded-full bg-green-100 text-green-700">
                    <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
                    Active
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1.5 text-[10px] tracking-[0.12em] uppercase font-medium px-2.5 py-1 rounded-full bg-taupe/15 text-charcoal/40">
                    <span className="w-1.5 h-1.5 rounded-full bg-charcoal/25" />
                    {subscriptions.status || "Inactive"}
                  </span>
                )}
                {subscriptions.total_subscription_count > 0 && (
                  <span className={`text-xs ${isPaid ? "text-bone/45" : "text-charcoal/35"}`}>
                    {subscriptions.total_subscription_count}{" "}
                    subscription{subscriptions.total_subscription_count !== 1 ? "s" : ""}
                  </span>
                )}
              </div>

              {isStale && (
                <p className={`text-xs leading-relaxed ${isPaid ? "text-bone/55" : "text-charcoal/40"}`}>
                  Showing your last known membership state while Loop reconnects.
                </p>
              )}

              {/* Action button */}
              <button
                onClick={() => setManageOpen(true)}
                className={`inline-flex items-center justify-center h-9 px-5 rounded-lg border text-xs font-medium tracking-wider uppercase transition-all duration-300 cursor-pointer ${
                  isPaid
                    ? "border-bone/20 text-bone hover:bg-bone/10"
                    : "border-forest/20 text-forest hover:bg-forest/5"
                }`}
              >
                Manage Subscription
              </button>
            </div>
          )}
        </div>
      </div>

      <SubscriptionManagerModal open={manageOpen} onClose={() => setManageOpen(false)} />
    </section>
  );
}

/* ═══════════════════════════════════════════
   SUBSCRIPTION MANAGER MODAL
   ═══════════════════════════════════════════ */

type SubView = "main" | "change-plan" | "cancel";

const PLAN_OPTIONS = LOOP_CHANGE_PLAN_OPTIONS;

function SubscriptionManagerModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { user } = useMembership();
  const [subscriptions, setSubscriptions] = useState<LoopSubscriptionRecord[]>([]);
  const [selectedSubscriptionId, setSelectedSubscriptionId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<SubView>("main");
  const [cancelReason, setCancelReason] = useState("");
  const [actionLoading, setActionLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadSubscriptions = useCallback(async (token?: string) => {
    if (!user) return;
    const idToken = token ?? await user.getIdToken();
    const res = await fetch("/api/loop/subscription", {
      headers: { Authorization: `Bearer ${idToken}` },
    });

    if (!res.ok) {
      throw new Error("Subscription data is temporarily unavailable.");
    }

    const data = (await res.json()) as {
      subscriptions?: LoopSubscriptionRecord[];
      subscription?: LoopSubscriptionRecord | null;
    };

    const nextSubscriptions =
      Array.isArray(data.subscriptions) && data.subscriptions.length > 0
        ? data.subscriptions
        : data.subscription
          ? [data.subscription]
          : [];

    setSubscriptions(nextSubscriptions);
    setSelectedSubscriptionId((current) => {
      if (current && nextSubscriptions.some((subscription) => subscription.id === current)) {
        return current;
      }
      return nextSubscriptions[0]?.id ?? null;
    });
  }, [user]);

  useEffect(() => {
    if (!open || !user) return;
    setLoading(true);
    setView("main");
    setCancelReason("");
    setError(null);
    loadSubscriptions()
      .catch((err) => {
        console.error("[SubManager] load failed:", err);
        setSubscriptions([]);
        setSelectedSubscriptionId(null);
        setError("Subscription data is temporarily unavailable.");
      })
      .finally(() => setLoading(false));
  }, [loadSubscriptions, open, user]);

  // Escape key
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open, onClose]);

  async function callAction(path: string, body?: Record<string, unknown>) {
    if (!user) return;
    setActionLoading(true);
    setError(null);
    try {
      const token = await user.getIdToken();
      const res = await fetch(path, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(body ?? {}),
          ...(selectedSubscriptionId ? { subscriptionId: selectedSubscriptionId } : {}),
        }),
      });
      if (!res.ok) {
        const payload = (await res.json().catch(() => null)) as { error?: string } | null;
        const message = payload?.error ?? "Subscription action failed.";
        console.error(`[SubManager] ${path} failed:`, message);
        setError(message);
        return;
      }
      await loadSubscriptions(token);
    } catch (err) {
      console.error(`[SubManager] ${path} error:`, err);
      setError("Subscription action failed. Please try again.");
    } finally {
      setActionLoading(false);
    }
  }

  async function handleChangePlan(sellingPlanShopifyId: number) {
    await callAction("/api/loop/subscription/change-plan", { sellingPlanShopifyId });
    setView("main");
  }

  async function handleCancel() {
    await callAction("/api/loop/subscription/cancel", { reason: cancelReason });
    onClose();
  }

  if (!open) return null;

  const sub =
    subscriptions.find((subscription) => subscription.id === selectedSubscriptionId) ??
    subscriptions[0] ??
    null;
  const status = sub?.status ?? "";
  const isActive = status === "ACTIVE";
  const isPaused = status === "PAUSED";
  const isCancelled = status === "CANCELLED";
  const price = typeof sub?.price === "number" ? sub.price : undefined;
  const nextBillingEpoch =
    typeof sub?.nextBillingDateEpoch === "number"
      ? sub.nextBillingDateEpoch
      : undefined;
  const nextBilling = nextBillingEpoch
    ? new Date(nextBillingEpoch * 1000).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
    : null;

  const titles: Record<SubView, string> = {
    main: "Manage Subscription",
    "change-plan": "Change Plan",
    cancel: "Cancel Subscription",
  };

  return (
    <div className="fixed inset-0 z-[95]">
      <div className="absolute inset-0 bg-obsidian/50 backdrop-blur-sm" onClick={onClose} />
      <div className="absolute inset-0 flex items-center justify-center p-4 sm:p-6 pointer-events-none">
        <div className="relative w-full max-w-md rounded-2xl pointer-events-auto glass-modal-center overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between px-6 pt-6 pb-4 border-b border-taupe/10">
            <h2 className="font-serif text-xl text-obsidian">{titles[view]}</h2>
            <button
              onClick={onClose}
              className="w-8 h-8 rounded-full bg-taupe/10 hover:bg-taupe/20 flex items-center justify-center transition-colors cursor-pointer"
            >
              <svg className="w-4 h-4 text-charcoal/50" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          <div className="px-6 py-5">
            {loading ? (
              <div className="space-y-3 py-2">
                {[40, 32, 56].map((w) => (
                  <div key={w} className={`h-4 w-${w} bg-taupe/15 rounded animate-pulse`} />
                ))}
              </div>
            ) : error ? (
              <p className="text-sm text-ember/75 py-4">{error}</p>
            ) : !sub ? (
              <p className="text-sm text-charcoal/40 py-4">No subscription found.</p>
            ) : view === "main" ? (
              <div className="space-y-5">
                {subscriptions.length > 1 && (
                  <div className="space-y-2">
                    <p className="text-xs text-charcoal/40">Select the subscription you want to manage.</p>
                    <div className="flex flex-wrap gap-2">
                      {subscriptions.map((subscription, index) => (
                        <button
                          key={subscription.id}
                          onClick={() => setSelectedSubscriptionId(subscription.id)}
                          className={`rounded-full border px-3 py-1.5 text-[11px] tracking-wide transition-colors cursor-pointer ${
                            subscription.id === sub.id
                              ? "border-forest/35 bg-forest/5 text-forest"
                              : "border-taupe/20 text-charcoal/45 hover:border-forest/25 hover:text-forest"
                          }`}
                        >
                          {`Subscription ${index + 1} · ${subscription.status}`}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Details */}
                <div className="rounded-xl bg-cream border border-taupe/12 divide-y divide-taupe/10">
                  <div className="flex items-center justify-between px-4 py-3">
                    <span className="text-xs text-charcoal/40">Subscription ID</span>
                    <span className="text-xs text-charcoal/55">{sub.id}</span>
                  </div>
                  <div className="flex items-center justify-between px-4 py-3">
                    <span className="text-xs text-charcoal/40">Status</span>
                    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                      isActive ? "bg-forest/10 text-forest"
                      : isPaused ? "bg-amber-100 text-amber-700"
                      : "bg-taupe/15 text-charcoal/40"
                    }`}>{status}</span>
                  </div>
                  {price != null && (
                    <div className="flex items-center justify-between px-4 py-3">
                      <span className="text-xs text-charcoal/40">Price</span>
                      <span className="text-sm font-medium text-obsidian">${price}</span>
                    </div>
                  )}
                  {nextBilling && (
                    <div className="flex items-center justify-between px-4 py-3">
                      <span className="text-xs text-charcoal/40">Next billing</span>
                      <span className="text-sm text-obsidian">{nextBilling}</span>
                    </div>
                  )}
                </div>

                {/* Actions */}
                <div className="space-y-2.5">
                  {isCancelled ? (
                    <button
                      onClick={() => callAction("/api/loop/subscription/reactivate")}
                      disabled={actionLoading}
                      className="w-full h-10 rounded-xl bg-forest text-bone text-sm font-medium hover:bg-forest-dark transition-all cursor-pointer btn-press disabled:opacity-50"
                    >
                      {actionLoading ? "..." : "Reactivate Subscription"}
                    </button>
                  ) : (
                    <>
                      {isActive && (
                        <button
                          onClick={() => callAction("/api/loop/subscription/pause")}
                          disabled={actionLoading}
                          className="w-full h-10 rounded-xl border border-taupe/20 text-sm text-charcoal/60 hover:border-charcoal/25 hover:text-charcoal/80 transition-all cursor-pointer disabled:opacity-50"
                        >
                          {actionLoading ? "..." : "Pause Subscription"}
                        </button>
                      )}
                      {isPaused && (
                        <button
                          onClick={() => callAction("/api/loop/subscription/resume")}
                          disabled={actionLoading}
                          className="w-full h-10 rounded-xl bg-forest text-bone text-sm font-medium hover:bg-forest-dark transition-all cursor-pointer btn-press disabled:opacity-50"
                        >
                          {actionLoading ? "..." : "Resume Subscription"}
                        </button>
                      )}
                      <button
                        onClick={() => setView("change-plan")}
                        className="w-full h-10 rounded-xl border border-taupe/20 text-sm text-charcoal/60 hover:border-charcoal/25 hover:text-charcoal/80 transition-all cursor-pointer"
                      >
                        Change Plan
                      </button>
                      <button
                        onClick={() => setView("cancel")}
                        className="w-full h-10 rounded-xl text-sm text-ember/60 hover:text-ember transition-colors cursor-pointer"
                      >
                        Cancel Subscription
                      </button>
                    </>
                  )}
                </div>
              </div>
            ) : view === "change-plan" ? (
              <div className="space-y-4">
                <p className="text-xs text-charcoal/40">Select a new plan:</p>
                <div className="space-y-2">
                  {PLAN_OPTIONS.map((plan) => (
                    <button
                      key={plan.sellingPlanShopifyId}
                      onClick={() => handleChangePlan(plan.sellingPlanShopifyId)}
                      disabled={actionLoading}
                      className="w-full rounded-xl border border-taupe/20 px-4 py-3 text-left hover:border-forest/30 hover:bg-forest/[0.02] transition-all cursor-pointer disabled:opacity-50"
                    >
                      <p className="text-sm font-medium text-obsidian">{plan.label}</p>
                      <p className="text-xs text-charcoal/40 mt-0.5">{plan.price}</p>
                    </button>
                  ))}
                </div>
                <button onClick={() => setView("main")} className="text-xs text-charcoal/35 hover:text-charcoal/55 transition-colors cursor-pointer">
                  ← Back
                </button>
              </div>
            ) : (
              <div className="space-y-4">
                <p className="text-xs text-charcoal/40">Please let us know why you&rsquo;re cancelling:</p>
                <textarea
                  value={cancelReason}
                  onChange={(e) => setCancelReason(e.target.value)}
                  placeholder="Reason for cancelling..."
                  rows={3}
                  className="w-full px-3 py-2.5 rounded-xl border border-taupe/20 bg-cream text-sm text-obsidian placeholder-charcoal/25 focus:border-forest/30 focus:ring-2 focus:ring-forest/10 transition-all resize-none"
                />
                <div className="flex items-center gap-3">
                  <button
                    onClick={handleCancel}
                    disabled={actionLoading}
                    className="h-10 px-5 rounded-xl bg-ember text-white text-sm font-medium hover:bg-ember/90 transition-all cursor-pointer btn-press disabled:opacity-50"
                  >
                    {actionLoading ? "..." : "Confirm Cancel"}
                  </button>
                  <button onClick={() => setView("main")} className="text-xs text-charcoal/35 hover:text-charcoal/55 transition-colors cursor-pointer">
                    Back
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
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
              <div className="space-y-1">
                <p className="text-sm font-medium text-obsidian">
                  ${(storeCredit.balance_cents / 100).toFixed(2)}{" "}
                  <span className="text-xs text-charcoal/30 font-normal">{storeCredit.currency}</span>
                </p>
                {storeCredit.isStale && (
                  <p className="text-xs text-charcoal/40">
                    Showing your last synced balance while Shopify reconnects.
                  </p>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

/* ═══════════════════════════════════════════
   ORDERS SECTION
   ═══════════════════════════════════════════ */

function formatOrderDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  } catch {
    return iso;
  }
}

function OrderStatusBadge({ status }: { status: string }) {
  const label = status.replace(/_/g, " ");
  const isGood = ["paid", "partially_paid"].includes(status.toLowerCase());
  return (
    <span
      className={`inline-flex text-[9px] tracking-[0.1em] uppercase font-medium px-2 py-0.5 rounded-full ${
        isGood
          ? "bg-forest/10 text-forest"
          : "bg-taupe/15 text-charcoal/40"
      }`}
    >
      {label}
    </span>
  );
}

function OrdersSection({ orders }: { orders: OrdersState }) {
  if (orders.source === "loading") {
    return (
      <section className="mb-10">
        <SectionLabel>Orders</SectionLabel>
        <div className="rounded-xl border border-taupe/12 bg-cream overflow-hidden divide-y divide-taupe/10">
          {[1, 2, 3].map((i) => (
            <div key={i} className="px-5 py-4 space-y-2">
              <div className="flex items-center justify-between">
                <div className="h-4 w-20 rounded bg-taupe/15 animate-pulse" />
                <div className="h-3 w-24 rounded bg-taupe/10 animate-pulse" />
              </div>
              <div className="h-3 w-2/3 rounded bg-taupe/10 animate-pulse" />
            </div>
          ))}
        </div>
      </section>
    );
  }

  if (orders.source === "unavailable") {
    return (
      <section className="mb-10">
        <SectionLabel>Orders</SectionLabel>
        <div className="rounded-xl border border-taupe/12 bg-cream p-6 text-center">
          <p className="text-sm text-charcoal/45 mb-1">Order history is temporarily unavailable</p>
          <p className="text-xs text-charcoal/30">
            We couldn&rsquo;t reach Shopify just now. Try again in a moment.
          </p>
        </div>
      </section>
    );
  }

  if (orders.items.length === 0) {
    return (
      <section className="mb-10">
        <SectionLabel>Orders</SectionLabel>
        <div className="rounded-xl border border-taupe/12 bg-cream p-6 text-center">
          <p className="text-sm text-charcoal/40 mb-1">No orders yet</p>
          <p className="text-xs text-charcoal/25 mb-4">
            Your history will appear here after your first purchase.
          </p>
          <Link
            href="/home"
            className="inline-flex items-center justify-center h-9 px-5 rounded-lg border border-taupe/20 text-xs font-medium tracking-wider uppercase text-charcoal/45 hover:border-forest/30 hover:text-forest transition-all duration-300"
          >
            Browse Shop
          </Link>
        </div>
      </section>
    );
  }

  return (
    <section className="mb-10">
      <SectionLabel>Orders</SectionLabel>
      <div className="rounded-xl border border-taupe/12 bg-cream overflow-hidden">
        {orders.items.map((order, i) => (
          <div key={order.order_number}>
            {i > 0 && <div className="h-px bg-taupe/10 mx-5" />}
            <div className="px-5 py-4">
              <div className="flex items-center justify-between mb-1.5">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-obsidian">{order.name}</span>
                  <OrderStatusBadge status={order.financial_status} />
                </div>
                <span className="text-sm font-medium text-obsidian">
                  ${parseFloat(order.total_price).toFixed(2)}{" "}
                  <span className="text-xs text-charcoal/30 font-normal">{order.currency}</span>
                </span>
              </div>
              <div className="flex items-start justify-between gap-3">
                <p className="text-xs text-charcoal/40 leading-relaxed">
                  {order.line_items.map((li) => `${li.name} ×${li.quantity}`).join(", ")}
                </p>
                <span className="text-[11px] text-charcoal/30 shrink-0">
                  {formatOrderDate(order.created_at)}
                </span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

/* ═══════════════════════════════════════════
   TOGGLE SWITCH
   ═══════════════════════════════════════════ */

function ToggleSwitch({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      onClick={() => onChange(!checked)}
      className={`relative w-10 h-[22px] rounded-full transition-colors duration-300 cursor-pointer shrink-0 ${
        checked ? "bg-forest" : "bg-taupe/30"
      }`}
      role="switch"
      aria-checked={checked}
    >
      <div
        className={`absolute top-[2px] w-[18px] h-[18px] rounded-full bg-bone shadow-sm transition-transform duration-300 ${
          checked ? "translate-x-[20px]" : "translate-x-[2px]"
        }`}
      />
    </button>
  );
}
