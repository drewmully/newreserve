import { createHash, createHmac, timingSafeEqual } from "node:crypto";
export type Receipt = {
  source: "shopify"; deliveryId: string; businessKey: string;
  topic: string; payloadHash: string; payload: Record<string, unknown>;
};
export type ReceiptStore = (receipt: Receipt) => Promise<string>;
const topics = new Set(["orders/paid", "orders/updated", "orders/cancelled", "refunds/create"]);
/** Verify exact raw bytes before parsing or writing. Never invokes business handlers. */
export async function acceptShopifyReceipt(input: {
  body: Buffer; signature: string; secret: string; deliveryId: string;
  topic: string; shop: string; allowedShop: string;
}, store: ReceiptStore): Promise<string> {
  if (!input.secret || !input.allowedShop || input.shop !== input.allowedShop ||
      input.body.length > 1024 * 1024 || !topics.has(input.topic) ||
      !/^[A-Za-z0-9_-]{1,200}$/.test(input.deliveryId)) throw new Error("invalid_envelope");
  const expected = createHmac("sha256", input.secret).update(input.body).digest();
  if (!/^[A-Za-z0-9+/]{43}=$/.test(input.signature)) throw new Error("invalid_signature");
  const actual = Buffer.from(input.signature, "base64");
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw new Error("invalid_signature");
  const payload: unknown = JSON.parse(input.body.toString("utf8"));
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error("invalid_payload");
  const p = payload as Record<string, unknown>;
  // Numeric IDs larger than JS safe integer must be supplied as GraphQL/string IDs.
  const id = p.admin_graphql_api_id ?? p.id;
  if (!(typeof id === "string" && id.length > 0 && id.length < 200) &&
      !(typeof id === "number" && Number.isSafeInteger(id) && id > 0)) throw new Error("invalid_source_id");
  return store({
    source: "shopify", deliveryId: input.deliveryId, businessKey: JSON.stringify([input.shop, String(id)]),
    topic: input.topic, payloadHash: createHash("sha256").update(input.body).digest("hex"), payload: p,
  });
}
