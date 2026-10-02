/* eslint-disable @next/next/no-img-element */
import Link from "next/link";
import type { ReactNode } from "react";
import type { ShopifyProduct } from "@/lib/shopify";
import { shopProductPhoto, shopProductLabel } from "@/lib/shopProductPhotos";
import { money } from "@/lib/shopOutfit";

/**
 * Editorial breaks for /shop/collection/shop-all. Each break only renders when
 * every product it features is in the collection, so an archived or sold-out
 * piece never leaves a story pointing at a dead product page.
 * Photography is the brands' own (Duck Head, Olydoe), not AI imagery.
 */
type StoryBreak = {
  kind: "story";
  key: string;
  after: number;
  image: string;
  imageAlt: string;
  eyebrow: string;
  title: string;
  lede: string;
  slugs: string[];
};
type TileBreak = {
  kind: "tile";
  key: string;
  after: number;
  image: string;
  imageAlt: string;
  eyebrow: string;
  title: string;
  cta: string;
  slug: string;
};
export type EditorialBreak = StoryBreak | TileBreak;

export const SHOP_ALL_BREAKS: EditorialBreak[] = [
  {
    kind: "story",
    key: "october-layer",
    after: 8,
    image: "/shop-redesign/editorial/fremont-october-layer.webp",
    imageAlt: "Duck Head Fremont quilted vest in Brandy Brown worn over a plaid shirt",
    eyebrow: "The October Layer",
    title: "Warm enough for the first tee. Light enough for the back nine.",
    lede: "A quilted vest over a cotton sweater, finished with a khaki chino. Three pieces, one look.",
    slugs: [
      "duckhead-fremont-sport-performance-quilted-vest-brandy-brown",
      "quiet-golf-bristol-polo-sweater",
      "duckhead-classic-fit-gold-school-chino-khaki",
    ],
  },
  {
    kind: "tile",
    key: "quiet-layers",
    after: 14,
    image: "/shop-redesign/editorial/olydoe-quiet-layers.webp",
    imageAlt: "Olydoe Merino Ponte Quarter Zip in Sand worn in a wood-paneled study",
    eyebrow: "Quiet Layers",
    title: "Merino, worn softly. From the range to the clubhouse.",
    cta: "Shop the Merino Quarter Zip",
    slug: "olydoe-merino-ponte-quarter-zip",
  },
];

function StoryBand({ b, products }: { b: StoryBreak; products: ShopifyProduct[] }) {
  const total = products.reduce((sum, p) => sum + p.price, 0);
  return (
    <section className="shop-edit-story" aria-labelledby={`story-${b.key}`}>
      <div className="shop-edit-story__media"><img src={b.image} alt={b.imageAlt} loading="lazy" /></div>
      <div className="shop-edit-story__copy">
        <p className="shop-edit-eyebrow">{b.eyebrow}</p>
        <h2 id={`story-${b.key}`}>{b.title}</h2>
        <p className="shop-edit-story__lede">{b.lede}</p>
        <ul className="shop-edit-story__pieces">
          {products.map((p) => (
            <li key={p.slug}>
              <Link href={`/shop/${p.slug}`} className="shop-edit-piece" data-testid={`story-piece-${p.slug}`}>
                <img src={(p as ShopifyProduct & { cardImage?: string }).cardImage || shopProductPhoto(p)} alt="" loading="lazy" />
                <span><small>{p.brand}</small>{shopProductLabel(p)}<b>{money(p.price)}</b></span>
              </Link>
            </li>
          ))}
        </ul>
        <Link href="/shop#outfit" className="shop-edit-cta">Build the look · {money(total)}</Link>
      </div>
    </section>
  );
}

function Tile({ b, product }: { b: TileBreak; product: ShopifyProduct }) {
  return (
    <Link href={`/shop/${product.slug}`} className="shop-edit-tile" aria-label={`${b.eyebrow}: ${b.cta}`}>
      <img src={b.image} alt={b.imageAlt} loading="lazy" />
      <span className="shop-edit-tile__copy">
        <span className="shop-edit-eyebrow">{b.eyebrow}</span>
        <span className="shop-edit-tile__title">{b.title}</span>
        <span className="shop-edit-cta shop-edit-cta--light">{b.cta} · {money(product.price)}</span>
      </span>
    </Link>
  );
}

/** Interleave product cards with editorial breaks at their configured positions. */
export function withEditorialBreaks<T extends ShopifyProduct>(
  products: T[],
  renderCard: (p: T) => ReactNode,
  breaks: EditorialBreak[] = SHOP_ALL_BREAKS
): ReactNode[] {
  // First card per slug is the lead color; that is what the story should show.
  const bySlug = new Map<string, ShopifyProduct>();
  for (const p of products) if (!bySlug.has(p.slug)) bySlug.set(p.slug, p);
  const out: ReactNode[] = [];
  products.forEach((p, i) => {
    for (const b of breaks) {
      if (b.after !== i) continue;
      if (b.kind === "story") {
        const pieces = b.slugs.map((s) => bySlug.get(s));
        if (pieces.every(Boolean)) out.push(<StoryBand key={b.key} b={b} products={pieces as ShopifyProduct[]} />);
      } else {
        const product = bySlug.get(b.slug);
        if (product) out.push(<Tile key={b.key} b={b} product={product} />);
      }
    }
    out.push(renderCard(p));
  });
  return out;
}
