import { evidenceDigest, validateRetainedEvidence, type EvidencePacket } from "./evidenceIntake";
import { prepareRefresh, type RefreshInput } from "./refreshPlan";
import { mapMullySource, orderCustomerIds, readMullyCustomers } from "./mymullySource";
import { mapJourneyCheckout, orderCartTokens, readJourneyReceipts } from "./journeySource";
import { mapDraftJourney, readDraftJourney } from "./draftJourneySource";
import { readShopifyAnalyticsOrder, shopifyId, shopifyShop, type ShopifyOrderDocument } from "./shopifySource";
import { nyDate } from "./primitives";

export type CollectRefreshInput = {
  kind: "mully-collect-v1";
  refresh: RefreshInput;
  collection: {
    approvalRef: string;
    projectRef: string;
    shop: string;
    /** Explicit inventory, not a claim of complete purchase history. */
    orderIds: string[];
    entities: string[];
    checkout: boolean;
    draftJourney?: { from: string; until: string };
    maxOrders: number;
    maxLinePages: number;
    maxRequests: number;
    maxBytes: number;
    timeoutMs: number;
    binding: { sourceId: string; schemaVersion: string; maxAgeSeconds: number };
  };
};
type Environment = Record<string, string | undefined>;
const integer = (n: number, min: number, max: number) => Number.isSafeInteger(n) && n >= min && n <= max;
const text = (s: string) => typeof s === "string" && !!s.trim() && s.length <= 512;

/** Optional read-only preparation, never a runner or scheduler. Every unrelated
 * packet retains its capture time, binding, source reference and payload hash.
 * New source facts cannot certify consent, historical ownership or coverage. */
