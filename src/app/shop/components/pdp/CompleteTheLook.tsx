"use client";

import Image from "next/image";
import { useEffect, useMemo, useRef, useState } from "react";
import { useMembership } from "../../../context/MembershipContext";
import { useHasShopReward } from "../useCompleteLookVariant";
import { trackEvent } from "@/lib/tracking";
import { BOGO15_CODE } from "@/lib/cartPicks";
import { money } from "@/lib/shopOutfit";
import {
  PDP_BOGO_LINE,
  PDP_COMPLETE_LOOK_PROPERTY,
  inStockSizes,
  itemsProperty,
  lookVariantFor,
  pdpBogoLineApplies,
  selectCompleteLook,
  type CompleteLookVariant,
  type LookItem,
  type LookPick,
} from "@/lib/pdpCompleteLook";

interface Props {
  pdpHandle: string;
  /** Pairing items in config order (null where Shopify has no product). */
  pairing: Array<LookItem | null>;
  fallbacks: LookItem[];
  /** The vest is in Shop — All (BOGO15 buy collection). */
  vestBogoEligible: boolean;
  /** Size the shopper picked on the vest. */
  vestSize?: string;
  variant: CompleteLookVariant;
}

/**
 * Test arm of `pdp_complete_look`: two one-tap add-ons under the vest's
 * Add to cart, in the shop product card style. Out-of-stock pairings fall
 * back to the next in-stock gift guide piece; the BOGO15 line shows only
 * where Shopify's automatic discount covers the vest and every shown piece.
 */
export function CompleteTheLook({ pdpHandle, pairing, fallbacks, vestBogoEligible, vestSize, variant }: Props) {
  const { addItemsToCart, hasShopDiscount, memberPrice, cartDiscountCodes } = useMembership();
  const hasReward = useHasShopReward();
  const otherCodes = (cartDiscountCodes ?? []).some((c) => c.applicable && c.code.toUpperCase() !== BOGO15_CODE);

  const picks = useMemo(
    () => selectCompleteLook(pairing, fallbacks, { vestSize, exclude: [pdpHandle] }),
    [pairing, fallbacks, vestSize, pdpHandle]
  );
  const showBogo = pdpBogoLineApplies(vestBogoEligible, picks, hasShopDiscount || hasReward || otherCodes);

  const ref = useRef<HTMLElement>(null);
  const viewedKey = useRef("");
  const items = itemsProperty(picks);
  useEffect(() => {
    const el = ref.current;
    if (!el || !items) return;
    const key = `${pdpHandle}|${items}`;
    const fire = () => {
      if (viewedKey.current === key) return;
      viewedKey.current = key;
      void trackEvent("complete_look_view", {
        properties: {
          pdp_handle: pdpHandle,
          items,
          item_count: picks.length,
          vest_size: vestSize ?? null,
          bogo_line: showBogo,
          [PDP_COMPLETE_LOOK_PROPERTY]: variant,
        },
      });
    };
    if (typeof IntersectionObserver === "undefined") { fire(); return; }
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) { fire(); io.disconnect(); }
    }, { threshold: 0.3 });
    io.observe(el);
    return () => io.disconnect();
  }, [items, pdpHandle, picks.length, vestSize, showBogo, variant]);

  if (!picks.length) return null;

  return (
    <section
      ref={ref}
      aria-labelledby="complete-look-heading"
      data-testid="complete-the-look"
      className="mt-6 border-t border-charcoal/10 pt-5"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2 id="complete-look-heading" className="text-[11px] font-mono uppercase tracking-[0.2em] text-charcoal">
          Complete the look
        </h2>
        {showBogo && (
          <p data-testid="complete-look-bogo" className="text-[12px] text-forest">{PDP_BOGO_LINE}</p>
        )}
      </div>
      <div className="mt-3 grid grid-cols-2 gap-4">
        {picks.map((pick) => (
          <LookCard
            key={`${pick.item.slug}:${pick.defaultSize ?? ""}`}
            pick={pick}
            pdpHandle={pdpHandle}
            variant={variant}
            displayPrice={(n) => (hasShopDiscount ? memberPrice(n) : n)}
            isMember={hasShopDiscount}
            onAdd={addItemsToCart}
          />
        ))}
      </div>
    </section>
  );
}

function LookCard({
  pick,
  pdpHandle,
  variant,
  displayPrice,
  isMember,
  onAdd,
}: {
  pick: LookPick;
  pdpHandle: string;
  variant: CompleteLookVariant;
  displayPrice: (n: number) => number;
  isMember: boolean;
  onAdd: ReturnType<typeof useMembership>["addItemsToCart"];
}) {
  const { item, position } = pick;
  const [size, setSize] = useState(pick.defaultSize);
  const [state, setState] = useState<"idle" | "adding" | "added" | "error">("idle");
  const sizes = inStockSizes(item);
  const chosen = lookVariantFor(item, size);
  const price = chosen?.price ?? item.variants[0]?.price ?? 0;
  const shown = displayPrice(price);

  async function add() {
    if (!chosen || state === "adding") return;
    setState("adding");
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
      }]); // Shopify applies BOGO15 automatically where it qualifies.
      setState("added");
      void trackEvent("complete_look_add", {
        properties: {
          pdp_handle: pdpHandle,
          item_handle: item.slug,
          price: chosen.price,
          position,
          size: size ?? null,
          source: pick.source,
          [PDP_COMPLETE_LOOK_PROPERTY]: variant,
        },
      });
      setTimeout(() => setState("idle"), 2000);
    } catch {
      setState("error");
    }
  }

  const selectId = `complete-look-size-${item.slug}`;
  return (
    <div className="shop-product-card flex flex-col" data-testid={`complete-look-item-${item.slug}`}>
      <a href={`/shop/${item.slug}`} className="shop-product-card__image block" aria-label={item.name} tabIndex={-1}>
        {item.image && (
          <Image src={item.image} alt={item.name} fill sizes="(max-width: 768px) 45vw, 20vw" className="object-contain p-4" />
        )}
      </a>
      <a href={`/shop/${item.slug}`} className="block">
        <p className="shop-product-card__brand">{item.brand}</p>
        <h3>{item.name}</h3>
      </a>
      <div className="shop-product-card__price">
        {isMember && shown !== price && (
          <span className="text-[11px] font-mono text-charcoal/40 line-through">{money(price)}</span>
        )}
        <span className="text-sm font-semibold text-charcoal">{money(shown)}</span>
      </div>
      <div className="mt-auto flex items-stretch gap-2 pt-3">
        {item.sizeOption && sizes.length > 0 && (
          <>
            <label htmlFor={selectId} className="sr-only">{item.name} size</label>
            <select
              id={selectId}
              value={size ?? ""}
              onChange={(e) => setSize(e.target.value)}
              className="min-h-[40px] min-w-0 flex-1 border border-charcoal/20 bg-white px-2 text-[16px] md:text-[13px]"
            >
              {sizes.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </>
        )}
        <button
          type="button"
          onClick={add}
          disabled={!chosen || state === "adding"}
          aria-label={`Add ${item.name}${size ? `, size ${size}` : ""}`}
          className="min-h-[40px] flex-1 bg-charcoal px-3 text-[11px] font-mono uppercase tracking-[0.18em] text-white disabled:opacity-40"
        >
          {state === "adding" ? "Adding" : state === "added" ? "Added" : "Add"}
        </button>
      </div>
      {state === "error" && <p role="alert" className="mt-2 text-[12px] text-charcoal">Could not add. Try again.</p>}
    </div>
  );
}
