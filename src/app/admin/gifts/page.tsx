"use client";

/**
 * Admin → Gifts
 *
 * Lists every gift_orders doc. Shows status, key timestamps, recipient
 * email, total, and a link to the recipient's sizing page (so you can
 * preview what they see). Filter by status with the pill bar at the top.
 */

import { useEffect, useState, useCallback } from "react";
import { useMembership } from "@/app/context/MembershipContext";

interface GiftRow {
  shopify_order_id: string;
  shopify_order_number: string;
  purchaser_email: string;
  purchaser_first_name: string | null;
  recipient_email: string;
  recipient_first_name: string | null;
  gift_message: string | null;
  deliver_on: string | null;
  sizing_token: string;
  total_price: number;
  currency: string;
  status: string;
  created_at: number;
  updated_at: number;
  recipient_emailed_at: number | null;
  sizing_collected_at: number | null;
  first_box_shipped_at: number | null;
  completed_at: number | null;
  sizing: Record<string, string> | null;
  loop_subscription_id: string | null;
  last_error: string | null;
}

const STATUS_FILTERS = [
  { label: "All", value: "" },
  { label: "Pending email", value: "pending_recipient_email" },
  { label: "Emailed", value: "recipient_emailed" },
  { label: "Sizing collected", value: "sizing_collected" },
  { label: "Shipped", value: "first_box_shipped" },
  { label: "Completed", value: "completed" },
  { label: "Errored", value: "errored" },
];

const STATUS_COLOR: Record<string, string> = {
  pending_recipient_email: "bg-taupe/30 text-charcoal/70",
  recipient_emailed: "bg-sage/30 text-forest",
  sizing_collected: "bg-forest/15 text-forest",
  first_box_shipped: "bg-ember/15 text-ember",
  completed: "bg-forest text-bone",
  errored: "bg-red-100 text-red-700",
  cancelled: "bg-taupe/20 text-charcoal/50",
};

