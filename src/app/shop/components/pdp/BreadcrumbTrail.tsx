"use client";

import Link from "next/link";

interface Props {
  productType?: string;
  subcategory?: string;
  brand: string;
}

/**
 * PDP breadcrumb funnel: Shop / [ProductType] / [Subcategory]
 *
 * Product type comes from Shopify `productType` (e.g. "Pants").
 * Subcategory comes from custom.subcategory metafield (e.g. "5 Pocket Pants").
 * If neither exists, falls back to Shop / Brand.
 *
 * All segments except the last are links; the last (subcategory or brand) is text.
 */
export function BreadcrumbTrail({ productType, subcategory, brand }: Props) {
  const crumbs: Array<{ label: string; href?: string }> = [
    { label: "Shop", href: "/shop" },
  ];

  if (productType && productType.trim().length > 0) {
    // Link to collection when we can guess it; slug it.
    const slug = productType.toLowerCase().replace(/[^a-z0-9]+/g, "-");
    crumbs.push({ label: productType, href: `/shop/collection/${slug}` });
  }

  if (subcategory && subcategory.trim().length > 0) {
    crumbs.push({ label: subcategory });
  } else if (crumbs.length === 1) {
    crumbs.push({ label: brand });
  }

  return (
    <nav aria-label="Breadcrumb" className="flex items-center gap-2 text-[11px] font-mono uppercase tracking-[0.2em] text-charcoal/50">
      {crumbs.map((c, i) => {
        const isLast = i === crumbs.length - 1;
        return (
          <span key={`${c.label}-${i}`} className="flex items-center gap-2">
            {c.href && !isLast ? (
              <Link href={c.href} className="transition-colors hover:text-charcoal">
                {c.label}
              </Link>
            ) : (
              <span className="text-charcoal/70">{c.label}</span>
            )}
            {!isLast && <span aria-hidden="true">/</span>}
          </span>
        );
      })}
    </nav>
  );
}
