"use client";

import { useState } from "react";
import Link from "next/link";

import { ShopHeader } from "../components/ShopHeader";

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
}

interface OrderData {
  orderId: string;
  orderName: string;
  orderDate: string;
  items: ReturnableItem[];
}

interface SelectedItem {
  lineItemId: string;
  quantity: number;
  reason: string;
}

interface ReturnConfirmation {
  returnId: string;
  itemTotal: number;
  shippingCost: number;
  handlingFee: number;
  creditAmount: number;
  labelUrl: string;
  labelTrackingNumber: string;
}

const RETURN_REASONS = [
  "Wrong size",
  "Didn't like the fit",
  "Not as described",
  "Damaged or defective",
  "Changed my mind",
  "Other",
];

/* ── Placeholder data for demo (remove when API is wired) ── */
const DEMO_ORDER: OrderData = {
  orderId: "gid://shopify/Order/12345",
  orderName: "#1042",
  orderDate: "February 18, 2026",
  items: [
    {
      lineItemId: "li_1",
      sku: "GV-TW-NAV-L",
      title: "Greyson Tate Vest",
      variantTitle: "Navy / L",
      quantity: 1,
      returnableQty: 1,
      price: 168.00,
      image: "https://cdn.shopify.com/s/files/1/placeholder/vest.jpg",
      isChildSku: false,
    },
    {
      lineItemId: "li_2",
      sku: "BD-TP-WHT-M",
      title: "Birds of Condor Trophy Polo",
      variantTitle: "White / M",
      quantity: 2,
      returnableQty: 2,
      price: 98.00,
      image: "https://cdn.shopify.com/s/files/1/placeholder/polo.jpg",
      isChildSku: false,
    },
    {
      lineItemId: "li_3",
      sku: "MH-CL-BLK",
      title: "Mully Heritage Cap",
      variantTitle: "Black",
      quantity: 1,
      returnableQty: 0,
      price: 42.00,
      image: "https://cdn.shopify.com/s/files/1/placeholder/cap.jpg",
      isChildSku: false,
      alreadyReturned: true,
    },
    {
      lineItemId: "li_4",
      sku: "JL-QZ-GRN-M",
      title: "Johnnie-O Sully Quarter-Zip",
      variantTitle: "Pine / M",
      quantity: 1,
      returnableQty: 1,
      price: 135.00,
      image: "https://cdn.shopify.com/s/files/1/placeholder/quarterzip.jpg",
      isChildSku: true,
      parentSku: "JL-BUNDLE-M",
    },
  ],
};

