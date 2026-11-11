/**
 * Server-rendered building blocks for the holiday gift guide. Product cards
 * reuse ShopProductCard (live price, member price, PR #350 restock label);
 * everything around them is plain server markup so the guide's copy,
 * headings and JSON-LD are in the HTML even if client JS fails.
 */

import Image from "next/image";
import Link from "next/link";
import { Fragment } from "react";
import { ShopProductCard } from "../components/ShopProductCard";
import { RestockChristmasNote } from "./RestockChristmasNote";
import { shopProductLabel, shopProductPhoto } from "@/lib/shopProductPhotos";
import { GiftReminderSignup } from "./GiftReminderSignup";
import {
  GIFT_GUIDE_TIERS,
  giftGuideFaqs,
  giftOrderByCopy,
  giftOrderByShort,
  giftRestockCutoffShortDay,
  giftRestockCopy,
  isPastGiftOrderBy,
  GIFT_RESTOCK_WEEKS,
  GIFT_SEASON_HREF,
  GIFT_SEASON_LIVE,
  GIFT_OUTFIT_CHINO,
  type GiftOutfitData,
  type GiftPick,
  type GiftTierData,
  type GiftTierSlug,
} from "@/lib/giftGuide";


export function GiftTierNav({ active, placement }: { active?: GiftTierSlug | "hub"; placement: string }) {
  return (
    <nav className="gg-tiernav" aria-label="Gift budgets">
      <Link href="/shop/gifts" aria-current={active === "hub" ? "page" : undefined} data-gg-tier-link="hub" data-gg-placement={placement}>
        All gifts
      </Link>
      {GIFT_GUIDE_TIERS.map((t) => (
        <Link
          key={t.slug}
          href={`/shop/gifts/${t.slug}`}
          aria-current={active === t.slug ? "page" : undefined}
          data-gg-tier-link={t.slug}
          data-gg-placement={placement}
        >
          {t.label}
        </Link>
      ))}
    </nav>
  );
}

/** Christmas cutoff note. The date comes from GIFT_ORDER_BY only. */
export function GiftOrderByNote() {
  const past = isPastGiftOrderBy();
  return (
    <aside className="gg-orderby" aria-label="Christmas shipping">
      <p className="gg-orderby__lead">
        {past ? "The Christmas shipping cutoff has passed." : `${giftOrderByCopy()}.`}
      </p>
      <p>
        {past
          ? `In-stock pieces still ship in 5 to 7 business days.${GIFT_SEASON_LIVE ? " Gift a Season works as a gift on any date." : ""}`
          : `Applies to in-stock pieces with standard shipping. Pieces marked Restocking ship in about ${GIFT_RESTOCK_WEEKS} weeks. ${giftRestockCopy()}`}
      </p>
    </aside>
  );
}

/**
 * Above-the-fold strip under the H1: the order-by date and the Gift a Season
 * CTA, so both show on a 375px screen without scrolling.
 */
export function GiftHeroStrip({ placement, tier }: { placement: string; tier: string }) {
  const past = isPastGiftOrderBy();
  return (
    <div className="gg-strip">
      <p className="gg-strip__date">
        <span aria-hidden="true" className="gg-strip__dot" />
        <span>{past ? "The Christmas shipping cutoff has passed." : giftOrderByCopy()}</span>
      </p>
      {GIFT_SEASON_LIVE && (
        <Link href={GIFT_SEASON_HREF} className="gg-strip__cta" data-gg-season={placement} data-gg-tier={tier}>
          <span>Gift a Season</span>
          <span className="gg-strip__sub">One, two or four seasons</span>
        </Link>
      )}
    </div>
  );
}

/** Sizing and returns reassurance, shown in each tier header. */
export function GiftReassurance() {
  return (
    <ul className="gg-assure" aria-label="Sizing and returns">
      <li><strong>Unsure of his size?</strong> Most tops we ship this time of year go out in L or XL.</li>
      <li>
        <strong>Easy returns.</strong> Unworn with tags, within 30 days of delivery.{" "}
        <Link href="/policies/refund" className="gg-ulink">Policy</Link>
      </li>
    </ul>
  );
}

export function GiftReminders({ tier, placement }: { tier: string; placement: string }) {
  if (isPastGiftOrderBy()) return null;
  return <GiftReminderSignup tier={tier} placement={placement} orderBy={giftOrderByShort()} restockBy={giftRestockCutoffShortDay()} />;
}

export function GiftSizingNote() {
  return (
    <p className="gg-sizing">
      Not sure of his size? Most tops we ship this time of year go out in L or XL. Unworn pieces with tags return within 30 days of delivery.{" "}
      <Link href="/policies/refund" className="gg-ulink">Return policy</Link>
    </p>
  );
}

