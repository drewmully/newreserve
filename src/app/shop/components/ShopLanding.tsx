"use client";
/* eslint-disable @next/next/no-img-element */
/* Full document navigation intentionally preserves the existing shop gate lifecycle. */
/* eslint-disable @next/next/no-html-link-for-pages */
import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import type { ShopifyProduct } from "@/lib/shopify";
import { useMembership } from "@/app/context/MembershipContext";
import { money, OUTFIT_SLOTS, variantLabel } from "@/lib/shopOutfit";
import { SHOP_CATEGORIES, GIFT_TIERS } from "../shopCollections";
import type { SeasonalTheme } from "../seasonalTheme";
import { ScrollToTop } from "./ScrollToTop";
import { ShopPasswordGate } from "./ShopPasswordGate";
import { ShopOutfitBuilder } from "./ShopOutfitBuilder";
import "./shop-redesign.css";
import "./shop-redesign-native.css";

const asset = (path: string) => `/shop-redesign/${path}`;
const LATEST = [
  "technically-golf-performance-polo",
  "olydoe-og-supima-hollow-polo",
  "winston-solid-tradition-leather-headcover",
  "stitch-monte-carlo-leather-head-cover",
];
const MOMENTS = [
  {
    name: "The 6 a.m. tee time",
    copy: "Vests, pullovers, packable shells.",
    image: "lifestyle/style-quiet.jpg",
    collection: "outerwear",
  },
  {
    name: "The Saturday round",
    copy: "Polos and trousers you can play in.",
    image: "lifestyle/style-bold.jpg",
    collection: "tops",
  },
  {
    name: "The clubhouse dinner",
    copy: "Cashmere, belts, the good hat.",
    image: "lifestyle/style-classic.jpg",
    collection: "accessories",
  },
  {
    name: "The range session",
    copy: "Rangefinders, launch monitors, training tools.",
    image: "products/blue-tees-player-gps-speaker-v4.jpg",
    collection: "tech",
  },
];
export function ShopLanding({
  products,
  productsByCategory,
  theme,
}: {
  products: ShopifyProduct[];
  productsByCategory: Record<string, ShopifyProduct[]>;
  theme: SeasonalTheme;
}) {
  const { addItemsToCart, cartOpen } = useMembership();
  const [quick, setQuick] = useState<ShopifyProduct | null>(null);
  const [variant, setVariant] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [dock, setDock] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const outfitSlugs = new Set<string>(
    OUTFIT_SLOTS.flatMap((s) => [...s.slugs]),
  );
  const latest = useMemo(() => {
    const wanted = LATEST.map((s) => products.find((p) => p.slug === s)).filter(
      (p): p is ShopifyProduct => !!p,
    );
    for (const p of products)
      if (
        wanted.length < 4 &&
        !wanted.some((x) => x.slug === p.slug) &&
        !outfitSlugs.has(p.slug)
      )
        wanted.push(p);
    return wanted;
    // Stable editorial handle list, live catalog data.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [products]);
  useEffect(() => {
    function update() {
      const outfit = document.getElementById("outfit")?.getBoundingClientRect();
      const footer = document.querySelector("#shop-site-footer")?.getBoundingClientRect();
      document.body.dataset.shopBuilderInView = String(!!outfit && outfit.top < 160 && outfit.bottom > window.innerHeight * .6);
      setDock(
        window.scrollY > window.innerHeight * 0.8 &&
          !(
            outfit &&
            outfit.top < window.innerHeight * 0.7 &&
            outfit.bottom > 96
          ) &&
          !(footer && footer.top < window.innerHeight),
      );
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
    const v = quick?.variants.find((x) => x.id === variant);
    if (!quick || !v?.availableForSale) return;
    setBusy(true);
    setError("");
    try {
      await addItemsToCart(
        [
          {
            slug: quick.slug,
            name: quick.name,
            brand: quick.brand,
            price: v.price,
            retailPrice: v.price,
            variantId: v.id,
            variantTitle: variantLabel(v),
            image: v.image || quick.images[0],
          },
        ],
        "BOGO15",
      );
      dialog.current?.close();
    } catch {
      setError("Could not add this option. Check availability and try again.");
    } finally {
      setBusy(false);
    }
  }
  const activeVariant = quick?.variants.find((v) => v.id === variant);
  return (
    <>
      <ScrollToTop />
      <ShopPasswordGate accent={theme.accent} />
      <div
        className="shop-redesign"
        style={{ "--accent": theme.accent } as CSSProperties}
      >
        <section className="hero" id="hero">
          <img
            className="hero__img"
            src={theme.heroImage}
            alt="A golf fairway at dawn"
            fetchPriority="high"
          />
          <div className="hero__scrim" />
          <div className="wrap hero__in">
            <p className="eyebrow eyebrow--light">
              <span className="dot" />
              {theme.eyebrow}
            </p>
            <h1 className="hero__h">
              {theme.headline[0]}
              <br />
              <em>{theme.headline[1]}</em>
            </h1>
            <p className="hero__sub">
              A base you can sweat in. A mid you can zip up. An outer you throw
              off at the turn. Picked by players, in the brands we actually
              wear.
            </p>
            <div className="hero__ctas">
              <a className="btn btn--accent" href="#edit">
                Shop the Edit ↗
              </a>
              <a className="btn btn--ghost" href="#outfit">
                Put your look together
              </a>
            </div>
            <ul className="trustrow">
              <li>Buy one, 15% off the second</li>
              <li>Brand-specific sizing</li>
              <li>Free U.S. returns</li>
            </ul>
          </div>
        </section>
        <section className="trust" aria-label="Shopping promises">
          <div className="wrap trust__in">
            <div>
              <h3>Picked by players</h3>
              <p>Brands we actually wear.</p>
            </div>
            <div>
              <h3>BOGO15</h3>
              <p>15% off a second eligible piece.</p>
            </div>
            <div>
              <h3>Returns that work</h3>
              <p>See our 30-day return policy.</p>
            </div>
          </div>
        </section>
        <section className="sec sec--tight" id="cats">
          <div className="wrap">
            <div className="tiles">
              {SHOP_CATEGORIES.map((c) => {
                const p = productsByCategory[c.handle]?.find(
                  (p) => p.images.length,
                );
                return (
                  <a
                    className="tile"
                    key={c.handle}
                    href={`/shop/collection/${c.handle}`}
                  >
                    {p && (
                      <img src={p.images[0]} alt={c.label} loading="lazy" />
                    )}
                    <span className="tile__go">↗</span>
                    <div className="tile__txt">
                      <p className="tile__kicker">{c.eyebrow}</p>
                      <p className="tile__name">{c.label}</p>
                      <p className="tile__line">{c.detail}</p>
                    </div>
                  </a>
                );
              })}
            </div>
          </div>
        </section>
        <section className="sec" id="edit">
          <div className="wrap">
            <div className="sechead">
              <div>
                <h2 className="h2">Latest at Mully.</h2>
                <p className="lede">
                  Fresh arrivals from the brands we curate.
                </p>
              </div>
              <a className="ulink" href="/shop/collection/shop-all">
                See all new
              </a>
            </div>
            <div className="grid grid--4">
              {latest.map((p) => (
                <article className="card" key={p.slug}>
                  <div className="card__media">
                    <a href={`/shop/${p.slug}`}>
                      <img src={p.images[0]} alt={p.name} loading="lazy" />
                    </a>
                    <div className="card__badges">
                      <span className="pill pill--accent">
                        15% off the second piece
                      </span>
                    </div>
                    <button
                      className="card__quick"
                      onClick={() => openQuick(p)}
                    >
                      {p.variants.some((v) => v.availableForSale)
                        ? "Choose options"
                        : "View availability"}{" "}
                      · {money(p.price)}
                    </button>
                  </div>
                  <div className="card__body">
                    <div className="card__brand">
                      <span>{p.brand}</span>
                      {p.rating && p.reviewCount ? (
                        <span className="card__stars">
                          ★ {p.rating} ({p.reviewCount})
                        </span>
                      ) : null}
                    </div>
                    <a className="card__name" href={`/shop/${p.slug}`}>
                      {p.name}
                    </a>
                    <div className="card__row">
                      <span className="card__price">{money(p.price)}</span>
                    </div>
                  </div>
                </article>
              ))}
            </div>
            {!latest.length && (
              <p>New pieces are on their way. Please check back soon.</p>
            )}
          </div>
        </section>
        <ShopOutfitBuilder
          products={products}
          byCategory={productsByCategory}
        />
        <section className="sec" id="moments">
          <div className="wrap">
            <div className="sechead">
              <h2 className="h2">Match the round.</h2>
            </div>
            <div className="moments">
              {MOMENTS.map((m) => (
                <a
                  className="moment"
                  href={`/shop/collection/shop-${m.collection}`}
                  key={m.name}
                >
                  <img src={asset(m.image)} alt={m.name} loading="lazy" />
                  <div className="moment__txt">
                    <h3>{m.name}</h3>
                    <p>{m.copy}</p>
                    <span className="moment__cta">Shop {m.collection} ↗</span>
                  </div>
                </a>
              ))}
            </div>
          </div>
        </section>
        <section className="rule">
          <div className="wrap rule__in">
            <p className="rule__txt">
              A base you can sweat in. A mid you can zip up. An outer you throw
              off at the turn.
            </p>
            <ul className="chips" aria-label="Seasonal palette">
              {theme.layerPalette.map((c) => (
                <li key={c.hex}>
                  <i style={{ background: c.hex }} />
                  {c.name}
                </li>
              ))}
            </ul>
          </div>
        </section>
        <section className="sec sec--cream" id="gift-tiers">
          <div className="wrap">
            <div className="sechead">
              <h2 className="h2">For the guy who has enough polos.</h2>
            </div>
            <div className="gifts">
              {GIFT_TIERS.map((t) => {
                const picks = products
                  .filter((p) =>
                    t.key === "under100"
                      ? p.price < 100
                      : t.key === "hundredToThree"
                        ? p.price >= 100 && p.price < 300
                        : p.price >= 300,
                  )
                  .slice(0, 3);
                return (
                  <div className="gift" key={t.key}>
                    <div className="gift__head">
                      <span className="gift__tier">{t.accent}</span>
                      <span className="gift__range">{t.title}</span>
                    </div>
                    <p className="gift__line">{t.subtitle}</p>
                    <div className="gift__items">
                      {picks.map((p) => (
                        <a key={p.slug} href={`/shop/${p.slug}`} title={p.name}>
                          <img src={p.images[0]} alt={p.name} loading="lazy" />
                          <span>{money(p.price)}</span>
                        </a>
                      ))}
                    </div>
                    <a className="ulink" href={`/shop/gifts/${t.key}`}>
                      Shop gifts ↗
                    </a>
                  </div>
                );
              })}
            </div>
          </div>
        </section>
        <section className="sec" id="faq">
          <div className="wrap faqwrap">
            <div>
              <h2 className="h2">The questions we get.</h2>
              <p className="lede">
                Straight answers on sizing, the offer, and Mully Reserve.
              </p>
            </div>
            <div className="faq">
              <details open>
                <summary>
                  How does BOGO15 work?
                  <i />
                </summary>
                <div>
                  <p>
                    Buy two or more eligible one-time pieces and get 15% off one
                    lowest-priced item. The builder shows an estimate; Shopify
                    confirms the applicable discount and final total in your
                    bag. It does not stack with a Reserve subscription.
                  </p>
                </div>
              </details>
              <details>
                <summary>
                  How do I choose my size?
                  <i />
                </summary>
                <div>
                  <p>
                    Pick a size for each piece in the builder. Size &amp; fit
                    opens the product’s brand-specific chart. The selected size
                    travels with the item into your bag.
                  </p>
                </div>
              </details>
              <details>
                <summary>
                  What happens if I choose Mully Reserve?
                  <i />
                </summary>
                <div>
                  <p>
                    You continue into Mully Reserve with your outfit saved as a
                    style guide. Complete enrollment there for quarterly
                    curation at $250 per quarter. Choosing the option here does
                    not start a subscription.
                  </p>
                </div>
              </details>
              <details>
                <summary>
                  When will my pieces ship?
                  <i />
                </summary>
                <div>
                  <p>
                    Check each product’s availability and delivery details
                    before ordering. Shipping options, costs, and taxes are
                    confirmed at checkout.
                  </p>
                </div>
              </details>
              <details>
                <summary>
                  What if the fit is wrong?
                  <i />
                </summary>
                <div>
                  <p>
                    Review our <a href="/policies/refund">return policy</a> for
                    the 30-day return window and conditions. You can start a
                    return from the <a href="/returns">returns page</a>.
                  </p>
                </div>
              </details>
            </div>
          </div>
        </section>
        <section className="sec sec--cream" id="journal">
          <div className="wrap">
            <div className="sechead">
              <div>
                <h2 className="h2">Reading for the range.</h2>
                <p className="lede">
                  Stories, destinations, and the picks we’re arguing about.
                </p>
              </div>
              <a className="ulink" href="/lp/editorial">
                See all
              </a>
            </div>
            <div className="journal">
              {[
                [
                  "Pebble in the fall.",
                  "Why October is the right month, and what to pack.",
                  "lifestyle/pebble.jpg",
                  "/lp/editorial",
                ],
                [
                  "The layering rule, illustrated.",
                  "Three pieces, the whole season.",
                  "lifestyle/rhone-layering-v3.jpg",
                  "/lp/editorial",
                ],
                [
                  "The gift list we actually use.",
                  "Picks worth giving, and keeping.",
                  "lifestyle/kiawah.jpg",
                  "/lp/mully100",
                ],
              ].map(([name, copy, image, href]) => (
                <a className="jcard" href={href} key={name}>
                  <img src={asset(image)} alt={name} loading="lazy" />
                  <h3>{name}</h3>
                  <p>{copy}</p>
                </a>
              ))}
            </div>
          </div>
        </section>
        <section className="sec">
          <div className="wrap signup">
            <div>
              <h2 className="h2">A better starting point.</h2>
              <p className="lede">
                Let our team build your next edit. Tell Mully Reserve what you
                like.
              </p>
            </div>
            <a className="btn btn--accent" href="/#quiz">
              Find your style ↗
            </a>
          </div>
        </section>
        <div
          className={`dock ${dock && !cartOpen ? "is-on" : ""}`}
          aria-hidden={!dock || cartOpen}
        >
          <div className="wrap dock__in">
            <div className="dock__copy">
              <strong>Buy one. Save 15% on the second.</strong>
              <span>Choose your pieces, or start with a full outfit.</span>
            </div>
            <div className="dock__ctas">
              <a
                className="btn btn--accent btn--sm"
                href="#edit"
                tabIndex={dock && !cartOpen ? 0 : -1}
              >
                Shop the edit
              </a>
              <a
                className="btn btn--ghost-dark btn--sm"
                href="#outfit"
                tabIndex={dock && !cartOpen ? 0 : -1}
              >
                Build your outfit
              </a>
            </div>
          </div>
        </div>
        <dialog
          ref={dialog}
          className="outfit-fit"
          aria-labelledby="quick-title"
        >
          <div className="outfit-fit__head">
            <h2 id="quick-title">{quick?.name}</h2>
            <button
              onClick={() => dialog.current?.close()}
              aria-label="Close product options"
            >
              ×
            </button>
          </div>
          {quick && (
            <>
              <p>
                {quick.brand} · {money(activeVariant?.price ?? quick.price)}
              </p>
              <label className="quick-select">
                Choose your option
                <select
                  value={variant}
                  onChange={(e) => setVariant(e.target.value)}
                >
                  <option value="">Select a size / option</option>
                  {quick.variants.map((v) => (
                    <option
                      key={v.id}
                      value={v.id}
                      disabled={!v.availableForSale}
                    >
                      {variantLabel(v)}
                      {!v.availableForSale ? " · Unavailable" : ""}
                    </option>
                  ))}
                </select>
              </label>
              {error && <p role="alert">{error}</p>}
              <button
                className="btn btn--accent btn--block"
                disabled={!activeVariant?.availableForSale || busy}
                onClick={addQuick}
              >
                {busy ? "Adding…" : "Add to bag"}
              </button>
              <a href={`/shop/${quick.slug}`}>
                Full details, sizing &amp; availability ↗
              </a>
            </>
          )}
        </dialog>
      </div>
    </>
  );
}
