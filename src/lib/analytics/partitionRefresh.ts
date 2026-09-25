import { collectRefresh, type CollectRefreshInput } from "./collectRefresh";
import { prepareRefresh, type RefreshInput } from "./refreshPlan";
import { assembleEvidence, canonicalJson, evidenceDigest, type EvidencePacket } from "./evidenceIntake";
import { readPilotSource } from "./shopifyPilotSource";
import { prepareOriginalPurchases, type OriginalPurchaseCollection, type OriginalPurchaseInput } from "./originalPurchasePreparation";
import { assemblePartitionPages, makePartitionPages, validatePartitionInventory,
  type PartitionInventory, type PartitionPage, type PartitionRow } from "./partitionInventory";
import type { ShopifyOrderDocument } from "./shopifySource";
import { key } from "./primitives";
import { readJourneyPermissions } from "./journeyPermissions";
import { planJourneyPermissionCollection, composeCollectedJourneyPermissions } from "./journeyPermissionCollection";

type Collection = CollectRefreshInput["collection"];
export type PartitionCollectInput = {
  kind: "mully-partition-collect-v1"; refresh: RefreshInput;
  collection: Omit<Collection, "discover" | "orderIds" | "originalPurchases" | "cash"> & {
    partitions: { id: string; history: RefreshInput["history"]; originalPurchases?: OriginalPurchaseCollection }[];
  };
};
export type PartitionPreparedInput = { kind: "mully-partition-prepared-v1"; refresh: RefreshInput; manifest: PartitionInventory };
/** Pure assembly prepares ONE parent; children are private source pages, not jobs/publications. */
export function preparePartitionRefresh(input: PartitionPreparedInput) {
  const manifest = validatePartitionInventory(input.manifest, { ...input.refresh.intake.scope, asOf: input.refresh.intake.asOf });
  if (input.kind !== "mully-partition-prepared-v1" || manifest.expiresAt !== input.refresh.expiresAt ||
      input.refresh.commercePolicy.sourceInventory !== undefined ||
      input.refresh.commercePolicy.partitionInventory !== undefined)
    throw new Error("partition_preparation_scope");
  const refresh = structuredClone(input.refresh);
  refresh.history = manifest.children[0].inventory.windows.map(({ from, until, pageSize, maxPages, scanBasis }) =>
    ({ from, until, pageSize, maxPages, ...(scanBasis ? { scanBasis } : {}) }));
  // Reuse all 17 section, policy, scope, freshness and expansion checks. The
  // ordinary registrar is never given this temporary validation-only seed.
  refresh.maxSteps = Math.max(refresh.maxSteps, refresh.history.reduce((n, h) => n + h.maxPages, 0) + 102);
  if (refresh.maxSteps > 128) throw new Error("partition_step_budget");
  const seed = prepareRefresh(refresh), digest = evidenceDigest(input), runId = `refresh:${digest.slice(0, 48)}`;
  if (seed.evidenceDigest !== manifest.evidenceDigest) throw new Error("partition_evidence_binding");
  const spend = seed.spend.map((s, i) => ({ ...s, runId: `${runId}:s${i}` }));
  const policy = { ...input.refresh.commercePolicy, partitionInventory: manifest };
  const maxSteps = spend.length + 2;
  if (input.refresh.maxSteps < Math.max(3, maxSteps)) throw new Error("partition_step_budget");
  return { ...seed, version: 2, digest, runId, history: [], spend,
    evidenceScope: input.refresh.intake.scope, evidenceBindings: input.refresh.intake.bindings,
    base: { ...seed.base, runId: `${runId}:base`, historyRuns: [], spendRuns: spend.map(s => s.runId), policy },
    full: { ...seed.full, runId, baseRun: `${runId}:base` },
    queue: { ...seed.queue, maxSteps: input.refresh.maxSteps } };
}

/** Explicit aggregate budget wraps ALL child collectors and financial reads.
 * Only local output is prepared here; private staging is a later owner action. */
