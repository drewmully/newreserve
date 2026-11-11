"use client";

import Image from "next/image";
import { useEffect, useMemo, useRef, useState } from "react";
import { useMembership } from "../../context/MembershipContext";
import { useHasShopReward } from "./useCompleteLookVariant";
import { trackEvent } from "@/lib/tracking";
import { BOGO15_CODE } from "@/lib/cartPicks";
import { money } from "@/lib/shopOutfit";
import {
  CART_BOGO_APPLIED,
  CART_BOGO_ONE_ITEM,
  COMPLETE_LOOK_PAIRINGS,
  PDP_COMPLETE_LOOK_PROPERTY,
  bogoSavedFromAllocations,
  cartBogoState,
  inStockSizes,
  lookVariantFor,
  selectCompleteLook,
  sizeFromVariantTitle,
  type CompleteLookVariant,
  type LookItem,
  type LookPick,
} from "@/lib/pdpCompleteLook";

interface CartLookData {
  eligible: Record<string, boolean>;
  pairings: Record<string, Array<LookItem | null>>;
  fallbacks: LookItem[];
}

const cache = new Map<string, Promise<CartLookData>>();
function loadCartLook(slugs: string[]): Promise<CartLookData> {
  const key = [...new Set(slugs)].sort().join(",");
  let hit = cache.get(key);
  if (!hit) {
    hit = fetch(`/api/shop/complete-look?slugs=${encodeURIComponent(key)}`)
      .then((r) => (r.ok ? r.json() : { eligible: {}, pairings: {}, fallbacks: [] }))
      .catch(() => {
        cache.delete(key);
        return { eligible: {}, pairings: {}, fallbacks: [] };
      });
    cache.set(key, hit);
  }
  return hit;
}

/**
 * Test arm of `pdp_complete_look` in the slide cart.
 *   1 eligible piece  -> "Add one more piece and save 15% on it" + 2 picks
 *   2+ eligible       -> "Second piece 15% off applied" + live saved amount
 *                        from Shopify's BOGO15 discount allocations
 */
export function ShopCartBogoLine({ variant }: { variant: CompleteLookVariant }) {
  const {
    cart, cartOpen, cartTotal, cartDiscountCodes, cartDiscountAmounts, hasShopDiscount, addItemsToCart, cartLoading,
  } = useMembership();
  const [data, setData] = useState<CartLookData | null>(null);
  const hasReward = useHasShopReward();

  const slugs = useMemo(() => cart.map((i) => i.slug), [cart]);
  const slugKey = slugs.join(",");
  useEffect(() => {
    if (!cartOpen || !slugKey) return;
    let live = true;
    void loadCartLook(slugKey.split(",")).then((d) => { if (live) setData(d); });
    return () => { live = false; };
  }, [cartOpen, slugKey]);

  const otherCodes = (cartDiscountCodes ?? []).some((c) => c.applicable && c.code.toUpperCase() !== BOGO15_CODE);
  const suppressed = hasShopDiscount || hasReward || otherCodes;
  const lines = cart.map((i) => ({ slug: i.slug, quantity: i.quantity, eligible: !!data?.eligible[i.slug] }));
  const { state, saved } = cartBogoState({
    lines: data ? lines : [],
    bogoSaved: bogoSavedFromAllocations(cartDiscountAmounts),
    suppressed,
  });

  const anchor = cart.find((i) => data?.eligible[i.slug]);
  const picks: LookPick[] = useMemo(() => {
    if (state !== "one_item" || !data || !anchor) return [];
    const pairing = COMPLETE_LOOK_PAIRINGS[anchor.slug] ? data.pairings[anchor.slug] ?? [] : [];
    return selectCompleteLook(pairing, data.fallbacks, {
      vestSize: sizeFromVariantTitle(anchor.variantTitle),
      exclude: slugs,
      requireBogo: true,
    });
  }, [state, data, anchor, slugs]);

  const viewedKey = useRef("");
  useEffect(() => {
    if (!cartOpen || state === "hidden") return;
    if (state === "one_item" && !picks.length) return;
    const key = `${state}|${slugKey}|${saved}`;
    if (viewedKey.current === key) return;
    viewedKey.current = key;
    void trackEvent("cart_bogo_line_view", {
      properties: {
        state,
        cart_value: cartTotal,
        saved: state === "applied" ? saved : null,
        items: picks.map((p) => p.item.slug).join(","),
        [PDP_COMPLETE_LOOK_PROPERTY]: variant,
      },
    });
  }, [cartOpen, state, slugKey, saved, cartTotal, picks, variant]);

  if (state === "applied") {
    return (
      <div role="status" data-testid="cart-bogo-line" data-state="applied" className="mt-4 flex items-center justify-between gap-3 border border-forest/25 bg-forest/5 px-4 py-3">
        <p className="text-[13px] leading-snug text-charcoal">{CART_BOGO_APPLIED}</p>
        <p className="shrink-0 text-[13px] font-semibold text-forest">You save {money(saved)}</p>
      </div>
    );
  }
  if (state !== "one_item" || !picks.length) return null;

  return (
    <section data-testid="cart-bogo-line" data-state="one_item" aria-labelledby="cart-bogo-heading" className="mt-4 border border-charcoal/10 px-4 py-4">
      <p id="cart-bogo-heading" className="text-[13px] leading-snug text-charcoal">{CART_BOGO_ONE_ITEM}</p>
      <div className="mt-3 grid grid-cols-2 gap-3">
        {picks.map((pick) => (
          <SuggestionCard
            key={`${pick.item.slug}:${pick.defaultSize ?? ""}`}
            pick={pick}
            disabled={cartLoading}
            variant={variant}
            onAdd={addItemsToCart}
          />
        ))}
      </div>
    </section>
  );
}

