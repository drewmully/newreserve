import { NextRequest, NextResponse } from "next/server";
import { getSupabaseService } from "@/app/api/_lib/supabaseService";
import { acceptShopifyReceipt } from "@/lib/analytics/receipts";
export const runtime = "nodejs";
/** New subscription is opt-in. Existing checkout/webhook routes are untouched. */
export async function POST(req: NextRequest) {
  if (process.env.LEAN_ANALYTICS_RECEIPTS_ENABLED !== "true") return new NextResponse(null, { status: 404 });
  const secret = process.env.LEAN_SHOPIFY_WEBHOOK_SECRET ?? "";
  const allowedShop = process.env.LEAN_SHOPIFY_SHOP_DOMAIN ?? "";
  if (!secret || !allowedShop) return new NextResponse(null, { status: 503 });
  // Enforce streamed bytes, not the untrusted Content-Length header.
  const reader = req.body?.getReader();
  if (!reader) return new NextResponse(null, { status: 400 });
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > 1024 * 1024) { await reader.cancel(); return new NextResponse(null, { status: 413 }); }
    chunks.push(value);
  }
  try {
    const id = await acceptShopifyReceipt({
      body: Buffer.concat(chunks), signature: req.headers.get("x-shopify-hmac-sha256") ?? "",
      secret, allowedShop, shop: req.headers.get("x-shopify-shop-domain") ?? "",
      topic: req.headers.get("x-shopify-topic") ?? "", deliveryId: req.headers.get("x-shopify-webhook-id") ?? "",
    }, async r => {
      const { data, error } = await getSupabaseService().rpc("lean_accept_receipt", {
        p_source: r.source, p_delivery_id: r.deliveryId, p_business_key: r.businessKey,
        p_topic: r.topic, p_payload_hash: r.payloadHash, p_payload: r.payload,
      });
      if (error || data == null) throw new Error("receipt_unavailable");
      return String(data);
    });
    return NextResponse.json({ accepted: true, receiptId: id }, { status: 202 });
  } catch (e) {
    const code = e instanceof Error ? e.message : "";
    return new NextResponse(null, { status: code.startsWith("invalid_") || e instanceof SyntaxError ? 400 : 503 });
  }
}
