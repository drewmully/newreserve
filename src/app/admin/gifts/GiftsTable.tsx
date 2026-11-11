"use client";

/**
 * Presentational gift orders table for /admin/gifts. Split out so the
 * preview-only fixture page can render it with sample data.
 */

import { Fragment, useState } from "react";

export interface GiftRow {
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
  gift_kind: "subscription" | "season";
  seasons_total: number | null;
  boxes_dispatched: number | null;
  boxes_shipped: number | null;
  boxes_remaining: number | null;
  next_box_number: number | null;
  next_box_due_on: string | null;
  box_orders: Array<{
    box_number: number;
    shopify_order_id: string;
    shopify_order_name: string | null;
    created_at: number;
    due_on: string | null;
    shipped_at: number | null;
  }>;
  continue_offer_sent_at: number | null;
  converted_at: number | null;
  converted_order_id: string | null;
}

const STATUS_COLOR: Record<string, string> = {
  pending_recipient_email: "bg-taupe/30 text-charcoal/70",
  recipient_emailed: "bg-sage/30 text-forest",
  sizing_collected: "bg-forest/15 text-forest",
  first_box_shipped: "bg-ember/15 text-ember",
  season_active: "bg-ember/15 text-ember",
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

export function GiftsTable({
  orders,
  initiallyExpanded = null,
}: {
  orders: GiftRow[];
  initiallyExpanded?: string | null;
}) {
  const [expanded, setExpanded] = useState<string | null>(initiallyExpanded);
  return (
        <div className="bg-white border border-taupe/20 rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-cream border-b border-taupe/20 text-xs text-charcoal/60">
              <tr>
                <th className="text-left px-3 py-2 font-medium">Order</th>
                <th className="text-left px-3 py-2 font-medium">Status</th>
                <th className="text-left px-3 py-2 font-medium">Recipient</th>
                <th className="text-left px-3 py-2 font-medium">From</th>
                <th className="text-left px-3 py-2 font-medium">Total</th>
                <th className="text-left px-3 py-2 font-medium">Seasons</th>
                <th className="text-left px-3 py-2 font-medium">Next due</th>
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
                  <Fragment key={o.shopify_order_id}>
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
                      <td className="px-3 py-2 text-xs text-charcoal/80" data-testid="season-progress">
                        {o.gift_kind === "season" && o.seasons_total ? (
                          <Fragment key={o.shopify_order_id}>
                            <div className="font-medium">
                              {o.boxes_remaining} of {o.seasons_total} left
                            </div>
                            <div className="text-[11px] text-charcoal/55">
                              {o.boxes_shipped} shipped, {o.boxes_dispatched} ordered
                            </div>
                          </Fragment>
                        ) : (
                          <span className="text-charcoal/40">recurring</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-xs text-charcoal/65">
                        {o.gift_kind === "season"
                          ? o.next_box_number
                            ? `#${o.next_box_number}: ${o.next_box_due_on ?? "after first ships"}`
                            : "all ordered"
                          : "—"}
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
                        <td colSpan={12} className="px-5 py-4 text-xs text-charcoal/75">
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
                            {o.gift_kind === "season" ? (
                              <div className="md:col-span-3">
                                <div className="text-[10px] uppercase tracking-wide text-charcoal/50 mb-1">
                                  Season shipments
                                </div>
                                <table className="w-full text-[11px]">
                                  <thead className="text-charcoal/50">
                                    <tr>
                                      <th className="text-left py-1 pr-3 font-medium">#</th>
                                      <th className="text-left py-1 pr-3 font-medium">Shopify order</th>
                                      <th className="text-left py-1 pr-3 font-medium">Due</th>
                                      <th className="text-left py-1 pr-3 font-medium">Ordered</th>
                                      <th className="text-left py-1 pr-3 font-medium">Shipped</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {Array.from({ length: o.seasons_total ?? 0 }, (_, i) => {
                                      const b = o.box_orders.find((x) => x.box_number === i + 1);
                                      return (
                                        <tr key={i} className="border-t border-taupe/10">
                                          <td className="py-1 pr-3">{i + 1}</td>
                                          <td className="py-1 pr-3 font-mono">
                                            {b ? b.shopify_order_name ?? b.shopify_order_id : "not yet ordered"}
                                          </td>
                                          <td className="py-1 pr-3">
                                            {b?.due_on ?? (i + 1 === o.next_box_number ? o.next_box_due_on ?? "after first ships" : i === 0 ? "on sizing" : "—")}
                                          </td>
                                          <td className="py-1 pr-3">{b ? fmt(b.created_at) : "—"}</td>
                                          <td className="py-1 pr-3">{b ? fmt(b.shipped_at) : "—"}</td>
                                        </tr>
                                      );
                                    })}
                                  </tbody>
                                </table>
                                <div className="mt-2 text-charcoal/65">
                                  Continue offer: {o.continue_offer_sent_at ? `sent ${fmt(o.continue_offer_sent_at)}` : "not sent"}
                                  {" · "}
                                  Converted: {o.converted_at ? `${fmt(o.converted_at)} (order ${o.converted_order_id ?? "?"})` : "no"}
                                </div>
                              </div>
                            ) : null}
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
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
  );
}