function SuggestionCard({
  pick, disabled, variant, onAdd,
}: {
  pick: LookPick;
  disabled: boolean;
  variant: CompleteLookVariant;
  onAdd: ReturnType<typeof useMembership>["addItemsToCart"];
}) {
  const { item } = pick;
  const [size, setSize] = useState(pick.defaultSize);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const sizes = inStockSizes(item);
  const chosen = lookVariantFor(item, size);

  async function add() {
    if (!chosen || busy) return;
    setBusy(true); setError(false);
    try {
      await onAdd([{
        slug: item.slug,
        name: item.name,
        brand: item.brand,
        price: chosen.price,
        retailPrice: chosen.reservePrice,
        variantId: chosen.id,
        image: item.image,
        variantTitle: chosen.label,
      }]);
      void trackEvent("cart_bogo_suggestion_add", {
        properties: {
          item_handle: item.slug,
          price: chosen.price,
          position: pick.position,
          size: size ?? null,
          [PDP_COMPLETE_LOOK_PROPERTY]: variant,
        },
      });
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="shop-product-card flex flex-col" data-testid={`cart-bogo-item-${item.slug}`}>
      <div className="shop-product-card__image">
        {item.image && <Image src={item.image} alt={item.name} fill sizes="120px" className="object-contain p-3" />}
      </div>
      <p className="shop-product-card__brand">{item.brand}</p>
      <h3 className="!text-[12px]">{item.name}</h3>
      <div className="shop-product-card__price"><span className="text-sm font-semibold">{money(chosen?.price ?? item.variants[0]?.price ?? 0)}</span></div>
      <div className="mt-auto flex gap-2 pt-2">
        {item.sizeOption && sizes.length > 0 && (
          <select
            aria-label={`${item.name} size`}
            value={size ?? ""}
            onChange={(e) => setSize(e.target.value)}
            className="min-h-[36px] min-w-0 flex-1 border border-charcoal/20 bg-white px-1 text-[16px] md:text-[12px]"
          >
            {sizes.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        )}
        <button
          type="button"
          onClick={add}
          disabled={disabled || busy || !chosen}
          aria-label={`Add ${item.name}`}
          className="min-h-[36px] flex-1 bg-charcoal px-2 text-[10px] font-mono uppercase tracking-[0.18em] text-white disabled:opacity-40"
        >
          {busy ? "Adding" : "Add"}
        </button>
      </div>
      {error && <p role="alert" className="mt-1 text-[11px] text-charcoal">Could not add.</p>}
    </div>
  );
}
