import type { Metadata } from "next";
import Link from "next/link";
import { notFound, permanentRedirect } from "next/navigation";
import { getCollectionProducts } from "@/lib/shopify";
import { ShopPageShell } from "../../components/ShopPageShell";
import { ShopProductCard } from "../../components/ShopProductCard";
import { ScrollToTop } from "../../components/ScrollToTop";
import { withEditorialBreaks } from "../../components/ShopEditorialBreaks";
import { buildColorCards, buildSwatchCards } from "@/lib/shopColorCards";
import { SHOP_CATEGORIES, SHOP_CATEGORY_HANDLES } from "../../shopCollections";

export const revalidate = 3600;
interface Props { params: Promise<{ handle: string }> }
const categories = [{ label: "Shop all", handle: "shop-all", detail: "The whole edit, in one place." }, ...SHOP_CATEGORIES];
export async function generateStaticParams() {
  return [...Object.values(SHOP_CATEGORY_HANDLES), "shop-all"].map(handle => ({handle}));
}
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { handle } = await params;
  const cat = categories.find(c => c.handle === handle);
  return {title: `${cat?.label ?? "Shop"} | Mully`, description: cat?.detail};
}
export default async function ShopCollectionPage({ params }: Props) {
  const { handle } = await params;
  if (handle === "shop-tech") permanentRedirect("/shop/collection/shop-gear");
  const cat = categories.find(c => c.handle === handle);
  if (!cat) notFound();
  let products: Awaited<ReturnType<typeof getCollectionProducts>> = [];
  let failed = false;
  try {
    products = handle === "shop-gear"
      ? (await getCollectionProducts("shop-all")).filter(p => p.tags?.includes("shop-gear"))
      : await getCollectionProducts(handle);
  }
  catch (err) { failed = true; console.error("[shop collection] Catalog unavailable", err); }
  // Shop all: one card per product with color swatches. Category pages: a card per color.
  const cards = handle === "shop-all" ? buildSwatchCards(products) : buildColorCards(products);
  return <ShopPageShell>
    <ScrollToTop />
    <main className="shop-page-main">
      <header className="shop-page-heading">
        <Link href="/shop" className="shop-text-link shop-page-kicker">← The shop</Link>
        <h1>{cat.label}</h1><p>{cat.detail}</p>
      </header>
      <nav className="shop-collection-nav" aria-label="Shop categories">
        {categories.map(c => <Link key={c.handle} href={`/shop/collection/${c.handle}`} aria-current={handle === c.handle ? "page" : undefined}>{c.label}</Link>)}
      </nav>
      <p className="text-xs text-charcoal/60 mb-6">{cards.length} {cards.length === 1 ? "piece" : "pieces"}</p>
      <div className={handle === "shop-all" ? "shop-catalog-grid shop-catalog-grid--editorial" : "shop-catalog-grid"}>
        {handle === "shop-all"
          ? withEditorialBreaks(cards, product => <ShopProductCard key={product.displayKey} product={product} accent="#4A3528" />)
          : cards.map(product => <ShopProductCard key={product.displayKey} product={product} accent="#4A3528" />)}
      </div>
      {products.length === 0 && <div className="py-16">
        <p>{failed ? "We couldn’t load this collection. Please try again shortly." : "No pieces in this collection right now."}</p>
        <Link href="/shop" className="shop-text-link mt-4">Explore the edit →</Link>
      </div>}
      <div className="shop-support-links mt-14"><Link href="/shop#outfit" className="shop-text-link">Make it an outfit →</Link><Link href="/faq" className="shop-text-link">Questions? Start here</Link></div>
    </main>
  </ShopPageShell>;
}
