"use client";

/**
 * Admin > Pro Shop
 *
 * Funnel + top products + brand/source breakdown for the Pro Shop. Pulls
 * /api/admin/proshop-insights which runs HogQL against PostHog.
 *
 * Designed to answer the questions Drew actually asks:
 *   - What's converting? (view → add → purchase rates)
 *   - What are people buying? (top products, brand mix)
 *   - Where are they coming from? (source breakdown for product views)
 */

import { useEffect, useState, useCallback } from "react";
import { auth } from "@/lib/firebase";

interface Insights {
  window_days: number;
  funnel: {
    proshop_views: number;
    product_views: number;
    quick_adds: number;
    adds: number;
    checkouts: number;
    purchases: number;
    unique_viewers: number;
    unique_adders: number;
  };
  conv: {
    view_to_add: number | null;
    add_to_purchase: number | null;
  };
  top_products: Array<{
    slug: string | null;
    name: string | null;
    brand: string | null;
    adds: number;
    users: number;
  }>;
  brands: Array<{ brand: string | null; adds: number; users: number }>;
  sources: Array<{ source: string | null; views: number }>;
}

function pct(v: number | null): string {
  if (v === null || !Number.isFinite(v)) return "—";
  return `${(v * 100).toFixed(1)}%`;
}

function num(v: number): string {
  return v.toLocaleString();
}

export default function ProShopAdminPage() {
  const [days, setDays] = useState(30);
  const [data, setData] = useState<Insights | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const user = auth.currentUser;
      if (!user) throw new Error("not signed in");
      const token = await user.getIdToken();
      const res = await fetch(`/api/admin/proshop-insights?days=${days}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(j.error ?? "failed");
      }
      const j = (await res.json()) as Insights;
      setData(j);
    } catch (err) {
      setError(err instanceof Error ? err.message : "unknown");
    } finally {
      setLoading(false);
    }
  }, [days]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="max-w-6xl mx-auto px-6 py-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="font-serif text-2xl text-obsidian">Pro Shop</h1>
          <p className="text-xs text-charcoal/50">
            Demand, conversion, and brand mix over the last {days} days.
          </p>
        </div>
        <div className="flex gap-2">
          {[7, 30, 90].map((d) => (
            <button
              key={d}
              onClick={() => setDays(d)}
              className={`px-3 py-1.5 text-xs rounded-md border ${
                days === d
                  ? "border-forest text-forest bg-forest/5"
                  : "border-taupe/30 text-charcoal/60 hover:border-forest/40"
              }`}
            >
              {d}d
            </button>
          ))}
        </div>
      </div>

      {loading && <p className="text-sm text-charcoal/50">Loading…</p>}
      {error && (
        <p className="text-sm text-ember bg-ember/10 px-3 py-2 rounded-md">
          {error}
        </p>
      )}

      {data && !loading && (
        <>
          {/* Funnel */}
          <section className="mb-8">
            <h2 className="text-[11px] tracking-[0.25em] uppercase text-charcoal/40 mb-3">
              Funnel
            </h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <Stat label="Proshop views" value={num(data.funnel.proshop_views)} />
              <Stat label="Product views" value={num(data.funnel.product_views)} />
              <Stat label="Adds to cart" value={num(data.funnel.adds)} />
              <Stat label="Purchases" value={num(data.funnel.purchases)} />
              <Stat label="Unique viewers" value={num(data.funnel.unique_viewers)} />
              <Stat label="Unique adders" value={num(data.funnel.unique_adders)} />
              <Stat label="View → Add" value={pct(data.conv.view_to_add)} />
              <Stat label="Add → Purchase" value={pct(data.conv.add_to_purchase)} />
            </div>
          </section>

          {/* Top products */}
          <section className="mb-8">
            <h2 className="text-[11px] tracking-[0.25em] uppercase text-charcoal/40 mb-3">
              Top products by adds
            </h2>
            <div className="bg-white rounded-lg border border-taupe/20 overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-cream text-charcoal/50 text-xs uppercase tracking-wider">
                  <tr>
                    <th className="text-left px-4 py-2">Product</th>
                    <th className="text-left px-4 py-2">Brand</th>
                    <th className="text-right px-4 py-2">Adds</th>
                    <th className="text-right px-4 py-2">Users</th>
                  </tr>
                </thead>
                <tbody>
                  {data.top_products.length === 0 && (
                    <tr>
                      <td colSpan={4} className="text-center text-charcoal/40 px-4 py-6">
                        No add_to_cart events in window.
                      </td>
                    </tr>
                  )}
                  {data.top_products.map((p, i) => (
                    <tr key={p.slug ?? i} className="border-t border-taupe/10">
                      <td className="px-4 py-2 text-obsidian">{p.name ?? p.slug ?? "—"}</td>
                      <td className="px-4 py-2 text-charcoal/60">{p.brand ?? "—"}</td>
                      <td className="px-4 py-2 text-right text-obsidian">{num(p.adds)}</td>
                      <td className="px-4 py-2 text-right text-charcoal/60">{num(p.users)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {/* Brand & Source */}
          <div className="grid md:grid-cols-2 gap-6">
            <section>
              <h2 className="text-[11px] tracking-[0.25em] uppercase text-charcoal/40 mb-3">
                Brands
              </h2>
              <div className="bg-white rounded-lg border border-taupe/20 p-4">
                {data.brands.length === 0 && (
                  <p className="text-xs text-charcoal/40">No brand data.</p>
                )}
                {data.brands.map((b) => (
                  <div
                    key={b.brand ?? "unknown"}
                    className="flex items-center justify-between py-1.5 border-b border-taupe/10 last:border-0"
                  >
                    <span className="text-sm text-obsidian">{b.brand ?? "—"}</span>
                    <span className="text-sm text-charcoal/60">
                      {num(b.adds)} <span className="text-xs text-charcoal/35">/ {num(b.users)}u</span>
                    </span>
                  </div>
                ))}
              </div>
            </section>

            <section>
              <h2 className="text-[11px] tracking-[0.25em] uppercase text-charcoal/40 mb-3">
                Where PDP views come from
              </h2>
              <div className="bg-white rounded-lg border border-taupe/20 p-4">
                {data.sources.length === 0 && (
                  <p className="text-xs text-charcoal/40">No source data yet.</p>
                )}
                {data.sources.map((s) => (
                  <div
                    key={s.source ?? "unknown"}
                    className="flex items-center justify-between py-1.5 border-b border-taupe/10 last:border-0"
                  >
                    <span className="text-sm text-obsidian">{s.source ?? "(unknown)"}</span>
                    <span className="text-sm text-charcoal/60">{num(s.views)}</span>
                  </div>
                ))}
              </div>
            </section>
          </div>
        </>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-white rounded-lg border border-taupe/20 px-4 py-3">
      <p className="text-[10px] tracking-[0.2em] uppercase text-charcoal/40 mb-1">
        {label}
      </p>
      <p className="text-lg font-serif text-obsidian">{value}</p>
    </div>
  );
}
