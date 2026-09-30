import type { Metadata } from "next";
import { notFound } from "next/navigation";
import {
  getCollectionProducts,
  getProductByHandle,
  mergeCollectionProductsBySlug,
  PRIVATE_RELEASES_COLLECTION_HANDLE,
  PRO_SHOP_COLLECTION_HANDLE,
} from "@/lib/shopify";
import { ShopPDPClient } from "../components/ShopPDPClient";
import { ShopPageShell } from "../components/ShopPageShell";
import { ScrollToTop } from "../components/ScrollToTop";
import { getSeasonalTheme } from "../seasonalTheme";
import { getVariantById, getVariantSelection } from "@/lib/productVariants";

export const revalidate = 3600;

interface Props {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ variant?: string }>;
}

export async function generateStaticParams() {
  try {
    const [proShop, privateReleases] = await Promise.allSettled([
      getCollectionProducts(PRO_SHOP_COLLECTION_HANDLE),
      getCollectionProducts(PRIVATE_RELEASES_COLLECTION_HANDLE),
    ]);

    const successfulCollections: Array<{
      handle: string;
      products: Awaited<ReturnType<typeof getCollectionProducts>>;
    }> = [];

    if (proShop.status === "fulfilled") {
      successfulCollections.push({
        handle: PRO_SHOP_COLLECTION_HANDLE,
        products: proShop.value,
      });
    }

    if (privateReleases.status === "fulfilled") {
      successfulCollections.push({
        handle: PRIVATE_RELEASES_COLLECTION_HANDLE,
        products: privateReleases.value,
      });
    }

    return mergeCollectionProductsBySlug(successfulCollections).map((p) => ({
      slug: p.slug,
    }));
  } catch {
    return [];
  }
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  try {
    const product = await getProductByHandle(slug);
    if (!product) return {};
    return {
      title: `${product.name} | ${product.brand} | Mully Shop`,
      description: product.description,
    };
  } catch {
    return {};
  }
}

export default async function ProductPage({ params, searchParams }: Props) {
  const { slug } = await params;
  const { variant: requestedVariantId } = await searchParams;

  let product;
  try {
    product = await getProductByHandle(slug);
  } catch (err) {
    console.error("[ProductPage] Shopify fetch failed:", err);
    notFound();
  }
  if (!product) notFound();

  const preferredVariant = requestedVariantId
    ? getVariantById(product, requestedVariantId)
    : null;
  const initialSelection = getVariantSelection(preferredVariant);
  const theme = getSeasonalTheme();

  // Related products for the "More from Brand" and "You may also like" rails.
  let related: Awaited<ReturnType<typeof getCollectionProducts>> = [];
  try {
    // Keep recommendations inside the current shop assortment. Unrelated
    // Reserve/private-release inventory remains untouched in Shopify.
    related = await getCollectionProducts("shop-all");
  } catch (err) {
    console.error("[ProductPage] related fetch failed:", err);
  }

  return (
    <ShopPageShell className="shop-pdp">
      <ScrollToTop />

      <main className="shop-main pb-24">
        {/* Product detail (breadcrumb is rendered inside ShopPDPClient) */}
        <section className="px-6 py-8 md:px-12 md:py-12">
          <div className="mx-auto max-w-7xl">
            <ShopPDPClient
              product={product}
              initialSelection={initialSelection}
              accent={theme.accent}
              relatedProducts={related}
            />
          </div>
        </section>
      </main>

    </ShopPageShell>
  );
}
