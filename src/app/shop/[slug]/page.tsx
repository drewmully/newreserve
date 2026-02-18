import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { products, getProductBySlug } from "../products";
import {
  ProductImageGallery,
  Accordion,
  AddToCartButton,
  BackLink,
} from "../components/ShopClient";
import { ShopHeader } from "../../components/ShopHeader";

interface Props {
  params: Promise<{ slug: string }>;
}

export async function generateStaticParams() {
  return products.map((p) => ({ slug: p.slug }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const product = getProductBySlug(slug);
  if (!product) return {};
  return {
    title: `${product.name} — ${product.brand} | Mully Reserve`,
    description: product.description,
  };
}

export default async function ProductPage({ params }: Props) {
  const { slug } = await params;
  const product = getProductBySlug(slug);
  if (!product) notFound();

  const accordionItems = [
    { title: "Description", content: product.description },
    { title: "Material", content: product.material },
    { title: "About the Brand", content: product.aboutBrand },
    { title: "Why We Like It", content: product.whyWeLikeIt },
    { title: "Sizing", content: product.sizing },
  ];

  return (
    <div className="min-h-screen bg-bone">
      {/* ─── HEADER ─── */}
      <ShopHeader />

      {/* ─── PRODUCT DETAIL ─── */}
      <main className="pt-28 pb-24 px-6 md:px-12">
        <div className="max-w-6xl mx-auto">
          <BackLink>Back to Shop</BackLink>

          <div className="grid md:grid-cols-2 gap-8 md:gap-14 lg:gap-20">
            {/* Left — Images */}
            <div>
              <ProductImageGallery
                images={product.images}
                name={product.name}
              />
            </div>

            {/* Right — Details */}
            <div className="flex flex-col">
              <p className="text-xs tracking-[0.25em] uppercase text-sage font-medium mb-2">
                {product.brand}
              </p>
              <h1 className="font-serif text-2xl md:text-3xl text-obsidian leading-tight mb-4">
                {product.name}
              </h1>

              {/* Price */}
              <div className="mb-6 pb-6 border-b border-taupe/20">
                <div className="flex items-center gap-3">
                  <span className="text-sm text-charcoal/40 line-through">${product.price}</span>
                  <span className="font-serif text-2xl text-forest">${product.reservePrice}</span>
                  <span className="text-[10px] tracking-wide uppercase text-sage bg-sage/10 px-2 py-1 rounded font-medium">
                    Mill River Price
                  </span>
                </div>
              </div>

              {/* Short description */}
              <p className="text-sm text-charcoal/60 leading-relaxed mb-8">
                {product.description}
              </p>

              {/* Add to cart */}
              <div className="mb-8">
                <AddToCartButton product={{ slug: product.slug, name: product.name, brand: product.brand, reservePrice: product.reservePrice, price: product.price }} />
              </div>

              {/* Accordions */}
              <Accordion items={accordionItems} />
            </div>
          </div>
        </div>
      </main>

      {/* ─── FOOTER ─── */}
      <footer className="py-10 px-6 md:px-12 bg-forest">
        <div className="max-w-6xl mx-auto flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <span className="flex items-center gap-2 text-bone">
            <svg viewBox="0 0 1002 540" fill="currentColor" className="h-4 w-auto" aria-hidden="true"><path d="M0,0 H1002 V540 H0 Z M50,1 L998,269 L50,538 Z" fillRule="evenodd" /></svg>
            <span className="font-serif text-xl font-bold tracking-wide">mully.</span>
          </span>
          <div className="flex items-center gap-8">
            <Link href="/policies/terms" className="text-sm text-bone/50 hover:text-bone transition-colors duration-300">Terms</Link>
            <Link href="/policies/privacy" className="text-sm text-bone/50 hover:text-bone transition-colors duration-300">Privacy</Link>
            <Link href="/faq" className="text-sm text-bone/50 hover:text-bone transition-colors duration-300">FAQ</Link>
          </div>
          <p className="text-xs text-bone/30">&copy; {new Date().getFullYear()} Mully Group, Inc.</p>
        </div>
      </footer>
    </div>
  );
}
