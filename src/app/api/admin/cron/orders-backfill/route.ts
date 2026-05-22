/**
 * GET /api/admin/cron/orders-backfill?since=2021-01-01
 *
 * All-time (or windowed) backfill of `orders` + `order_line_items` from Shopify
 * Admin via bulk operations. Orders are upserted first (so subsequent line
 * items always find their parent), then line items in batches.
 *
 * Default since = '2021-01-01' (covers earliest known order 2021-04-27).
 * Override with ?since=YYYY-MM-DD or ?since=ISO.
 *
 * Idempotent: order_line_items upsert on shopify_line_id.
 * Orphan handling: line items whose parent order isn't in Supabase yet
 * are counted and reported via job_runs.meta.orphans for backfill review.
 *
 * Auth: CRON_SECRET Bearer.
 *
 * Long-running. Set Vercel maxDuration high.
 */

import { NextRequest, NextResponse } from "next/server";
import { getSupabaseService, withJobRun } from "@/app/api/_lib/supabaseService";
import { runBulkQuery, streamJsonl } from "@/app/api/_lib/shopifyBulk";

export const runtime = "nodejs";
export const maxDuration = 800;

function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

/**
 * Bulk-ops query: orders + line items nested.
 * Bulk ops return PARENT then CHILD records in JSONL, each child with __parentId.
 */
function buildBulkOrdersQuery(sinceIso: string): string {
  return `
{
  orders(query: "created_at:>=${sinceIso}") {
    edges {
      node {
        id
        name
        createdAt
        processedAt
        cancelledAt
        updatedAt
        currentTotalPriceSet     { shopMoney { amount currencyCode } }
        currentSubtotalPriceSet  { shopMoney { amount } }
        totalShippingPriceSet    { shopMoney { amount } }
        currentTotalTaxSet       { shopMoney { amount } }
        totalDiscountsSet        { shopMoney { amount } }
        totalRefundedSet         { shopMoney { amount } }
        displayFinancialStatus
        displayFulfillmentStatus
        email
        phone
        note
        sourceName
        riskLevel
        discountCode
        customer { id }
        tags
        shippingLine { title }
        shippingAddress { city province country }
        billingAddress  { city province country }
        lineItems {
          edges {
            node {
              id
              name
              quantity
              sku
              vendor
              taxable
              requiresShipping
              fulfillmentStatus
              variant { id title }
              product { id productType }
              originalUnitPriceSet { shopMoney { amount } }
              totalDiscountSet     { shopMoney { amount } }
              sellingPlan { name sellingPlanId }
              customAttributes { key value }
            }
          }
        }
      }
    }
  }
}`.trim();
}

interface MoneySet { shopMoney: { amount: string; currencyCode?: string } }
interface BulkOrderNode {
  __typename?: "Order";
  id: string;                                      // gid://shopify/Order/<n>
  name?: string;
  createdAt?: string;
  processedAt?: string | null;
  cancelledAt?: string | null;
  updatedAt?: string;
  currentTotalPriceSet?: MoneySet;
  currentSubtotalPriceSet?: MoneySet;
  totalShippingPriceSet?: MoneySet;
  currentTotalTaxSet?: MoneySet;
  totalDiscountsSet?: MoneySet;
  totalRefundedSet?: MoneySet;
  displayFinancialStatus?: string;
  displayFulfillmentStatus?: string;
  email?: string | null;
  phone?: string | null;
  note?: string | null;
  sourceName?: string | null;
  riskLevel?: string | null;
  discountCode?: string | null;
  customer?: { id: string } | null;
  tags?: string[];
  shippingLine?: { title?: string | null } | null;
  shippingAddress?: { city?: string | null; province?: string | null; country?: string | null } | null;
  billingAddress?: { city?: string | null; province?: string | null; country?: string | null } | null;
}

