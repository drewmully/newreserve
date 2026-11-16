"use client";

import { useState, useEffect, Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useMembership } from "../context/MembershipContext";
import { ShopPageShell } from "../shop/components/ShopPageShell";
import {
  RESOLUTION_LABELS,
  RETURN_REASONS,
  RETURN_RULES,
  type OrderReturnType,
  type ReturnResolution,
} from "@/lib/returns/policy";

/* ═══════════════════════════════════════════
   RETURNS FLOW — 4 Steps
   1. Order Lookup
   2. Select Items to Return
   3. Review & Submit
   4. Confirmation
   ═══════════════════════════════════════════ */

/* ── Types ── */

interface ReturnableItem {
  lineItemId: string;
  sku: string;
  title: string;
  variantTitle: string;
  quantity: number;
  returnableQty: number;
  price: number;
  image: string;
  isChildSku: boolean;
  parentSku?: string;
  isFinalSale?: boolean;
  alreadyReturned?: boolean;
  ineligibleReason?: "final_sale" | "not_fulfilled" | "already_returned" | "outside_window" | null;
  returnDeadline?: string | null;
  /** Server-computed: refund vs store credit if requested now. */
  resolution?: ReturnResolution | null;
  resolutionUntil?: string | null;
}

interface OrderPolicy {
  windowDays: number;
  exchangeAllowed: boolean;
}

/** Overall outcome of a selection: all refund, all credit, or both. */
type ResolutionSummary = ReturnResolution | "mixed";

function summarizeResolutions(list: Array<ReturnResolution | "mixed" | null | undefined>): ResolutionSummary {
  const set = new Set(list.filter((r): r is ReturnResolution | "mixed" => !!r));
  if (set.has("mixed") || set.size > 1) return "mixed";
  return set.values().next().value ?? "store_credit";
}

const SUMMARY_LABELS: Record<ResolutionSummary, { short: string; title: string }> = {
  refund_original_payment: { short: "refund", title: "Estimated refund" },
  store_credit: { short: "store credit", title: "Estimated store credit" },
  mixed: { short: "refund and store credit", title: "Estimated refund and store credit" },
};

interface OrderData {
  orderId: string;
  orderName: string;
  orderDate: string;
  items: ReturnableItem[];
  /** Signed, short-lived proof of order ownership from /api/returns/lookup. */
  returnToken: string;
  orderType?: OrderReturnType;
  policy?: OrderPolicy;
  /** Return shipping fee computed server-side. */
  returnShippingCost?: number;
}

/** API error with an optional machine-readable code. */
class ReturnsApiError extends Error {
  code?: string;
  constructor(message: string, code?: string) {
    super(message);
    this.code = code;
  }
}

const TOKEN_ERROR_CODES = new Set(["return_token_expired", "return_token_invalid"]);

function policyFor(order: OrderData): OrderPolicy {
  if (order.policy) return order.policy;
  const rules = RETURN_RULES[order.orderType ?? "pro_shop"];
  return { windowDays: rules.windowDays, exchangeAllowed: rules.exchangeAllowed };
}

function ineligibleLabel(item: ReturnableItem): string {
  switch (item.ineligibleReason) {
    case "final_sale":
      return "Final sale";
    case "already_returned":
      return "Already returned";
    case "not_fulfilled":
      return "Not shipped yet";
    case "outside_window":
      return "Return window closed";
    default:
      return item.alreadyReturned ? "Already returned" : item.isFinalSale ? "Final sale" : "Not eligible";
  }
}

/** Firebase ID token when signed in, so the server can apply member pricing. */
async function authHeaders(
  user: { getIdToken: () => Promise<string> } | null | undefined
): Promise<Record<string, string>> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (!user) return headers;
  try {
    const idToken = await user.getIdToken();
    if (idToken) headers.Authorization = `Bearer ${idToken}`;
  } catch {
    // Guest pricing is fine if the token can't be fetched.
  }
  return headers;
}

interface SelectedItem {
  lineItemId: string;
  quantity: number;
  reason: string;
}

interface ReturnConfirmation {
  returnId: string;
  returnStatus: string;
  itemsCreditAmount: number;
  shippingCost: number;
  estimatedCreditAmount: number;
  resolution?: ResolutionSummary;
}


