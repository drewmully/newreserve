"use client";
/* eslint-disable @next/next/no-img-element */
/* eslint-disable @next/next/no-html-link-for-pages */
import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import type { ShopifyProduct } from "@/lib/shopify";
import { shopProductPhoto, shopProductLabel } from "@/lib/shopProductPhotos";
import { selectShopEdit } from "@/lib/shopMerchandising";
import { useMembership } from "@/app/context/MembershipContext";
import { money, variantLabel } from "@/lib/shopOutfit";
import { GIFT_TIERS } from "../shopCollections";
import type { SeasonalTheme } from "../seasonalTheme";
import { ScrollToTop } from "./ScrollToTop";
import { ShopPasswordGate } from "./ShopPasswordGate";
import { ShopOutfitBuilder } from "./ShopOutfitBuilder";
import { ShopNewsletter } from "./ShopNewsletter";
import { ShopEditRail } from "./ShopEditRail";
import { ShopHeroHotspots } from "./ShopHeroHotspots";
import { CompactVariantPicker } from "./CompactVariantPicker";
import "./shop-redesign.css";
import "./shop-redesign-native.css";
import "./shop-outfit.css";
import "./shop-first.css";

function ProductCard({ product: p, onQuick }: { product: ShopifyProduct; onQuick: (p: ShopifyProduct) => void }) {
  const available = p.variants.some(v => v.availableForSale);
  return <article className="card">
    <div className="card__media">
      <a href={`/shop/${p.slug}`} aria-label={p.name}><img src={shopProductPhoto(p)} alt={p.name} loading="lazy" /></a>
      <button className="shop-card-options" onClick={() => onQuick(p)} aria-label={`View options for ${p.name}`}>
        <span aria-hidden="true">{available ? "+" : "↗"}</span>
      </button>
    </div>
    <div className="card__body">
      <p className="card__brand">{p.brand}</p>
      <a className="card__name" href={`/shop/${p.slug}`} title={p.name}>{shopProductLabel(p)}</a>
      <div className="card__row"><span className="card__price">{money(p.price)}</span>{!available && <span className="shop-stock">Unavailable</span>}</div>
      {p.variants.some(v => v.currentlyNotInStock) && <p className="shop-stock">Preorder · About {p.preOrderEtaWeeks || 2} weeks</p>}
    </div>
  </article>;
}

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
  const [quickIsOpen, setQuickIsOpen] = useState(false);
  const [styledLook, setStyledLook] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const heroImage = useRef<HTMLImageElement>(null);
  const quickTrigger = useRef<HTMLElement | null>(null);
  const edit = useMemo(() => selectShopEdit(products, products.length), [products]);
  const gear = ["winston-golf-tour-towel", "technically-golf-tiger-stripe-needlepoint-belt", "duckhead-stretch-belt", "leon-weekender-duffel"]
    .map(slug => products.find(p => p.slug === slug)).filter((p): p is ShopifyProduct => !!p);
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
  useEffect(() => {
    if (!quickIsOpen) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previous; };
  }, [quickIsOpen]);
  function openQuick(p: ShopifyProduct, fromHero = false) {
    quickTrigger.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setQuick(p);
    setStyledLook(fromHero);
    setVariant(p.variants.length === 1 ? p.variants[0].id : "");
    setError("");
    dialog.current?.showModal();
    setQuickIsOpen(true);
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
      }]); // Shopify applies the automatic one-item offer; avoid a duplicate code.
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
          <picture>
            <source media="(max-width: 600px) and (orientation: portrait)" srcSet="/shop-redesign/lifestyle/fall-firepit-mobile.webp" width={1086} height={1448} />
            <img ref={heroImage} className="shop-hero__image" src="/shop-redesign/lifestyle/fall-firepit-desktop.webp" alt="AI-styled fall outfit: a striped polo, braided brown belt, tailored khakis and white golf shoes beside a clubhouse firepit" width={1672} height={941} fetchPriority="high" loading="eager" />
          </picture>
          <div className="wrap shop-hero__in">
            <div className="shop-hero__copy">
              <h1 id="shopHeroTitle">The {theme.season.charAt(0).toUpperCase() + theme.season.slice(1)} Edit</h1>
              <a className="shop-hero__cta" href="#edit" aria-label="Shop the edit">[ shop ]</a>
            </div>
          </div>
          <ShopHeroHotspots imageRef={heroImage} products={products} onSelect={p => openQuick(p, true)} />
        </section>
        <div className="shop-colorway-strip" aria-hidden="true">
          {[
            ["#EDE6D6", 24, false], ["#B08558", 18, false], ["#5B613F", 26, true],
            ["#9B8B7A", 16, false], ["#4A3528", 16, true],
          ].map(([hex, width, dark]) => <div key={String(hex)} style={{ backgroundColor: String(hex), flex: Number(width) }} className={dark ? "is-dark" : ""}><span>{hex}</span></div>)}
        </div>
        <section className="sec" id="edit">
          <div className="wrap">
            <ShopEditRail count={edit.length} season={theme.season}>
              {edit.map(p => <ProductCard key={p.slug} product={p} onQuick={openQuick} />)}
            </ShopEditRail>
            {!edit.length && <p>New pieces are on their way. Please check back soon.</p>}
          </div>
        </section>
        <ShopOutfitBuilder products={products} byCategory={productsByCategory} />
        {gear.length > 0 && <section className="sec shop-gear" id="seasonal-story">
          <div className="wrap">
            <div className="sechead">
              <h2 className="h2">Gear worth bringing</h2>
              <a className="ulink" href="/shop/collection/shop-gear">Shop gear</a>
            </div>
            <div className="grid shop-edit-grid">
              {gear.map(p => <ProductCard key={p.slug} product={p} onQuick={openQuick} />)}
            </div>
          </div>
        </section>}
        <section className="sec shop-gifts" id="gift-tiers">
          <div className="wrap">
            <div className="sechead"><h2 className="h2">Gifts for golfers</h2></div>
            <div className="shop-gift-links">
              {GIFT_TIERS.map(t => <a key={t.key} href={`/shop/gifts/${t.key}`}><span>{t.title}</span><span aria-hidden="true">→</span></a>)}
            </div>
          </div>
        </section>
        <section className="sec" id="journal">
          <div className="wrap">
            <div className="sechead"><h2 className="h2">From the Journal</h2><a className="ulink" href="/blog">View all</a></div>
            <div className="journal">
              {journalPosts.length ? journalPosts.map(p => <a className="jcard" href={`/blog/${p.slug}`} key={p.slug}><img src={p.image} alt={p.imageAlt || ""} loading="lazy" /><h3>{p.title}</h3></a>) : [
                ["The Shelf", "A closer look at the products on our radar.", "/shop-redesign/lifestyle/style-quiet.jpg", "/lp/editorial"],
                ["Golf destinations", "Explore the places in our destination edit.", "/shop-redesign/lifestyle/pebble.jpg", "/lp/editorial?category=destinations#editorial-top"],
                ["The Mully 100", "Our collection of golf-adjacent Amazon finds.", "/shop-redesign/lifestyle/kiawah.jpg", "/lp/mully100"],
              ].map(([name, , image, href]) => <a className="jcard" href={href} key={name}><img src={image} alt="" loading="lazy" /><h3>{name}</h3></a>)}
            </div>
          </div>
        </section>
        <ShopNewsletter />
        <section className="sec shop-faq" id="faq">
          <div className="wrap faqwrap">
            <div><h2 className="h2">Good to know</h2></div>
            <div className="faq">
              <details><summary>Do I need a subscription to shop?<i /></summary><div><p>No. Shop individual products whenever you like. Mully Reserve is an optional quarterly service.</p></div></details>
              <details><summary>How do I choose my size?<i /></summary><div><p>Use the brand-specific size chart on each product page or the builder’s Size &amp; fit guide. Choose a size for each piece before adding it to your bag.</p></div></details>
              <details><summary>When will my order ship?<i /></summary><div><p>Preorder pieces ship in about 2 weeks. Check each product for current availability. Shipping options, costs, and taxes are confirmed at checkout.</p></div></details>
              <details><summary>What if the fit is wrong?<i /></summary><div><p>See our <a href="/policies/refund">return policy</a> for the 30-day return window and conditions, or <a href="/returns">start a return</a>.</p></div></details>
              <details><summary>How does the shop offer work?<i /></summary><div><p>Buy two or more eligible one-time pieces for 15% off one lowest-priced item. Review your bag for the applied discount and final total. This offer does not stack with Reserve.</p></div></details>
            </div>
          </div>
        </section>
        <dialog ref={dialog} id="shop-quick-dialog" className="outfit-fit shop-quick" aria-labelledby="quick-title"
          onClose={() => { setQuickIsOpen(false); setQuick(null); quickTrigger.current?.focus({ preventScroll: true }); }}
          onClick={e => {
            if (e.target !== e.currentTarget) return;
            const r = e.currentTarget.getBoundingClientRect();
            if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) e.currentTarget.close();
          }}
        >
          <div className="outfit-fit__head"><h2 id="quick-title">{quick?.name}</h2><button onClick={() => dialog.current?.close()} aria-label="Close product options">×</button></div>
          {quick && <>
            <div className="shop-quick__product">
              <img src={activeVariant?.image || shopProductPhoto(quick)} alt={quick.name} width={140} height={160} />
              <div>
                <p className="shop-quick__brand">{quick.brand}</p>
                <p className="shop-quick__price">{money(activeVariant?.price ?? quick.price)}</p>
                {!quick.variants.some(v => v.availableForSale) && <p className="shop-quick__stock" role="status">Currently unavailable</p>}
                {activeVariant?.currentlyNotInStock && <p className="shop-quick__stock">Preorder · Ships in about {quick.preOrderEtaWeeks || 2} weeks</p>}
                {styledLook && <p className="shop-quick__note">Styled illustration. Product photos show the actual item; fit may differ.</p>}
              </div>
            </div>
            {quick.variants[0]?.selectedOptions.length > 1 ? <CompactVariantPicker key={quick.slug} product={quick} value={variant} onChange={setVariant} /> : <label className="quick-select">Choose your option<select value={variant} onChange={e => setVariant(e.target.value)}>
              <option value="">Select a size / option</option>
              {quick.variants.map(v => <option key={v.id} value={v.id} disabled={!v.availableForSale}>{variantLabel(v)}{!v.availableForSale ? " · Unavailable" : ""}</option>)}
            </select></label>}
            {error && <p role="alert">{error}</p>}
            <button className="btn btn--accent btn--block" disabled={!activeVariant?.availableForSale || busy} onClick={addQuick}>{busy ? "Adding…" : !quick.variants.some(v => v.availableForSale) ? "Currently unavailable" : "Add to bag"}</button>
            <a href={`/shop/${quick.slug}`}>Full details, sizing &amp; availability ↗</a>
          </>}
        </dialog>
      </div>
    </>
  );
}