export async function collectRefresh(input: CollectRefreshInput, env: Environment,
  request: typeof fetch = fetch, clock: () => string = () => new Date().toISOString()) {
  if (env.LEAN_REFRESH_SOURCE_COLLECTION_APPROVED !== "true" ||
      env.LEAN_MULLY_SOURCE_READ_APPROVED !== "true") throw new Error("refresh_collection_disabled");
  const c = input.collection, original = input.refresh, startedAt = clock();
  nyDate(startedAt);
  if (input.kind !== "mully-collect-v1" || !c || !text(c.approvalRef) ||
      c.projectRef !== env.LEAN_MULLY_SOURCE_PROJECT_REF || c.shop !== env.LEAN_SHOPIFY_SHOP_DOMAIN ||
      c.projectRef !== original.intake.scope.projectRef || c.shop !== original.intake.scope.shop ||
      !/^[a-z]{20}$/.test(c.projectRef)) throw new Error("refresh_collection_target");
  if ("originalPurchases" in input || "originalPurchases" in c || "originalPurchases" in original)
    throw new Error("collected_original_purchases_require_reviewed_replacement_packet");
  if (Object.keys(input).some(k => !["kind", "refresh", "collection"].includes(k)) ||
      Object.keys(c).some(k => !["approvalRef", "projectRef", "shop", "orderIds", "entities", "checkout",
        "draftJourney", "maxOrders", "maxLinePages", "maxRequests", "maxBytes", "timeoutMs", "binding"].includes(k)))
    throw new Error("unsupported_collection_option");
  shopifyShop(c.shop);
  const readKey = env.LEAN_MULLY_SOURCE_READ_KEY, shopifyToken = env.LEAN_SHOPIFY_ANALYTICS_READ_TOKEN;
  if (!readKey?.trim() || !shopifyToken?.trim()) throw new Error("refresh_collection_credentials");
  if (!integer(c.maxOrders, 1, 100) || !integer(c.maxLinePages, 1, 20) ||
      !integer(c.maxRequests, 1, 500) || !integer(c.maxBytes, 1024, 8000000) ||
      !integer(c.timeoutMs, 1, 120000) || !Array.isArray(c.orderIds) ||
      !c.orderIds.length || c.orderIds.length > c.maxOrders || new Set(c.orderIds).size !== c.orderIds.length ||
      !Array.isArray(c.entities) || !c.entities.length || c.entities.length > 5 ||
      c.entities.some(e => !/^[a-z][a-z0-9_]{0,31}$/.test(e)) ||
      new Set(c.entities).size !== c.entities.length || typeof c.checkout !== "boolean")
    throw new Error("refresh_collection_budget");
  c.orderIds.forEach(id => shopifyId(id, "Order"));
  // Reserve the worst-case request count, including each order revision recheck.
  if (c.orderIds.length * (c.maxLinePages + 1) + 1 + Number(c.checkout) +
      (c.draftJourney ? 2 : 0) > c.maxRequests) throw new Error("refresh_collection_request_budget");
  if (c.checkout || c.draftJourney) {
    if ((env.LEAN_CHECKOUT_CONTEXT_SECRET?.length ?? 0) < 32 ||
        original.policy.project !== env.LEAN_POSTHOG_PROJECT_ID)
      throw new Error("refresh_collection_checkout_configuration");
  }
  if (c.draftJourney) {
    if (Object.keys(c.draftJourney).some(k => !["from", "until"].includes(k)))
      throw new Error("unsupported_collection_option");
    const { from, until } = c.draftJourney;
    [from, until].forEach(nyDate);
    if (Date.parse(until) <= Date.parse(from) || Date.parse(until) > Date.parse(startedAt) ||
        Date.parse(until) - Date.parse(from) > 93 * 86400000)
      throw new Error("refresh_collection_draft_window");
  }
  if (c.draftJourney !== undefined && (!c.draftJourney || typeof c.draftJourney !== "object"))
    throw new Error("refresh_collection_draft_window");
  const b = c.binding;
  if (!b || !text(b.sourceId) || !text(b.schemaVersion) || !integer(b.maxAgeSeconds, 1, 604800) ||
      original.intake.bindings.some(prior => prior.sourceId === b.sourceId))
    throw new Error("refresh_collection_binding");
  if (original.policy.asOf !== original.intake.asOf) throw new Error("refresh_policy_mismatch");
  nyDate(original.readyAt); nyDate(original.expiresAt);
  if (Date.parse(original.expiresAt) <= Date.parse(startedAt) ||
      Date.parse(original.expiresAt) - Date.parse(startedAt) > 86400000 ||
      Date.parse(original.expiresAt) - Date.parse(startedAt) > b.maxAgeSeconds * 1000)
    throw new Error("refresh_collection_execution_window");
  const replaced: ("orderIdentities" | "checkout")[] = ["orderIdentities",
    ...(c.checkout || c.draftJourney ? ["checkout" as const] : [])];
  const refresh = structuredClone(original);
  refresh.intake.asOf = startedAt;
  validateRetainedEvidence(refresh.intake, replaced);
  for (const packet of refresh.intake.packets.filter(p => !replaced.includes(p.section as typeof replaced[number]))) {
    const binding = refresh.intake.bindings.find(b => b.sourceId === packet.sourceId)!;
    if (Date.parse(refresh.expiresAt) - Date.parse(packet.capturedAt) > binding.maxAgeSeconds * 1000)
      throw new Error("refresh_outlives_evidence");
  }
  const deadline = AbortSignal.timeout(c.timeoutMs);
  let calls = 0, bytes = 0;
  const bounded: typeof fetch = async (url, init) => {
    if (deadline.aborted) throw new Error("refresh_collection_timeout");
    if (++calls > c.maxRequests) throw new Error("refresh_collection_request_budget");
    const target = new URL(String(url));
    const allowed = target.origin === `https://${c.projectRef}.supabase.co` &&
      (target.pathname === "/rest/v1/customers" && init?.method === "GET" ||
       ["/rest/v1/rpc/lean_checkout_receipts_read", "/rest/v1/rpc/lean_draft_receipts_read"].includes(target.pathname) &&
       init?.method === "POST") ||
      target.origin === `https://${c.shop}` && target.pathname === "/admin/api/2026-07/graphql.json" &&
      init?.method === "POST";
    if (!allowed || init?.redirect !== "error") throw new Error("refresh_collection_endpoint");
    const response = await request(url, { ...init,
      signal: AbortSignal.any([deadline, ...(init?.signal ? [init.signal] : [])]) });
    if (!response.ok) { await response.body?.cancel(); throw new Error("refresh_collection_source_failed"); }
    const reader = response.body?.getReader();
    if (!reader) throw new Error("refresh_collection_empty_response");
    const chunks: Uint8Array[] = [];
    try {
      for (;;) {
        if (deadline.aborted) { await reader.cancel(); throw new Error("refresh_collection_timeout"); }
        const part = await reader.read();
        if (part.done) break;
        bytes += part.value.length;
        if (bytes > c.maxBytes) { await reader.cancel(); throw new Error("refresh_collection_byte_budget"); }
        chunks.push(part.value);
      }
    } finally { reader.releaseLock(); }
    return new Response(Buffer.concat(chunks), { status: response.status, headers: response.headers });
  };
  const orders: ShopifyOrderDocument[] = [];
  for (const id of c.orderIds) orders.push(await readShopifyAnalyticsOrder({
    shop: c.shop, accessToken: shopifyToken, fetcher: bounded, maxLinePages: c.maxLinePages,
  }, id));
  const common = { projectRef: c.projectRef, shop: c.shop, capturedAt: startedAt };
  const snapshot = await readMullyCustomers({ ...common, entities: c.entities,
    customerIds: orderCustomerIds(orders) }, readKey, bounded);
  const journey = c.checkout ? await readJourneyReceipts({ ...common,
    requestedCarts: orderCartTokens(orders) }, readKey, bounded) : undefined;
  const draftJourney = c.draftJourney ? await readDraftJourney({ ...common,
    from: c.draftJourney.from, until: c.draftJourney.until },
    readKey, shopifyToken, bounded) : undefined;
  const finishedAt = clock(); nyDate(finishedAt);
  if (deadline.aborted || Date.parse(finishedAt) < Date.parse(startedAt) ||
      Date.parse(finishedAt) - Date.parse(startedAt) > c.timeoutMs)
    throw new Error("refresh_collection_timeout");
  refresh.intake.asOf = finishedAt;
  refresh.policy.asOf = finishedAt;
  refresh.readyAt = new Date(Math.max(Date.parse(original.readyAt), Date.parse(finishedAt))).toISOString();
  // Keep the reviewed absolute expiry. Never extend the evidence validity window.
  const facts = mapMullySource({ snapshot, orders, mappingVersion: refresh.policy.mappingVersion, permissions: [] });
  const sourceDigest = evidenceDigest({ orders, snapshot, journey: journey ?? null, draftJourney: draftJourney ?? null });
  const packets: EvidencePacket[] = [];
  const add = (section: typeof replaced[number], payload: EvidencePacket["payload"]) => packets.push({
    section, payload, sourceId: b.sourceId, schemaVersion: b.schemaVersion, scope: refresh.intake.scope,
    sourceRecordRef: `collected:sha256:${sourceDigest}`, capturedAt: startedAt, sha256: evidenceDigest(payload),
  });
  // Only the explicit order-to-customer links are used. The customer reader does
  // not replace identity, permission/removal or history with inferred authority.
  add("orderIdentities", facts.orderIdentities);
  if (journey || draftJourney) {
    const config = { projectRef: c.projectRef, shop: c.shop, posthogProject: refresh.policy.project,
      sessionVersion: refresh.policy.sessionVersion, asOf: finishedAt };
    add("checkout", [
      ...(journey ? mapJourneyCheckout(orders, journey, config, env.LEAN_CHECKOUT_CONTEXT_SECRET!) : []),
      ...(draftJourney ? mapDraftJourney(orders, draftJourney, config, env.LEAN_CHECKOUT_CONTEXT_SECRET!) : []),
    ]);
  }
  const sections = new Set(packets.map(p => p.section));
  refresh.intake.packets = [...refresh.intake.packets.filter(p => !sections.has(p.section)), ...packets];
  refresh.intake.bindings = [
    ...refresh.intake.bindings.map(prior => ({ ...prior, sections: prior.sections.filter(s => !sections.has(s)) }))
      .filter(prior => prior.sections.length),
    { ...b, approvalRef: c.approvalRef, sections: packets.map(p => p.section), independentControlSource: false },
  ];
  const bundle = prepareRefresh(refresh);
  return { bundle, refresh, sources: { orders, snapshot, journey, draftJourney },
    audit: { version: 1, approvalRef: c.approvalRef, startedAt, finishedAt, sourceDigest,
      projectRef: c.projectRef, shop: c.shop, calls, bytes, orderIds: c.orderIds,
      collectedSections: [...sections], retainedSections: refresh.intake.packets
        .filter(p => !sections.has(p.section)).map(p => p.section),
      completePurchaseHistory: false, independentlyReconciled: false, registered: false, enabled: false } };
}
