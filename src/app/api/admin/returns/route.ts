/**
 * GET /api/admin/returns
 *
 * Daily returns & requests queue for /admin/returns.
 *   needsDecision — Shopify return requests (REQUESTED) + open customer
 *                   exchange requests saved by /api/returns/exchange-request
 *   openReturns   — approved returns that were never closed
 *   disputes      — open chargebacks (only if the token has payments scope)
 *   today         — decisions made in the last 24 hours (audit log)
 */

import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/app/api/_lib/adminAuth";
import { adminDb } from "@/lib/firebase-admin";
import {
  adminGraphql,
  DISPUTES_QUERY,
  fetchReturnOrders,
  normalizeOrders,
  sortQueue,
  ShopifyAdminError,
  shopifyAdminUrl,
} from "@/lib/returnsAdmin";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

type Dispute = {
  id: string;
  status: string;
  initiatedAt: string;
  evidenceDueBy: string | null;
  amount: { amount: string };
  reasonDetails: { reason: string } | null;
  order: { id: string; name: string; customer: { displayName: string; email: string | null } | null } | null;
};

async function loadDisputes() {
  try {
    const data = await adminGraphql<{ shopifyPaymentsAccount: { disputes: { nodes: Dispute[] } } | null }>(
      DISPUTES_QUERY,
    );
    return {
      available: true,
      items: (data.shopifyPaymentsAccount?.disputes.nodes ?? []).map((d) => ({
        id: d.id,
        status: d.status,
        initiatedAt: d.initiatedAt,
        evidenceDueBy: d.evidenceDueBy,
        amount: Number(d.amount.amount),
        reason: d.reasonDetails?.reason ?? null,
        orderName: d.order?.name ?? null,
        orderUrl: d.order ? shopifyAdminUrl(d.order.id) : null,
        customerName: d.order?.customer?.displayName ?? null,
        customerEmail: d.order?.customer?.email ?? null,
      })),
    };
  } catch (err) {
    if (err instanceof ShopifyAdminError && err.accessDenied) return { available: false, items: [] };
    console.error("[admin/returns] disputes failed", err);
    return { available: false, items: [] };
  }
}

async function loadCustomerRequests() {
  const snap = await adminDb
    .collection("customer_requests")
    .where("status", "==", "open")
    .limit(200)
    .get();
  // Sorted in memory so no composite Firestore index is needed.
  return snap.docs.map((d) => {
    const v = d.data();
    return {
      id: d.id,
      type: v.type ?? "exchange",
      orderName: v.orderName ?? null,
      customerEmail: v.customerEmail ?? null,
      message: v.message ?? "",
      createdAt: (v.createdAt?.toMillis?.() ?? null) as number | null,
    };
  }).sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0));
}

async function loadTodayDecisions() {
  // Rolling 24 hours: avoids UTC-vs-Detroit "midnight" confusion on Vercel.
  const start = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const snap = await adminDb
    .collection("return_decisions")
    .where("createdAt", ">=", start)
    .orderBy("createdAt", "desc")
    .limit(200)
    .get();
  return snap.docs.map((d) => {
    const v = d.data();
    return {
      id: d.id,
      action: v.action,
      orderName: v.orderName ?? null,
      returnName: v.returnName ?? null,
      by: v.by,
      createdAt: v.createdAt?.toMillis?.() ?? null,
      exchangeReturnName: v.exchangeReturnName ?? null,
    };
  });
}

export async function GET(req: NextRequest) {
  const guard = await requireAdmin(req);
  if (!guard.ok) return guard.response;

  try {
    const now = new Date();
    const [requested, open, disputes, customerRequests, today] = await Promise.all([
      fetchReturnOrders("return_status:return_requested"),
      fetchReturnOrders("return_status:in_progress"),
      loadDisputes(),
      loadCustomerRequests().catch((e) => {
        console.error("[admin/returns] customer_requests failed", e);
        return [];
      }),
      loadTodayDecisions().catch((e) => {
        console.error("[admin/returns] return_decisions failed", e);
        return [];
      }),
    ]);

    return NextResponse.json({
      generatedAt: now.toISOString(),
      needsDecision: sortQueue(normalizeOrders(requested.orders, ["REQUESTED"], now)),
      openReturns: sortQueue(normalizeOrders(open.orders, ["OPEN"], now)),
      customerRequests,
      disputes,
      today,
      truncated: requested.truncated || open.truncated,
    });
  } catch (err) {
    console.error("[admin/returns] failed", err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