function money(m: MoneySet | undefined | null): string | null {
  return m?.shopMoney?.amount ?? null;
}
interface BulkLineItemNode {
  __typename?: "LineItem";
  __parentId: string;                              // gid://shopify/Order/<n>
  id: string;                                      // gid://shopify/LineItem/<n>
  name?: string;
  quantity?: number;
  sku?: string | null;
  vendor?: string | null;
  taxable?: boolean;
  requiresShipping?: boolean;
  fulfillmentStatus?: string | null;
  variant?: { id: string | null; title?: string | null } | null;
  product?: { id: string | null; productType?: string | null } | null;
  originalUnitPriceSet?: MoneySet;
  totalDiscountSet?: MoneySet;
  sellingPlan?: { name: string | null; sellingPlanId: string | null } | null;
  customAttributes?: Array<{ key: string; value: string | null }> | null;
}

type BulkRow = (BulkOrderNode | BulkLineItemNode) & Record<string, unknown>;

function shopifyNumericId(gid: string | null | undefined): string | null {
  if (!gid) return null;
  const m = gid.match(/\/(\d+)$/);
  return m ? m[1] : gid;
}

function isLineItem(row: BulkRow): boolean {
  return "__parentId" in row && typeof (row as { __parentId?: string }).__parentId === "string";
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const url = new URL(req.url);
  const since = url.searchParams.get("since") ?? "2021-01-01";

  const result = await withJobRun("orders-backfill", async ({ bumpRows, setMeta, setWatermark }) => {
    const sb = getSupabaseService();

    // 1) Bulk query
    const bulk = await runBulkQuery(buildBulkOrdersQuery(since));
    setWatermark(`since=${since},op=${bulk.operationId}`);
    setMeta({ bulk_object_count: bulk.objectCount, since });

    // 2) Two-pass stream:
    //    Pass A: orders only — upsert into `orders`. Track which order_ids are
    //            present so line items in pass B always link to a known parent.
    //    Pass B: line items only — upsert into `order_line_items`.
    //    JSONL doesn't guarantee order ordering, so we stream twice.
    const BATCH = 500;
    const knownOrderIds = new Set<string>();
    let ordersBuf: Array<Record<string, unknown>> = [];
    let totalOrders = 0;
    let lineItemsBuf: Array<Record<string, unknown>> = [];
    let totalLines = 0;
    let orphanCount = 0;
    const orphanSamples: string[] = [];

    async function flushOrders() {
      if (ordersBuf.length === 0) return;
      const { error } = await sb
        .from("orders")
        .upsert(ordersBuf, { onConflict: "id" });
      if (error) throw new Error(`orders upsert: ${error.message}`);
      totalOrders += ordersBuf.length;
      ordersBuf = [];
    }

    async function flushLineItems() {
      if (lineItemsBuf.length === 0) return;
      const { error } = await sb
        .from("order_line_items")
        .upsert(lineItemsBuf, { onConflict: "shopify_line_id" });
      if (error) throw new Error(`order_line_items upsert: ${error.message}`);
      totalLines += lineItemsBuf.length;
      lineItemsBuf = [];
    }

    // Pass A — orders
    await streamJsonl<BulkRow>(bulk.jsonlUrl, async (row) => {
      if (isLineItem(row)) return;
      const ord = row as BulkOrderNode;
      const orderShopifyId = shopifyNumericId(ord.id);
      if (!orderShopifyId) return;
      const createdAt = ord.createdAt ?? new Date().toISOString();
      const isSub = (ord.tags ?? []).some((t) => /subscription/i.test(t));
      ordersBuf.push({
        id: Number(orderShopifyId),
        name: ord.name ?? `#${orderShopifyId}`,
        email: ord.email ?? null,
        financial_status: ord.displayFinancialStatus ?? null,
        fulfillment_status: ord.displayFulfillmentStatus ?? null,
        total: money(ord.currentTotalPriceSet),
        subtotal: money(ord.currentSubtotalPriceSet),
        shipping_amount: money(ord.totalShippingPriceSet),
        taxes: money(ord.currentTotalTaxSet),
        discount_code: ord.discountCode ?? null,
        discount_amount: money(ord.totalDiscountsSet),
        refunded_amount: money(ord.totalRefundedSet) ?? 0,
        currency: ord.currentTotalPriceSet?.shopMoney?.currencyCode ?? "USD",
        shipping_method: ord.shippingLine?.title ?? null,
        tags: (ord.tags ?? []).join(", ") || null,
        source: ord.sourceName ?? null,
        risk_level: ord.riskLevel ?? null,
        notes: ord.note ?? null,
        cancelled_at: ord.cancelledAt ?? null,
        paid_at: ord.processedAt ?? null,
        fulfilled_at: null,
        created_at: createdAt,
        is_subscription: isSub,
        shipping_city: ord.shippingAddress?.city ?? null,
        shipping_province: ord.shippingAddress?.province ?? null,
        shipping_country: ord.shippingAddress?.country ?? null,
        billing_city: ord.billingAddress?.city ?? null,
        billing_province: ord.billingAddress?.province ?? null,
        billing_country: ord.billingAddress?.country ?? null,
      });
      knownOrderIds.add(orderShopifyId);
      if (ordersBuf.length >= BATCH) await flushOrders();
    });
    await flushOrders();

    // Pass B — line items
    await streamJsonl<BulkRow>(bulk.jsonlUrl, async (row) => {
      if (!isLineItem(row)) return;
      {
        const li = row as BulkLineItemNode;
        const parentShopifyOrderId = shopifyNumericId(li.__parentId);
        if (!parentShopifyOrderId) return;
        if (!knownOrderIds.has(parentShopifyOrderId)) {
          orphanCount++;
          if (orphanSamples.length < 10) orphanSamples.push(parentShopifyOrderId);
          return;
        }
        // Flatten customAttributes into a single { key: value } jsonb object so
        // downstream queries can filter directly on common keys (Shirt Size,
        // Glove Size, Style, Gender, Glove Hand). Multiple attributes with the
        // same key are collapsed; last wins.
        const props: Record<string, string | null> = {};
        for (const a of li.customAttributes ?? []) {
          if (a && typeof a.key === "string") props[a.key] = a.value;
        }
        lineItemsBuf.push({
          order_id: Number(parentShopifyOrderId),
          shopify_line_id: li.id,
          product_id: shopifyNumericId(li.product?.id ?? null),
          variant_id: shopifyNumericId(li.variant?.id ?? null),
          variant_title: li.variant?.title ?? null,
          product_type: li.product?.productType ?? null,
          sku: li.sku ?? null,
          title: li.name ?? null,
          vendor: li.vendor ?? null,
          quantity: li.quantity ?? 0,
          price: li.originalUnitPriceSet?.shopMoney?.amount ?? null,
          total_discount: li.totalDiscountSet?.shopMoney?.amount ?? null,
          fulfillment_status: li.fulfillmentStatus ?? null,
          requires_shipping: li.requiresShipping ?? null,
          selling_plan_id: li.sellingPlan?.sellingPlanId ?? null,
          selling_plan_name: li.sellingPlan?.name ?? null,
          taxable: li.taxable ?? null,
          properties: Object.keys(props).length > 0 ? props : null,
          raw: li,
        });
        if (lineItemsBuf.length >= BATCH) await flushLineItems();
      }
    });
    await flushLineItems();

    setMeta({
      orphans: orphanCount,
      orphan_sample_order_ids: orphanSamples,
      orders_upserted: totalOrders,
    });
    bumpRows(bulk.objectCount, totalOrders + totalLines);
    return {
      since,
      orders_upserted: totalOrders,
      line_items_upserted: totalLines,
      orphans: orphanCount,
      orphan_sample_order_ids: orphanSamples,
      bulk_object_count: bulk.objectCount,
    };
  });

  return NextResponse.json(result, { status: result.ok ? 200 : 500 });
}
