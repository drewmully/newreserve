import { evidenceDigest, validateRetainedEvidence, type EvidencePacket } from "./evidenceIntake";
import { prepareRefresh, type RefreshInput } from "./refreshPlan";
import { mapMullySource, orderCustomerIds, readMullyCustomers } from "./mymullySource";
import { mapJourneyCheckout, orderCartTokens, readJourneyReceipts } from "./journeySource";
import { mapDraftJourney, readDraftJourney } from "./draftJourneySource";
import { readShopifyAnalyticsOrder, shopifyId, shopifyShop, type ShopifyOrderDocument } from "./shopifySource";
import { nyDate } from "./primitives";
import { planCollectedShopifyCash, composeCollectedShopifyCash, type ShopifyCashCollection } from "./shopifyCashCollection";
import { readHistoryInventoryPage, verifyHistoryAccess } from "./shopifyHistory";
import { inventoryOrder, validateHistoryInventory, type HistoryInventory } from "./historyInventory";
import { readShopifyAgreements } from "./shopifyAgreements";
import { mapShopifyLineDiscounts, mapShopifyOffers, type OfferRegistry } from "./shopifyOffers";
import { readJourneyPermissions } from "./journeyPermissions";
import { planJourneyPermissionCollection, composeCollectedJourneyPermissions,
  type JourneyPermissionCollection } from "./journeyPermissionCollection";
import { prepareOriginalPurchases, requireEmptyOriginalPurchaseEvidence, validateOriginalPurchaseCollection,
  type OriginalPurchaseCollection, type OriginalPurchaseInput } from "./originalPurchasePreparation";