function SpecificItemForm({
  order,
  customerEmail,
  onBack,
  onTokenExpired,
}: {
  order: OrderData;
  customerEmail: string;
  onBack: () => void;
  onTokenExpired: (message: string) => void;
}) {
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState(
    `My order number is ${order.orderName}, I am looking to exchange `
  );

  async function handleSend() {
    if (!message.trim()) return;
    setSending(true);
    setError("");
    try {
      const res = await fetch("/api/returns/exchange-request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ returnToken: order.returnToken, message }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string; code?: string };
        if (data.code && TOKEN_ERROR_CODES.has(data.code)) {
          onTokenExpired(data.error || "Please look up your order again.");
          return;
        }
        throw new ReturnsApiError(data.error || "Something went wrong. Please try again.", data.code);
      }
      setSent(true);
    } catch (err) {
      setError(
        err instanceof ReturnsApiError && err.code
          ? err.message
          : "Something went wrong. Please try again."
      );
    } finally {
      setSending(false);
    }
  }

  if (sent) {
    return (
      <div className="animate-fade-up text-center py-10">
        <div className="w-12 h-12 rounded-full bg-forest/10 flex items-center justify-center mx-auto mb-5">
          <svg className="w-6 h-6 text-forest" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
          </svg>
        </div>
        <h2 className="font-serif text-2xl text-obsidian mb-2">Request sent</h2>
        <p className="text-sm text-charcoal/60 max-w-sm mx-auto">
          We&rsquo;ll be in touch at {customerEmail} to sort out your exchange.
        </p>
      </div>
    );
  }

  return (
    <div className="animate-fade-up">
      <div className="text-center mb-10">
        <span className="inline-flex items-center gap-2.5 text-[11px] tracking-[0.35em] uppercase text-sage font-medium mb-4">
          <span className="w-6 h-px bg-sage/40" />
          Returns
          <span className="w-6 h-px bg-sage/40" />
        </span>
        <h1 className="font-serif text-3xl md:text-4xl text-obsidian mb-3">
          Contact us to exchange
        </h1>
        <p className="text-sm text-charcoal/60 max-w-md mx-auto leading-relaxed">
          For specific item exchanges, our team handles it personally.
        </p>
      </div>
      <div className="bg-white rounded-xl border border-taupe/20 p-6 space-y-4 mb-6">
        <div>
          <p className="text-xs uppercase tracking-widest text-charcoal/40 mb-1">To</p>
          <p className="text-sm text-obsidian">info@MyMully.com</p>
        </div>
        <div>
          <p className="text-xs uppercase tracking-widest text-charcoal/40 mb-1">Subject</p>
          <p className="text-sm text-obsidian">Exchange Request: {order.orderName}</p>
        </div>
        <div>
          <p className="text-xs uppercase tracking-widest text-charcoal/40 mb-1">Message</p>
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            maxLength={2000}
            rows={4}
            className="w-full text-sm text-obsidian bg-bone border border-taupe/20 rounded-lg px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-forest/20 resize-none leading-relaxed"
          />
        </div>
      </div>
      {error && (
        <p className="text-sm text-ember text-center mb-4">{error}</p>
      )}
      <button
        onClick={handleSend}
        disabled={sending}
        className="flex items-center justify-center w-full py-3.5 rounded-lg bg-forest text-bone text-sm font-medium tracking-wide hover:bg-forest/90 transition-colors duration-300 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {sending ? "Sending..." : "Send exchange request"}
      </button>
      <div className="mt-6 text-center">
        <button
          onClick={onBack}
          className="text-xs text-charcoal/40 hover:text-charcoal transition-colors"
        >
          ← Back
        </button>
      </div>
    </div>
  );
}

export default function ReturnsPage() {
  return (
    <Suspense>
      <ReturnsContent />
    </Suspense>
  );
}

