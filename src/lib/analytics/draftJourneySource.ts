import { evidenceDigest } from "./evidenceIntake";
import { mapJourneyCheckout, type JourneyReceipt } from "./journeySource";
import { nyDate } from "./primitives";
import { shopifyId, shopifyShop, type ShopifyOrderDocument } from "./shopifySource";

type DraftReceipt = JourneyReceipt & { draftId: string };
type DraftLink = { draftId: string; orderId: string | null; completedAt: string | null };
export type DraftJourneySnapshot = {
  projectRef: string; shop: string; capturedAt: string; from: string; until: string;
  receipts: DraftReceipt[]; links: DraftLink[]; digest: string;
};
async function boundedJson(response: Response) {
  if (!response.ok) throw new Error("draft_source_unavailable");
  const reader = response.body?.getReader();
  if (!reader) throw new Error("draft_source_empty");
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    for (;;) {
      const part = await reader.read(); if (part.done) break;
      size += part.value.length;
      if (size > 500000) { await reader.cancel(); throw new Error("draft_source_budget"); }
      chunks.push(part.value);
    }
  } finally { reader.releaseLock(); }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}
function scope(config: Omit<DraftJourneySnapshot, "receipts" | "links" | "digest">) {
  shopifyShop(config.shop);
  [config.from, config.until, config.capturedAt].forEach(nyDate);
  if (!/^[a-z]{20}$/.test(config.projectRef) || Date.parse(config.until) > Date.parse(config.capturedAt) ||
    Date.parse(config.until) <= Date.parse(config.from) ||
    Date.parse(config.until) - Date.parse(config.from) > 93 * 86400000) throw new Error("draft_source_scope");
}
/** Two bounded read-only requests. Shopify's explicit DraftOrder.order relation
 * is the sole bridge to a purchase; no invoice URL, email or time-based match. */
