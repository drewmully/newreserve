/**
 * GET /api/admin/customers/[id]
 *
 * Returns the full customer dossier needed to pack a box:
 *   - customer_360 row
 *   - customer_facts (sizes, prefs, sourcing notes)
 *   - last 20 orders + line items
 *   - subscribers row (Loop state)
 *   - Firestore customer doc (optional, if FIREBASE_SERVICE_ACCOUNT_BASE64 set)
 *
 * Auth: Firebase ID token from admin allowlist.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/app/api/_lib/adminAuth";
import { getSupabaseService } from "@/app/api/_lib/supabaseService";

export const runtime = "nodejs";

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const guard = await requireAdmin(req);
  if (!guard.ok) return guard.response;
  const { id } = await ctx.params;

  const svc = getSupabaseService();
  const customerId = Number(id);
  if (!Number.isFinite(customerId)) {
    return NextResponse.json({ error: "bad id" }, { status: 400 });
  }

  const [c360, facts, subs] = await Promise.all([
    svc.from("customer_360").select("*").eq("id", customerId).maybeSingle(),
    svc.from("customer_facts").select("*").eq("customer_id", customerId).maybeSingle(),
    svc.from("subscribers").select("*").eq("customer_id", String(customerId)).maybeSingle(),
  ]);

  if (c360.error) {
    return NextResponse.json({ error: `c360: ${c360.error.message}` }, { status: 500 });
  }
  if (!c360.data) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  // Orders are linked by email (no customer_id FK on orders table).
  const email = c360.data.email;
  let orderRows: Array<Record<string, unknown>> = [];
  let lineItems: Array<Record<string, unknown>> = [];
  if (email) {
    const { data: ord } = await svc
      .from("orders")
      .select(
        "id,name,email,financial_status,fulfillment_status,total,subtotal,shipping_amount,discount_code,discount_amount,refunded_amount,currency,shipping_method,tags,source,cancelled_at,paid_at,fulfilled_at,created_at,is_subscription,is_first_order,is_recurring,shipping_city,shipping_province,shipping_country,billing_city,billing_province,billing_country,notes,entity",
      )
      .eq("email", email)
      .order("created_at", { ascending: false })
      .limit(20);
    orderRows = ord || [];
    if (orderRows.length > 0) {
      const orderIds = orderRows.map((o) => o.id);
      const { data: items } = await svc
        .from("order_line_items")
        .select("order_id,sku,product_id,variant_id,selling_plan_name,quantity,price,title,vendor")
        .in("order_id", orderIds);
      lineItems = items || [];
    }
  }

  // Group line items by order
  const itemsByOrder = new Map<string, Array<Record<string, unknown>>>();
  for (const li of lineItems) {
    const k = String(li.order_id);
    if (!itemsByOrder.has(k)) itemsByOrder.set(k, []);
    itemsByOrder.get(k)!.push(li);
  }
  const ordersWithItems = orderRows.map((o) => ({
    ...o,
    line_items: itemsByOrder.get(String(o.id)) || [],
  }));

  // Optional Firestore doc
  let firestore: Record<string, unknown> | null = null;
  try {
    if (process.env.FIREBASE_SERVICE_ACCOUNT_BASE64) {
      const admin = (await import("firebase-admin")).default;
      if (!admin.apps.length) {
        const sa = JSON.parse(
          Buffer.from(process.env.FIREBASE_SERVICE_ACCOUNT_BASE64, "base64").toString("utf-8"),
        );
        admin.initializeApp({ credential: admin.credential.cert(sa) });
      }
      // Drew's site stores customer profile under "customers/{firebase_uid}"; fall back to email.
      const uid = c360.data.firebase_uid;
      if (uid) {
        const doc = await admin.firestore().collection("customers").doc(uid).get();
        if (doc.exists) firestore = doc.data() || null;
      }
      if (!firestore && email) {
        const snap = await admin
          .firestore()
          .collection("customers")
          .where("email", "==", email)
          .limit(1)
          .get();
        if (!snap.empty) firestore = snap.docs[0].data();
      }
    }
  } catch {
    // best-effort
  }
  return NextResponse.json({
    customer_360: c360.data,
    customer_facts: facts.data || null,
    subscriber: subs.data || null,
    orders: ordersWithItems,
    firestore,
  });
}