export type CollectRefreshInput = {
  kind: "mully-collect-v1";
  refresh: RefreshInput;
  collection: {
    approvalRef: string;
    projectRef: string;
    shop: string;
    /** Explicit inventory, not a claim of complete purchase history. */
    orderIds?: string[];
    /** Discover only within refresh.history, never caller-defined queries. */
    discover?: true;
    entities: string[];
    checkout: boolean;
    draftJourney?: { from: string; until: string };
    originalPurchases?: OriginalPurchaseCollection;
    /** Explicit replacement of authentic empty offers evidence, unedited orders only. */
    offers?: { registry?: OfferRegistry };
    /** Reuse read transactions only under an explicit customer-payment cash clock. */
    cash?: ShopifyCashCollection;
    journeyPermissions?: JourneyPermissionCollection;
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
  if ("originalPurchases" in input || "originalPurchases" in original)
    throw new Error("collected_original_purchases_require_reviewed_replacement_packet");
  if (Object.keys(input).some(k => !["kind", "refresh", "collection"].includes(k)) ||
      Object.keys(c).some(k => !["approvalRef", "projectRef", "shop", "orderIds", "discover", "entities", "checkout",
        "draftJourney", "originalPurchases", "offers", "journeyPermissions", "cash",
        "maxOrders", "maxLinePages", "maxRequests", "maxBytes", "timeoutMs", "binding"].includes(k)))
    throw new Error("unsupported_collection_option");
  shopifyShop(c.shop);
  const readKey = env.LEAN_MULLY_SOURCE_READ_KEY, shopifyToken = env.LEAN_SHOPIFY_ANALYTICS_READ_TOKEN;
  if (!readKey?.trim() || !shopifyToken?.trim()) throw new Error("refresh_collection_credentials");
  if (c.discover !== undefined && c.discover !== true || c.discover && "orderIds" in c ||
      original.commercePolicy.sourceInventory !== undefined) throw new Error("refresh_collection_inventory_mode");
  const explicitIds = c.orderIds ?? [];
  if (!integer(c.maxOrders, 1, 100) || !integer(c.maxLinePages, 1, 20) ||
      !integer(c.maxRequests, 1, 500) || !integer(c.maxBytes, 1024, 8000000) ||
      !integer(c.timeoutMs, 1, 120000) || !Array.isArray(explicitIds) ||
      (!c.discover && (!explicitIds.length || explicitIds.length > c.maxOrders ||
        new Set(explicitIds).size !== explicitIds.length)) ||
      !Array.isArray(c.entities) || !c.entities.length || c.entities.length > 5 ||
      c.entities.some(e => !/^[a-z][a-z0-9_]{0,31}$/.test(e)) ||
      new Set(c.entities).size !== c.entities.length || typeof c.checkout !== "boolean")
    throw new Error("refresh_collection_budget");
  explicitIds.forEach(id => shopifyId(id, "Order"));
  if (c.offers !== undefined) {
    if (!c.offers || typeof c.offers !== "object" || Array.isArray(c.offers) ||
        Object.keys(c.offers).some(k => k !== "registry")) throw new Error("collection_offers_option");
    if (c.offers.registry !== undefined) {
      if (!c.offers.registry || c.offers.registry.shop !== c.shop) throw new Error("offer_shop_mismatch");
      // Reuse the existing reviewed taxonomy validator before any source call.
      mapShopifyOffers([], c.offers.registry);
    }
    const prior = original.intake.packets.filter(p => p.section === "offers");
    if (prior.length !== 1 || !Array.isArray(prior[0].payload) || prior[0].payload.length)
      throw new Error("collection_offers_require_empty_reviewed_packet");
    // This packet still goes through retained-evidence hash/binding/freshness
    // validation below. Missing/stale evidence is never an authentic empty.
  }
  let agreementPlan: OriginalPurchaseCollection | undefined;
  if (c.originalPurchases !== undefined) {
    if (env.LEAN_SHOPIFY_AGREEMENTS_READ_APPROVED !== "true") throw new Error("agreement_read_disabled");
    agreementPlan = validateOriginalPurchaseCollection(c.originalPurchases, c.maxOrders);
    requireEmptyOriginalPurchaseEvidence(original);
    if (!c.discover && agreementPlan.orders.some(o => !explicitIds.includes(o.orderGid)))
      throw new Error("collection_original_purchase_target");
  }
  let inventoryRequests = 0, reservedOrders = explicitIds.length;
  if (c.discover) {
    if (!Array.isArray(original.history) || !original.history.length || original.history.length > 5)
      throw new Error("refresh_discovery_window_budget");
    let pages = 0, rows = 0;
    for (const [index, w] of original.history.entries()) {
      [w.from, w.until].forEach(nyDate);
      if (Date.parse(w.from) >= Date.parse(w.until) || Date.parse(w.until) > Date.parse(startedAt) ||
          !integer(w.pageSize, 1, 5) || !integer(w.maxPages, 1, 25) ||
          !["created_at", "updated_at"].includes(w.scanBasis ?? "created_at") ||
          original.history.slice(0, index).some(p => (p.scanBasis ?? "created_at") === (w.scanBasis ?? "created_at") &&
            Date.parse(p.from) < Date.parse(w.until) && Date.parse(w.from) < Date.parse(p.until)))
        throw new Error("refresh_discovery_window_scope");
      pages += w.maxPages; rows += w.maxPages * w.pageSize;
    }
    if (pages > 25 || rows > 100) throw new Error("refresh_discovery_window_budget");
    inventoryRequests = original.history.length + pages; // scope check per window + inventory pages
    reservedOrders = Math.min(c.maxOrders, rows);
  }
  // Reserve the worst-case request count, including each order revision recheck.
  if (inventoryRequests + reservedOrders * (c.maxLinePages + 1) + 1 + Number(c.checkout) +
      (c.draftJourney ? 2 : 0) + Number(c.journeyPermissions !== undefined) +
      (agreementPlan ? agreementPlan.orders.length * agreementPlan.maxRequestsPerOrder : 0) >
      c.maxRequests) throw new Error("refresh_collection_request_budget");
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
  const permissionPlan = c.journeyPermissions === undefined ? undefined :
    planJourneyPermissionCollection(refresh, c.journeyPermissions, b.sourceId, env, startedAt);
  const cashPlan = c.cash === undefined ? undefined :
    planCollectedShopifyCash(refresh, c.cash, b.maxAgeSeconds, startedAt);
  const deadline = AbortSignal.timeout(c.timeoutMs);
  let calls = 0, bytes = 0;
  const bounded: typeof fetch = async (url, init) => {
    if (deadline.aborted) throw new Error("refresh_collection_timeout");
    if (++calls > c.maxRequests) throw new Error("refresh_collection_request_budget");
    const target = new URL(String(url));
    const allowed = target.origin === `https://${c.projectRef}.supabase.co` &&
      (target.pathname === "/rest/v1/customers" && init?.method === "GET" ||
       ["/rest/v1/rpc/lean_checkout_receipts_read", "/rest/v1/rpc/lean_draft_receipts_read",
         "/rest/v1/rpc/lean_journey_permissions_read"].includes(target.pathname) &&
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
  let inventory: HistoryInventory | undefined;
  let orderIds = explicitIds;
  if (c.discover) {
    const windows: HistoryInventory["windows"] = [];
    const selected = new Map<string, ReturnType<typeof inventoryOrder>>();
    for (const w of original.history) {
      const options = { shop: c.shop, accessToken: shopifyToken, fetcher: bounded, signal: deadline,
        fromTime: w.from, untilTime: w.until, scanBasis: w.scanBasis, approvalRef: c.approvalRef,
        pageSize: w.pageSize, now: startedAt };
      await verifyHistoryAccess(options);
      const pages: HistoryInventory["windows"][number]["pages"] = [], cursors = new Set<string>();
      let cursor: string | null = null;
      for (let n = 0; n < w.maxPages; n++) {
        const page = await readHistoryInventoryPage(options, cursor);
        pages.push({ cursor, nextCursor: page.nextCursor, orders: page.rows.map(inventoryOrder) });
        for (const order of pages[pages.length - 1].orders) {
          const prior = selected.get(order.id);
          if (prior && evidenceDigest(prior) !== evidenceDigest(order)) throw new Error("inventory_revision_conflict");
          selected.set(order.id, order);
        }
        if (selected.size > c.maxOrders) throw new Error("refresh_discovery_order_budget");
        if (page.complete) break;
        if (!page.nextCursor || cursors.has(page.nextCursor)) throw new Error("inventory_cursor_cycle");
        cursors.add(page.nextCursor); cursor = page.nextCursor;
        if (n + 1 === w.maxPages) throw new Error("refresh_discovery_page_budget");
      }
      windows.push({ ...w, pages });
    }
    const payload = { version: 1 as const, projectRef: c.projectRef, shop: c.shop,
      approvalRef: c.approvalRef, capturedAt: startedAt, windows,
      orders: [...selected.values()].sort((a, b) => a.id.localeCompare(b.id)) };
    inventory = validateHistoryInventory({ ...payload, digest: evidenceDigest(payload) },
      { projectRef: c.projectRef, shop: c.shop, asOf: startedAt, history: original.history });
    orderIds = inventory.orders.map(o => o.id);
  }
  const orders: ShopifyOrderDocument[] = [];
  if (agreementPlan?.orders.some(o => !orderIds.includes(o.orderGid))) throw new Error("collection_original_purchase_target");
  for (const id of orderIds) orders.push(await readShopifyAnalyticsOrder({
    shop: c.shop, accessToken: shopifyToken, fetcher: bounded, maxLinePages: c.maxLinePages,
  }, id));
  if (c.offers && orders.some(o => o.order.edited !== false))
    throw new Error("collection_offers_require_unedited_orders");
  if (inventory && evidenceDigest(orders.map(o => inventoryOrder(o.order))
    .sort((a, b) => a.id.localeCompare(b.id))) !== evidenceDigest(inventory.orders))
    throw new Error("inventory_hydration_changed");
  if (inventory) refresh.commercePolicy.sourceInventory = inventory;
  const originalPurchases: OriginalPurchaseInput[] = [];
  for (const item of agreementPlan?.orders ?? []) {
    const order = orders.find(o => o.order.id === item.orderGid)!;
    const document = await readShopifyAgreements({ shop: c.shop, accessToken: shopifyToken,
      orderGid: item.orderGid, sourceUpdatedAt: String(order.order.updatedAt),
      maxRequests: agreementPlan!.maxRequestsPerOrder, fetcher: bounded, now: () => new Date(clock()) });
    originalPurchases.push({ orderGid: item.orderGid, document, policy: { ...item.policy,
      sourceEvidenceRef: `collected-agreements:sha256:${evidenceDigest({ order, document })}` } });
  }
  const common = { projectRef: c.projectRef, shop: c.shop, capturedAt: startedAt };
  const snapshot = await readMullyCustomers({ ...common, entities: c.entities,
    customerIds: orderCustomerIds(orders) }, readKey, bounded);
  const journey = c.checkout ? await readJourneyReceipts({ ...common,
    requestedCarts: orderCartTokens(orders) }, readKey, bounded) : undefined;
  const draftJourney = c.draftJourney ? await readDraftJourney({ ...common,
    from: c.draftJourney.from, until: c.draftJourney.until },
    readKey, shopifyToken, bounded) : undefined;
  const journeyPermissions = permissionPlan ? await readJourneyPermissions({
    ...permissionPlan.config, capturedAt: clock(),
  }, readKey, bounded) : undefined;
  const finishedAt = clock(); nyDate(finishedAt);
  if (deadline.aborted || Date.parse(finishedAt) < Date.parse(startedAt) ||
      Date.parse(finishedAt) - Date.parse(startedAt) > c.timeoutMs ||
      originalPurchases.some(o => Date.parse(o.document.capturedAt) < Date.parse(startedAt) ||
        Date.parse(o.document.capturedAt) > Date.parse(finishedAt)) ||
      journeyPermissions && (Date.parse(journeyPermissions.capturedAt) < Date.parse(startedAt) ||
        Date.parse(journeyPermissions.capturedAt) > Date.parse(finishedAt)))
    throw new Error("refresh_collection_timeout");
  refresh.intake.asOf = finishedAt;
  refresh.policy.asOf = finishedAt;
  refresh.readyAt = new Date(Math.max(Date.parse(original.readyAt), Date.parse(finishedAt))).toISOString();
  // Keep the reviewed absolute expiry. Never extend the evidence validity window.
  const facts = mapMullySource({ snapshot, orders, mappingVersion: refresh.policy.mappingVersion, permissions: [] });
  const sourceDigest = evidenceDigest({ orders, snapshot, journey: journey ?? null, draftJourney: draftJourney ?? null,
    ...(agreementPlan ? { originalPurchases } : {}), ...(c.offers ? { offers: c.offers } : {}),
    ...(cashPlan ? { cashPolicy: cashPlan.policy } : {}),
    ...(journeyPermissions ? { journeyPermissions } : {}) });
  const packets: EvidencePacket[] = [];
  const add = (section: typeof replaced[number], payload: EvidencePacket["payload"]) => packets.push({
    section, payload, sourceId: b.sourceId, schemaVersion: b.schemaVersion, scope: refresh.intake.scope,
    sourceRecordRef: `collected:sha256:${sourceDigest}`, capturedAt: startedAt, sha256: evidenceDigest(payload),
  });
  // Only the explicit order-to-customer links are used. The customer reader does
  // not replace identity, permission/removal or history with inferred authority.
  add("orderIdentities", facts.orderIdentities);
  const cash = cashPlan ? composeCollectedShopifyCash(refresh, cashPlan, orders,
    { ...b, capturedAt: startedAt }) : undefined;
  if (cash) packets.push(cash.packet);
  if (c.offers) {
    const payload = [...mapShopifyLineDiscounts(orders, c.shop),
      ...(c.offers.registry ? mapShopifyOffers(orders, c.offers.registry) : [])];
    packets.push({ section: "offers", payload, sourceId: b.sourceId, schemaVersion: b.schemaVersion,
      scope: refresh.intake.scope, capturedAt: startedAt, sha256: evidenceDigest(payload),
      sourceRecordRef: `collected-offers:sha256:${evidenceDigest({ orders, registry: c.offers.registry ?? null })}` });
  }
  if (agreementPlan) {
    const mapped = prepareOriginalPurchases(refresh, orders, originalPurchases,
      { sourceId: b.sourceId, schemaVersion: b.schemaVersion });
    refresh.commercePolicy.deferredOrders = mapped.deferredOrders;
    packets.push(mapped.packet);
  }
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
  if (permissionPlan && journeyPermissions) {
    composeCollectedJourneyPermissions(refresh, permissionPlan, journeyPermissions);
    sections.add("identity");
  }
  const bundle = prepareRefresh(refresh);
  const preparedAt = clock(); nyDate(preparedAt);
  if (deadline.aborted || Date.parse(preparedAt) < Date.parse(finishedAt) ||
      Date.parse(preparedAt) - Date.parse(startedAt) > c.timeoutMs)
    throw new Error("refresh_collection_timeout");
  return { bundle, refresh, sources: { orders, snapshot, journey, draftJourney, inventory, originalPurchases,
    ...(cash ? { cash: cash.source } : {}),
    ...(journeyPermissions ? { journeyPermissions } : {}) },
    audit: { version: 1, approvalRef: c.approvalRef, startedAt, finishedAt, sourceDigest,
      projectRef: c.projectRef, shop: c.shop, calls, bytes, orderIds,
      inventoryDigest: inventory?.digest ?? null,
      collectedSections: [...sections], retainedSections: refresh.intake.packets
        .filter(p => !sections.has(p.section)).map(p => p.section),
      completePurchaseHistory: false, independentlyReconciled: false, registered: false, enabled: false } };
}
