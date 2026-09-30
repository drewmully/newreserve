"use client";
/* eslint-disable @next/next/no-img-element */
import { useMemo, useRef, useState } from "react";
import type { ShopifyProduct } from "@/lib/shopify";
import { useMembership } from "@/app/context/MembershipContext";
import { getSizeGuide } from "@/lib/sizeCharts";
import { shopProductPhoto, shopProductLabel } from "@/lib/shopProductPhotos";
import {
  OUTFIT_SLOTS,
  RESERVE_OUTFIT_PRICE,
  money,
  outfitEstimate,
  outfitOptions,
  variantLabel,
} from "@/lib/shopOutfit";
import { trackEvent } from "@/lib/tracking";
import { createMembershipCheckout } from "@/lib/shopifyCheckout";
import { CompactVariantPicker } from "./CompactVariantPicker";

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
  const [zoom, setZoom] = useState<ShopifyProduct | null>(null);
  const zoomRef = useRef<HTMLDialogElement>(null);
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
    if (busy || chooseMissing() || !chosen.length) return;
    setError("");
    if (unavailable && mode === "once") {
      setError("Choose available sizes for each piece before checking out.");
      return;
    }
    if (mode === "reserve") {
      if (!full) { setError("Choose a top, bottom, and layer for Reserve."); return; }
      setBusy(true);
      try {
        void trackEvent("shop_outfit_reserve_clicked", {properties:{source:"shop_outfit",products:chosen.map(p=>p.slug)}});
        await createMembershipCheckout("member", {
          firstBoxItems: selected.map((p,i) => ({
            variantId: variants[p!.slug],
            slot: (["Top","Bottom","Layer"] as const)[i],
            name: p!.name,
            size: variantLabel(selectedVariants[i]!),
          })),
        });
      } catch (err) {
        setError(err instanceof Error ? err.message : "We couldn’t open checkout. Please try again.");
      } finally { setBusy(false); }
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
            </h2>
            <p className="lede">
              Pick your pieces. Choose your sizes. Make it yours.
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
                  <span className="outfit-tab__number">{selectedVariants[i] ? "✓" : i + 1}</span>
                  {selected[i]?.images[0] && (
                    <img
                      className="outfit-tab__thumb"
                      src={selectedVariants[i]?.image || shopProductPhoto(selected[i]!)}
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
            <div
              id="outfitCards"
              role="tabpanel"
              aria-labelledby={`outfitTab${active}`}
            >
              {options[active].map((p, i) => (
                <article className="outfit-choice" key={p.slug}>
                  <button
                    className="outfit-choice__pick"
                    aria-label={`Choose ${p.name}`}
                    aria-pressed={indices[active] === i}
                    onClick={() => {
                      setIndices((xs) =>
                        xs.map((x, j) => (j === active ? i : x)),
                      );
                      setError("");
                    }}
                  >
                    <span className="outfit-choice__image">
                      {p.images[0] && <img src={p.variants.find(v => v.id === variants[p.slug])?.image || shopProductPhoto(p)} alt={p.name} />}
                      <span className="outfit-choice__check" aria-hidden>
                        {indices[active] === i ? "✓" : "+"}
                      </span>
                    </span>
                    <span className="outfit-choice__meta">
                      <span className="outfit-choice__brand">{p.brand}</span>
                      <span className="outfit-choice__name" title={p.name}>
                        {shopProductLabel(p)}
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
                    className="outfit-choice__zoom"
                    aria-label={`Enlarge ${p.name} photo`}
                    onClick={() => {
                      setZoom(p);
                      zoomRef.current?.showModal();
                    }}
                  >
                    ⤢
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
                  <div role="group" aria-labelledby="outfitSizeLabel">
                    <CompactVariantPicker key={current.slug} product={current} value={variants[current.slug] || ""}
                      allowUnavailable onChange={id => setVariants(x => ({...x, [current.slug]: id}))} />
                  </div>
                  {selectedVariants[active]?.currentlyNotInStock && <p className="outfit__stock-note">Preorder · Ships in about {current.preOrderEtaWeeks || 2} weeks</p>}
                  {current.variants.every(v => !v.availableForSale) && <p className="outfit__stock-note">Sold out individually · Available to select for your Reserve first box.</p>}
                </>
              ) : (
                <p>Select a piece to see its sizes.</p>
              )}
            </div>
            <div className="outfit__next">
              <span>
                Tap a photo to switch. Your sizes stay saved.
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
                    <img src={selectedVariants[i]?.image || shopProductPhoto(selected[i]!)} alt={selected[i]!.name} />
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
                      ? shopProductLabel(selected[i]!)
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
                      : "Your first outfit, included"}
                  </span>
                  <span className="purchase-option__copy">
                    This outfit first. New styles curated every 3 months.
                  </span>
                </span>
              </label>
            </fieldset>
            <p className="outfit__terms" aria-live="polite">
              {mode === "reserve"
                ? "$250 every 3 months, plus any tax/shipping. These pieces ship once. Future boxes are newly curated. Cancel before renewal."
                : unavailable
                  ? "Selected sizes are sold out individually. Edit your pieces or choose Reserve."
                  : "15% off one lowest-priced item with 2+. Shopify confirms eligibility and your final total in the bag."}
            </p>
            {error && (
              <p className="outfit-error" role="alert">
                {error}
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
                ? mode === "reserve" ? "Opening checkout…" : "Adding…"
                : missing >= 0
                  ? "Choose remaining sizes →"
                  : mode === "reserve"
                    ? "Checkout with Reserve →"
                    : unavailable
                      ? "Selected sizes sold out"
                      : `Add ${chosen.length === 1 ? "piece" : "outfit"} to bag`}
            </button>
            <p className="outfit__fine">
              {selectedVariants.some(v => v?.currentlyNotInStock) ? "Preorder. First shipment ships in about 2 weeks." : "No subscription unless you enroll in Reserve."}
            </p>
          </aside>
          <div className="outfit__mobile-footer">
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
      <dialog className="outfit-fit outfit-photo" ref={zoomRef} aria-labelledby="outfitPhotoTitle">
        <div className="outfit-fit__head">
          <h2 id="outfitPhotoTitle">{zoom ? shopProductLabel(zoom) : "Product photo"}</h2>
          <button onClick={() => zoomRef.current?.close()} aria-label="Close enlarged photo">×</button>
        </div>
        {zoom && <>
          <img src={shopProductPhoto(zoom)} alt={zoom.name} />
          <button className="outfit-photo__fit" onClick={() => { zoomRef.current?.close(); showFit(zoom); }}>Size &amp; fit ↗</button>
        </>}
      </dialog>
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
