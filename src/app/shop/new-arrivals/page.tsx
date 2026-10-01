import type { Metadata } from "next";
import Link from "next/link";
import { getCollectionProducts, type ShopifyProduct } from "@/lib/shopify";
import { ShopPageShell } from "../components/ShopPageShell";
import { ShopProductCard } from "../components/ShopProductCard";
export const revalidate = 60;
export const metadata: Metadata = {title:"New Arrivals | Mully",description:"The latest additions to the Mully shop."};
export default async function NewArrivals() {
  let products: ShopifyProduct[] = [];
  try {
    products = await getCollectionProducts("shop-all", true);
  } catch (error) {
    console.error("[shop new arrivals] Catalog unavailable", error);
  }
  return <ShopPageShell><main className="shop-page-main">
    <header className="shop-page-heading"><Link href="/shop" className="shop-text-link shop-page-kicker">← The shop</Link>
      <h1>New arrivals.</h1><p>The latest additions to the edit, newest first.</p></header>
    <div className="shop-catalog-grid">{products.map(product=><ShopProductCard key={product.slug} product={product} accent="#4A3528"/>)}</div>
    {!products.length && <p>New finds are on their way. <Link href="/shop">Explore the shop.</Link></p>}
  </main></ShopPageShell>;
}
