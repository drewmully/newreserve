"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useMembership } from "../../context/MembershipContext";
import { trackEvent } from "@/lib/tracking";
import { readShopReward } from "@/lib/shopRewards";
import {
  BOGO15_CODE,
  bogoSavings,
  resolveVariant,
  selectCartPicks,
  type CartPickProduct,
  type PickFatigue,
} from "@/lib/cartPicks";

const FATIGUE_KEY = "mully_cart_picks_v1";
const FATIGUE_TTL_MS = 14 * 24 * 60 * 60 * 1000;

let catalogPromise: Promise<CartPickProduct[]> | null = null;
function loadCatalog(): Promise<CartPickProduct[]> {
  catalogPromise ??= fetch("/api/shop/cart-picks")
    .then((r) => (r.ok ? r.json() : { products: [] }))
    .then((j: { products?: CartPickProduct[] }) => j.products ?? [])
    .catch(() => {
      catalogPromise = null; // allow a retry on the next open
      return [];
    });
  return catalogPromise;
}

interface FatigueStore {
  at: number;
  rotation: number;
  picks: PickFatigue;
}
function readFatigue(): FatigueStore {
  try {
    const raw = JSON.parse(localStorage.getItem(FATIGUE_KEY) || "null") as FatigueStore | null;
    if (raw && Date.now() - raw.at < FATIGUE_TTL_MS) return raw;
  } catch { /* optional storage */ }
  return { at: Date.now(), rotation: 0, picks: {} };
}
function writeFatigue(store: FatigueStore) {
  try { localStorage.setItem(FATIGUE_KEY, JSON.stringify(store)); } catch { /* optional storage */ }
}

function money(n: number): string {
  return Number.isInteger(n) ? `$${n}` : `$${n.toFixed(2)}`;
}

