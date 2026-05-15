import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  getCollectionProducts,
  getProductByHandle,
  mergeCollectionProductsBySlug,
  PRIVATE_RELEASES_COLLECTION_HANDLE,
  PRO_SHOP_COLLECTION_HANDLE,
} from "@/lib/shopify";
import {
  Accordion,
  BackLink,
} from "../components/ShopClient";
import { ProductDetailClient } from "../components/ProductDetailClient";
import { ShopHeader } from "../../components/ShopHeader";
import { getVariantById, getVariantSelection } from "@/lib/productVariants";

// Revalidate ISR every hour
export const revalidate = 3600;

interface Props {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ from?: string; variant?: string }>;
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
    // Shopify unavailable at build time — pages generated on demand
    return [];
  }
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  try {
    const product = await getProductByHandle(slug);
    if (!product) return {};
    return {
      title: `${product.name} | ${product.brand} | Mully Reserve`,
      description: product.description,
    };
  } catch {
    return {};
  }
}

export default async function ProductPage({ params, searchParams }: Props) {
  const { slug } = await params;
  const { from, variant: requestedVariantId } = await searchParams;
  const backHref = from === "dashboard" ? "/dashboard?tab=shop" : "/shop";
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

  const accordionItems = [
    { title: "Description", content: product.description },
    { title: "Material", content: product.material },
    { title: "About the Brand", content: product.aboutBrand },
    { title: "Why We Like It", content: product.whyWeLikeIt },
    { title: "Sizing", content: product.sizing },
  ].filter((item) => item.content); // hide empty accordion rows

  return (
    <div className="min-h-screen bg-bone">
      {/* HEADER */}
      <ShopHeader />

      {/* PRODUCT DETAIL */}
      <main className="shop-main pb-24 px-6 md:px-12">
        <div className="max-w-6xl mx-auto">
          <BackLink href={backHref}>Back to Shop</BackLink>

          <ProductDetailClient
            product={product}
            initialSelection={initialSelection}
            detailsFooter={<Accordion items={accordionItems} />}
          />
        </div>
      </main>

      {/* FOOTER */}
      <footer className="py-10 px-6 md:px-12 bg-forest">
        <div className="max-w-6xl mx-auto flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <span className="flex items-center gap-2 text-bone">
            <svg
              viewBox="0 0 1002 540"
              fill="currentColor"
              className="h-4 w-auto"
              aria-hidden="true"
            >
              <path
                d="M0,0 H1002 V540 H0 Z M50,1 L998,269 L50,538 Z"
                fillRule="evenodd"
              />
            </svg>
            <span className="font-serif text-xl font-bold tracking-wide">
              mully.
            </span>
          </span>
          <div className="flex items-center gap-8">
            <Link
              href="/policies/terms"
              className="text-sm text-bone/50 hover:text-bone transition-colors duration-300"
            >
              Terms
            </Link>
            <Link
              href="/policies/privacy"
              className="text-sm text-bone/50 hover:text-bone transition-colors duration-300"
            >
              Privacy
            </Link>
            <Link
              href="/faq"
              className="text-sm text-bone/50 hover:text-bone transition-colors duration-300"
            >
              FAQ
            </Link>
          </div>
          <p className="text-xs text-bone/30">
            &copy; {new Date().getFullYear()} Mully Group, Inc.
          </p>
        </div>
      </footer>
    </div>
  );
}
