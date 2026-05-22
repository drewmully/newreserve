/**
 * GET /api/admin/cron/subscribers-rebuild
 *
 * Overlay-upsert the `subscribers` table from Shopify customer tags.
 * (Loop is the system of record for subscription state; it syncs state
 * to Shopify via customer tags. Plan code is derived from
 * `subscription_plan_map`.)
 *
 * Mode: UPSERT on customer_id, overwriting ONLY the tag-derived columns:
 *   status, plan_code, shopify_customer_gid, tags_raw, is_past_due,
 *   is_card_declined, email, name, total_orders, total_spent,
 *   shopify_synced_at, updated_at, acquired_at, churned_at, paused_at.
 *
 * Loop-API-only columns are preserved untouched:
 *   loop_subscription_spent, renewal_price, plan_variant_id,
 *   next_order_date, last_order_date, active_subscriptions,
 *   paused_subscriptions, cancelled_subscriptions, total_subscription_orders.
 *
 * Customers in Supabase but not in Shopify keep their existing row but get
 * shopify_synced_at left untouched (visible as stale).
 *
 * Auth: CRON_SECRET Bearer (same as other admin crons).
 *
 * NOTE: Long-running (~5–15 min). Set Vercel maxDuration accordingly.
 */

import { NextRequest, NextResponse } from "next/server";
import { getSupabaseService, withJobRun } from "@/app/api/_lib/supabaseService";
import { runBulkQuery, streamJsonl } from "@/app/api/_lib/shopifyBulk";

export const runtime = "nodejs";
// Vercel Hobby caps at 60s; Pro/Enterprise can go to 900s.
export const maxDuration = 800;

function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

const BULK_CUSTOMERS_QUERY = `
{
  customers {
    edges {
      node {
        id
        email
        firstName
        lastName
        tags
        createdAt
        updatedAt
        numberOfOrders
        amountSpent { amount }
      }
    }
  }
}
`.trim();

interface ShopifyCustomerNode {
  id: string;                     // gid://shopify/Customer/<n>
  email: string | null;
  firstName: string | null;
  lastName: string | null;
  tags: string[];
  createdAt: string;
  updatedAt: string;
  numberOfOrders: string;
  amountSpent: { amount: string } | null;
}

interface PlanMapRow {
  tag: string;
  plan_code: string;
  plan_label: string;
}

function deriveStatus(tags: string[]): { status: string; isPastDue: boolean; isCardDeclined: boolean } {
  const has = (t: string) => tags.includes(t);
  const isPastDue = has("Past Due Subscriber");
  const isCardDeclined = has("Subscription card declined");
  if (has("Active Subscriber")) return { status: "active", isPastDue, isCardDeclined };
  if (has("Paused Subscriber")) return { status: "paused", isPastDue, isCardDeclined };
  if (isPastDue) return { status: "past_due", isPastDue, isCardDeclined };
  if (has("Inactive Subscriber")) return { status: "inactive", isPastDue, isCardDeclined };
  return { status: "never", isPastDue, isCardDeclined };
}

function derivePlanCode(tags: string[], planMap: PlanMapRow[]): string | null {
  for (const row of planMap) {
    if (tags.includes(row.tag)) return row.plan_code;
  }
  return null;
}

function customerIdFromGid(gid: string): string {
  // "gid://shopify/Customer/123456789" -> "123456789"
  const m = gid.match(/Customer\/(\d+)$/);
  return m ? m[1] : gid;
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await withJobRun("subscribers-rebuild", async ({ bumpRows, setMeta, setWatermark }) => {
    const sb = getSupabaseService();

    // 1) Load plan_map ----------------------------------------------------
    const { data: planMap, error: planErr } = await sb
      .from("subscription_plan_map")
      .select("tag, plan_code, plan_label")
      .eq("is_active", true);
    if (planErr) throw new Error(`plan_map load: ${planErr.message}`);

    // 2) Kick off Shopify bulk customers query ----------------------------
    const bulk = await runBulkQuery(BULK_CUSTOMERS_QUERY);
    setWatermark(bulk.operationId);
    setMeta({ bulk_object_count: bulk.objectCount });

    // 3) Snapshot prior rows so we can detect transitions ----------------
    const { data: priorRows } = await sb
      .from("subscribers")
      .select("customer_id, status, acquired_at, churned_at, paused_at");
    const prior: Map<string, { status: string; acquired_at: string | null; churned_at: string | null; paused_at: string | null }> = new Map();
    if (priorRows) {
      for (const row of priorRows) {
        prior.set(row.customer_id, {
          status: row.status,
          acquired_at: row.acquired_at,
          churned_at: row.churned_at,
          paused_at: row.paused_at,
        });
      }
    }

    // 4) Stream JSONL, build upsert payloads ------------------------------
    const BATCH = 500;
    const now = new Date().toISOString();
    let buf: Array<Record<string, unknown>> = [];
    let totalRead = 0;
    let totalWritten = 0;
    let newSubs = 0;
    let churned = 0;
    let paused = 0;

    async function flush() {
      if (buf.length === 0) return;
      // Upsert on customer_id (UNIQUE constraint from migration). Only the
      // fields included here are written; Loop-only columns left alone.
      const { error } = await sb
        .from("subscribers")
        .upsert(buf, { onConflict: "customer_id" });
      if (error) throw new Error(`subscribers upsert batch (n=${buf.length}): ${error.message}`);
      totalWritten += buf.length;
      buf = [];
    }

    await streamJsonl<ShopifyCustomerNode>(bulk.jsonlUrl, async (node) => {
      totalRead++;
      const customerId = customerIdFromGid(node.id);
      const { status, isPastDue, isCardDeclined } = deriveStatus(node.tags);
      const planCode = derivePlanCode(node.tags, planMap || []);

      // Transition detection
      const priorRow = prior.get(customerId);
      let acquired_at: string | null = priorRow?.acquired_at ?? null;
      let churned_at: string | null = priorRow?.churned_at ?? null;
      let paused_at: string | null = priorRow?.paused_at ?? null;

      const wasActive = priorRow?.status === "active";
      const isActive = status === "active";
      if (isActive && !acquired_at) {
        acquired_at = now;
        if (!priorRow) newSubs++;
      }
      if (!isActive && wasActive) {
        churned_at = now;
        churned++;
      }
      if (status === "paused" && priorRow?.status !== "paused") {
        paused_at = now;
        paused++;
      }

      buf.push({
        customer_id: customerId,
        email: node.email,
        name: [node.firstName, node.lastName].filter(Boolean).join(" ") || null,
        status,
        plan_code: planCode,
        shopify_customer_gid: node.id,
        tags_raw: node.tags,
        is_past_due: isPastDue,
        is_card_declined: isCardDeclined,
        total_orders: node.numberOfOrders ? Number(node.numberOfOrders) : null,
        total_spent: node.amountSpent ? Number(node.amountSpent.amount) : null,
        shopify_synced_at: now,
        updated_at: now,
        acquired_at,
        churned_at,
        paused_at,
      });

      if (buf.length >= BATCH) await flush();
    });

    await flush();

    bumpRows(totalRead, totalWritten);
    setMeta({
      new_subs: newSubs,
      churned,
      paused,
      plan_map_tags: (planMap || []).length,
    });
    return {
      totalRead,
      totalWritten,
      newSubs,
      churned,
      paused,
      planMapTags: (planMap || []).length,
    };
  });

  return NextResponse.json(result, { status: result.ok ? 200 : 500 });
}