export function GiftSeasonCard({ placement, tier, compact = false }: { placement: string; tier: string; compact?: boolean }) {
  if (!GIFT_SEASON_LIVE) return null;
  return (
    <section className={`gg-season${compact ? " gg-season--compact" : ""}`} aria-labelledby={`gg-season-${placement}`}>
      <div className="gg-season__image">
        <Image
          src="/reserve-flatlay-hero.webp"
          alt="A Mully Reserve shipment laid out on turf: boxes, a quarter zip, a polo, a shoe bag and a belt."
          fill
          sizes="(max-width: 900px) 100vw, 640px"
          className="object-cover"
        />
      </div>
      <div className="gg-season__copy">
        <p className="gg-kicker">The gift that keeps arriving</p>
        <h2 id={`gg-season-${placement}`} className="gg-season__title">Gift a Season</h2>
        <p>
          A season of Mully Reserve. A stylist hand-picks golf apparel and accessories, and he confirms his own sizing through a
          private link, so you never guess. Paid once, never renews.
        </p>
        <p className="gg-season__options">One, two or four seasons.</p>
        <Link href={GIFT_SEASON_HREF} className="gg-button" data-gg-season={placement} data-gg-tier={tier}>
          Gift a Season
        </Link>
      </div>
    </section>
  );
}

/**
 * Compact Gift a Season tile in the product grid. Default: full-width row
 * after pick 4, mobile only. `slot`: one grid cell in the last row's empty
 * slot, desktop only. Both render nothing while GIFT_SEASON_LIVE is false.
 */
export function GiftSeasonTile({ placement, tier, slot = false }: { placement: string; tier: string; slot?: boolean }) {
  if (!GIFT_SEASON_LIVE) return null;
  return (
    <li className={slot ? "gg-season-tile gg-season-tile--slot" : "gg-season-tile"} aria-label="Gift a Season">
      <p className="gg-kicker">The gift that keeps arriving</p>
      <p className="gg-season-tile__title">Gift a Season</p>
      <p className="gg-season-tile__copy">A stylist picks, he confirms his own sizes. One, two or four seasons.</p>
      <Link href={GIFT_SEASON_HREF} className="gg-button" data-gg-season={placement} data-gg-tier={tier}>
        Gift a Season
      </Link>
    </li>
  );
}

/**
 * Hub rail directly under the H1: four in-stock pieces, real Shopify
 * packshots, live from the catalog. No price here (members see their own
 * price on the cards below). The first two images are the LCP candidates.
 */
export function GiftHeroRail({ picks }: { picks: GiftPick[] }) {
  if (picks.length < 4) return null;
  return (
    <ol className="gg-rail" aria-label="Top gifts in stock now">
      {picks.map((p, i) => {
        const { product } = p;
        const href = product.preferredVariantId
          ? `/shop/${product.slug}?variant=${encodeURIComponent(product.preferredVariantId)}`
          : `/shop/${product.slug}`;
        return (
          <li
            key={product.slug}
            className="gg-rail__item"
            data-gg-product={product.slug}
            data-gg-product-id={product.id}
            data-gg-price={product.price || undefined}
            data-gg-brand={product.brand}
            data-gg-tier="hub"
            data-gg-position={i + 1}
            data-gg-placement="hub-hero-rail"
          >
            <Link href={href}>
              <span className="gg-rail__img">
                <Image
                  src={shopProductPhoto(product)}
                  alt={shopProductLabel(product)}
                  fill
                  priority={i < 2}
                  sizes="(max-width: 640px) 40vw, (max-width: 1280px) 22vw, 280px"
                  className="object-contain"
                />
              </span>
              <span className="gg-rail__brand">{product.brand}</span>
              <span className="gg-rail__name">{shopProductLabel(product)}</span>
            </Link>
          </li>
        );
      })}
    </ol>
  );
}

/** One link tile that fills the last slot of a grid one short of a full row. */
export function GiftFillTile({ href, kicker, label, tierLink, placement, mobileOnly = false }: { href: string; kicker: string; label: string; tierLink: string; placement: string; mobileOnly?: boolean }) {
  return (
    <li className={mobileOnly ? "gg-fill gg-fill--mobile" : "gg-fill"}>
      <Link href={href} data-gg-tier-link={tierLink} data-gg-placement={placement}>
        <span className="gg-kicker">{kicker}</span>
        <span className="gg-fill__label">{label}</span>
        <span aria-hidden="true" className="gg-fill__arrow">→</span>
      </Link>
    </li>
  );
}

/**
 * What fills a grid's empty last slot. On the Gift a Season tier, once it is
 * live, the Season tile takes the slot on desktop (mobile already has the
 * tile after pick 4, so the link tile stays there).
 */
export function GiftGridFill({ season, ...link }: Omit<Parameters<typeof GiftFillTile>[0], "mobileOnly"> & { season?: { placement: string; tier: string } }) {
  if (season && GIFT_SEASON_LIVE) {
    return (
      <>
        <GiftSeasonTile {...season} slot />
        <GiftFillTile {...link} mobileOnly />
      </>
    );
  }
  return <GiftFillTile {...link} />;
}

