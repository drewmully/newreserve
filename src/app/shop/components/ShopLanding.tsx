"use client";
/* eslint-disable @next/next/no-img-element */
/* eslint-disable @next/next/no-html-link-for-pages */
import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import type { ShopifyProduct } from "@/lib/shopify";
import { shopProductPhoto } from "@/lib/shopProductPhotos";
import { selectShopEdit, shopGiftPicks, shopSelectionNote } from "@/lib/shopMerchandising";
import { useMembership } from "@/app/context/MembershipContext";
import { money, variantLabel } from "@/lib/shopOutfit";
import { SHOP_CATEGORIES, GIFT_TIERS } from "../shopCollections";
import type { SeasonalTheme } from "../seasonalTheme";
import { ScrollToTop } from "./ScrollToTop";
import { ShopPasswordGate } from "./ShopPasswordGate";
import { ShopOutfitBuilder } from "./ShopOutfitBuilder";
import { ShopNewsletter } from "./ShopNewsletter";
import "./shop-redesign.css";
import "./shop-redesign-native.css";
import "./shop-outfit.css";
import "./shop-first.css";

export function ShopLanding({ products, productsByCategory, theme, journalPosts = [] }: {
  products: ShopifyProduct[];
  productsByCategory: Record<string, ShopifyProduct[]>;
  theme: SeasonalTheme;
  journalPosts?: Array<{slug: string; title: string; excerpt: string; image: string; imageAlt: string}>;
}) {
  const { addItemsToCart } = useMembership();
  const [quick, setQuick] = useState<ShopifyProduct | null>(null);
  const [variant, setVariant] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const dialog = useRef<HTMLDialogElement>(null);
  const edit = useMemo(() => selectShopEdit(products), [products]);
  const layers = ["technically-golf-nio-half-zip", "duckhead-classic-fit-gold-school-chino-khaki", "tasc-release-hybrid-jacket"]
    .map(slug => products.find(p => p.slug === slug)).filter((p): p is ShopifyProduct => !!p);
  const heroProduct = products.find(p => p.slug === "rhone-commuter-1-4-zip");
  useEffect(() => {
    function update() {
      const outfit = document.getElementById("outfit")?.getBoundingClientRect();
      document.body.dataset.shopBuilderInView = String(!!outfit && outfit.top < 160 && outfit.bottom > window.innerHeight * .6);
    }
    window.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    update();
    return () => {
      window.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
      delete document.body.dataset.shopBuilderInView;
    };
  }, []);
  function openQuick(p: ShopifyProduct) {
    setQuick(p);
    setVariant(p.variants.length === 1 ? p.variants[0].id : "");
    setError("");
    dialog.current?.showModal();
  }
  async function addQuick() {
    const v = quick?.variants.find(x => x.id === variant);
    if (!quick || !v?.availableForSale) return;
    setBusy(true); setError("");
    try {
      await addItemsToCart([{
        slug: quick.slug, name: quick.name, brand: quick.brand,
        price: v.price, retailPrice: v.price, variantId: v.id,
        variantTitle: variantLabel(v), image: v.image || shopProductPhoto(quick),
      }], "BOGO15");
      dialog.current?.close();
    } catch {
      setError("Could not add this option. Check availability and try again.");
    } finally { setBusy(false); }
  }
  const activeVariant = quick?.variants.find(v => v.id === variant);
  return (
    <>
      <ScrollToTop />
      <ShopPasswordGate accent={theme.accent} />
      <div className="shop-redesign shop-first" style={{ "--accent": theme.accent, "--accent-d": theme.accentDark } as CSSProperties}>
        <section className="shop-hero" id="hero" aria-labelledby="shopHeroTitle">
          <div className="wrap shop-hero__in">
            <div className="shop-hero__copy">
              <p className="eyebrow">{theme.eyebrow}</p>
              <h1 id="shopHeroTitle">Golf apparel and gear.<br /><em>Selected by Mully.</em></h1>
              <p>Polos, pants, layers, and gear for the season ahead. Shop individual pieces or put a full outfit together.</p>
              <div className="shop-hero__actions">
                <a className="btn btn--accent" href="#edit">Shop the edit ↗</a>
                <a className="ulink" href="#outfit">Build an outfit ↗</a>
              </div>
              <span className="shop-hero__reassurance">No subscription required.</span>
            </div>
            <div className="shop-hero__media">
              <img src={theme.heroImage} alt="Rhone Commuter quarter-zip worn with khaki trousers" fetchPriority="high" />
              {heroProduct && <a className="shop-hero__caption" href={`/shop/${heroProduct.slug}`}>
                <span>In the edit</span>{heroProduct.name} <span aria-hidden>↗</span>
              </a>}
            </div>
          </div>
        </section>
        <section className="shop-categories" id="cats" aria-label="Shop by category">
          <nav className="wrap shop-categories__row" aria-label="Product categories">
            {SHOP_CATEGORIES.map(c => {
              const p = productsByCategory[c.handle]?.[0];
              return <a key={c.key} href={`/shop/collection/${c.handle}`}>
                {p?.images[0] && <img src={shopProductPhoto(p)} alt="" loading="lazy" />}
                <span>{c.label}</span><span aria-hidden>↗</span>
              </a>;
            })}
          </nav>
        </section>
        <section className="sec" id="edit">
          <div className="wrap">
            <div className="sechead">
              <div><p className="eyebrow">Apparel / equipment / everyday gear</p><h2 className="h2">The Mully Edit.</h2><p className="lede">Our current selection of apparel and gear.</p></div>
              <a className="ulink" href="/shop/collection/shop-all">Shop all ↗</a>
            </div>
            <div className="grid shop-edit-grid">
              {edit.map(p => <article className="card" key={p.slug}>
                <div className="card__media">
                  <a href={`/shop/${p.slug}`}><img src={shopProductPhoto(p)} alt={p.name} loading="lazy" /></a>
                  <button className="card__quick" onClick={() => openQuick(p)}>
                    {p.variants.some(v => v.availableForSale) ? "Choose options" : "View availability"} · {money(p.price)}
                  </button>
                </div>
                <div className="card__body">
                  <div className="card__brand"><span>{p.brand}</span>{p.rating && p.reviewCount ? <span className="card__stars">★ {p.rating} ({p.reviewCount})</span> : null}</div>
                  <a className="card__name" href={`/shop/${p.slug}`}>{p.name}</a>
                  <div className="card__row"><span className="card__price">{money(p.price)}</span>{!p.variants.some(v => v.availableForSale) && <span className="shop-stock">Currently unavailable</span>}</div>
                  {shopSelectionNote(p) && <p className="shop-selection-note">{shopSelectionNote(p)}</p>}
                </div>
              </article>)}
            </div>
            {!edit.length && <p>New pieces are on their way. Please check back soon.</p>}
          </div>
        </section>
        <ShopOutfitBuilder products={products} byCategory={productsByCategory} />
        {layers.length > 0 && <section className="sec shop-layer-story" id="seasonal-story">
          <div className="wrap">
            <div className="sechead">
              <div><p className="eyebrow">The seasonal notes</p><h2 className="h2">Layers for cooler rounds.</h2></div>
              <p className="lede">Start with a half-zip and chinos. Keep a jacket close for the early tee time.</p>
            </div>
            <div className="shop-story-pieces">
              {layers.map((p, i) => <a href={`/shop/${p.slug}`} key={p.slug}>
                <span className="eyebrow">{["The first layer", "The foundation", "The extra layer"][i]}</span>
                <img src={shopProductPhoto(p)} alt={p.name} loading="lazy" />
                <span className="shop-story-pieces__brand">{p.brand}</span>
                <h3>{p.name}</h3>
                <span>{money(p.price)} · View piece ↗</span>
              </a>)}
            </div>
          </div>
        </section>}
        <section className="sec sec--cream" id="gift-tiers">
          <div className="wrap">
            <div className="sechead"><div><p className="eyebrow">A good place to start</p><h2 className="h2">Gifts for golfers.</h2><p className="lede">Find a gift that fits the person, and your budget.</p></div></div>
            <div className="gifts">
              {GIFT_TIERS.map(t => {
                const picks = shopGiftPicks(products, t.tag);
                return <div className="gift" key={t.key}>
                  <div className="gift__head"><span className="gift__tier">{t.accent}</span><span className="gift__range">{t.title}</span></div>
                  <div className="gift__items">{picks.map(p => <a key={p.slug} href={`/shop/${p.slug}`} title={p.name}><img src={shopProductPhoto(p)} alt={p.name} loading="lazy" /><span>{money(p.price)}</span></a>)}</div>
                  <a className="ulink" href={`/shop/gifts/${t.key}`}>Shop gifts ↗</a>
                </div>;
              })}
            </div>
          </div>
        </section>
        <section className="sec" id="journal">
          <div className="wrap">
            <div className="sechead"><div><p className="eyebrow">Beyond the product page</p><h2 className="h2">From the Journal.</h2><p className="lede">What to wear, where to play, and the gear worth a closer look.</p></div><a className="ulink" href="/blog">Read the Journal ↗</a></div>
            <div className="journal">
              {journalPosts.length ? journalPosts.map(p => <a className="jcard" href={`/blog/${p.slug}`} key={p.slug}><img src={p.image} alt={p.imageAlt || ""} loading="lazy" /><h3>{p.title} <span aria-hidden>↗</span></h3><p>{p.excerpt}</p></a>) : [
                ["The Shelf", "A closer look at the products on our radar.", "/shop-redesign/lifestyle/style-quiet.jpg", "/lp/editorial"],
                ["Golf destinations", "Explore the places in our destination edit.", "/shop-redesign/lifestyle/pebble.jpg", "/lp/editorial?category=destinations#editorial-top"],
                ["The Mully 100", "Our collection of golf-adjacent Amazon finds.", "/shop-redesign/lifestyle/kiawah.jpg", "/lp/mully100"],
              ].map(([name, copy, image, href]) => <a className="jcard" href={href} key={name}><img src={image} alt="" loading="lazy" /><h3>{name} <span aria-hidden>↗</span></h3><p>{copy}</p></a>)}
            </div>
          </div>
        </section>
        <ShopNewsletter />
        <section className="sec shop-faq" id="faq">
          <div className="wrap faqwrap">
            <div><h2 className="h2">A few useful answers.</h2><p className="lede">Sizing, shipping, and shopping with Mully.</p></div>
            <div className="faq">
              <details><summary>Do I need a subscription to shop?<i /></summary><div><p>No. Shop individual products whenever you like. Mully Reserve is an optional quarterly service.</p></div></details>
              <details><summary>How do I choose my size?<i /></summary><div><p>Use the brand-specific size chart on each product page or the builder’s Size &amp; fit guide. Choose a size for each piece before adding it to your bag.</p></div></details>
              <details><summary>When will my order ship?<i /></summary><div><p>Check the availability and delivery details for each product. Shipping options, costs, and taxes are confirmed at checkout.</p></div></details>
              <details><summary>What if the fit is wrong?<i /></summary><div><p>See our <a href="/policies/refund">return policy</a> for the 30-day return window and conditions, or <a href="/returns">start a return</a>.</p></div></details>
              <details><summary>How does the shop offer work?<i /></summary><div><p>Buy two or more eligible one-time pieces for 15% off one lowest-priced item. Review your bag for the applied discount and final total. This offer does not stack with Reserve.</p></div></details>
            </div>
          </div>
        </section>
        <dialog ref={dialog} className="outfit-fit" aria-labelledby="quick-title">
          <div className="outfit-fit__head"><h2 id="quick-title">{quick?.name}</h2><button onClick={() => dialog.current?.close()} aria-label="Close product options">×</button></div>
          {quick && <>
            <p>{quick.brand} · {money(activeVariant?.price ?? quick.price)}</p>
            <label className="quick-select">Choose your option<select value={variant} onChange={e => setVariant(e.target.value)}>
              <option value="">Select a size / option</option>
              {quick.variants.map(v => <option key={v.id} value={v.id} disabled={!v.availableForSale}>{variantLabel(v)}{!v.availableForSale ? " · Unavailable" : ""}</option>)}
            </select></label>
            {error && <p role="alert">{error}</p>}
            <button className="btn btn--accent btn--block" disabled={!activeVariant?.availableForSale || busy} onClick={addQuick}>{busy ? "Adding…" : "Add to bag"}</button>
            <a href={`/shop/${quick.slug}`}>Full details, sizing &amp; availability ↗</a>
          </>}
        </dialog>
      </div>
    </>
  );
}
