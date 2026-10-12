"use client";

import { useEffect, useState } from "react";
import { useMembership } from "../../context/MembershipContext";
import { trackEvent } from "@/lib/tracking";

interface AccessOffer {
  merchandiseId: string;
  sellingPlanId: string | null;
  monthlyPrice: number;
  discountRate: number;
}

let offerPromise: Promise<AccessOffer | null> | null = null;
function loadOffer(): Promise<AccessOffer | null> {
  offerPromise ??= fetch("/api/shop/mully-access")
    .then(r => (r.ok ? r.json() : null))
    .catch(() => { offerPromise = null; return null; });
  return offerPromise;
}

const money = (n: number) => (Number.isInteger(n) ? `$${n}` : `$${n.toFixed(2)}`);

/**
 * Compact Mully Access join row in the bag. Joining adds the $15/month line;
 * after checkout the orders/paid webhook refunds the better-of discount gap
 * plus shipping on that order.
 */
export function ShopCartAccessOffer({ accent }: { accent: string }) {
  const { cart, cartOpen, cartLoading, cartOrderDiscount = 0, hasShopDiscount, addItemsToCart } = useMembership();
  const [offer, setOffer] = useState<AccessOffer | null>(null);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!cartOpen || hasShopDiscount) return;
    let live = true;
    void loadOffer().then(o => { if (live) setOffer(o); });
    return () => { live = false; };
  }, [cartOpen, hasShopDiscount]);

  if (hasShopDiscount || !offer?.sellingPlanId) return null;
  const joined = cart.some(i => i.variantId === offer.merchandiseId);
  const merch = cart.filter(i => i.variantId !== offer.merchandiseId);
  if (!merch.length) return null;

  const retail = merch.reduce((t, i) => t + (i.retailPrice ?? i.price) * i.quantity, 0);
  const existing = cartOrderDiscount + merch.reduce((t, i) => t + Math.max(0, (i.retailPrice ?? i.price) - i.price) * i.quantity, 0);
  const back = Math.max(0, Math.round((retail * offer.discountRate - existing) * 100) / 100);

  async function join() {
    if (!offer?.sellingPlanId || adding) return;
    setAdding(true); setError("");
    try {
      await addItemsToCart([{
        slug: "mully-access",
        name: "Mully Access",
        brand: "Mully",
        price: offer.monthlyPrice,
        variantId: offer.merchandiseId,
        sellingPlanId: offer.sellingPlanId,
        variantTitle: "Monthly",
      }]);
      void trackEvent("mully_access_join_clicked", { properties: { refund_estimate: back, cart_value: retail } });
    } catch {
      setError("Couldn't add Mully Access. Try again.");
    } finally { setAdding(false); }
  }

  return (
    <section className="mt-5 border border-charcoal/10 bg-white px-4 py-3" aria-label="Mully Access">
      {joined ? (
        <p className="text-xs text-charcoal/80">
          <strong className="font-medium">Mully Access added.</strong>{" "}
          {back > 0 ? `${money(back)} plus shipping comes back to you after checkout.` : "Shipping on this order comes back to you after checkout."}
        </p>
      ) : (
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[10px] font-mono uppercase tracking-[0.24em] text-charcoal/50">Mully Access · {money(offer.monthlyPrice)}/mo</p>
            <p className="mt-1 text-xs text-charcoal/80">10% off every order, free shipping, first look at drops.</p>
          </div>
          <button
            onClick={join}
            disabled={adding || cartLoading || !cartOpen}
            className="shrink-0 px-3 py-2 text-[10px] font-mono uppercase tracking-[0.18em] text-white disabled:opacity-40"
            style={{ background: accent }}
          >
            {adding ? "Adding" : back > 0 ? `Join, get ${money(back)} back` : "Join"}
          </button>
        </div>
      )}
      {!joined && <p className="mt-2 text-[11px] text-charcoal/50">{back > 0 ? "Refunded after checkout, plus your shipping." : "Shipping on this order refunded after checkout."} Cancel anytime.</p>}
      {error && <p role="alert" className="mt-2 text-[11px] text-red-700">{error}</p>}
    </section>
  );
}
