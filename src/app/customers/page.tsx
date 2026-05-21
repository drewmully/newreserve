"use client";

/**
 * /customers — search-by-name/email/address dossier view for packing
 * subscription boxes. Hits /api/admin/customers/search and
 * /api/admin/customers/[id].
 *
 * Auth: admin allowlist via AdminGate.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import AdminGate from "@/app/components/AdminGate";
import { useAdminFetch } from "@/app/components/useAdminFetch";

type SearchHit = {
  id: number;
  email: string | null;
  first_name: string | null;
  last_name: string | null;
  phone_e164: string | null;
  city: string | null;
  province: string | null;
  zip: string | null;
  total_orders: number | null;
  total_spent: number | null;
  subscriber_status: string | null;
  sub_plan_code: string | null;
  sub_next_order_date: string | null;
  last_order_at: string | null;
};

type LineItem = {
  order_id: number;
  sku: string | null;
  title: string | null;
  vendor: string | null;
  quantity: number | null;
  price: number | null;
  selling_plan_name: string | null;
};
type OrderRow = {
  id: number;
  name: string;
  email: string | null;
  financial_status: string | null;
  fulfillment_status: string | null;
  total: number | null;
  shipping_method: string | null;
  tags: string | null;
  fulfilled_at: string | null;
  created_at: string | null;
  is_subscription: boolean | null;
  shipping_city: string | null;
  shipping_province: string | null;
  shipping_country: string | null;
  notes: string | null;
  line_items: LineItem[];
};
type Dossier = {
  customer_360: Record<string, unknown> & { id: number; email: string | null };
  customer_facts: Record<string, unknown> | null;
  subscriber: Record<string, unknown> | null;
  orders: OrderRow[];
  firestore: Record<string, unknown> | null;
};

function fmtMoney(v: unknown) {
  const n = Number(v);
  if (!Number.isFinite(n)) return "—";
  return `$${n.toFixed(2)}`;
}
function fmtDate(v: unknown) {
  if (!v) return "—";
  const d = new Date(String(v));
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}
function fmtArr(v: unknown) {
  if (!Array.isArray(v) || v.length === 0) return "—";
  return v.join(", ");
}

export default function CustomersPage() {
  return (
    <AdminGate>
      <CustomersInner />
    </AdminGate>
  );
}

function CustomersInner() {
  const { adminFetch, tokenReady } = useAdminFetch();
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState<number | null>(null);
  const [dossier, setDossier] = useState<Dossier | null>(null);
  const [loadingDossier, setLoadingDossier] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  const runSearch = useCallback(
    async (query: string) => {
      if (query.trim().length < 2) {
        setHits([]);
        return;
      }
      setSearching(true);
      setSearchError(null);
      try {
        const r = await adminFetch(`/api/admin/customers/search?q=${encodeURIComponent(query)}`);
        if (!r.ok) throw new Error(`search ${r.status}`);
        const j = (await r.json()) as { results: SearchHit[] };
        setHits(j.results || []);
      } catch (e) {
        setSearchError(e instanceof Error ? e.message : String(e));
      } finally {
        setSearching(false);
      }
    },
    [adminFetch],
  );

  // Debounce typing
  useEffect(() => {
    if (!tokenReady) return;
    const t = setTimeout(() => runSearch(q), 250);
    return () => clearTimeout(t);
  }, [q, tokenReady, runSearch]);

  const loadDossier = useCallback(
    async (id: number) => {
      setSelected(id);
      setDossier(null);
      setLoadingDossier(true);
      try {
        const r = await adminFetch(`/api/admin/customers/${id}`);
        if (!r.ok) throw new Error(`dossier ${r.status}`);
        const j = (await r.json()) as Dossier;
        setDossier(j);
      } catch {
        setDossier(null);
      } finally {
        setLoadingDossier(false);
      }
    },
    [adminFetch],
  );

  return (
    <div className="min-h-screen bg-cream">
      <Header />
      <div className="max-w-6xl mx-auto px-6 py-6 grid grid-cols-12 gap-6">
        {/* Search column */}
        <div className="col-span-4">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search name, email, phone, city, zip…"
            className="w-full border border-taupe/40 rounded px-3 py-2 text-sm bg-white"
            autoFocus
          />
          <div className="mt-2 text-xs text-charcoal/40 flex items-center justify-between">
            <span>
              {searching ? "Searching…" : `${hits.length} match${hits.length === 1 ? "" : "es"}`}
            </span>
            {searchError && <span className="text-red-600">{searchError}</span>}
          </div>
          <ul className="mt-3 space-y-1">
            {hits.map((h) => (
              <li key={h.id}>
                <button
                  onClick={() => loadDossier(h.id)}
                  className={`w-full text-left px-3 py-2 rounded border text-sm transition-colors ${
                    selected === h.id
                      ? "bg-forest/10 border-forest text-obsidian"
                      : "bg-white border-taupe/30 hover:border-taupe/60"
                  }`}
                >
                  <div className="font-medium text-obsidian">
                    {(h.first_name || "") + " " + (h.last_name || "") || h.email || "(no name)"}
                  </div>
                  <div className="text-xs text-charcoal/60">{h.email}</div>
                  <div className="text-xs text-charcoal/50">
                    {[h.city, h.province, h.zip].filter(Boolean).join(", ") || "—"}
                  </div>
                  <div className="text-xs mt-1 flex gap-3">
                    <span className="text-charcoal/70">{h.total_orders ?? 0} orders</span>
                    <span className="text-charcoal/70">{fmtMoney(h.total_spent)}</span>
                    {h.sub_plan_code && (
                      <span className="text-forest font-medium">{h.sub_plan_code}</span>
                    )}
                  </div>
                </button>
              </li>
            ))}
          </ul>
        </div>

        {/* Dossier column */}
        <div className="col-span-8">
          {!selected && (
            <div className="text-sm text-charcoal/40 mt-12 text-center">
              Pick a customer to view sizing, order history, and notes.
            </div>
          )}
          {loadingDossier && <div className="text-sm text-charcoal/40">Loading…</div>}
          {dossier && <Dossier dossier={dossier} />}
        </div>
      </div>
    </div>
  );
}