function ReturnsContent() {
  const searchParams = useSearchParams();
  const [step, setStep] = useState(1);
  const [orderNumber, setOrderNumber] = useState("");
  const [email, setEmail] = useState("");

  useEffect(() => {
    const pre = searchParams.get("order");
    if (pre) setOrderNumber(pre);
  }, [searchParams]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [order, setOrder] = useState<OrderData | null>(null);
  const [selections, setSelections] = useState<Map<string, SelectedItem>>(new Map());
  const [confirmation, setConfirmation] = useState<ReturnConfirmation | null>(null);
  const [boxChoice, setBoxChoice] = useState<"pending" | "full" | "specific" | null>(null);

  function isBoxOrder(o: OrderData): boolean {
    return o.items.some((item) =>
      item.title.includes("Reserve Member") || item.title.includes("Back 9")
    );
  }

  const { tier, user } = useMembership();

  /** Token expired or invalid: back to step 1 with the order number kept. */
  function restartLookup(message: string) {
    setOrder(null);
    setSelections(new Map());
    setBoxChoice(null);
    setConfirmation(null);
    setStep(1);
    setError(message);
  }

  /* ── Step 1: Lookup ── */

  async function handleLookup(e: React.FormEvent) {
    e.preventDefault();
    if (!orderNumber.trim() || !email.trim()) return;

    setLoading(true);
    setError("");

    try {
      const res = await fetch("/api/returns/lookup", {
        method: "POST",
        headers: await authHeaders(user),
        body: JSON.stringify({ orderNumber: orderNumber.trim(), email: email.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Order not found");
      }
      const resolved = data as OrderData;
      setOrder(resolved);
      if (isBoxOrder(resolved)) {
        setBoxChoice("pending");
      } else {
        setStep(2);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  /* ── Step 2: Selection helpers ── */

  function toggleItem(lineItemId: string) {
    setSelections((prev) => {
      const next = new Map(prev);
      if (next.has(lineItemId)) {
        next.delete(lineItemId);
      } else {
        next.set(lineItemId, { lineItemId, quantity: 1, reason: "" });
      }
      return next;
    });
  }

  function updateQuantity(lineItemId: string, qty: number) {
    setSelections((prev) => {
      const next = new Map(prev);
      const existing = next.get(lineItemId);
      if (existing) next.set(lineItemId, { ...existing, quantity: qty });
      return next;
    });
  }

  function updateReason(lineItemId: string, reason: string) {
    setSelections((prev) => {
      const next = new Map(prev);
      const existing = next.get(lineItemId);
      if (existing) next.set(lineItemId, { ...existing, reason });
      return next;
    });
  }

  const selectedItems = Array.from(selections.values());
  const allReasonsProvided = selectedItems.length > 0 && selectedItems.every((s) => s.reason);

  function creditTotal(): number {
    if (!order) return 0;
    return selectedItems.reduce((sum, sel) => {
      const item = order.items.find((i) => i.lineItemId === sel.lineItemId);
      return sum + (item ? item.price * sel.quantity : 0);
    }, 0);
  }

  /* ── Step 3: Submit ── */

  async function handleSubmit() {
    if (!order) return;
    setLoading(true);
    setError("");

    try {
      const res = await fetch("/api/returns/create", {
        method: "POST",
        headers: await authHeaders(user),
        body: JSON.stringify({
          returnToken: order.returnToken,
          orderId: order.orderId,
          items: Array.from(selections.values()),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (data.code && TOKEN_ERROR_CODES.has(data.code)) {
          restartLookup(data.error || "Your session expired. Please look up your order again.");
          return;
        }
        throw new Error(data.error || "Failed to submit return");
      }
      setConfirmation(data as ReturnConfirmation);
      setStep(4);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  /* ── Shipping cost by tier ── */

  function shippingCost(): number {
    // Server-computed fee from lookup (what create will actually charge).
    if (typeof order?.returnShippingCost === "number") return order.returnShippingCost;
    if (tier === "member" || tier === "black") return 0;
    if (tier === "access") return 5.95;
    return 9.95;
  }

  const policy = order ? policyFor(order) : null;
  // Per-item resolution comes from the server (lookup); create recomputes it.
  const selectedResolution: ResolutionSummary = order
    ? summarizeResolutions(
        (selectedItems.length > 0
          ? selectedItems.map((sel) => order.items.find((it) => it.lineItemId === sel.lineItemId))
          : order.items.filter((it) => it.returnableQty > 0 && !it.isFinalSale)
        ).map((it) => it?.resolution),
      )
    : "store_credit";
  const resolutionSummary: ResolutionSummary = confirmation?.resolution ?? selectedResolution;
  const isRefund = resolutionSummary === "refund_original_payment";
  const hasRefund = resolutionSummary !== "store_credit";
  const hasCredit = resolutionSummary !== "refund_original_payment";
  const creditLabel = SUMMARY_LABELS[resolutionSummary].short;

  function netCredit(): number {
    return Math.max(0, creditTotal() - shippingCost());
  }

  return (
    <ShopPageShell>
      <main className="shop-returns-main">
        <div className="max-w-2xl mx-auto">

          {/* ── Step indicator ── */}
          <div className="flex items-center justify-center gap-2 mb-10">
            {[1, 2, 3, 4].map((s) => (
              <div key={s} className="flex items-center gap-2">
                <div
                  className={`w-2.5 h-2.5 rounded-full transition-all duration-300 ${
                    s === step
                      ? "bg-forest scale-110"
                      : s < step
                        ? "bg-forest/40"
                        : "bg-taupe/40"
                  }`}
                />
                {s < 4 && (
                  <div className={`w-8 h-px transition-colors duration-300 ${s < step ? "bg-forest/30" : "bg-taupe/25"}`} />
                )}
              </div>
            ))}
          </div>

          {/* ═══════════════════════════════════════
             STEP 1 — Order Lookup
             ═══════════════════════════════════════ */}
          {step === 1 && !boxChoice && (
            <div className="animate-fade-up">
              <div className="text-center mb-10">
                <span className="inline-flex items-center gap-2.5 text-[11px] tracking-[0.35em] uppercase text-sage font-medium mb-4">
                  <span className="w-6 h-px bg-sage/40" />
                  Returns
                  <span className="w-6 h-px bg-sage/40" />
                </span>
                <h1 className="font-serif text-3xl md:text-4xl text-obsidian mb-3">
                  Start a Return
                </h1>
                <p className="text-sm text-charcoal/60 max-w-md mx-auto leading-relaxed">
                  Enter your order details below and we&rsquo;ll pull up your items.
                  Returns are accepted within 30 days of delivery for unworn, unwashed items with tags attached, for both Pro Shop and subscription box orders.
                  Pro Shop items are refunded to your original payment method. Subscription box items are refunded if you start the return within 14 days of delivery, and receive store credit from day 15 to day 30.
                  Final sale items can&rsquo;t be returned.
                </p>
              </div>

              <form onSubmit={handleLookup} className="space-y-5">
                <div>
                  <label htmlFor="orderNumber" className="block text-xs tracking-wide uppercase text-charcoal/50 font-medium mb-2">
                    Order Number
                  </label>
                  <input
                    id="orderNumber"
                    type="text"
                    value={orderNumber}
                    onChange={(e) => setOrderNumber(e.target.value)}
                    placeholder="#1042"
                    className="w-full px-4 py-3 rounded-lg border border-taupe/30 bg-white text-obsidian text-sm placeholder:text-charcoal/25 focus:outline-none focus:ring-2 focus:ring-forest/20 focus:border-forest/40 transition-all"
                  />
                </div>

                <div>
                  <label htmlFor="email" className="block text-xs tracking-wide uppercase text-charcoal/50 font-medium mb-2">
                    Email Address
                  </label>
                  <input
                    id="email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="your@email.com"
                    className="w-full px-4 py-3 rounded-lg border border-taupe/30 bg-white text-obsidian text-sm placeholder:text-charcoal/25 focus:outline-none focus:ring-2 focus:ring-forest/20 focus:border-forest/40 transition-all"
                  />
                </div>

                {error && (
                  <p className="text-sm text-red-600 bg-red-50 px-4 py-2.5 rounded-lg">{error}</p>
                )}

                <button
                  type="submit"
                  disabled={loading || !orderNumber.trim() || !email.trim()}
                  className="w-full py-3.5 rounded-lg bg-forest text-bone text-sm font-medium tracking-wide btn-press hover:bg-forest-light transition-colors duration-300 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {loading ? (
                    <span className="flex items-center justify-center gap-2">
                      <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                      </svg>
                      Looking up order…
                    </span>
                  ) : (
                    "Look Up Order"
                  )}
                </button>
              </form>

              <p className="text-center text-xs text-charcoal/35 mt-6">
                Find your order number in your confirmation email, or check your{" "}
                <Link href="/account" className="underline hover:text-charcoal/60 transition-colors">account page</Link>.
              </p>
            </div>
          )}

          {/* ═══════════════════════════════════════
             BOX CHOICE — Full box or specific item?
             ═══════════════════════════════════════ */}
          {step === 1 && boxChoice === "pending" && order && (
            <div className="animate-fade-up">
              <div className="text-center mb-10">
                <span className="inline-flex items-center gap-2.5 text-[11px] tracking-[0.35em] uppercase text-sage font-medium mb-4">
                  <span className="w-6 h-px bg-sage/40" />
                  Returns
                  <span className="w-6 h-px bg-sage/40" />
                </span>
                <h1 className="font-serif text-3xl md:text-4xl text-obsidian mb-3">
                  What are you exchanging?
                </h1>
                <p className="text-sm text-charcoal/60 max-w-md mx-auto leading-relaxed">
                  Order {order.orderName}. Let us know what you&rsquo;d like to exchange.
                </p>
              </div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <button
                  onClick={() => { setBoxChoice("full"); setStep(2); }}
                  className="flex flex-col items-start gap-2 rounded-xl border border-taupe/20 bg-white p-6 text-left hover:border-forest/40 hover:shadow-sm transition-all duration-300"
                >
                  <span className="text-base font-medium text-obsidian">Full box</span>
                  <span className="text-sm text-charcoal/50 leading-relaxed">Return the entire box as received.</span>
                </button>
                <button
                  onClick={() => setBoxChoice("specific")}
                  className="flex flex-col items-start gap-2 rounded-xl border border-taupe/20 bg-white p-6 text-left hover:border-forest/40 hover:shadow-sm transition-all duration-300"
                >
                  <span className="text-base font-medium text-obsidian">Specific item</span>
                  <span className="text-sm text-charcoal/50 leading-relaxed">Exchange an item for a different size.</span>
                </button>
              </div>
              <div className="mt-6 text-center">
                <button
                  onClick={() => { setBoxChoice(null); setOrder(null); }}
                  className="text-xs text-charcoal/40 hover:text-charcoal transition-colors"
                >
                  ← Back
                </button>
              </div>
            </div>
          )}

          {/* ═══════════════════════════════════════
             SPECIFIC ITEM — Send exchange request
             ═══════════════════════════════════════ */}
          {step === 1 && boxChoice === "specific" && order && (
            <SpecificItemForm
              order={order}
              customerEmail={email}
              onBack={() => {
                if (isBoxOrder(order)) setBoxChoice("pending");
                else { setBoxChoice(null); setStep(2); }
              }}
              onTokenExpired={restartLookup}
            />
          )}

          {/* ═══════════════════════════════════════
             STEP 2 — Select Items
             ═══════════════════════════════════════ */}
          {step === 2 && order && (
            <div className="animate-fade-up">
              <div className="text-center mb-8">
                <h1 className="font-serif text-2xl md:text-3xl text-obsidian mb-2">
                  Select Items to Return
                </h1>
                <p className="text-sm text-charcoal/50">
                  Order {order.orderName} &middot; {order.orderDate}
                </p>
              </div>

              <div className="space-y-4 mb-8">
                {order.items.map((item) => {
                  const isEligible = item.returnableQty > 0 && !item.isFinalSale;
                  const selected = selections.has(item.lineItemId);
                  const sel = selections.get(item.lineItemId);

                  return (
                    <div
                      key={item.lineItemId}
                      className={`rounded-xl border transition-all duration-300 ${
                        !isEligible
                          ? "border-taupe/15 bg-bone-dark/30 opacity-50"
                          : selected
                            ? "border-forest/30 bg-white shadow-sm"
                            : "border-taupe/25 bg-white hover:border-taupe/40"
                      }`}
                    >
                      {/* Item row */}
                      <button
                        type="button"
                        disabled={!isEligible}
                        onClick={() => toggleItem(item.lineItemId)}
                        className="w-full flex items-center gap-4 p-4 text-left disabled:cursor-not-allowed"
                      >
                        {/* Checkbox */}
                        <div className={`w-5 h-5 rounded-md border-2 flex items-center justify-center shrink-0 transition-all duration-200 ${
                          !isEligible
                            ? "border-taupe/20 bg-taupe/5"
                            : selected
                              ? "border-forest bg-forest"
                              : "border-taupe/40"
                        }`}>
                          {selected && (
                            <svg className="w-3 h-3 text-bone" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                            </svg>
                          )}
                        </div>

                        {/* Item image (placeholder when Shopify has none) */}
                        <div className="w-16 h-16 rounded-lg bg-bone-dark flex items-center justify-center shrink-0 overflow-hidden">
                          {item.image ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={item.image}
                              alt={item.title}
                              width={64}
                              height={64}
                              loading="lazy"
                              className="w-full h-full object-cover"
                            />
                          ) : (
                            <svg className="w-6 h-6 text-taupe/50" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1} aria-hidden="true">
                              <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M3.75 21h16.5A2.25 2.25 0 0022.5 18.75V5.25A2.25 2.25 0 0020.25 3H3.75A2.25 2.25 0 001.5 5.25v13.5A2.25 2.25 0 003.75 21z" />
                            </svg>
                          )}
                        </div>

                        {/* Details */}
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-obsidian truncate">{item.title}</p>
                          <p className="text-xs text-charcoal/45 mt-0.5">{item.variantTitle}</p>
                          {item.isChildSku && (
                            <span className="inline-block text-[10px] tracking-wide uppercase text-sage bg-sage/10 px-1.5 py-0.5 rounded mt-1">
                              Bundle item
                            </span>
                          )}
                          {!isEligible && (
                            <span className="inline-block text-[10px] tracking-wide uppercase text-charcoal/40 mt-1">
                              {ineligibleLabel(item)}
                            </span>
                          )}
                          {isEligible && item.resolution && (
                            <span
                              data-testid={`resolution-${item.lineItemId}`}
                              className="block text-[11px] text-forest mt-1"
                            >
                              {RESOLUTION_LABELS[item.resolution]}
                            </span>
                          )}
                        </div>

                        {/* Price */}
                        <span className="text-sm font-medium text-obsidian shrink-0">
                          ${item.price.toFixed(2)}
                        </span>
                      </button>

                      {/* Expanded: quantity + reason */}
                      {selected && (
                        <div className="px-4 pb-4 pt-0 border-t border-taupe/10 mt-0">
                          <div className="flex flex-col sm:flex-row gap-3 pt-3">
                            {/* Quantity */}
                            {item.returnableQty > 1 && (
                              <div className="flex-1">
                                <label className="block text-[10px] tracking-wide uppercase text-charcoal/40 font-medium mb-1.5">
                                  Quantity
                                </label>
                                <select
                                  value={sel?.quantity || 1}
                                  onChange={(e) => updateQuantity(item.lineItemId, Number(e.target.value))}
                                  className="w-full px-3 py-2 rounded-lg border border-taupe/25 bg-bone text-sm text-obsidian focus:outline-none focus:ring-2 focus:ring-forest/20"
                                >
                                  {Array.from({ length: item.returnableQty }, (_, i) => i + 1).map((q) => (
                                    <option key={q} value={q}>{q}</option>
                                  ))}
                                </select>
                              </div>
                            )}

                            {/* Reason */}
                            <div className="flex-[2]">
                              <label className="block text-[10px] tracking-wide uppercase text-charcoal/40 font-medium mb-1.5">
                                Reason for return
                              </label>
                              <select
                                value={sel?.reason || ""}
                                onChange={(e) => updateReason(item.lineItemId, e.target.value)}
                                className="w-full px-3 py-2 rounded-lg border border-taupe/25 bg-bone text-sm text-obsidian focus:outline-none focus:ring-2 focus:ring-forest/20"
                              >
                                <option value="" disabled>Select a reason</option>
                                {RETURN_REASONS.map((r) => (
                                  <option key={r} value={r}>{r}</option>
                                ))}
                              </select>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {policy?.exchangeAllowed && !isBoxOrder(order) && (
                <p className="text-center text-xs text-charcoal/50 mb-4">
                  Need a different size instead?{" "}
                  <button
                    type="button"
                    onClick={() => { setBoxChoice("specific"); setStep(1); }}
                    className="underline hover:text-charcoal transition-colors"
                  >
                    Request a free size exchange
                  </button>
                </p>
              )}

              {/* Credit summary + Continue */}
              <div className="rounded-xl bg-forest/5 border border-forest/10 p-5 mb-6">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-charcoal/60">Estimated {creditLabel}</span>
                  <span className="text-lg font-serif font-bold text-forest">${creditTotal().toFixed(2)}</span>
                </div>
              </div>

              <div className="flex gap-3">
                <button
                  onClick={() => { setStep(1); setSelections(new Map()); setOrder(null); }}
                  className="px-6 py-3 rounded-lg border border-taupe/30 text-sm text-charcoal/60 hover:border-taupe/50 transition-colors duration-300"
                >
                  Back
                </button>
                <button
                  onClick={() => setStep(3)}
                  disabled={!allReasonsProvided}
                  className="flex-1 py-3 rounded-lg bg-forest text-bone text-sm font-medium tracking-wide btn-press hover:bg-forest-light transition-colors duration-300 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Continue
                </button>
              </div>
            </div>
          )}

          {/* ═══════════════════════════════════════
             STEP 3 — Credit Summary & Get Label
             ═══════════════════════════════════════ */}
          {step === 3 && order && (
            <div className="animate-fade-up">
              <div className="text-center mb-8">
                <h1 className="font-serif text-2xl md:text-3xl text-obsidian mb-2">
                  Your Return Summary
                </h1>
                <p className="text-sm text-charcoal/50">Order {order.orderName}</p>
              </div>

              {/* Items being returned */}
              <div className="rounded-xl border border-taupe/20 bg-white overflow-hidden mb-5">
                {selectedItems.map((sel, i) => {
                  const item = order.items.find((it) => it.lineItemId === sel.lineItemId);
                  if (!item) return null;
                  return (
                    <div
                      key={sel.lineItemId}
                      className={`flex items-center gap-4 px-5 py-4 ${i > 0 ? "border-t border-taupe/10" : ""}`}
                    >
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-obsidian">{item.title}</p>
                        <p className="text-xs text-charcoal/40">{item.variantTitle} &middot; Qty {sel.quantity}</p>
                        {item.resolution && (
                          <p className="text-[11px] text-forest mt-0.5">{RESOLUTION_LABELS[item.resolution]}</p>
                        )}
                      </div>
                      <span className="text-sm font-medium text-obsidian shrink-0">
                        ${(item.price * sel.quantity).toFixed(2)}
                      </span>
                    </div>
                  );
                })}
              </div>

              {/* Store credit breakdown */}
              <div className="rounded-xl bg-forest/5 border border-forest/10 p-5 mb-5">
                <div className="space-y-2.5">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-charcoal/60">Return value</span>
                    <span className="text-sm text-obsidian">${creditTotal().toFixed(2)}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-charcoal/60">Return shipping</span>
                    <span className="text-sm text-obsidian">
                      {shippingCost() === 0 ? "Free" : `-$${shippingCost().toFixed(2)}`}
                    </span>
                  </div>
                  <div className="flex items-center justify-between pt-3 border-t border-forest/10">
                    <span className="text-sm font-semibold text-obsidian">{SUMMARY_LABELS[resolutionSummary].title}</span>
                    <span className="text-xl font-serif font-bold text-forest">${netCredit().toFixed(2)}</span>
                  </div>
                </div>
              </div>

              {/* Policy note */}
              <div className="rounded-xl border border-taupe/20 bg-white px-5 py-4 mb-6">
                <p className="text-xs text-charcoal/50 leading-relaxed">
                  Items must be unworn and unwashed with tags attached.{" "}
                  {hasRefund && <>Refunds go to your original payment method once we receive and inspect your items.{" "}</>}
                  {hasCredit && <>Store credit is applied to your Mully Pro Shop account once we receive and inspect your items.{" "}</>}
                  {resolutionSummary === "mixed" && <>Any return shipping fee comes off the refund first.{" "}</>}
                  You&rsquo;ll receive an email confirmation.
                </p>
              </div>

              {error && (
                <p className="text-sm text-red-600 bg-red-50 px-4 py-2.5 rounded-lg mb-4">{error}</p>
              )}

              <div className="flex gap-3">
                <button
                  onClick={() => setStep(2)}
                  className="px-6 py-3 rounded-lg border border-taupe/30 text-sm text-charcoal/60 hover:border-taupe/50 transition-colors duration-300"
                >
                  Back
                </button>
                <button
                  onClick={handleSubmit}
                  disabled={loading}
                  className="flex-1 py-3.5 rounded-lg bg-forest text-bone text-sm font-medium tracking-wide btn-press hover:bg-forest-light transition-colors duration-300 disabled:opacity-40"
                >
                  {loading ? (
                    <span className="flex items-center justify-center gap-2">
                      <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                      </svg>
                      Submitting…
                    </span>
                  ) : (
                    "Submit Return"
                  )}
                </button>
              </div>
            </div>
          )}

          {/* ═══════════════════════════════════════
             STEP 4 — Confirmation
             ═══════════════════════════════════════ */}
          {step === 4 && confirmation && (
            <div className="animate-fade-up text-center">
              <div className="w-16 h-16 rounded-full bg-forest/10 flex items-center justify-center mx-auto mb-6">
                <svg className="w-8 h-8 text-forest" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                </svg>
              </div>

              <h1 className="font-serif text-2xl md:text-3xl text-obsidian mb-2">
                Return Request Submitted
              </h1>
              <p className="text-sm text-charcoal/50 mb-8 max-w-sm mx-auto leading-relaxed">
                We&rsquo;ve received your request. Once reviewed, you&rsquo;ll get an email at{" "}
                <span className="text-charcoal/70">{email}</span>{" "}
                with your prepaid return label.
              </p>

              {/* What happens next */}
              <div className="rounded-xl border border-taupe/20 bg-white p-5 mb-5 max-w-sm mx-auto text-left">
                <p className="text-xs tracking-wide uppercase text-charcoal/40 font-medium mb-3">What happens next</p>
                <ol className="space-y-2.5">
                  {[
                    "We review your return request",
                    "You receive a prepaid shipping label via email",
                    "Drop off your package at the carrier",
                    isRefund
                      ? "Your refund is issued to your original payment method once we inspect your items"
                      : hasRefund
                        ? "Refund items go back to your original payment method and store credit items are credited once we inspect them"
                        : "Store credit is applied once we inspect your items",
                  ].map((s, i) => (
                    <li key={i} className="flex items-start gap-3">
                      <span className="w-5 h-5 rounded-full bg-forest/10 text-forest text-[10px] font-semibold flex items-center justify-center shrink-0 mt-0.5">
                        {i + 1}
                      </span>
                      <span className="text-sm text-charcoal/60 leading-snug">{s}</span>
                    </li>
                  ))}
                </ol>
              </div>

              {/* Credit breakdown */}
              <div className="rounded-xl bg-forest/5 border border-forest/10 p-5 mb-6 max-w-sm mx-auto text-left">
                <p className="text-xs tracking-wide uppercase text-sage font-medium mb-3">{SUMMARY_LABELS[resolutionSummary].title}</p>
                <div className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <span className="text-charcoal/60">Return value</span>
                    <span className="text-obsidian">${confirmation.itemsCreditAmount.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-charcoal/60">Return shipping</span>
                    <span className="text-obsidian">
                      {confirmation.shippingCost === 0 ? "Free" : `-$${confirmation.shippingCost.toFixed(2)}`}
                    </span>
                  </div>
                  <div className="flex justify-between pt-2 border-t border-forest/10">
                    <span className="text-sm font-semibold text-obsidian">{SUMMARY_LABELS[resolutionSummary].title}</span>
                    <span className="text-lg font-serif font-bold text-forest">${confirmation.estimatedCreditAmount.toFixed(2)}</span>
                  </div>
                </div>
                <p className="text-xs text-charcoal/40 mt-3 leading-relaxed">
                  Issued once we receive your items unworn and unwashed, with tags attached.
                </p>
              </div>

              <div className="flex flex-col sm:flex-row gap-3 max-w-sm mx-auto">
                <Link
                  href="/shop"
                  className="flex-1 py-3 rounded-lg bg-forest text-bone text-sm font-medium tracking-wide text-center btn-press hover:bg-forest-light transition-colors duration-300"
                >
                  Return to Shop
                </Link>
                <Link
                  href="/account"
                  className="flex-1 py-3 rounded-lg border border-taupe/30 text-sm text-charcoal/60 text-center hover:border-taupe/50 transition-colors duration-300"
                >
                  View Account
                </Link>
              </div>
            </div>
          )}

        </div>
      </main>

    </ShopPageShell>
  );
}