function PickCard({ pick, tier, position, placement }: { pick: GiftPick; tier: string; position: number; placement: string }) {
  const { product } = pick;
  return (
    <li
      className="gg-pick"
      data-gg-product={product.slug}
      data-gg-product-id={product.id}
      data-gg-price={product.price || undefined}
      data-gg-brand={product.brand}
      data-gg-tier={tier}
      data-gg-position={position}
      data-gg-placement={placement}
    >
      <ShopProductCard product={product} />
      {pick.reason && <p className="gg-pick__reason">{pick.reason}</p>}
      {pick.inStock && pick.sizesInStock.length > 0 && (
        <p className="gg-pick__meta">In stock: {pick.sizesInStock.join(", ")}</p>
      )}
      {pick.restockOnly && <RestockChristmasNote weeks={product.preOrderEtaWeeks} />}
    </li>
  );
}

export function GiftTierSection({
  data,
  as = "h2",
  placement,
  showAllLink = false,
  aside,
  tile,
  tileAfter = 4,
  fill,
}: {
  data: GiftTierData;
  as?: "h1" | "h2";
  placement: string;
  showAllLink?: boolean;
  aside?: React.ReactNode;
  /** Grid tile inserted after pick `tileAfter`. When set, `aside` hides on mobile. */
  tile?: React.ReactNode;
  tileAfter?: number;
  /** Last grid slot when the picks are one short of a full row (see fitToRows). */
  fill?: React.ReactNode;
}) {
  const { tier, picks } = data;
  const Heading = as;
  return (
    <section className="gg-tier" id={tier.slug} aria-labelledby={`gg-h-${tier.slug}`}>
      <header className="gg-tier__head">
        <p className="gg-kicker">{tier.kicker} · {tier.label}</p>
        <Heading id={`gg-h-${tier.slug}`} className={as === "h1" ? "gg-h1" : "gg-h2"}>
          {tier.heading}
        </Heading>
        {as === "h1" && <GiftHeroStrip placement="tier-hero-strip" tier={tier.slug} />}
        <p className="gg-dek">{tier.dek}</p>
        <GiftReassurance />
        {showAllLink && (
          <Link href={`/shop/gifts/${tier.slug}`} className="gg-ulink" data-gg-tier-link={tier.slug} data-gg-placement={`${placement}-see-all`}>
            See the {tier.label} page
          </Link>
        )}
      </header>
      {aside && (tile ? <div className="gg-aside--desktop">{aside}</div> : aside)}
      {picks.length === 0 ? (
        <p className="gg-empty">This edit is being restocked. Try another budget or the full shop.</p>
      ) : (
        <ol className="gg-grid">
          {picks.flatMap((p, i) => {
            const card = <PickCard key={p.product.slug} pick={p} tier={tier.slug} position={i + 1} placement={placement} />;
            return tile && i + 1 === Math.min(tileAfter, picks.length) ? [card, <Fragment key="gg-season-tile">{tile}</Fragment>] : [card];
          })}
          {fill}
        </ol>
      )}
    </section>
  );
}

export function GiftOutfits({ outfits, placement }: { outfits: GiftOutfitData[]; placement: string }) {
  if (!outfits.length) return null;
  const onChino = outfits.every((o) => o.look.anchor === GIFT_OUTFIT_CHINO);
  return (
    <section className="gg-outfits" aria-labelledby={`gg-outfits-${placement}`}>
      <header className="gg-tier__head">
        <p className="gg-kicker">Head to toe</p>
        <h2 id={`gg-outfits-${placement}`} className="gg-h2">The full outfit</h2>
        <p className="gg-dek">
          {onChino ? "Built on the Duck Head Gold School Chino." : "Built around the vest he will wear all winter."} Give the set, or one piece of it.
        </p>
      </header>
      {outfits.map(({ outfit, look, picks }) => (
        <div className="gg-outfit" key={outfit.key}>
          <div className="gg-outfit__copy">
            <h3>{outfit.name}</h3>
            <p>{look.note}</p>
          </div>
          <ol className="gg-grid gg-grid--three">
            {picks.map((p, i) => (
              <PickCard key={p.product.slug} pick={p} tier={`outfit-${outfit.key}`} position={i + 1} placement={placement} />
            ))}
          </ol>
        </div>
      ))}
    </section>
  );
}

export function GiftFaqs({ headingId = "gg-faq" }: { headingId?: string }) {
  return (
    <section className="gg-faq" aria-labelledby={headingId}>
      <h2 id={headingId} className="gg-h2">Gift questions</h2>
      <div>
        {giftGuideFaqs().map((f) => (
          <details key={f.q}>
            <summary>{f.q}</summary>
            <p>{f.a}</p>
          </details>
        ))}
      </div>
    </section>
  );
}