export function ShopCartBogoNudge({ accent }: { accent: string }) {
  const { cart, cartOpen, setCartOpen, cartDiscountCodes, hasShopDiscount, addItemsToCart, cartLoading } =
    useMembership();
  const [catalog, setCatalog] = useState<CartPickProduct[]>([]);
  const [rotation, setRotation] = useState(0);
  const [fatigue, setFatigue] = useState<PickFatigue>({});
  const [openSlug, setOpenSlug] = useState<string | null>(null);
  const [chosen, setChosen] = useState<Record<string, string>>({});
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState("");
  const viewedKey = useRef("");

  const units = cart.reduce((n, i) => n + i.quantity, 0);
  const codes = cartDiscountCodes ?? [];
  const bogo = codes.find((c) => c.code.toUpperCase() === BOGO15_CODE);
  const otherCodes = codes.some((c) => c.code.toUpperCase() !== BOGO15_CODE);
  const [hasReward, setHasReward] = useState(false);
  useEffect(() => { setHasReward(Boolean(readShopReward())); }, [cartOpen]);
  const suppressed = hasShopDiscount || hasReward || otherCodes;

  // Load the catalog and advance the rotation once per cart open.
  useEffect(() => {
    if (!cartOpen || suppressed || units !== 1) return;
    let live = true;
    void loadCatalog().then((c) => { if (live) setCatalog(c); });
    const store = readFatigue();
    const next = { ...store, rotation: store.rotation + 1 };
    writeFatigue(next);
    setRotation(next.rotation);
    setFatigue(next.picks);
    return () => { live = false; };
  }, [cartOpen, suppressed, units]);

  const cartSlugs = useMemo(() => cart.map((i) => i.slug), [cart]);
  const anchor = catalog.find((p) => p.slug === cart[0]?.slug);
  const picks = useMemo(
    () => (anchor ? selectCartPicks(catalog, cartSlugs, { fatigue, rotation }) : []),
    [anchor, catalog, cartSlugs, fatigue, rotation]
  );

  // Count impressions once per open so ignored picks rotate out over time.
  useEffect(() => {
    if (!cartOpen || !picks.length) return;
    const key = `${rotation}:${picks.map((p) => p.slug).join(",")}`;
    if (viewedKey.current === key) return;
    viewedKey.current = key;
    const store = readFatigue();
    for (const p of picks) {
      const f = store.picks[p.slug] ?? { seen: 0, clicked: 0 };
      store.picks[p.slug] = { ...f, seen: f.seen + 1 };
    }
    writeFatigue(store);
    void trackEvent("bogo_nudge_viewed", {
      properties: { picks: picks.map((p) => p.slug), anchor: anchor?.slug, rotation },
    });
  }, [cartOpen, picks, rotation, anchor]);

  if (suppressed || !cart.length) return null;

  // 2+ pieces: confirm the offer is working instead of selling more.
  if (units >= 2) {
    if (!bogo?.applicable) return null;
    return (
      <div role="status" className="mt-4 flex items-center gap-3 border border-forest/25 bg-forest/5 px-4 py-3">
        <span className="shrink-0 rounded-full bg-forest px-2 py-1 text-[10px] font-mono uppercase tracking-[0.18em] text-white">
          {BOGO15_CODE}
        </span>
        <p className="text-[13px] leading-snug text-charcoal">
          Applied. 15% off one piece is already in your total.
        </p>
      </div>
    );
  }

  if (!anchor || !picks.length) return null;
  const anchorPrice = cart[0]?.retailPrice ?? cart[0]?.price ?? anchor.price;
  const open = picks.find((p) => p.slug === openSlug) ?? null;
  const variant = open ? resolveVariant(open, chosen) : null;

  function toggle(p: CartPickProduct) {
    setError("");
    if (openSlug === p.slug) { setOpenSlug(null); return; }
    setOpenSlug(p.slug);
    // Preselect any option with a single available value.
    const pre: Record<string, string> = {};
    for (const o of p.choiceOptions) {
      const avail = o.values.filter((v) => p.variants.some((x) => x.options[o.name] === v));
      if (avail.length === 1) pre[o.name] = avail[0];
    }
    setChosen(pre);
    const store = readFatigue();
    const f = store.picks[p.slug] ?? { seen: 0, clicked: 0 };
    store.picks[p.slug] = { ...f, clicked: f.clicked + 1 };
    writeFatigue(store);
    void trackEvent("bogo_pick_opened", { properties: { product: p.slug, anchor: anchor?.slug } });
  }

  async function add() {
    if (!open || !variant || adding) return;
    setAdding(true);
    setError("");
    try {
      await addItemsToCart([{
        slug: open.slug,
        name: open.name,
        brand: open.brand,
        price: variant.price,
        retailPrice: variant.price,
        variantId: variant.id,
        image: open.image,
        variantTitle: variant.title,
      }]);
      void trackEvent("bogo_pick_added", {
        properties: { product: open.slug, anchor: anchor?.slug, value: variant.price },
      });
      setOpenSlug(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "We couldn't add that piece. Please try again.");
    } finally {
      setAdding(false);
    }
  }

  function optionAvailable(p: CartPickProduct, name: string, value: string) {
    return p.variants.some(
      (v) => v.options[name] === value &&
        p.choiceOptions.every((o) => o.name === name || !chosen[o.name] || v.options[o.name] === chosen[o.name])
    );
  }

  return (
    <section aria-labelledby="bogo-nudge-title" className="mt-4 border border-charcoal/10 bg-cream/60 px-4 pb-4 pt-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[10px] font-mono uppercase tracking-[0.22em] text-charcoal/55">Don&apos;t forget</p>
          <h3 id="bogo-nudge-title" className="mt-1 font-serif text-[19px] leading-tight text-charcoal">
            Take advantage of BOGO15
          </h3>
          <p className="mt-1 text-[13px] leading-snug text-charcoal/70">
            Add one more piece and save 15% on one of them. It applies automatically.
          </p>
        </div>
        <button
          type="button"
          onClick={() => { setOpenSlug(null); setRotation((r) => r + 1); }}
          className="min-h-[44px] shrink-0 px-1 text-[10px] font-mono uppercase tracking-[0.2em] text-charcoal/60 underline underline-offset-4"
          aria-label="Show other picks"
        >
          More picks
        </button>
      </div>

      <ul
        className="-mx-4 mt-3 flex snap-x snap-mandatory gap-3 overflow-x-auto overscroll-x-contain px-4 pb-1"
        style={{ scrollbarWidth: "none", WebkitOverflowScrolling: "touch" }}
        aria-label="Pairs well with your piece"
      >
        {picks.map((p) => {
          const selected = p.slug === openSlug;
          return (
            <li key={p.slug} className="w-[42%] min-w-[132px] max-w-[160px] shrink-0 snap-start">
              <button
                type="button"
                onClick={() => toggle(p)}
                aria-expanded={selected}
                className={`block w-full border bg-white text-left transition-colors ${selected ? "border-charcoal" : "border-charcoal/10"}`}
              >
                <span className="relative block aspect-[4/5] w-full overflow-hidden bg-cream">
                  {p.image ? (
                    <Image src={p.image} alt={p.name} fill sizes="160px" className="object-cover" />
                  ) : null}
                </span>
                <span className="block px-2.5 pb-2.5 pt-2">
                  <span className="block truncate text-[9px] font-mono uppercase tracking-[0.2em] text-charcoal/50">{p.brand}</span>
                  <span className="mt-0.5 line-clamp-2 block min-h-[2.4em] text-[12.5px] leading-[1.2] text-charcoal">{p.name}</span>
                  <span className="mt-1.5 flex items-baseline justify-between gap-1">
                    <span className="text-[13px] font-medium text-charcoal">{money(p.price)}</span>
                    <span className="text-[11px] text-forest">Save {money(bogoSavings(anchorPrice, p.price))}</span>
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      {open && (
        <div className="mt-3 border border-charcoal/10 bg-white p-3">
          <p className="text-[13px] font-medium text-charcoal">{open.name}</p>
          {open.quickAdd ? (
            <>
              {open.choiceOptions.map((o) => (
                <fieldset key={o.name} className="mt-3">
                  <legend className="text-[10px] font-mono uppercase tracking-[0.2em] text-charcoal/55">{o.name}</legend>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {o.values.map((v) => {
                      const on = chosen[o.name] === v;
                      const ok = optionAvailable(open, o.name, v);
                      return (
                        <button
                          key={v}
                          type="button"
                          disabled={!ok}
                          aria-pressed={on}
                          onClick={() => setChosen((c) => ({ ...c, [o.name]: v }))}
                          className={`min-h-[44px] min-w-[44px] border px-3 text-[13px] transition-colors disabled:opacity-30 ${on ? "border-charcoal bg-charcoal text-white" : "border-charcoal/20 text-charcoal"}`}
                        >
                          {v}
                        </button>
                      );
                    })}
                  </div>
                </fieldset>
              ))}
              <button
                type="button"
                onClick={add}
                disabled={!variant || adding || cartLoading}
                className="mt-3 flex min-h-[48px] w-full items-center justify-center text-[11px] font-mono uppercase tracking-[0.24em] text-white transition-opacity disabled:opacity-40"
                style={{ backgroundColor: accent }}
              >
                {adding ? "Adding…" : variant ? `Add to bag · ${money(variant.price)}` : "Choose your size"}
              </button>
            </>
          ) : (
            <Link
              href={`/shop/${open.slug}`}
              onClick={() => setCartOpen(false)}
              className="mt-3 flex min-h-[48px] w-full items-center justify-center border border-charcoal text-[11px] font-mono uppercase tracking-[0.24em] text-charcoal"
            >
              Choose your fit
            </Link>
          )}
          {error && <p role="alert" className="mt-2 text-xs text-red-700">{error}</p>}
        </div>
      )}
    </section>
  );
}
