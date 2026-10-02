"use client";
import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { useMembership } from "../context/MembershipContext";
import { LOOP_CHANGE_PLAN_OPTIONS } from "@/lib/membershipConfig";
import type { ShopifySubscription } from "../context/useShopifySubscriptions";

interface LoopSubscriptionRecord extends Record<string, unknown> {
  id: string;
  status: string;
  price?: number;
  nextBillingDateEpoch?: number;
}
type SubView = "main" | "change-plan" | "cancel";

const PLAN_OPTIONS = LOOP_CHANGE_PLAN_OPTIONS;

const CONNECTION_ERRORS: Record<string, string> = {
  client_configuration_error: "Shopify account connection needs a storefront configuration update. Please contact Mully; signing in again will not fix this.",
  connect_required: "Shopify sign-in returned, but we could not finish connecting your account. Please contact Mully if another attempt fails.",
  permissions_required: "Shopify sign-in succeeded, but subscription access is not enabled for this storefront. Please contact Mully.",
  account_mismatch: "That Shopify login does not match your MyMully account. Use the same email you used at checkout.",
  verify_email: "Please verify your MyMully email before connecting Shopify.",
  expired_callback: "The Shopify connection expired. Please connect again.",
  setup_required: "Subscription management is being configured. Please contact Mully.",
  shopify_unavailable: "Shopify could not complete the account connection. Please try again later.",
};

