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
import { GiftsTable, type GiftRow } from "./GiftsTable";

const STATUS_FILTERS = [
  { label: "All", value: "" },
  { label: "Pending email", value: "pending_recipient_email" },
  { label: "Emailed", value: "recipient_emailed" },
  { label: "Sizing collected", value: "sizing_collected" },
  { label: "Shipped", value: "first_box_shipped" },
  { label: "Season active", value: "season_active" },
  { label: "Completed", value: "completed" },
  { label: "Errored", value: "errored" },
];

export default function AdminGiftsPage() {
  const { user, authLoading } = useMembership();
  const [orders, setOrders] = useState<GiftRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");

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
        <GiftsTable orders={orders} />
      )}

      <p className="mt-6 text-[11px] text-charcoal/45 leading-relaxed">
        Gift orders are created by /api/webhooks/shopify/orders-paid when a checkout
        includes the <code className="bg-cream px-1">gift=true</code> attribute.
        The hourly cron at /api/gifts/scheduled-send sends recipient emails when due;
        /api/gifts/post-first-shipment auto-cancels the Loop subscription after the
        first box ships. Season gifts (gift_kind=season) never touch Loop: the daily
        /api/gifts/season-dispatch cron creates each $0 Reserve order when due and
        fulfillments-create counts shipments down.
      </p>
    </div>
  );
}
