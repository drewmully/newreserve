"use client";

import { useEffect } from "react";
import type { SizeGuide } from "@/lib/sizeCharts";

interface Props {
  guide: SizeGuide;
  productName: string;
  onClose: () => void;
}

/**
 * Huckberry-style Size & Fit modal. Fixed overlay, escape-key close,
 * body-scroll lock while open. Chart columns come from the guide.
 */
export function SizeFitChart({ guide, productName, onClose }: Props) {
  useEffect(() => {
    const original = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = original;
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  const { chart, fitNote, source } = guide;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-end justify-center bg-charcoal/60 backdrop-blur-sm md:items-center"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden bg-white shadow-2xl md:max-h-[85vh] md:rounded-sm"
      >
        <div className="flex items-start justify-between border-b border-charcoal/10 px-6 py-5">
          <div>
            <p className="text-[10px] font-mono uppercase tracking-[0.28em] text-charcoal/50">
              Size &amp; Fit
            </p>
            <h2 className="mt-1 font-serif text-2xl leading-tight text-charcoal">
              {productName}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="ml-4 flex h-9 w-9 items-center justify-center text-charcoal/60 transition-colors hover:text-charcoal"
          >
            <svg
              viewBox="0 0 24 24"
              className="h-5 w-5"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
            >
              <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-6">
          <p className="text-[15px] leading-relaxed text-charcoal/80">
            {fitNote}
          </p>

          <div className="mt-6 overflow-x-auto">
            <table className="w-full min-w-[420px] border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-charcoal/15">
                  <th className="pb-3 pr-4 text-[10px] font-mono uppercase tracking-[0.2em] text-charcoal/50">
                    Size
                  </th>
                  {chart.columns.map((col) => (
                    <th
                      key={col}
                      className="pb-3 pl-4 text-[10px] font-mono uppercase tracking-[0.2em] text-charcoal/50"
                    >
                      {col}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {chart.rows.map((row, i) => (
                  <tr
                    key={row.size}
                    className={
                      i < chart.rows.length - 1
                        ? "border-b border-charcoal/5"
                        : ""
                    }
                  >
                    <td className="py-3 pr-4 font-medium text-charcoal">
                      {row.size}
                    </td>
                    {chart.columns.map((col) => (
                      <td
                        key={col}
                        className="py-3 pl-4 tabular-nums text-charcoal/75"
                      >
                        {row[col] ?? "—"}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className="mt-4 text-[11px] text-charcoal/45">
            {chart.measurementType === "garment"
              ? "Garment measurements laid flat, inches."
              : "Body measurements, inches. If you sit between sizes, size up for a looser fit."}
            {source ? ` Sourced from ${source}.` : ""}
          </p>
        </div>
      </div>
    </div>
  );
}