export default function ReturnsPage() {
  const [step, setStep] = useState(1);
  const [orderNumber, setOrderNumber] = useState("");
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [order, setOrder] = useState<OrderData | null>(null);
  const [selections, setSelections] = useState<Map<string, SelectedItem>>(new Map());
  const [confirmation, setConfirmation] = useState<ReturnConfirmation | null>(null);

  /* ── Step 1: Lookup ── */

  async function handleLookup(e: React.FormEvent) {
    e.preventDefault();
    if (!orderNumber.trim() || !email.trim()) return;

    setLoading(true);
    setError("");

    try {
      /*
       * TODO (Leo): Wire to POST /api/returns/lookup
       *
       * const res = await fetch("/api/returns/lookup", {
       *   method: "POST",
       *   headers: { "Content-Type": "application/json" },
       *   body: JSON.stringify({ orderNumber: orderNumber.trim(), email: email.trim() }),
       * });
       * if (!res.ok) {
       *   const data = await res.json();
       *   throw new Error(data.error || "Order not found");
       * }
       * const data: OrderData = await res.json();
       * setOrder(data);
       */

      // Demo: simulate API delay then use placeholder
      await new Promise((r) => setTimeout(r, 800));
      setOrder(DEMO_ORDER);
      setStep(2);
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
      /*
       * TODO (Leo): Wire to POST /api/returns/create
       *
       * const res = await fetch("/api/returns/create", {
       *   method: "POST",
       *   headers: { "Content-Type": "application/json" },
       *   body: JSON.stringify({
       *     orderId: order.orderId,
       *     items: selectedItems,
       *     customerEmail: email,
       *   }),
       * });
       * if (!res.ok) throw new Error("Failed to submit return");
       * const data: ReturnConfirmation = await res.json();
       * setConfirmation(data);
       */

      // Demo: simulate API delay
      // In production, POST /api/returns/create calls Shopify Returns API which
      // generates a return label and provides the actual shipping cost.
      await new Promise((r) => setTimeout(r, 1000));
      const itemTotal = creditTotal();
      const shippingCost = DEMO_SHIPPING_COST; // from Shopify Returns label generation
      const handlingFee = HANDLING_FEE;
      setConfirmation({
        returnId: "RET-" + Math.random().toString(36).substring(2, 8).toUpperCase(),
        itemTotal,
        shippingCost,
        handlingFee,
        creditAmount: itemTotal - shippingCost - handlingFee,
        labelUrl: "https://example.com/label.pdf",
        labelTrackingNumber: "1Z999AA10123456784",
      });

      setStep(4);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  /* ── Shipping / handling constants ── */
  const HANDLING_FEE = 3.0;

  /* Demo shipping cost — in production this comes from Shopify Returns label generation */
  const DEMO_SHIPPING_COST = 8.50;

  return (
    <div className="min-h-screen bg-bone">
      <ShopHeader />

      <main className="pt-24 pb-24 px-6 md:px-12">
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
          {step === 1 && (
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
                  Eligible returns are issued as store credit to your Mully Pro Shop account
                  once our team has received and inspected your items.
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

                        {/* Image placeholder */}
                        <div className="w-16 h-16 rounded-lg bg-bone-dark flex items-center justify-center shrink-0 overflow-hidden">
                          {/* TODO (Leo): replace with <Image> once real product images are available */}
                          <svg className="w-6 h-6 text-taupe/50" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M3.75 21h16.5A2.25 2.25 0 0022.5 18.75V5.25A2.25 2.25 0 0020.25 3H3.75A2.25 2.25 0 001.5 5.25v13.5A2.25 2.25 0 003.75 21z" />
                          </svg>
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
                              {item.alreadyReturned ? "Already returned" : item.isFinalSale ? "Final sale" : "Not eligible"}
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

              {/* Credit summary + Continue */}
              <div className="rounded-xl bg-forest/5 border border-forest/10 p-5 mb-6">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-charcoal/60">Item value</span>
                  <span className="text-lg font-serif font-bold text-forest">${creditTotal().toFixed(2)}</span>
                </div>
                <p className="text-xs text-charcoal/40 mt-2 leading-relaxed">
                  Return shipping and a $3.00 handling fee will be deducted from your store credit.
                  Final credit amount will be shown after your label is generated.
                </p>
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
             STEP 3 — Review & Submit
             ═══════════════════════════════════════ */}
          {step === 3 && order && (
            <div className="animate-fade-up">
              <div className="text-center mb-8">
                <h1 className="font-serif text-2xl md:text-3xl text-obsidian mb-2">
                  Review Your Return
                </h1>
                <p className="text-sm text-charcoal/50">
                  Order {order.orderName}
                </p>
              </div>

              {/* Selected items summary */}
              <div className="rounded-xl border border-taupe/20 bg-white overflow-hidden mb-5">
                {selectedItems.map((sel, i) => {
                  const item = order.items.find((it) => it.lineItemId === sel.lineItemId);
                  if (!item) return null;
                  return (
                    <div
                      key={sel.lineItemId}
                      className={`flex items-center gap-4 px-5 py-4 ${i > 0 ? "border-t border-taupe/10" : ""}`}
                    >
                      <div className="w-12 h-12 rounded-lg bg-bone-dark flex items-center justify-center shrink-0">
                        <svg className="w-5 h-5 text-taupe/50" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M3.75 21h16.5A2.25 2.25 0 0022.5 18.75V5.25A2.25 2.25 0 0020.25 3H3.75A2.25 2.25 0 001.5 5.25v13.5A2.25 2.25 0 003.75 21z" />
                        </svg>
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-obsidian">{item.title}</p>
                        <p className="text-xs text-charcoal/40">{item.variantTitle} &middot; Qty {sel.quantity} &middot; {sel.reason}</p>
                      </div>
                      <span className="text-sm font-medium text-obsidian shrink-0">
                        ${(item.price * sel.quantity).toFixed(2)}
                      </span>
                    </div>
                  );
                })}
              </div>

              {/* Shipping & fees breakdown */}
              <div className="rounded-xl bg-forest/5 border border-forest/10 p-5 mb-6">
                <p className="text-xs text-charcoal/50 leading-relaxed mb-4">
                  Returns are issued as <strong className="text-charcoal/70">store credit</strong> to your Mully Pro Shop account
                  once our team has received and inspected your items. Return shipping cost and a handling fee
                  are deducted from your credit.
                </p>

                <div className="space-y-2 text-sm">
                  <div className="flex items-center justify-between">
                    <span className="text-charcoal/60">Item value</span>
                    <span className="text-obsidian">${creditTotal().toFixed(2)}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-charcoal/60">Return shipping <span className="text-xs text-charcoal/35">(via Shopify Returns)</span></span>
                    <span className="text-obsidian">&minus;${DEMO_SHIPPING_COST.toFixed(2)}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-charcoal/60">Handling fee</span>
                    <span className="text-obsidian">&minus;${HANDLING_FEE.toFixed(2)}</span>
                  </div>
                  <div className="flex items-center justify-between pt-3 border-t border-forest/10">
                    <span className="font-medium text-charcoal/70">Estimated store credit</span>
                    <span className="text-xl font-serif font-bold text-forest">
                      ${(creditTotal() - DEMO_SHIPPING_COST - HANDLING_FEE).toFixed(2)}
                    </span>
                  </div>
                </div>

                <p className="text-[11px] text-charcoal/35 mt-3 leading-relaxed">
                  Shipping cost is calculated when your return label is generated. Final credit is confirmed
                  after our team inspects the returned items.
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
              {/* Success icon */}
              <div className="w-16 h-16 rounded-full bg-forest/10 flex items-center justify-center mx-auto mb-6">
                <svg className="w-8 h-8 text-forest" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                </svg>
              </div>

              <h1 className="font-serif text-2xl md:text-3xl text-obsidian mb-2">
                Return Submitted
              </h1>
              <p className="text-sm text-charcoal/50 mb-1">
                Return ID: <span className="font-mono text-charcoal/70">{confirmation.returnId}</span>
              </p>
              <p className="text-sm text-charcoal/50 mb-8">
                We&rsquo;ve sent a confirmation and your return label to <span className="text-charcoal/70">{email}</span>
              </p>

              {/* Credit breakdown */}
              <div className="rounded-xl bg-forest/5 border border-forest/10 p-6 mb-6 max-w-sm mx-auto text-left">
                <p className="text-xs tracking-wide uppercase text-sage font-medium mb-3">Estimated Store Credit</p>
                <div className="space-y-1.5 text-sm">
                  <div className="flex justify-between">
                    <span className="text-charcoal/55">Item value</span>
                    <span className="text-obsidian">${confirmation.itemTotal.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-charcoal/55">Return shipping</span>
                    <span className="text-obsidian">&minus;${confirmation.shippingCost.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-charcoal/55">Handling fee</span>
                    <span className="text-obsidian">&minus;${confirmation.handlingFee.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between pt-2 border-t border-forest/10">
                    <span className="font-medium text-charcoal/70">Credit total</span>
                    <span className="text-xl font-serif font-bold text-forest">${confirmation.creditAmount.toFixed(2)}</span>
                  </div>
                </div>
                <p className="text-[11px] text-charcoal/35 mt-3 leading-relaxed">
                  Credit will be applied to your Pro Shop account once our team receives and inspects the returned items.
                </p>
              </div>

              {/* Return label — always generated via Shopify Returns */}
              <div className="rounded-xl border border-taupe/20 bg-white p-5 mb-6 max-w-sm mx-auto text-left">
                <div className="flex items-start gap-3">
                  <svg className="w-5 h-5 text-forest shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m.75 12l3 3m0 0l3-3m-3 3v-6m-1.5-9H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
                  </svg>
                  <div className="flex-1">
                    <p className="text-sm font-medium text-obsidian">Return Shipping Label</p>
                    <p className="text-xs text-charcoal/40 mt-0.5 font-mono">{confirmation.labelTrackingNumber}</p>
                    <div className="flex flex-wrap gap-3 mt-2">
                      <a
                        href={confirmation.labelUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-block text-xs text-forest font-medium hover:underline"
                      >
                        Print Label &rarr;
                      </a>
                      <a
                        href={confirmation.labelUrl}
                        download
                        className="inline-block text-xs text-forest font-medium hover:underline"
                      >
                        Download PDF
                      </a>
                    </div>
                    <p className="text-[11px] text-charcoal/35 mt-2">
                      This label has also been emailed to {email}
                    </p>
                  </div>
                </div>
              </div>

              {/* Actions */}
              <div className="flex flex-col sm:flex-row gap-3 max-w-sm mx-auto mt-8">
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

      {/* ─── FOOTER ─── */}
      <footer className="py-10 px-6 md:px-12 bg-forest">
        <div className="max-w-6xl mx-auto flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <span className="flex items-center gap-2 text-bone">
            <svg viewBox="0 0 1002 540" fill="currentColor" className="h-4 w-auto" aria-hidden="true"><path d="M0,0 H1002 V540 H0 Z M50,1 L998,269 L50,538 Z" fillRule="evenodd" /></svg>
            <span className="font-serif text-xl font-bold tracking-wide">mully.</span>
          </span>
          <div className="flex items-center gap-8">
            <Link href="/policies/terms" className="text-sm text-bone/50 hover:text-bone transition-colors duration-300">Terms</Link>
            <Link href="/policies/privacy" className="text-sm text-bone/50 hover:text-bone transition-colors duration-300">Privacy</Link>
            <Link href="/faq" className="text-sm text-bone/50 hover:text-bone transition-colors duration-300">FAQ</Link>
          </div>
          <p className="text-xs text-bone/30">&copy; {new Date().getFullYear()} Mully Group, Inc.</p>
        </div>
      </footer>
    </div>
  );
}
