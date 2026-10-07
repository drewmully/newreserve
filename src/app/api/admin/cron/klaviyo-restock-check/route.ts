/**
 * GET /api/admin/cron/klaviyo-restock-check
 *
 * Hourly. For every waiting back-in-stock request, checks the live catalog
 * and sends "Mully Back in Stock" to Klaviyo when the variant is buyable
 * again (see src/lib/klaviyo/restock.ts). Requests older than the max age,
 * or for products that no longer exist, are marked expired, not notified.
 *
 *   ?dry=1   decisions only; nothing sent, nothing written
 *
 * Auth: Bearer CRON_SECRET. Off unless KLAVIYO_RESTOCK_ENABLED=true.
 * Returns counts only.
 */

import { NextResponse } from "next/server";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { adminDb } from "@/lib/firebase-admin";
import { getProductByHandle, type ShopifyProduct } from "@/lib/shopify";
import { isCronAuthorized } from "@/lib/klaviyo/worker";
import { isLifecycleEnabled } from "@/lib/klaviyo/lifecycleConfig";
import { decideRestock, sendBackInStockEvent, type RestockRequest } from "@/lib/klaviyo/restock";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_REQUESTS = 400;

function toDate(value: unknown): Date | null {
  if (value instanceof Timestamp) return value.toDate();
  if (value instanceof Date) return value;
  return null;
}

export async function GET(req: Request) {
  if (!isCronAuthorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const dry = new URL(req.url).searchParams.get("dry") === "1";
  if (!dry && !isLifecycleEnabled("restock")) {
    return NextResponse.json({ ok: true, skipped: true, reason: "disabled" });
  }

  const counts = { waiting: 0, notified: 0, wouldNotify: 0, expired: 0, failed: 0, products: 0 };
  try {
    const snap = await adminDb
      .collection("back_in_stock_requests")
      .where("notified", "==", false)
      .limit(MAX_REQUESTS)
      .get();

    const requests: RestockRequest[] = [];
    for (const doc of snap.docs) {
      const d = doc.data();
      if (d.restockStatus === "expired" || typeof d.email !== "string" || typeof d.productSlug !== "string") continue;
      requests.push({
        id: doc.id,
        email: d.email,
        productSlug: d.productSlug,
        productName: d.productName ?? null,
        variantId: d.variantId ?? null,
        size: d.size ?? null,
        createdAt: toDate(d.createdAt),
      });
    }

    const products = new Map<string, ShopifyProduct | null>();
    for (const slug of new Set(requests.map((r) => r.productSlug))) {
      try {
        products.set(slug, await getProductByHandle(slug));
      } catch {
        // Catalog unreachable for this product: skip this run, never expire.
      }
    }
    counts.products = products.size;

    for (const request of requests) {
      if (!products.has(request.productSlug)) {
        counts.waiting += 1;
        continue;
      }
      const product = products.get(request.productSlug) ?? null;
      const decision = decideRestock(request, product);
      const ref = adminDb.collection("back_in_stock_requests").doc(request.id);

      if (decision.action === "wait") {
        counts.waiting += 1;
        continue;
      }
      if (decision.action === "expire") {
        counts.expired += 1;
        if (!dry) await ref.set({ restockStatus: "expired", restockReason: decision.reason, restockCheckedAt: FieldValue.serverTimestamp() }, { merge: true });
        continue;
      }
      if (dry) {
        counts.wouldNotify += 1;
        continue;
      }
      const sent = await sendBackInStockEvent(request, product!, decision.variant);
      if (sent.ok) {
        counts.notified += 1;
        await ref.set({ notified: true, notifiedAt: FieldValue.serverTimestamp(), restockStatus: "notified" }, { merge: true });
      } else {
        counts.failed += 1;
        await ref.set({ restockLastError: sent.code, restockCheckedAt: FieldValue.serverTimestamp() }, { merge: true });
      }
    }

    return NextResponse.json({ ok: counts.failed === 0, dry, scanned: requests.length, ...counts });
  } catch (err) {
    console.error(`[klaviyo-restock-check] failed: ${err instanceof Error ? err.message : "unexpected"}`);
    return NextResponse.json({ ok: false, error: "restock_check_failed" }, { status: 500 });
  }
}