export async function readDraftJourney(config: Omit<DraftJourneySnapshot, "receipts" | "links" | "digest">,
  readKey: string, shopifyToken: string, request: typeof fetch = fetch): Promise<DraftJourneySnapshot> {
  scope(config);
  if (!readKey.trim() || !shopifyToken.trim()) throw new Error("draft_source_credentials");
  const raw = await boundedJson(await request(`https://${config.projectRef}.supabase.co/rest/v1/rpc/lean_draft_receipts_read`, {
    method: "POST", redirect: "error", signal: AbortSignal.timeout(15000),
    headers: { apikey: readKey, Authorization: `Bearer ${readKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ p_project: config.projectRef, p_shop: config.shop, p_from: config.from, p_until: config.until }),
  }));
  if (!Array.isArray(raw) || raw.length > 100) throw new Error("draft_source_receipt_budget");
  const seen = new Set<string>();
  const utc = (value: unknown) => {
    if (typeof value !== "string") throw new Error("draft_source_timestamp");
    const text = value.replace(/\+00:00$/, "Z"); nyDate(text); return text;
  };
  const receipts: DraftReceipt[] = raw.map(r => {
    if (!r || typeof r.draftId !== "string" || !/^[1-9]\d{0,24}$/.test(r.draftId) ||
      seen.has(r.draftId) || r.cartToken !== `draft_${r.draftId}` ||
      typeof r.contextToken !== "string" || r.contextToken.length > 3000 ||
      !["subjectId", "sessionId", "posthogProject", "permissionEvidenceRef"].every(k => typeof r[k] === "string"))
      throw new Error("draft_source_receipt_shape");
    seen.add(r.draftId);
    const capturedAt = utc(r.capturedAt);
    if (Date.parse(capturedAt) < Date.parse(config.from) || Date.parse(capturedAt) >= Date.parse(config.until))
      throw new Error("draft_source_receipt_window");
    return { draftId: r.draftId, cartToken: r.cartToken, contextToken: r.contextToken, capturedAt,
      subjectId: r.subjectId, sessionId: r.sessionId, posthogProject: r.posthogProject,
      validFrom: utc(r.validFrom), expiresAt: utc(r.expiresAt),
      revokedAt: r.revokedAt === null ? null : utc(r.revokedAt), permissionEvidenceRef: r.permissionEvidenceRef };
  });
  let links: DraftLink[] = [];
  if (receipts.length) {
    const response = await request(`https://${config.shop}/admin/api/2026-07/graphql.json`, {
      method: "POST", redirect: "error", signal: AbortSignal.timeout(15000),
      headers: { "X-Shopify-Access-Token": shopifyToken, "Content-Type": "application/json" },
      body: JSON.stringify({ query: `query LeanDraftRelations($ids:[ID!]!) {
        nodes(ids:$ids) { __typename ... on DraftOrder { id status completedAt order { id } } }
      }`, variables: { ids: receipts.map(r => `gid://shopify/DraftOrder/${r.draftId}`) } }),
    });
    if (response.headers.get("X-Shopify-API-Version") !== "2026-07") throw new Error("draft_source_api_version");
    const result = await boundedJson(response);
    if (result.errors?.length || !Array.isArray(result.data?.nodes) || result.data.nodes.length !== receipts.length)
      throw new Error("draft_source_relations_shape");
    const returned = new Set<string>();
    links = result.data.nodes.map((node: Record<string, unknown>) => {
      if (!node || node.__typename !== "DraftOrder") throw new Error("draft_source_missing_relation");
      const draftId = shopifyId(node.id, "DraftOrder");
      if (!seen.has(draftId) || returned.has(draftId)) throw new Error("draft_source_relation_scope");
      returned.add(draftId);
      if (node.status === "COMPLETED") {
        const completedAt = utc(node.completedAt);
        if (Date.parse(completedAt) > Date.parse(config.capturedAt)) throw new Error("draft_source_future_relation");
        return { draftId, completedAt, orderId: shopifyId((node.order as { id?: unknown })?.id, "Order") };
      }
      if (!["OPEN", "INVOICE_SENT"].includes(String(node.status)) || node.order !== null || node.completedAt !== null)
        throw new Error("draft_source_inconsistent_relation");
      return { draftId, orderId: null, completedAt: null };
    });
  }
  const payload = { ...config, receipts, links };
  return { ...payload, digest: evidenceDigest(payload) };
}
export function mapDraftJourney(orders: ShopifyOrderDocument[], snapshot: DraftJourneySnapshot,
  config: Parameters<typeof mapJourneyCheckout>[2], secret: string) {
  scope(snapshot);
  const { digest, ...payload } = snapshot;
  if (digest !== evidenceDigest(payload) || snapshot.projectRef !== config.projectRef ||
    snapshot.shop !== config.shop || Date.parse(snapshot.capturedAt) > Date.parse(config.asOf) ||
    snapshot.receipts.length > 100 || snapshot.links.length !== snapshot.receipts.length)
    throw new Error("draft_snapshot_scope");
  const receiptIds = new Set(snapshot.receipts.map(r => r.draftId));
  const linkIds = new Set(snapshot.links.map(r => r.draftId));
  if (receiptIds.size !== snapshot.receipts.length || linkIds.size !== snapshot.links.length ||
    [...receiptIds].some(id => !linkIds.has(id))) throw new Error("draft_snapshot_duplicates");
  const byOrder = new Map<string, ShopifyOrderDocument>();
  for (const doc of orders) {
    const id = shopifyId(doc.order.id, "Order");
    if (doc.shop !== config.shop || byOrder.has(id)) throw new Error("draft_order_scope");
    byOrder.set(id, doc);
  }
  return snapshot.links.flatMap(link => {
    const receipt = snapshot.receipts.find(r => r.draftId === link.draftId)!;
    if (receipt.cartToken !== `draft_${link.draftId}` || !/^[1-9]\d{0,24}$/.test(link.draftId))
      throw new Error("draft_snapshot_receipt");
    if (link.orderId === null) {
      if (link.completedAt !== null) throw new Error("draft_snapshot_relation");
      return [];
    }
    if (!/^[1-9]\d*$/.test(link.orderId) || !link.completedAt) throw new Error("draft_snapshot_relation");
    nyDate(link.completedAt);
    const completed = Date.parse(link.completedAt);
    if (completed < Date.parse(receipt.capturedAt) || completed > Date.parse(snapshot.capturedAt))
      throw new Error("draft_snapshot_relation_time");
    const doc = byOrder.get(link.orderId);
    if (!doc) return [];
    // Reuse the signature/grant validator with an explicitly labelled draft
    // context. The independently returned Shopify order ID remains unchanged.
    const bridge = { ...doc, order: { ...doc.order, cartToken: receipt.cartToken } };
    const packet = { projectRef: snapshot.projectRef, shop: snapshot.shop, capturedAt: snapshot.capturedAt,
      requestedCarts: [receipt.cartToken], receipts: [receipt] };
    return mapJourneyCheckout([bridge], { ...packet, digest: evidenceDigest(packet) }, config, secret)
      .map(row => ({ ...row, evidenceRef: `draft-relation:sha256:${evidenceDigest({ receipt, link })}` }));
  });
}
