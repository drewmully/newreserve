"use client";

import { useEffect, useRef, useState } from "react";
import type { ShopifyProduct, ShopifyProductVariant } from "@/lib/shopify";
import { MullyWordmark } from "./MullyWordmark";
import "./mystery-bundle.css";

export const MYSTERY_BUNDLE_HANDLE = "mystery-bundle-closeout";

/** The value claim comes from the merchant's product copy, never compare-at
 * pricing: the assorted contents are not a formerly-$150 version of this SKU. */
export function mysteryRetailValue(description: string): number | null {
  const match = description.match(/retail value\s+(?:exceeding|over)\s+\$([\d,]+)/i);
  return match ? Number(match[1].replaceAll(",", "")) : null;
}

type Props = {
  product: ShopifyProduct;
  initialVariantId?: string;
  cartCount?: number;
  cartOpen?: boolean;
  onOpenBag: () => void;
  onAdd: (variant: ShopifyProductVariant) => Promise<void>;
  preview?: boolean;
};

export function MysteryBundlePage({
  product, initialVariantId, cartCount = 0, cartOpen = false,
  onOpenBag, onAdd, preview = false,
}: Props) {
  const [selectedId, setSelectedId] = useState(initialVariantId || "");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [showDock, setShowDock] = useState(false);
  const purchase = useRef<HTMLDivElement>(null);
  const sizes = useRef<HTMLFieldSetElement>(null);
  const photo = useRef<HTMLDialogElement>(null);
  const sizeHelp = useRef<HTMLDialogElement>(null);
  const selected = product.variants.find(v => v.id === selectedId);
  const available = product.variants.some(v => v.availableForSale);
  const price = selected?.price ?? product.price;
  const value = mysteryRetailValue(product.description);
  const money = (n: number) => new Intl.NumberFormat("en-US", {
    style: "currency", currency: "USD", maximumFractionDigits: n % 1 ? 2 : 0,
  }).format(n);
  const size = (v: ShopifyProductVariant) =>
    v.selectedOptions.find(o => /^size$/i.test(o.name))?.value || v.title;
  const cta = pending ? "Adding to bag…" : !available ? "Currently unavailable"
    : !selected ? "Choose your size" : !selected.availableForSale
      ? "Size unavailable" : `Add to bag · ${money(price)}`;

  useEffect(() => {
    if (!purchase.current || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(([entry]) => {
      setShowDock(!entry.isIntersecting && entry.boundingClientRect.top < 0);
    }, { threshold: 0 });
    observer.observe(purchase.current);
    return () => observer.disconnect();
  }, []);

  function choose(id: string) {
    setSelectedId(id); setError("");
    if (!preview) {
      const url = new URL(window.location.href);
      url.searchParams.set("variant", id.split("/").pop()!);
      window.history.replaceState(window.history.state, "", url);
    }
  }

  async function add() {
    if (!selected || !selected.availableForSale || pending) return;
    setPending(true); setError("");
    try { await onAdd(selected); }
    catch { setError("We couldn’t add this size. Please try again."); }
    finally { setPending(false); }
  }

  function reviewSize() {
    sizes.current?.scrollIntoView({ block: "center", behavior:
      window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth" });
    sizes.current?.querySelector<HTMLButtonElement>("button[aria-pressed=true],button:not(:disabled)")?.focus({ preventScroll: true });
  }

  function closeDialog(dialog: HTMLDialogElement | null) {
    dialog?.close(); document.body.style.overflow = "";
  }
  function openDialog(dialog: HTMLDialogElement | null) {
    dialog?.showModal(); document.body.style.overflow = "hidden";
  }

  return (
    <div className="mystery-page">
      {preview && <div className="mystery-preview">Design preview <span>Purchase flow is simulated. No orders or payments.</span></div>}
      <div className="mystery-announcement">The Mully closeout <span aria-hidden="true">/</span> A good find, for less.</div>
      <header className="mystery-header">
        <a href="https://www.mymully.com/shop" aria-label="Mully Shop home" className="mystery-wordmark">
          <MullyWordmark accent="#4A3528" />
        </a>
        <a className="mystery-link mystery-back" href="https://www.mymully.com/shop">Back to the shop <span aria-hidden="true">↗</span></a>
        <div className="mystery-header-actions">
          <a className="mystery-link" href="https://www.mymully.com/login?returnTo=%2Fshop%2Fmystery-bundle-closeout">Log in</a>
          <button className="mystery-bag" onClick={onOpenBag} aria-label={`Bag, ${cartCount} items`}>
            <svg width="19" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.3" aria-hidden="true"><path d="M5 7h14l1 14H4L5 7ZM8 8V5a4 4 0 0 1 8 0v3"/></svg>
            <span>Bag{cartCount > 0 ? ` (${cartCount})` : ""}</span>
          </button>
        </div>
      </header>

      <main id="main">
        <section className="mystery-hero" aria-labelledby="mystery-title">
          <figure className="mystery-visual">
            <button className="mystery-photo" aria-label="Enlarge Mystery Bundle image" onClick={() => openDialog(photo.current)}>
              {/* Shopify supplies the image. Never replace it with other products. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={product.images[0]} alt="Illustrative assortment of golf apparel and accessories. Actual contents vary." fetchPriority="high" />
              <span className="mystery-expand" aria-hidden="true">+</span>
            </button>
            <figcaption>Illustrative assortment. Actual items and quantity vary.</figcaption>
          </figure>

          <div className="mystery-buy">
            <p className="mystery-eyebrow">The Mully closeout</p>
            <h1 id="mystery-title">The Mystery<br className="mystery-title-break" /> Bundle.</h1>
            <p className="mystery-deck">Good gear. A little mystery.<br /> A very good deal.</p>
            <div className="mystery-offer">
              <span className="mystery-price">{money(price)}</span>
              {value && <div><strong>Over {money(value)} in retail value</strong><span>Guaranteed value. Surprising finds.</span></div>}
            </div>
            <p className="mystery-description">Golf apparel or accessories from our partner brands. You choose your size. We choose the surprise.</p>
            <div ref={purchase} className="mystery-purchase">
              <fieldset ref={sizes} className="mystery-sizes">
                <legend>Choose your size <span aria-live="polite">{selected ? size(selected) : "Required"}</span></legend>
                <div className="mystery-size-row">
                  {product.variants.map(v => (
                    <button key={v.id} type="button" aria-pressed={selectedId === v.id}
                      aria-label={`${size(v)}${!v.availableForSale ? ", unavailable" : ""}`}
                      disabled={!v.availableForSale || pending} onClick={() => choose(v.id)}>
                      {size(v)}
                    </button>
                  ))}
                </div>
              </fieldset>
              <button className="mystery-size-help mystery-link" onClick={() => openDialog(sizeHelp.current)}>Which size should I choose?</button>
              <button className="mystery-cta" disabled={!selected?.availableForSale || pending}
                onClick={add} aria-busy={pending}>{cta}<span aria-hidden="true">↗</span></button>
              <p className="mystery-terms"><span>One-time purchase</span><span>Final sale. No returns.</span></p>
              <p className="mystery-shipping">Shipping and taxes calculated at checkout.</p>
              {error && <p className="mystery-error" role="alert">{error}</p>}
            </div>
          </div>
        </section>

        <section className="mystery-facts" aria-label="What to expect">
          <div><span className="mystery-number">01</span><div><h2>Your size. Our picks.</h2><p>Choose your usual polo size.<br />Leave the styles to us.</p></div></div>
          <div><span className="mystery-number">02</span><div><h2>{value ? `Over ${money(value)} in value.` : "A closeout worth opening."}</h2><p>Partner-brand apparel or gear.<br />Not a fixed number of pieces.</p></div></div>
          <div><span className="mystery-number">03</span><div><h2>One purchase. All yours.</h2><p>No subscription. No repeat charges.<br />This closeout is final sale.</p></div></div>
        </section>

        <section className="mystery-faq" aria-labelledby="mystery-faq-title">
          <div><p className="mystery-eyebrow">No surprises in the fine print</p><h2 id="mystery-faq-title">Just the essentials.</h2><p>A little mystery should be fun.<br />Buying it should be simple.</p></div>
          <div className="mystery-questions">
            <details><summary>What could I receive?<span aria-hidden="true">+</span></summary><div><p>An assortment of golf apparel or accessories from Mully’s partner brands. It could be multiple polos or one higher-value accessory. Brands, colors and item counts vary. The photo is illustrative, not a promise of specific contents.</p></div></details>
            <details><summary>What’s guaranteed?<span aria-hidden="true">+</span></summary><div><p>{value ? `Retail value exceeding ${money(value)}. ` : ""}The exact products are the mystery. The assortment is selected for you from partner-brand closeout inventory.</p></div></details>
            <details><summary>How does sizing work?<span aria-hidden="true">+</span></summary><div><p>Select your usual polo or shirt size. We use it when your bundle includes sized apparel. Because the brands and styles vary, there is no single garment measurement chart for this assortment.</p></div></details>
            <details><summary>Can I return it or choose the contents?<span aria-hidden="true">+</span></summary><div><p>This is a final-sale closeout and is non-returnable. Specific brands, colors and pieces cannot be selected. If you prefer to choose exactly what arrives, <a className="mystery-link" href="https://www.mymully.com/shop">explore the shop instead</a>.</p></div></details>
          </div>
        </section>
      </main>
      <footer className="mystery-footer">
        <div><MullyWordmark accent="#bca890" tone="light" /><p>Good finds. On and off the course.</p></div>
        <nav aria-label="Footer"><a href="https://www.mymully.com/faq">Help & FAQ</a><a href="https://www.mymully.com/policies/privacy">Privacy</a><a href="https://www.mymully.com/policies/terms">Terms</a></nav>
        <small>© {new Date().getFullYear()} Mully Group</small>
      </footer>

      {showDock && !cartOpen && <div className="mystery-dock">
        <button className="mystery-dock-size" onClick={reviewSize}><strong>Mystery Bundle · {money(price)}</strong><span>{selected ? `Size ${size(selected)} · Change` : "Choose your size"} · Final sale</span></button>
        <button className="mystery-cta" disabled={pending || !available} onClick={selected?.availableForSale ? add : reviewSize}>{pending ? "Adding…" : !available ? "Unavailable" : selected ? "Add to bag ↗" : "Choose size ↗"}</button>
      </div>}

      <dialog className="mystery-dialog mystery-photo-dialog" ref={photo} aria-label="Mystery Bundle image"
        onClose={() => { document.body.style.overflow = ""; }} onClick={e => { if (e.target === e.currentTarget) closeDialog(photo.current); }}>
        <button className="mystery-close" onClick={() => closeDialog(photo.current)} aria-label="Close image">×</button>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={product.images[0]} alt="Mystery Bundle illustrative assortment. Actual contents vary." />
        <p>Illustrative assortment. Actual items and quantity vary.</p>
      </dialog>
      <dialog className="mystery-dialog mystery-fit-dialog" ref={sizeHelp} aria-labelledby="mystery-fit-title"
        onClose={() => { document.body.style.overflow = ""; }} onClick={e => { if (e.target === e.currentTarget) closeDialog(sizeHelp.current); }}>
        <button className="mystery-close" onClick={() => closeDialog(sizeHelp.current)} aria-label="Close sizing help">×</button>
        <p className="mystery-eyebrow">A note on fit</p><h2 id="mystery-fit-title">Go with your usual size.</h2>
        <p>Choose the size you normally wear in polos or shirts. We use your selection when the bundle includes sized apparel.</p>
        <p>Brands and styles vary, so a single measurement chart would be misleading. Specific fits and pieces cannot be requested.</p>
        <p className="mystery-fit-note">Please choose carefully. This closeout is final sale and non-returnable.</p>
        <button className="mystery-cta" onClick={() => closeDialog(sizeHelp.current)}>Back to my size <span aria-hidden="true">↗</span></button>
      </dialog>
    </div>
  );
}
