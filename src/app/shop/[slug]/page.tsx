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
      <header className="fixed top-0 left-0 right-0 z-50 bg-bone/90 backdrop-blur-md border-b border-taupe/20">
        <div className="max-w-7xl mx-auto px-6 md:px-12 flex items-center justify-between h-16">
          <Link
            href="/"
            className="font-serif text-2xl text-ember font-bold tracking-wide"
          >
            mully.
          </Link>
          <nav className="flex items-center gap-8">
            <Link
              href="/shop"
              className="hidden md:block text-sm tracking-wider uppercase text-charcoal/60 hover:text-forest transition-colors duration-300"
            >
              Shop
            </Link>
            <Link
              href="/#reserve"
              className="hidden md:block text-sm tracking-wider uppercase text-charcoal/60 hover:text-forest transition-colors duration-300"
            >
              Reserve
            </Link>
            <Link
              href="/login"
              className="text-sm tracking-wider uppercase text-forest font-medium hover:text-forest-dark transition-colors duration-300"
            >
              Sign In
            </Link>
          </nav>
        </div>
      </header>

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
              <div className="flex items-baseline gap-3 mb-6 pb-6 border-b border-taupe/20">
                <span className="font-serif text-2xl text-forest">
                  ${product.reservePrice}
                </span>
                {product.reservePrice < product.price && (
                  <>
                    <span className="text-base text-charcoal/30 line-through">
                      ${product.price}
                    </span>
                    <span className="text-xs tracking-wider uppercase bg-forest/10 text-forest font-medium px-2.5 py-1 rounded-full">
                      Reserve Price
                    </span>
                  </>
                )}
              </div>

              {/* Short description */}
              <p className="text-sm text-charcoal/60 leading-relaxed mb-8">
                {product.description}
              </p>

              {/* Add to cart */}
              <div className="mb-8">
                <AddToCartButton />
              </div>

              {/* Accordions */}
              <Accordion items={accordionItems} />
            </div>
          </div>
        </div>
      </main>

      {/* ─── FOOTER ─── */}
      <footer className="py-12 px-6 md:px-12 bg-obsidian">
        <div className="max-w-6xl mx-auto flex flex-col md:flex-row md:items-center md:justify-between gap-6">
          <span className="font-serif text-xl text-ember font-bold tracking-wide">
            mully.
          </span>
          <div className="flex items-center gap-8">
            <Link
              href="/terms"
              className="text-sm text-bone/40 hover:text-bone/70 transition-colors duration-300"
            >
              Terms
            </Link>
            <Link
              href="/privacy"
              className="text-sm text-bone/40 hover:text-bone/70 transition-colors duration-300"
            >
              Privacy
            </Link>
            <Link
              href="/contact"
              className="text-sm text-bone/40 hover:text-bone/70 transition-colors duration-300"
            >
              Contact
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
