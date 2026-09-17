"use client";

import { useState } from "react";
import type { ShopifyProduct } from "@/lib/shopify";
import type { SizeGuide } from "@/lib/sizeCharts";

interface Props {
  product: ShopifyProduct;
  sizeGuide?: SizeGuide | null;
  onOpenSizeChart: () => void;
}

/**
 * Structured accordion below the buy box.
 *
 *  - Features         → custom.features (newline-separated bullets)
 *  - Fit & Sizing     → custom.fit_notes + inline garment measurements + How-to-measure link
 *  - Materials & Care → custom.materials_bullets (falls back to legacy custom.material paragraph)
 *  - About [Brand]    → custom.about_brand (paragraph)
 *
 * Rows with no content are hidden. The Fit & Sizing row still renders when
 * we have a curated size guide, even if the fit_notes metafield is empty.
 */
export function PdpAccordion({ product, sizeGuide, onOpenSizeChart }: Props) {
  const [openId, setOpenId] = useState<string | null>("features");

  const features = splitBullets(product.features);
  const fitNotes = splitBullets(product.fitNotes);
  const materialsBullets = splitBullets(product.materialsBullets);

  const rows: Array<{
    id: string;
    label: string;
    content: React.ReactNode | null;
  }> = [
    {
      id: "features",
      label: "Features",
      content: features.length > 0 ? <BulletList items={features} /> : null,
    },
    {
      id: "sizing",
      label: "Fit & Sizing",
      content:
        fitNotes.length > 0 || sizeGuide ? (
          <FitAndSizingBody
            fitNotes={fitNotes}
            legacySizing={product.sizing}
            sizeGuide={sizeGuide}
            onOpenSizeChart={onOpenSizeChart}
          />
        ) : null,
    },
    {
      id: "materials",
      label: "Materials & Care",
      content:
        materialsBullets.length > 0 ? (
          <BulletList items={materialsBullets} />
        ) : product.material ? (
          <Paragraphs text={product.material} />
        ) : null,
    },
    {
      id: "brand",
      label: `About ${product.brand}`,
      content: product.aboutBrand ? <Paragraphs text={product.aboutBrand} /> : null,
    },
  ].filter((r) => r.content !== null);

  if (rows.length === 0) return null;

  return (
    <section className="mt-16 border-t border-charcoal/10">
      {rows.map((row) => {
        const open = openId === row.id;
        return (
          <div key={row.id} className="border-b border-charcoal/10">
            <button
              onClick={() => setOpenId(open ? null : row.id)}
              aria-expanded={open}
              className="flex w-full items-center justify-between py-5 text-left transition-colors hover:bg-cream/40"
            >
              <span className="font-serif text-lg tracking-tight text-charcoal md:text-xl">
                {row.label}
              </span>
              <span className="text-xl text-charcoal/40" aria-hidden="true">
                {open ? "−" : "+"}
              </span>
            </button>
            {open && (
              <div className="pb-6 pr-2 text-[14px] leading-relaxed text-charcoal/75">
                {row.content}
              </div>
            )}
          </div>
        );
      })}
    </section>
  );
}

function splitBullets(text: string | undefined): string[] {
  if (!text) return [];
  return text
    .split(/\n+/)
    .map((line) => line.replace(/^[-•*]\s*/, "").trim())
    .filter((line) => line.length > 0);
}

function BulletList({ items }: { items: string[] }) {
  return (
    <ul className="space-y-2 pl-1">
      {items.map((item, i) => (
        <li key={i} className="flex gap-3">
          <span aria-hidden="true" className="mt-2 inline-block h-1 w-1 flex-shrink-0 rounded-full bg-charcoal/40" />
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}

function Paragraphs({ text }: { text: string }) {
  return (
    <div className="space-y-3">
      {text.split(/\n\n+/).map((p, i) => (
        <p key={i}>{p}</p>
      ))}
    </div>
  );
}

function FitAndSizingBody({
  fitNotes,
  legacySizing,
  sizeGuide,
  onOpenSizeChart,
}: {
  fitNotes: string[];
  legacySizing: string;
  sizeGuide?: SizeGuide | null;
  onOpenSizeChart: () => void;
}) {
  const measurements =
    sizeGuide && sizeGuide.chart.columns && sizeGuide.chart.columns.length > 0
      ? sizeGuide.chart
      : null;

  return (
    <div className="space-y-6">
      {fitNotes.length > 0 ? (
        <BulletList items={fitNotes} />
      ) : legacySizing ? (
        <Paragraphs text={legacySizing} />
      ) : null}

      {measurements && (
        <div>
          <p className="mb-2 text-[11px] font-mono uppercase tracking-[0.22em] text-charcoal/50">
            Garment measurements (in)
          </p>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[420px] border-collapse text-[13px]">
              <thead>
                <tr className="border-b border-charcoal/15 text-left">
                  <th className="py-2 pr-4 text-[11px] font-mono uppercase tracking-[0.16em] text-charcoal/60">Size</th>
                  {measurements.columns.map((h) => (
                    <th
                      key={h}
                      className="py-2 pr-4 text-[11px] font-mono uppercase tracking-[0.16em] text-charcoal/60"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {measurements.rows.map((row) => (
                  <tr key={row.size} className="border-b border-charcoal/10">
                    <td className="py-2 pr-4 font-medium text-charcoal">{row.size}</td>
                    {measurements.columns.map((h) => (
                      <td key={h} className="py-2 pr-4 text-charcoal/70">
                        {(row as Record<string, string>)[h] ?? "—"}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {sizeGuide && (
        <button
          type="button"
          onClick={onOpenSizeChart}
          className="text-[11px] font-mono uppercase tracking-[0.22em] text-forest underline underline-offset-4 transition-colors hover:text-forest/80"
        >
          How to measure →
        </button>
      )}
    </div>
  );
}