export function SubscriptionManagerModal({ open, onClose, provider = "loop" }: { open: boolean; onClose: () => void; provider?: "loop" | "shopify" }) {
  const { user, acceptShopifySubscriptions, refreshShopifySubscriptions } = useMembership();
  const [subscriptions, setSubscriptions] = useState<LoopSubscriptionRecord[]>([]);
  const [selectedSubscriptionId, setSelectedSubscriptionId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<SubView>("main");
  const [cancelReason, setCancelReason] = useState("");
  const [actionLoading, setActionLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [needsConnection, setNeedsConnection] = useState(false);
  const native = provider === "shopify";

  const loadSubscriptions = useCallback(async (token?: string) => {
    if (!user) return;
    const idToken = token ?? await user.getIdToken();
    const res = await fetch(native ? "/api/shopify-customer/subscriptions" : "/api/loop/subscription", {
      headers: { Authorization: `Bearer ${idToken}` },
    });

    const data = (await res.json()) as {
      subscriptions?: LoopSubscriptionRecord[];
      subscription?: LoopSubscriptionRecord | null;
      needsConnection?: boolean;
      error?: string;
    };
    setNeedsConnection(Boolean(data.needsConnection));
    if (!res.ok) {
      throw new Error(data.error || "Subscription data is temporarily unavailable.");
    }

    const nextSubscriptions =
      Array.isArray(data.subscriptions) && data.subscriptions.length > 0
        ? data.subscriptions
        : data.subscription
          ? [data.subscription]
          : [];

    setSubscriptions(nextSubscriptions);
    if (native) acceptShopifySubscriptions(nextSubscriptions as ShopifySubscription[]);
    setSelectedSubscriptionId((current) => {
      if (current && nextSubscriptions.some((subscription) => subscription.id === current)) {
        return current;
      }
      return nextSubscriptions[0]?.id ?? null;
    });
  }, [user, native, acceptShopifySubscriptions]);

  useEffect(() => {
    if (!open || !user) return;
    setLoading(true);
    setView("main");
    setCancelReason("");
    setError(null);
    setNeedsConnection(false);
    const callbackCode = native ? new URLSearchParams(window.location.search).get("shopify") : null;
    const callbackError = callbackCode && callbackCode !== "connected"
      ? CONNECTION_ERRORS[callbackCode] || "The Shopify connection could not be completed. Please try again."
      : null;
    loadSubscriptions()
      .catch((err) => {
        console.error("[SubManager] load failed:", err);
        setSubscriptions([]);
        setSelectedSubscriptionId(null);
        setError(callbackError || (err instanceof Error ? err.message : "Subscription data is temporarily unavailable."));
      })
      .finally(() => setLoading(false));
  }, [loadSubscriptions, native, open, user]);

  // Escape key
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open, onClose]);

  async function connectShopify() {
    if (!user || actionLoading) return;
    setActionLoading(true);
    try {
      const token = await user.getIdToken();
      const response = await fetch("/api/shopify-customer/connect", { method: "POST", headers: { Authorization: `Bearer ${token}` } });
      const payload = await response.json();
      if (!response.ok || !payload.url) throw new Error(payload.error || "Could not connect Shopify.");
      const url = new URL(payload.url);
      if (url.origin !== "https://shopify.com" || !url.pathname.startsWith("/authentication/56105304256/")) throw new Error("Invalid connection destination.");
      window.location.assign(url.toString());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not connect Shopify.");
      setActionLoading(false);
    }
  }

  async function callAction(path: string, body?: Record<string, unknown>) {
    if (!user || actionLoading) return false;
    setActionLoading(true);
    setError(null);
    try {
      const token = await user.getIdToken();
      const endpoint = native ? `/api/shopify-customer/subscriptions/${path.split("/").pop()}` : path;
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(body ?? {}),
          ...(selectedSubscriptionId ? native ? { contractId: selectedSubscriptionId } : { subscriptionId: selectedSubscriptionId } : {}),
        }),
      });
      if (!res.ok) {
        const payload = (await res.json().catch(() => null)) as { error?: string } | null;
        const message = payload?.error ?? "Subscription action failed.";
        console.error(`[SubManager] ${path} failed:`, message);
        setError(message);
        return false;
      }
      if (native) {
        const payload = await res.json();
        if (!payload.contract?.id || !payload.contract?.status) {
          setError("Shopify returned an incomplete update. Refresh to confirm the current status before trying again.");
          return false;
        }
        const updated = subscriptions.map(item => item.id === payload.contract.id
          ? { ...item, status: payload.contract.status } : item);
        setSubscriptions(updated);
        acceptShopifySubscriptions(updated as ShopifySubscription[]);
        // A failed readback must not turn a confirmed cancellation into a failure.
        void refreshShopifySubscriptions();
      } else {
        await loadSubscriptions(token);
      }
      return true;
    } catch (err) {
      console.error(`[SubManager] ${path} error:`, err);
      setError("We couldn’t confirm the update. Refresh to check your current status before trying again.");
      return false;
    } finally {
      setActionLoading(false);
    }
  }

  async function handleChangePlan(sellingPlanShopifyId: number) {
    await callAction("/api/loop/subscription/change-plan", { sellingPlanShopifyId });
    setView("main");
  }

  async function handleCancel() {
    if (await callAction("/api/loop/subscription/cancel", native ? undefined : { reason: cancelReason })) onClose();
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
        <div role="dialog" aria-modal="true" aria-label={titles[view]} className="relative w-full max-w-md max-h-[90dvh] overflow-y-auto rounded-2xl pointer-events-auto glass-modal-center">
          {/* Header */}
          <div className="flex items-center justify-between px-6 pt-6 pb-4 border-b border-taupe/10">
            <h2 className="font-serif text-xl text-obsidian">{titles[view]}</h2>
            <button
              onClick={onClose}
              aria-label="Close subscription management"
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
              <div className="space-y-4">
                <p role="alert" className="text-sm text-ember/75 py-4">{error}</p>
                {native && needsConnection ? <>
                  <p className="text-xs text-charcoal/60">Verify the same email you used at checkout. You’ll return here to manage your subscription.</p>
                  <button onClick={connectShopify} disabled={actionLoading} className="w-full min-h-11 rounded-xl bg-forest px-4 text-sm text-bone disabled:opacity-50">{actionLoading ? "Connecting…" : "Connect Shopify account"}</button>
                </> : <button className="text-sm underline underline-offset-4" onClick={() => {setError(null);setLoading(true);loadSubscriptions().catch(err=>setError(err.message)).finally(()=>setLoading(false));}}>Try again</button>}
              </div>
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
                    <span className="text-xs text-charcoal/55">{native ? sub.id.split("/").pop() : sub.id}</span>
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
                      <span className="text-sm font-medium text-obsidian">{native && typeof sub?.currency === "string" ? new Intl.NumberFormat("en-US", {style:"currency",currency:sub.currency}).format(price) : `$${price}`}</span>
                    </div>
                  )}
                  {nextBilling && (!native || isActive) && (
                    <div className="flex items-center justify-between px-4 py-3">
                      <span className="text-xs text-charcoal/40">Next billing</span>
                      <span className="text-sm text-obsidian">{nextBilling}</span>
                    </div>
                  )}
                </div>

                {/* Actions */}
                <div className="space-y-2.5">
                  {isCancelled && native ? (
                    <div className="space-y-3">
                      <p className="text-sm text-charcoal/60">This subscription is cancelled. There are no further automatic renewals.</p>
                      {subscriptions.every(item => item.status === "CANCELLED") && <>
                        <Link href="/shop#outfit" className="flex min-h-11 items-center justify-center rounded-xl bg-forest px-4 text-sm font-medium text-bone transition-colors hover:bg-forest-dark">Start a new subscription</Link>
                        <p className="text-xs leading-relaxed text-charcoal/60">Choose a new outfit and review current pricing at checkout. A new subscription requires a new purchase.</p>
                      </>}
                    </div>
                  ) : isCancelled ? (
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
                      {!native && <button
                        onClick={() => setView("change-plan")}
                        className="w-full h-10 rounded-xl border border-taupe/20 text-sm text-charcoal/60 hover:border-charcoal/25 hover:text-charcoal/80 transition-all cursor-pointer"
                      >
                        Change Plan
                      </button>}
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
                <p className="text-xs text-charcoal/60">{native ? "Cancel future automatic renewals? Any already-paid orders are unaffected." : "Please let us know why you’re cancelling:"}</p>
                {!native && <textarea
                  value={cancelReason}
                  onChange={(e) => setCancelReason(e.target.value)}
                  placeholder="Reason for cancelling..."
                  rows={3}
                  className="w-full px-3 py-2.5 rounded-xl border border-taupe/20 bg-cream text-sm text-obsidian placeholder-charcoal/25 focus:border-forest/30 focus:ring-2 focus:ring-forest/10 transition-all resize-none"
                />}
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
