/**
 * Server pieces of blog commerce v1: live Shopify product fetch plus the
 * product rows, Reserve blocks and end-of-post block. Every block renders
 * inside a BlogCommerceSlot, so the server HTML matches control and the
 * test variant is revealed client-side.
 */
import Link from "next/link";
import { getProductByHandle, type ShopifyProduct } from "@/lib/shopify";
import { ShopProductCard } from "../../shop/components/ShopProductCard";
import {
  END_COPY,
  RESERVE_MID_COPY,
  ROW_COPY,
  type BlogCommerceBlock,
  type CtaCopy,
  type EndIntent,
} from "@/lib/blogCommerce";
import { BlogCommerceSlot } from "./BlogCommerceClient";
import "./blog-commerce.css";

const FETCH_TIMEOUT_MS = 2500;

/** In stock now: at least one variant can ship today (not a preorder). */
function inStock(p: ShopifyProduct): boolean {
  return p.price > 0 && Boolean(p.images[0]) && p.variants.some(v => v.availableForSale && !v.currentlyNotInStock);
}

/**
 * Live products for the given handles, in order, sold-out ones removed.
 * Any failure or a slow Storefront API returns [] so the post still renders.
 */
export async function getBlogCommerceProducts(handles: string[]): Promise<ShopifyProduct[]> {
  if (handles.length === 0) return [];
  const work = Promise.allSettled(handles.map(h => getProductByHandle(h))).then(results =>
    results.flatMap(r => (r.status === "fulfilled" && r.value && inStock(r.value) ? [r.value] : [])),
  );
  const timeout = new Promise<ShopifyProduct[]>(resolve => setTimeout(() => resolve([]), FETCH_TIMEOUT_MS));
  try {
    return await Promise.race([work, timeout]);
  } catch {
    return [];
  }
}

export function ProductRow({
  products,
  block,
  size,
}: {
  products: ShopifyProduct[];
  block: Extract<BlogCommerceBlock, "product_row_top" | "product_row_bottom">;
  size: "compact" | "full";
}) {
  if (products.length === 0) return null;
  const compact = size === "compact";
  return (
    <BlogCommerceSlot show="test" block={block} targetPath="/shop" productHandles={products.map(p => p.slug)}>
      <section className={`bc-row ${compact ? "bc-row--compact" : "bc-row--full"}`} aria-label={compact ? ROW_COPY.top : ROW_COPY.bottom}>
        {compact
          ? <p className="bc-eyebrow">{ROW_COPY.top}</p>
          : <h2 className="bc-row__title">{ROW_COPY.bottom}</h2>}
        <div className="bc-row__grid">
          {products.map(p => <ShopProductCard key={p.slug} product={p} />)}
        </div>
      </section>
    </BlogCommerceSlot>
  );
}

function CtaPanel({ copy, tone }: { copy: CtaCopy; tone: "mid" | "end" }) {
  return (
    <aside className={`bc-panel bc-panel--${tone}`} aria-label={copy.eyebrow}>
      <p className="bc-eyebrow">{copy.eyebrow}</p>
      <h2 className="bc-panel__title">{copy.heading}</h2>
      <p className="bc-panel__body">{copy.body}</p>
      <Link className="bc-panel__cta" href={copy.href}>{copy.cta} →</Link>
    </aside>
  );
}

export function ReserveMid() {
  return (
    <BlogCommerceSlot show="test" block="reserve_mid" targetPath={RESERVE_MID_COPY.href}>
      <CtaPanel copy={RESERVE_MID_COPY} tone="mid" />
    </BlogCommerceSlot>
  );
}

/**
 * Intent-matched end block: Reserve or gift panel. `shop` posts use
 * EndShopLink (after the bottom product row) instead.
 */
export function EndPanel({ intent }: { intent: EndIntent }) {
  if (intent === "shop") return null;
  const copy = END_COPY[intent];
  return (
    <BlogCommerceSlot show="test" block="end_block" targetPath={copy.href}>
      <CtaPanel copy={copy} tone="end" />
    </BlogCommerceSlot>
  );
}

/** End block for shop-intent posts: "Shop the Mully Edit" link to /shop. */
export function EndShopLink() {
  return (
    <BlogCommerceSlot show="test" block="end_block" targetPath={ROW_COPY.shopLink.href}>
      <Link className="bc-shop-link" href={ROW_COPY.shopLink.href}>{ROW_COPY.shopLink.label} →</Link>
    </BlogCommerceSlot>
  );
}