function fmt(ms: number | null): string {
  if (!ms) return "—";
  return new Date(ms).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default function AdminGiftsPage() {
  const { user, authLoading } = useMembership();
  const [orders, setOrders] = useState<GiftRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (authLoading || !user) return;
    setLoading(true);
    setError(null);
    try {
      const token = await user.getIdToken();
      const url = `/api/admin/gifts${filter ? `?status=${filter}` : ""}`;
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? `HTTP ${res.status}`);
      }
      const data = await res.json();
      setOrders(data.orders);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load gifts");
    } finally {
      setLoading(false);
    }
  }, [authLoading, user, filter]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="max-w-7xl mx-auto px-6 py-8">
      <div className="flex items-baseline justify-between mb-6">
        <h1 className="font-serif text-2xl text-obsidian">Gift Orders</h1>
        <p className="text-xs text-charcoal/55">
          {orders.length} {orders.length === 1 ? "order" : "orders"} loaded
        </p>
      </div>

      {/* Filter pills */}
      <div className="flex flex-wrap gap-2 mb-5">
        {STATUS_FILTERS.map((f) => (
          <button
            key={f.value}
            type="button"
            onClick={() => setFilter(f.value)}
            className={`px-3 py-1.5 rounded text-xs transition ${
              filter === f.value
                ? "bg-forest text-bone"
                : "bg-white border border-taupe/30 text-charcoal/70 hover:border-forest/40"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {error ? (
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm p-3 rounded mb-4">
          {error}
        </div>
      ) : null}

      {loading ? (
        <p className="text-charcoal/50 text-sm">Loading…</p>
      ) : orders.length === 0 ? (
        <p className="text-charcoal/50 text-sm">No gift orders yet.</p>
      ) : (
        <div className="bg-white border border-taupe/20 rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-cream border-b border-taupe/20 text-xs text-charcoal/60">
              <tr>
                <th className="text-left px-3 py-2 font-medium">Order</th>
                <th className="text-left px-3 py-2 font-medium">Status</th>
                <th className="text-left px-3 py-2 font-medium">Recipient</th>
                <th className="text-left px-3 py-2 font-medium">From</th>
                <th className="text-left px-3 py-2 font-medium">Total</th>
                <th className="text-left px-3 py-2 font-medium">Created</th>
                <th className="text-left px-3 py-2 font-medium">Emailed</th>
                <th className="text-left px-3 py-2 font-medium">Sized</th>
                <th className="text-left px-3 py-2 font-medium">Shipped</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {orders.map((o) => {
                const isOpen = expanded === o.shopify_order_id;
                return (
                  <>
                    <tr
                      key={o.shopify_order_id}
                      className="border-t border-taupe/10 hover:bg-cream/40"
                    >
                      <td className="px-3 py-2 font-mono text-xs text-charcoal/80">
                        #{o.shopify_order_number}
                      </td>
                      <td className="px-3 py-2">
                        <span
                          className={`inline-block px-2 py-0.5 rounded text-[10px] font-medium ${
                            STATUS_COLOR[o.status] ?? "bg-taupe/20 text-charcoal/60"
                          }`}
                        >
                          {o.status.replace(/_/g, " ")}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-charcoal/80">
                        <div>{o.recipient_first_name ?? "—"}</div>
                        <div className="text-[11px] text-charcoal/55">
                          {o.recipient_email}
                        </div>
                      </td>
                      <td className="px-3 py-2 text-charcoal/80">
                        <div>{o.purchaser_first_name ?? "—"}</div>
                        <div className="text-[11px] text-charcoal/55">
                          {o.purchaser_email}
                        </div>
                      </td>
                      <td className="px-3 py-2 text-charcoal/80">
                        ${o.total_price.toFixed(2)}
                      </td>
                      <td className="px-3 py-2 text-xs text-charcoal/65">{fmt(o.created_at)}</td>
                      <td className="px-3 py-2 text-xs text-charcoal/65">
                        {fmt(o.recipient_emailed_at)}
                      </td>
                      <td className="px-3 py-2 text-xs text-charcoal/65">
                        {fmt(o.sizing_collected_at)}
                      </td>
                      <td className="px-3 py-2 text-xs text-charcoal/65">
                        {fmt(o.first_box_shipped_at)}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <button
                          type="button"
                          onClick={() =>
                            setExpanded(isOpen ? null : o.shopify_order_id)
                          }
                          className="text-xs text-forest hover:underline"
                        >
                          {isOpen ? "Hide" : "Details"}
                        </button>
                      </td>
                    </tr>
                    {isOpen ? (
                      <tr key={`${o.shopify_order_id}-detail`} className="bg-cream/30 border-t border-taupe/10">
                        <td colSpan={10} className="px-5 py-4 text-xs text-charcoal/75">
                          <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
                            <div>
                              <div className="text-[10px] uppercase tracking-wide text-charcoal/50 mb-1">
                                Sizing link (recipient view)
                              </div>
                              <a
                                href={`/gift-sizing/${o.sizing_token}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-forest underline break-all"
                              >
                                /gift-sizing/{o.sizing_token.slice(0, 16)}…
                              </a>
                            </div>
                            <div>
                              <div className="text-[10px] uppercase tracking-wide text-charcoal/50 mb-1">
                                Scheduled deliver on
                              </div>
                              <div>{o.deliver_on ?? "Send immediately"}</div>
                            </div>
                            <div>
                              <div className="text-[10px] uppercase tracking-wide text-charcoal/50 mb-1">
                                Loop subscription id
                              </div>
                              <div className="font-mono break-all">
                                {o.loop_subscription_id ?? "—"}
                              </div>
                            </div>
                            <div className="md:col-span-2">
                              <div className="text-[10px] uppercase tracking-wide text-charcoal/50 mb-1">
                                Gift message
                              </div>
                              <div className="italic">
                                {o.gift_message ?? "—"}
                              </div>
                            </div>
                            <div>
                              <div className="text-[10px] uppercase tracking-wide text-charcoal/50 mb-1">
                                Submitted sizing
                              </div>
                              {o.sizing ? (
                                <ul className="space-y-0.5">
                                  {Object.entries(o.sizing).map(([k, v]) => (
                                    <li key={k}>
                                      <span className="text-charcoal/50">{k}:</span> {v}
                                    </li>
                                  ))}
                                </ul>
                              ) : (
                                <div>—</div>
                              )}
                            </div>
                            {o.last_error ? (
                              <div className="md:col-span-3">
                                <div className="text-[10px] uppercase tracking-wide text-red-600 mb-1">
                                  Last error
                                </div>
                                <pre className="bg-red-50 border border-red-200 rounded p-2 text-red-700 text-[11px] whitespace-pre-wrap">
                                  {o.last_error}
                                </pre>
                              </div>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    ) : null}
                  </>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <p className="mt-6 text-[11px] text-charcoal/45 leading-relaxed">
        Gift orders are created by /api/webhooks/shopify/orders-paid when a checkout
        includes the <code className="bg-cream px-1">gift=true</code> attribute.
        The hourly cron at /api/gifts/scheduled-send sends recipient emails when due;
        /api/gifts/post-first-shipment auto-cancels the Loop subscription after the
        first box ships.
      </p>
    </div>
  );
}