function Header() {
  return (
    <nav className="border-b border-taupe/20 bg-white">
      <div className="max-w-6xl mx-auto px-6 h-12 flex items-center gap-6">
        <span className="font-serif text-sm text-obsidian font-medium">Customers</span>
        <a href="/ops" className="text-sm text-charcoal/50 hover:text-charcoal">
          Ops
        </a>
        <a href="/admin" className="text-sm text-charcoal/50 hover:text-charcoal">
          Admin
        </a>
      </div>
    </nav>
  );
}

function Dossier({ dossier }: { dossier: Dossier }) {
  const c = dossier.customer_360;
  const f = (dossier.customer_facts || {}) as Record<string, unknown>;
  const sub = (dossier.subscriber || {}) as Record<string, unknown>;
  const orders = dossier.orders;
  const skuCounts = useMemo(() => {
    const m = new Map<string, { sku: string; title: string | null; count: number }>();
    for (const o of orders) {
      for (const li of o.line_items) {
        const k = li.sku || li.title || "(no sku)";
        const cur = m.get(k);
        if (cur) cur.count += li.quantity || 1;
        else m.set(k, { sku: k, title: li.title, count: li.quantity || 1 });
      }
    }
    return [...m.values()].sort((a, b) => b.count - a.count).slice(0, 20);
  }, [orders]);

  return (
    <div className="space-y-5">
      {/* Identity */}
      <Section title="Identity">
        <KV label="Name" value={`${c.first_name || ""} ${c.last_name || ""}`.trim() || "—"} />
        <KV label="Email" value={String(c.email || "—")} />
        <KV label="Phone" value={String(c.phone_e164 || c.phone || "—")} />
        <KV
          label="Location"
          value={[c.city, c.province, c.zip, c.country].filter(Boolean).join(", ") || "—"}
        />
        <KV label="Tags" value={String(c.tags || "—")} />
      </Section>

      {/* Subscription state (Loop via tags) */}
      <Section title="Subscription">
        <KV label="Status" value={String(c.subscriber_status || sub.status || "—")} />
        <KV label="Plan" value={String(c.sub_plan_code || sub.plan_code || "—")} />
        <KV label="Next order" value={fmtDate(c.sub_next_order_date || sub.next_order_date)} />
        <KV label="Last order" value={fmtDate(c.sub_last_order_date || sub.last_order_date)} />
        <KV label="Renewal price" value={fmtMoney(c.sub_renewal_price || sub.renewal_price)} />
        <KV label="Past due?" value={c.sub_is_past_due ? "yes" : "no"} />
        <KV label="Card declined?" value={c.sub_is_card_declined ? "yes" : "no"} />
      </Section>

      {/* Sizing & prefs */}
      <Section title="Sizing & Preferences">
        <KV label="Top size" value={String(f.size_top ?? "—")} />
        <KV label="Bottom size" value={String(f.size_bottom ?? "—")} />
        <KV label="Shoe size" value={String(f.size_shoe ?? "—")} />
        <KV label="Fit notes" value={String(f.fit_notes ?? "—")} />
        <KV label="Color likes" value={fmtArr(f.color_preferences)} />
        <KV label="Colors to avoid" value={fmtArr(f.colors_avoid)} />
        <KV label="Brand likes" value={fmtArr(f.brand_likes)} />
        <KV label="Brand dislikes" value={fmtArr(f.brand_dislikes)} />
        <KV label="Style tags" value={fmtArr(f.style_tags)} />
        <KV label="Sourcing summary" value={String(f.sourcing_summary ?? "—")} />
        <KV label="Sourcing notes" value={String(f.sourcing_notes ?? "—")} multiline />
      </Section>

      {/* SKU frequency */}
      <Section title={`Most-ordered SKUs (top 20)`}>
        <table className="w-full text-sm">
          <thead className="text-xs text-charcoal/50">
            <tr>
              <th className="text-left font-normal">SKU</th>
              <th className="text-left font-normal">Title</th>
              <th className="text-right font-normal">Units</th>
            </tr>
          </thead>
          <tbody>
            {skuCounts.map((row) => (
              <tr key={row.sku} className="border-t border-taupe/20">
                <td className="py-1 font-mono text-xs">{row.sku}</td>
                <td className="py-1">{row.title || "—"}</td>
                <td className="py-1 text-right">{row.count}</td>
              </tr>
            ))}
            {skuCounts.length === 0 && (
              <tr>
                <td colSpan={3} className="py-2 text-charcoal/40">
                  No line items yet (run orders-backfill).
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </Section>

      {/* Orders */}
      <Section title={`Recent orders (${orders.length})`}>
        <ul className="divide-y divide-taupe/20">
          {orders.map((o) => (
            <li key={o.id} className="py-2">
              <div className="flex items-baseline justify-between">
                <div>
                  <span className="font-medium text-obsidian">{o.name}</span>
                  <span className="text-xs text-charcoal/40 ml-2">{fmtDate(o.created_at)}</span>
                  {o.is_subscription && (
                    <span className="text-xs ml-2 text-forest">subscription</span>
                  )}
                </div>
                <div className="text-sm text-charcoal/70">{fmtMoney(o.total)}</div>
              </div>
              <div className="text-xs text-charcoal/60 mt-0.5">
                {o.fulfillment_status || "unfulfilled"} · {o.financial_status || "—"} ·{" "}
                {[o.shipping_city, o.shipping_province].filter(Boolean).join(", ") || "—"}
              </div>
              {o.line_items.length > 0 && (
                <ul className="mt-1 pl-3 text-xs text-charcoal/70 space-y-0.5">
                  {o.line_items.map((li, i) => (
                    <li key={i}>
                      {li.quantity || 1}× {li.title || li.sku || "(item)"}
                      {li.sku ? (
                        <span className="font-mono text-charcoal/40"> · {li.sku}</span>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
              {o.notes && (
                <div className="text-xs italic text-charcoal/60 mt-1">“{o.notes}”</div>
              )}
            </li>
          ))}
          {orders.length === 0 && (
            <li className="py-2 text-sm text-charcoal/40">No orders yet.</li>
          )}
        </ul>
      </Section>

      {/* Email & SMS prefs */}
      <Section title="Communication Preferences">
        <KV label="Accepts email" value={c.accepts_email_marketing ? "yes" : "no"} />
        <KV label="Accepts SMS" value={c.accepts_sms_marketing ? "yes" : "no"} />
        <KV label="Email suppressed" value={c.is_email_suppressed ? "YES" : "no"} />
        <KV label="SMS suppressed" value={c.is_sms_suppressed ? "YES" : "no"} />
        <KV
          label="Last email open"
          value={c.last_email_open_days != null ? `${c.last_email_open_days}d ago` : "—"}
        />
        <KV
          label="Engagement vibe"
          value={String(c.engagement_vibe || c.engagement_tier || "—")}
        />
      </Section>

      {/* Firestore */}
      {dossier.firestore && (
        <Section title="Firestore (raw)">
          <pre className="text-xs bg-white border border-taupe/30 rounded p-3 overflow-x-auto">
            {JSON.stringify(dossier.firestore, null, 2)}
          </pre>
        </Section>
      )}

      {/* AI summary */}
      {c.ai_summary ? (
        <Section title="AI Summary">
          <p className="text-sm text-charcoal/80 whitespace-pre-wrap">{String(c.ai_summary)}</p>
        </Section>
      ) : null}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h2 className="text-xs uppercase tracking-wide text-charcoal/50 mb-2">{title}</h2>
      <div className="bg-white border border-taupe/30 rounded p-4 space-y-1">{children}</div>
    </div>
  );
}

function KV({ label, value, multiline }: { label: string; value: string; multiline?: boolean }) {
  return (
    <div className="grid grid-cols-3 gap-3 text-sm">
      <div className="text-charcoal/50">{label}</div>
      <div
        className={`col-span-2 text-obsidian ${multiline ? "whitespace-pre-wrap" : "truncate"}`}
      >
        {value || "—"}
      </div>
    </div>
  );
}