export async function collectPartitionRefresh(input: PartitionCollectInput, env: Record<string, string | undefined>,
  request: typeof fetch = fetch, clock = () => new Date().toISOString()) {
  if (env.LEAN_PARTITION_COLLECTION_APPROVED !== "true") throw new Error("partition_collection_disabled");
  const c = input.collection;
  // Cash composition is bounded to one <=100-order read. Do not duplicate a
  // retained settlement packet into every child and silently change its authority.
  if (c && "cash" in c) throw new Error("partition_cash_collection_not_supported");
  if (input.kind !== "mully-partition-collect-v1" || !c ||
      Object.keys(input).some(k => !["kind", "refresh", "collection"].includes(k)) ||
      ["discover", "orderIds", "originalPurchases"].some(k => k in c) ||
      !Array.isArray(c.partitions) || c.partitions.length < 1 || c.partitions.length > 10 ||
      !Number.isSafeInteger(c.maxOrders) || c.maxOrders < 1 || c.maxOrders > 1000 ||
      !Number.isSafeInteger(c.maxRequests) || c.maxRequests < 1 || c.maxRequests > 20000 ||
      !Number.isSafeInteger(c.maxBytes) || c.maxBytes < 1024 || c.maxBytes > 32000000 ||
      !Number.isSafeInteger(c.timeoutMs) || c.timeoutMs < 1 || c.timeoutMs > 120000)
    throw new Error("partition_collection_budget");
  const ids = new Set<string>(), originals = new Set<string>();
  let reserved = Number(c.journeyPermissions !== undefined);
  for (const child of c.partitions) {
    if (!child || Object.keys(child).some(k => !["id", "history", "originalPurchases"].includes(k)) ||
        !/^[a-zA-Z0-9_-]{1,32}$/.test(child.id) || ids.has(child.id) || !Array.isArray(child.history))
      throw new Error("partition_child_identity");
    ids.add(child.id);
    const rows = child.history.reduce((n, h) => n + h.pageSize * h.maxPages, 0);
    // PilotSource reserves two commerce pages + recheck, two financial reads,
    // and at most three refund reads. Never use a larger source-reader fallback.
    reserved += child.history.reduce((n, h) => n + h.maxPages + 1, 0) +
      Math.min(100, rows) * (c.maxLinePages + 1 + 8) + 1 + Number(c.checkout) + (c.draftJourney ? 2 : 0);
    if (child.originalPurchases) {
      reserved += child.originalPurchases.orders.length * child.originalPurchases.maxRequestsPerOrder;
      for (const item of child.originalPurchases.orders) {
        if (originals.has(item.orderGid)) throw new Error("partition_duplicate_original_target");
        originals.add(item.orderGid);
      }
    }
  }
  if (!Number.isSafeInteger(reserved) || reserved > c.maxRequests || originals.size > 100)
    throw new Error("partition_request_reservation");
  const startedAt = clock(), deadline = AbortSignal.timeout(c.timeoutMs);
  if (!Number.isFinite(Date.parse(startedAt))) throw new Error("partition_capture_clock");
  const permissionPlan = c.journeyPermissions === undefined ? undefined :
    planJourneyPermissionCollection(input.refresh, c.journeyPermissions, c.binding.sourceId, env, startedAt);
  let calls = 0, bytes = 0;
  const bounded: typeof fetch = async (url, init) => {
    if (deadline.aborted || ++calls > c.maxRequests) throw new Error("partition_read_budget");
    const response = await request(url, { ...init,
      signal: AbortSignal.any([deadline, ...(init?.signal ? [init.signal] : [])]) });
    const reader = response.body?.getReader();
    if (!response.ok || !reader) { await response.body?.cancel(); throw new Error("partition_source_failed"); }
    const parts: Uint8Array[] = [];
    try {
      for (;;) {
        if (deadline.aborted) { await reader.cancel(); throw new Error("partition_read_budget"); }
        const part = await reader.read(); if (part.done) break;
        bytes += part.value.length;
        if (bytes > c.maxBytes) { await reader.cancel(); throw new Error("partition_read_budget"); }
        parts.push(part.value);
      }
    } finally { reader.releaseLock(); }
    return new Response(Buffer.concat(parts), { headers: response.headers, status: response.status });
  };
  const refresh = structuredClone(input.refresh), pages: PartitionPage[] = [],
    children: PartitionInventory["children"] = [], originalsRead: OriginalPurchaseInput[] = [],
    orders: ShopifyOrderDocument[] = [], collected = new Map<string, EvidencePacket[]>(), audits: unknown[] = [];
  const { partitions: ignored, journeyPermissions: parentPermissions, ...shared } = c;
  void ignored; void parentPermissions;
  for (const child of c.partitions) {
    const part = await collectRefresh({ kind: "mully-collect-v1",
      refresh: { ...structuredClone(input.refresh), history: child.history },
      collection: { ...shared, discover: true, maxOrders: 100, maxRequests: Math.min(500, c.maxRequests),
        maxBytes: Math.min(8000000, c.maxBytes),
        ...(child.originalPurchases ? { originalPurchases: child.originalPurchases } : {}) } }, env, bounded, clock);
    const rows: PartitionRow[] = [];
    for (const order of part.sources.orders) {
      const source = await readPilotSource({ shop: c.shop, accessToken: env.LEAN_SHOPIFY_ANALYTICS_READ_TOKEN!,
        fetcher: bounded, signal: deadline }, String(order.order.id));
      if (evidenceDigest(order) !== evidenceDigest(source.commerce)) throw new Error("partition_hydration_changed");
      rows.push({ source, evidenceRef: `partition-source:sha256:${evidenceDigest(source)}`, capturedAt: clock() });
    }
    const childPages = makePartitionPages(child.id, rows); pages.push(...childPages);
    children.push({ id: child.id, inventory: part.sources.inventory!, pages: childPages.map(p => ({
      number: p.number, rows: (JSON.parse(p.payload) as unknown[]).length, bytes: Buffer.byteLength(p.payload),
      digest: evidenceDigest(JSON.parse(p.payload)),
    })) });
    orders.push(...part.sources.orders); originalsRead.push(...part.sources.originalPurchases);
    audits.push(part.audit);
    for (const section of part.audit.collectedSections) {
      if (section === "replacements") continue;
      const packet = part.refresh.intake.packets.find(p => p.section === section)!;
      collected.set(section, [...(collected.get(section) ?? []), packet]);
    }
  }
  const journeyPermissions = permissionPlan ? await readJourneyPermissions({
    ...permissionPlan.config, capturedAt: clock(),
  }, env.LEAN_MULLY_SOURCE_READ_KEY!, bounded) : undefined;
  const finishedAt = clock();
  if (deadline.aborted || !Number.isFinite(Date.parse(finishedAt)) || Date.parse(finishedAt) < Date.parse(startedAt) ||
      Date.parse(finishedAt) - Date.parse(startedAt) > c.timeoutMs ||
      journeyPermissions && (Date.parse(journeyPermissions.capturedAt) < Date.parse(startedAt) ||
        Date.parse(journeyPermissions.capturedAt) > Date.parse(finishedAt))) throw new Error("partition_read_budget");
  const owners: Record<string, string> = {};
  for (const child of children) for (const order of child.inventory.orders) owners[order.id] ??= child.id;
  const body = { version: 1 as const, projectRef: c.projectRef, shop: c.shop, approvalRef: c.approvalRef,
    capturedAt: finishedAt, expiresAt: refresh.expiresAt, maxBytes: c.maxBytes, children, owners,
    evidenceDigest: assembleEvidence(refresh.intake).digest };
  let manifest = validatePartitionInventory({ ...body, digest: evidenceDigest(body) }, body);
  const sources = assemblePartitionPages(manifest, pages);
  if (sources.length > c.maxOrders) throw new Error("partition_order_budget");
  refresh.intake.asOf = refresh.policy.asOf = finishedAt;
  refresh.readyAt = new Date(Math.max(Date.parse(refresh.readyAt), Date.parse(finishedAt))).toISOString();
  const packets: EvidencePacket[] = [];
  for (const [section, parts] of collected) {
    const unique = new Map<string, unknown>();
    for (const part of parts) for (const row of part.payload as unknown[]) unique.set(canonicalJson(row), row);
    const payload = [...unique.values()] as EvidencePacket["payload"];
    packets.push({ ...parts[0], section: section as EvidencePacket["section"], payload, sha256: evidenceDigest(payload),
      capturedAt: new Date(Math.min(...parts.map(p => Date.parse(p.capturedAt)))).toISOString(),
      sourceRecordRef: `partition-collection:sha256:${evidenceDigest(parts)}` });
  }
  if (originalsRead.length) {
    const original = prepareOriginalPurchases(refresh, orders, originalsRead, c.binding);
    packets.push(original.packet); refresh.commercePolicy.deferredOrders = original.deferredOrders;
  }
  const sections = new Set(packets.map(p => p.section));
  const selectedOrderKeys = new Set(sources.map(r => key(c.shop, String(r.source.commerce.order.id).split("/").at(-1)!)));
  // Scope is explicit: do not silently discard previously reviewed facts for
  // orders absent from this parent inventory.
  for (const prior of refresh.intake.packets.filter(p => sections.has(p.section) && p.section !== "replacements"))
    if ((prior.payload as { orderId: string }[]).some(row => !selectedOrderKeys.has(row.orderId)))
      throw new Error("partition_reviewed_records_outside_scope");
  refresh.intake.packets = [...refresh.intake.packets.filter(p => !sections.has(p.section)), ...packets];
  refresh.intake.bindings = [...refresh.intake.bindings.map(b => ({ ...b, sections: b.sections.filter(s => !sections.has(s)) }))
    .filter(b => b.sections.length), { ...c.binding, approvalRef: c.approvalRef,
    independentControlSource: false, sections: [...sections] }];
  if (permissionPlan && journeyPermissions)
    composeCollectedJourneyPermissions(refresh, permissionPlan, journeyPermissions);
  body.evidenceDigest = assembleEvidence(refresh.intake).digest;
  manifest = validatePartitionInventory({ ...body, digest: evidenceDigest(body) }, body);
  const prepared: PartitionPreparedInput = { kind: "mully-partition-prepared-v1", refresh, manifest };
  const bundle = preparePartitionRefresh(prepared);
  const committedAt = Date.parse(clock());
  if (deadline.aborted || !Number.isFinite(committedAt) || committedAt < Date.parse(finishedAt) ||
      committedAt - Date.parse(startedAt) > c.timeoutMs) throw new Error("partition_read_budget");
  return { bundle, refresh: prepared, sources: { pages, originalPurchases: originalsRead,
    ...(journeyPermissions ? { journeyPermissions } : {}) },
    audit: { startedAt, finishedAt, calls, bytes, children: audits, inventoryDigest: manifest.digest,
      completePurchaseHistory: false, independentlyReconciled: false, enabled: false, registered: false } };
}
