/**
 * Read-only seven-day coverage audit. No cron schedule, DB writes, profile
 * changes, Klaviyo calls or customer PII in the response. Authorization matches
 * the other Klaviyo admin endpoints. Never used as dispatch eligibility.
 */
import { NextResponse } from "next/server";
import { getSupabaseService } from "@/app/api/_lib/supabaseService";
import { isCronAuthorized } from "@/lib/klaviyo/worker";
import { classifyPaidOrder, matchOrderDelivery } from "@/lib/klaviyo/orderMatching";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: Request) {
  if (!isCronAuthorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const since = new Date(Date.now() - 7 * 86_400_000).toISOString();
  const sb = getSupabaseService();
  const limit = 5000;
  const rows: Array<{ event_name: string; payload: unknown }> = [];
  try {
    for (let from = 0; from < limit; from += 500) {
      const { data, error } = await sb.from("inbound_event").select("event_name,payload")
        .eq("source", "shopify")
        .in("event_name", ["order.paid", "fulfillment.created", "fulfillment.updated", "shipment.delivered"])
        .gte("received_at", since).order("id", { ascending: false }).range(from, from + 499);
      if (error) throw new Error("audit_read_failed");
      rows.push(...(data ?? []));
      if (!data || data.length < 500) break;
    }
    const coverage: Record<string, number> = {};
    const paid: Record<string, number> = {};
    const delivery: Record<string, number> = {};
    const bump = (counts: Record<string, number>, key: string) => { counts[key] = (counts[key] ?? 0) + 1; };
    for (const row of rows) bump(coverage, row.event_name);
    const shipments = rows.filter(r => r.event_name !== "order.paid").map(r => r.payload);
    const seen = new Set<string>();
    for (const row of rows.filter(r => r.event_name === "order.paid")) {
      const match = classifyPaidOrder(row.payload);
      if (match.orderId && seen.has(match.orderId)) continue;
      if (match.orderId) seen.add(match.orderId);
      bump(paid, `${match.kind}:${match.reason}`);
      bump(delivery, matchOrderDelivery(row.payload, shipments).reason);
    }
    return NextResponse.json({
      ok: true, dry: true, since, capped: rows.length >= limit, rows: rows.length,
      coverage, paid, delivery, dispatch_eligible: false,
      holds: ["fresh_order_refund_cancel_read", "service_exclusions", "native_membership_coverage",
        "first_member_order_history", "flow_event_rewire", "human_launch_approval"],
    });
  } catch {
    return NextResponse.json({ ok: false, error: "audit_read_failed" }, { status: 500 });
  }
}
