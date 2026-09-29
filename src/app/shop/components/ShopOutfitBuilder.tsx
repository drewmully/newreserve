"use client";
/* eslint-disable @next/next/no-img-element */
import { useMemo, useRef, useState } from "react";
import type { ShopifyProduct } from "@/lib/shopify";
import { useMembership } from "@/app/context/MembershipContext";
import { getSizeGuide } from "@/lib/sizeCharts";
import {
  OUTFIT_SLOTS,
  OUTFIT_STORAGE_KEY,
  RESERVE_OUTFIT_PRICE,
  money,
  outfitEstimate,
  outfitOptions,
  variantLabel,
  outfitProductName,
} from "@/lib/shopOutfit";
import { trackEvent } from "@/lib/tracking";

export function ShopOutfitBuilder({
  products,
  byCategory,
}: {
  products: ShopifyProduct[];
  byCategory: Record<string, ShopifyProduct[]>;
}) {
  const options = useMemo(
    () =>
      OUTFIT_SLOTS.map((s) =>
        outfitOptions(products, byCategory[s.category] || [], s.slugs),
      ),
    [products, byCategory],
  );
  const [indices, setIndices] = useState<(number | null)[]>([0, 0, 0]);
  const [active, setActive] = useState(0);
  const [variants, setVariants] = useState<Record<string, string>>({});
  const [mode, setMode] = useState<"once" | "reserve">("once");
  const [review, setReview] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [fit, setFit] = useState<ShopifyProduct | null>(null);
  const fitRef = useRef<HTMLDialogElement>(null);
  const root = useRef<HTMLElement>(null);
  const { addItemsToCart } = useMembership();
  const selected = options.map((list, i) =>
    indices[i] === null ? undefined : list[indices[i]!],
  );
  const chosen = selected.filter((p): p is ShopifyProduct => !!p);
  const current = selected[active];
  const selectedVariants = selected.map((p) =>
    p?.variants.find((v) => v.id === variants[p.slug]),
  );
  const missing = selected.findIndex((p, i) => p && !selectedVariants[i]);
  const full = chosen.length === 3;
  const estimate = outfitEstimate(
    chosen.map(
      (p) =>
        p.variants.find((v) => v.id === variants[p.slug])?.price ?? p.price,
    ),
  );
  const unavailable = selectedVariants.some((v) => v && !v.availableForSale);
  function tab(i: number) {
    setActive(i);
    setReview(false);
    setError("");
  }
  function reveal() {
    root.current?.scrollIntoView({ block: "start", behavior: "instant" });
  }
  function chooseMissing() {
    if (missing < 0) return false;
    tab(missing);
    requestAnimationFrame(() => {
      reveal();
      root.current
        ?.querySelector<HTMLButtonElement>("[data-size]")
        ?.focus({ preventScroll: true });
    });
    return true;
  }
  function reviewOutfit() {
    setReview(true);
    requestAnimationFrame(reveal);
  }
  function showFit(p: ShopifyProduct) {
    setFit(p);
    fitRef.current?.showModal();
  }
  async function add() {
    if (chooseMissing() || !chosen.length) return;
    setError("");
    if (mode === "reserve") {
      const guide = {
        createdAt: Date.now(),
        items: chosen.map((p) => {
          const v = p.variants.find((x) => x.id === variants[p.slug])!;
          return {
            slug: p.slug,
            name: p.name,
            brand: p.brand,
            variantId: v.id,
            size: variantLabel(v),
            image: v.image || p.images[0] || "",
          };
        }),
      };
      try {
        sessionStorage.setItem(OUTFIT_STORAGE_KEY, JSON.stringify(guide));
      } catch {
        setError(
          "Allow session storage to carry your outfit into Reserve, or continue from the main Mully page.",
        );
        return;
      }
      void trackEvent("shop_outfit_reserve_clicked", {
        properties: {
          source: "shop_outfit",
          products: chosen.map((p) => p.slug),
        },
      });
      window.location.assign("/?shop_outfit=1#quiz");
      return;
    }
    if (unavailable) {
      setError(
        "One of these options is unavailable. Please choose an available size or remove that piece.",
      );
      return;
    }
    setBusy(true);
    try {
      await addItemsToCart(
        chosen.map((p) => {
          const v = p.variants.find((x) => x.id === variants[p.slug])!;
          return {
            slug: p.slug,
            name: p.name,
            brand: p.brand,
            price: v.price,
            retailPrice: v.price,
            variantId: v.id,
            image: v.image || p.images[0],
            variantTitle: variantLabel(v),
          };
        }),
        "BOGO15",
      );
    } catch {
      setError(
        "We couldn’t add the outfit. Your bag has been refreshed; check it before retrying.",
      );
    } finally {
      setBusy(false);
    }
  }
  const sizeCount = selectedVariants.filter(Boolean).length;
  const guide = fit ? getSizeGuide(fit.slug) : null;
  return (
    <section
      id="outfit"
      ref={root}
      className={`sec sec--cream outfit${review ? " is-review" : ""}`}
      aria-labelledby="outfitTitle"
    >
      <div className="wrap">
        <div className="sechead">
          <div>
            <h2 className="h2" id="outfitTitle">
              Build your outfit.
              <br />
              <em>Make it yours.</em>
            </h2>
            <p className="lede">
              Choose a top, a bottom, and a layer. Or make it the starting point
              for Mully Reserve, {money(RESERVE_OUTFIT_PRICE)} per quarter.
            </p>
          </div>
          <button
            className="outfit__back"
            onClick={() => {
              setReview(false);
              reveal();
            }}
          >
            ← Edit pieces
          </button>
        </div>
        <div className="outfit__layout">
          <div className="outfit__workspace">
            <div
              className="outfit__tabs"
              role="tablist"
              aria-label="Outfit categories"
            >
              {OUTFIT_SLOTS.map((slot, i) => (
                <button
                  key={slot.label}
                  id={`outfitTab${i}`}
                  role="tab"
                  aria-selected={active === i}
                  aria-controls="outfitCards"
                  tabIndex={active === i ? 0 : -1}
                  onClick={() => tab(i)}
                  onKeyDown={(e) => {
                    if (
                      ["ArrowRight", "ArrowLeft", "Home", "End"].includes(e.key)
                    ) {
                      e.preventDefault();
                      const n =
                        e.key === "Home"
                          ? 0
                          : e.key === "End"
                            ? 2
                            : (i + (e.key === "ArrowRight" ? 1 : 2)) % 3;
                      tab(n);
                      document.getElementById(`outfitTab${n}`)?.focus();
                    }
                  }}
                >
                  <span className="outfit-tab__number">{i + 1}</span>
                  {selected[i]?.images[0] && (
                    <img
                      className="outfit-tab__thumb"
                      src={selected[i]!.images[0]}
                      alt=""
                    />
                  )}
                  <span>
                    {slot.label}
                    <small>
                      {selectedVariants[i]
                        ? variantLabel(selectedVariants[i]!)
                        : selected[i]
                          ? "Pick size"
                          : "Add piece"}
                    </small>
                  </span>
                </button>
              ))}
            </div>
            <div className="outfit__workspace-head">
              <div>
                <h3>Choose your {OUTFIT_SLOTS[active].label.toLowerCase()}.</h3>
                <p>Tap a piece, then choose your size.</p>
              </div>
              <span id="outfitStepCount">0{active + 1} / 03</span>
            </div>
            <div
              id="outfitCards"
              role="tabpanel"
              aria-labelledby={`outfitTab${active}`}
            >
              {options[active].map((p, i) => (
                <article className="outfit-choice" key={p.slug}>
                  <button
                    className="outfit-choice__pick"
                    aria-pressed={indices[active] === i}
                    onClick={() => {
                      setIndices((xs) =>
                        xs.map((x, j) => (j === active ? i : x)),
                      );
                      setError("");
                    }}
                  >
                    <span className="outfit-choice__image">
                      {p.images[0] && <img src={p.images[0]} alt={p.name} />}
                      <span className="outfit-choice__check" aria-hidden>
                        {indices[active] === i ? "✓" : "+"}
                      </span>
                    </span>
                    <span className="outfit-choice__meta">
                      <span className="outfit-choice__brand">{p.brand}</span>
                      <span className="outfit-choice__name">
                        {outfitProductName(p)}
                      </span>
                      <span className="outfit-choice__foot">
                        <span>{money(p.price)}</span>
                        <span className="outfit-choice__state">
                          {indices[active] === i ? "Selected" : "Choose"}
                        </span>
                      </span>
                    </span>
                  </button>
                  <button
                    className="outfit-choice__details"
                    onClick={() => showFit(p)}
                  >
                    Details &amp; fit ↗
                  </button>
                </article>
              ))}
              {!options[active].length && (
                <p>
                  No pieces in this category yet. Browse the shop for more
                  options.
                </p>
              )}
            </div>
            <div className="outfit__size">
              {current ? (
                <>
                  <div className="outfit__size-head">
                    <span id="outfitSizeLabel">
                      {OUTFIT_SLOTS[active].label} size
                    </span>
                    <button onClick={() => showFit(current)}>
                      Size &amp; fit ↗
                    </button>
                  </div>
                  <div
                    className="outfit__sizes"
                    role="group"
                    aria-labelledby="outfitSizeLabel"
                  >
                    {current.variants.map((v) => (
                      <button
                        key={v.id}
                        data-size={v.id}
                        data-unavailable={!v.availableForSale || undefined}
                        aria-pressed={variants[current.slug] === v.id}
                        title={
                          v.availableForSale
                            ? variantLabel(v)
                            : `${variantLabel(v)}: unavailable for one-time purchase`
                        }
                        onClick={() =>
                          setVariants((x) => ({ ...x, [current.slug]: v.id }))
                        }
                      >
                        {variantLabel(v)}
                        {!v.availableForSale && (
                          <span className="sr"> · Unavailable</span>
                        )}
                      </button>
                    ))}
                  </div>
                  {current.variants.every(v => !v.availableForSale) && <p className="outfit__stock-note">Unavailable to buy now. Sizes can still guide Reserve.</p>}
                </>
              ) : (
                <p>Select a piece to see its sizes.</p>
              )}
            </div>
            <div className="outfit__next">
              <span>
                Just want one piece? Remove the others from your outfit.
              </span>
              <button
                onClick={() => (active < 2 ? tab(active + 1) : reviewOutfit())}
              >
                {active < 2
                  ? `Next: choose a ${OUTFIT_SLOTS[active + 1].label.toLowerCase()} →`
                  : "Review your outfit →"}
              </button>
            </div>
          </div>
          <aside
            className="outfit__summary"
            id="outfitSummary"
            aria-label="Your outfit"
          >
            <div className="outfit__summary-head">
              <h3>Your outfit.</h3>
              <span id="outfitCount">{chosen.length} of 3 pieces</span>
            </div>
            <div className="outfit__board">
              {OUTFIT_SLOTS.map((s, i) => (
                <button
                  key={s.label}
                  onClick={() => tab(i)}
                  aria-label={`Edit ${s.label}`}
                >
                  <span className="outfit__board-label">{s.label} ↗</span>
                  {selected[i]?.images[0] ? (
                    <img src={selected[i]!.images[0]} alt={selected[i]!.name} />
                  ) : (
                    <span className="outfit__placeholder">+</span>
                  )}
                </button>
              ))}
            </div>
            <ul className="outfit__lines">
              {OUTFIT_SLOTS.map((s, i) => (
                <li key={s.label}>
                  <button className="outfit__line-name" onClick={() => tab(i)}>
                    {selected[i]
                      ? outfitProductName(selected[i]!)
                      : `+ Choose a ${s.label.toLowerCase()}`}
                    <span className="outfit__line-size">
                      {selectedVariants[i]
                        ? variantLabel(selectedVariants[i]!)
                        : "Choose size"}{" "}
                      · Edit
                    </span>
                  </button>
                  {selected[i] && (
                    <button
                      className="outfit__remove"
                      aria-label={`Remove ${s.label}`}
                      onClick={() => {
                        setIndices((xs) =>
                          xs.map((x, j) => (j === i ? null : x)),
                        );
                        setMode("once");
                      }}
                    >
                      ×
                    </button>
                  )}
                </li>
              ))}
            </ul>
            <fieldset className="outfit__purchase">
              <legend>How would you like it?</legend>
              <label
                className={`purchase-option ${mode === "once" ? "is-selected" : ""}`}
                id="onceOption"
              >
                <input
                  type="radio"
                  name="outfitPurchase"
                  checked={mode === "once"}
                  onChange={() => setMode("once")}
                />
                <span>
                  <span className="purchase-option__title">
                    Just this time{" "}
                    <span className="purchase-option__prices">
                      {estimate.savings > 0 && (
                        <s>{money(estimate.subtotal)}</s>
                      )}
                      <strong>{money(estimate.total)}</strong>
                    </span>
                  </span>
                  <span className="purchase-option__saving">
                    BOGO15 estimate · {money(estimate.savings)} off one piece
                  </span>
                </span>
              </label>
              <label
                className={`purchase-option purchase-option--subscription ${mode === "reserve" ? "is-selected" : ""} ${!full ? "is-disabled" : ""}`}
                id="subscriptionOption"
              >
                <input
                  type="radio"
                  name="outfitPurchase"
                  disabled={!full}
                  checked={mode === "reserve"}
                  onChange={() => setMode("reserve")}
                />
                <span>
                  <span className="purchase-option__title">
                    Mully Reserve <strong>{money(RESERVE_OUTFIT_PRICE)}</strong>
                  </span>
                  <span className="purchase-option__saving">
                    {full && estimate.total > RESERVE_OUTFIT_PRICE
                      ? `Save ${money(estimate.total - RESERVE_OUTFIT_PRICE)} vs. BOGO15`
                      : "Choose all 3 for your style guide"}
                  </span>
                  <span className="purchase-option__copy">
                    Use this outfit as your guide. New styles every 3 months.
                  </span>
                </span>
              </label>
            </fieldset>
            <p className="outfit__terms">
              {mode === "reserve"
                ? "Reserve checkout: $250/quarter. Cancel after your first quarter, before renewal. Exact styles depend on availability."
                : "15% off one lowest-priced item with 2+. Shopify confirms eligibility and your final total in the bag."}
            </p>
            {error && (
              <p className="outfit-error" role="alert">
                {error}
              </p>
            )}
            {unavailable && mode === "once" && (
              <p className="outfit-error" role="status">
                Selected option unavailable. Change the size or view product
                details.
              </p>
            )}
            <button
              className="btn btn--accent btn--block"
              disabled={
                busy ||
                !chosen.length ||
                (missing < 0 && unavailable && mode === "once")
              }
              onClick={add}
            >
              {busy
                ? "Adding…"
                : missing >= 0
                  ? "Choose remaining sizes →"
                  : mode === "reserve"
                    ? "Continue with Mully Reserve →"
                    : `Add ${chosen.length === 1 ? "piece" : "outfit"} to bag`}
            </button>
            <p className="outfit__fine">
              No subscription unless you enroll in Reserve.
            </p>
          </aside>
          <div className="outfit__mobile-footer">
            {full && (
              <button className="outfit__compare" onClick={reviewOutfit}>
                <span>
                  <strong>Or Mully Reserve, $250</strong>
                  <small>Quarterly curation, inspired by your picks</small>
                </span>
                <span>Compare →</span>
              </button>
            )}
            <button
              className="btn btn--accent btn--block"
              onClick={() => {
                if (!chooseMissing()) reviewOutfit();
              }}
            >
              {missing >= 0
                ? `Choose ${OUTFIT_SLOTS[missing].label.toLowerCase()} size →`
                : `Review outfit · ${money(estimate.total)}`}
            </button>
            <p id="outfitMobileProgress">
              {sizeCount} of {chosen.length} sizes chosen · BOGO15 estimate{" "}
              {money(estimate.total)}
            </p>
          </div>
        </div>
        <p className="outfit__preview">
          Live catalog options. Availability and final pricing confirmed by
          Shopify.
        </p>
      </div>
      <dialog
        className="outfit-fit"
        ref={fitRef}
        aria-labelledby="outfitFitTitle"
      >
        <div className="outfit-fit__head">
          <h2 id="outfitFitTitle">Size &amp; fit</h2>
          <button
            onClick={() => fitRef.current?.close()}
            aria-label="Close size guide"
          >
            ×
          </button>
        </div>
        {fit && (
          <>
            <p className="outfit-fit__brand">{fit.brand}</p>
            <h3>{fit.name}</h3>
            <p>
              {fit.fitNotes || guide?.fitNote || fit.sizing || fit.description}
            </p>
            {guide && (
              <>
                <div className="fit-table">
                  <table>
                    <caption>
                      {guide.chart.measurementType === "garment"
                        ? "Garment measurements"
                        : "Body measurements"}
                      , inches
                    </caption>
                    <thead>
                      <tr>
                        <th>Size</th>
                        {guide.chart.columns.map((c) => (
                          <th key={c}>{c}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {guide.chart.rows.map((r) => (
                        <tr key={r.size}>
                          <th>{r.size}</th>
                          {guide.chart.columns.map((c) => (
                            <td key={c}>{r[c]}</td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="outfit-fit__note">{guide.source}</p>
              </>
            )}
            <a href={`/shop/${fit.slug}`}>View full product details ↗</a>
          </>
        )}
      </dialog>
    </section>
  );
}
