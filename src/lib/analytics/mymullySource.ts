import { createHash } from "node:crypto";
import { evidenceDigest, type EvidencePacket, type EvidenceScope } from "./evidenceIntake";
import type { FullBuildEvidence } from "./fullReportBuild";
import { normalizeIdentity, type IdentityEvidence } from "./identity";
import { key, nyDate } from "./primitives";
import { shopifyId, shopifyShop, sourceObject, type ShopifyOrderDocument } from "./shopifySource";

export type MullyCustomer = {
  id: string; firebaseUid: string | null; createdAt: string | null; updatedAt: string | null;
};
export type MullyCustomerSnapshot = {
  projectRef: string; shop: string; capturedAt: string; requestedIds: string[];
  entities: string[]; customers: MullyCustomer[]; digest: string;
};
const columns = "id,firebase_uid,created_at,updated_at,entity";
function id(value: unknown): string {
  // PostgREST can serialize bigint as a JSON number. Never accept rounded IDs.
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) throw new Error("mully_unsafe_customer_id");
    value = String(value);
  }
  if (typeof value !== "string" || !/^[1-9]\d{0,19}$/.test(value))
    throw new Error("mully_invalid_customer_id");
  if (BigInt(value) >= BigInt("9000000000000000"))
    throw new Error("mully_synthetic_customer_requires_link");
  return value;
}
function project(value: string) {
  if (!/^[a-z]{20}$/.test(value)) throw new Error("mully_invalid_project");
}
/** Stable surrogate, scoped to the source project AND shop, never an email join.
 * public.customers.id is a Shopify customer ID (events/resolve-identity.ts).
 */
export function mullyCustomerId(projectRef: string, shop: string, customerId: string): string {
  project(projectRef); shopifyShop(shop);
  return `customer_${createHash("sha256").update(JSON.stringify([projectRef, shop, id(customerId)])).digest("hex")}`;
}
export function orderCustomerIds(orders: ShopifyOrderDocument[]): string[] {
  if (orders.length > 100) throw new Error("mully_order_budget");
  return [...new Set(orders.flatMap(doc => {
    // undefined means the source query predates this adapter, not a guest.
    if (doc.order.customer === undefined) throw new Error("mully_order_customer_not_selected");
    return doc.order.customer === null ? [] : [id(shopifyId(sourceObject(doc.order.customer).id, "Customer"))];
  }))].sort();
}
/** One read, explicit target and order-derived IDs. No fallback project,
 * profile scan, email/phone/marketing fields, mutations or automatic retries.
 * This is a current snapshot, NOT historical Firebase ownership or consent.
 */
export async function readMullyCustomers(config: {
  projectRef: string; shop: string; customerIds: string[]; capturedAt: string; entities: string[];
}, readKey: string, request: typeof fetch = fetch): Promise<MullyCustomerSnapshot> {
  project(config.projectRef); shopifyShop(config.shop); nyDate(config.capturedAt);
  if (!readKey.trim() || config.customerIds.length > 100) throw new Error("mully_source_configuration");
  if (!config.entities.length || config.entities.length > 5 ||
      config.entities.some(e => !/^[a-z][a-z0-9_]{0,31}$/.test(e)) ||
      new Set(config.entities).size !== config.entities.length) throw new Error("mully_entity_scope_required");
  const requestedIds = [...new Set(config.customerIds.map(id))].sort();
  if (requestedIds.length !== config.customerIds.length) throw new Error("mully_duplicate_requested_id");
  let customers: MullyCustomer[] = [];
  if (requestedIds.length) {
    const url = new URL(`https://${config.projectRef}.supabase.co/rest/v1/customers`);
    url.searchParams.set("select", columns);
    url.searchParams.set("entity", `in.(${config.entities.join(",")})`);
    url.searchParams.set("id", `in.(${requestedIds.join(",")})`);
    url.searchParams.set("order", "id.asc");
    url.searchParams.set("limit", String(requestedIds.length + 1));
    let response: Response;
    try {
      response = await request(url.toString(), { method: "GET", redirect: "error",
        headers: { apikey: readKey, Authorization: `Bearer ${readKey}`, Prefer: "count=exact",
          "Accept-Profile": "public" }, signal: AbortSignal.timeout(15000) });
    } catch { throw new Error("mully_source_unavailable"); }
    if (!response.ok) throw new Error("mully_source_unavailable");
    const stream = response.body?.getReader();
    if (!stream) throw new Error("mully_empty_response");
    const parts: Uint8Array[] = []; let bytes = 0;
    try {
      for (;;) {
        const part = await stream.read(); if (part.done) break;
        bytes += part.value.length;
        if (bytes > 250000) { await stream.cancel(); throw new Error("mully_response_budget"); }
        parts.push(part.value);
      }
    } finally { stream.releaseLock(); }
    let rows: unknown;
    try { rows = JSON.parse(Buffer.concat(parts).toString("utf8")); }
    catch { throw new Error("mully_response_shape"); }
    if (!Array.isArray(rows) || rows.length !== requestedIds.length ||
        response.headers.get("Content-Range") !== `0-${rows.length - 1}/${rows.length}`)
      throw new Error("mully_customer_scope_incomplete");
    const seen = new Set<string>();
    customers = rows.map(raw => {
      const r = sourceObject(raw), customerId = id(r.id);
      if (!requestedIds.includes(customerId) || seen.has(customerId) || !config.entities.includes(String(r.entity)))
        throw new Error("mully_customer_scope_mismatch");
      seen.add(customerId);
      if (!(r.firebase_uid === null || typeof r.firebase_uid === "string" &&
          /^[a-zA-Z0-9_-]{1,128}$/.test(r.firebase_uid))) throw new Error("mully_invalid_firebase_uid");
      const utc = (value: unknown) => {
        if (value === null) return null;
        if (typeof value !== "string") throw new Error("mully_invalid_timestamp");
        const t = value.replace(/\+00:00$/, "Z"); nyDate(t); return t;
      };
      const createdAt = utc(r.created_at), updatedAt = utc(r.updated_at);
      if (updatedAt && createdAt && Date.parse(updatedAt) < Date.parse(createdAt) ||
          [createdAt, updatedAt].some(t => t !== null && Date.parse(t) > Date.parse(config.capturedAt)))
        throw new Error("mully_future_customer");
      return { id: customerId, firebaseUid: r.firebase_uid as string | null, createdAt, updatedAt };
    }).sort((a, b) => a.id.localeCompare(b.id));
  }
  const snapshot = { projectRef: config.projectRef, shop: config.shop,
    capturedAt: config.capturedAt, requestedIds, entities: [...config.entities].sort(), customers };
  return { ...snapshot, digest: evidenceDigest(snapshot) };
}
/** A reviewed permission timeline, from the analytics authority, not marketing
 * flags. Absence stays unknown. A current grant cannot backdate permission.
 */
export type MullyPermission = {
  customerId: string; from: string; to: string | null; permitted: boolean;
  removed: boolean; evidenceRef: string;
};
export function mapMullySource(input: {
  snapshot: MullyCustomerSnapshot; orders: ShopifyOrderDocument[];
  mappingVersion: string; permissions: MullyPermission[];
}) {
  const { snapshot: s } = input, { digest, ...payload } = s;
  project(s.projectRef); shopifyShop(s.shop); nyDate(s.capturedAt);
  if (evidenceDigest(payload) !== digest || !input.mappingVersion.trim() ||
      input.permissions.length > 10000 || s.customers.length > 100)
    throw new Error("mully_snapshot_mismatch");
  const wanted = orderCustomerIds(input.orders);
  if (JSON.stringify(wanted) !== JSON.stringify(s.requestedIds) ||
      JSON.stringify(s.customers.map(c => c.id).sort()) !== JSON.stringify(wanted))
    throw new Error("mully_snapshot_scope_mismatch");
  const identity: IdentityEvidence[] = [], currentlyPermitted: string[] = [], removedCustomers: string[] = [];
  const customerHistory: FullBuildEvidence["customerHistory"] = {};
  const links = new Map<string, Set<string>>();
  for (const c of s.customers) if (c.firebaseUid) {
    const set = links.get(c.firebaseUid) ?? new Set(); set.add(c.id); links.set(c.firebaseUid, set);
  }
  for (const p of input.permissions) {
    if (!wanted.includes(p.customerId) || !p.evidenceRef.trim() || p.evidenceRef.length > 512 ||
        typeof p.permitted !== "boolean" || typeof p.removed !== "boolean" || p.removed && p.permitted)
      throw new Error("mully_invalid_permission");
    nyDate(p.from); if (p.to !== null) nyDate(p.to);
    if (Date.parse(p.from) > Date.parse(s.capturedAt) ||
        p.to !== null && Date.parse(p.to) <= Date.parse(p.from)) throw new Error("mully_invalid_permission_interval");
  }
  for (const c of s.customers) {
    if (c.createdAt !== null) nyDate(c.createdAt);
    if (c.updatedAt !== null) nyDate(c.updatedAt);
    if (c.createdAt && c.updatedAt && Date.parse(c.createdAt) > Date.parse(c.updatedAt) ||
        [c.createdAt, c.updatedAt].some(t => t !== null && Date.parse(t) > Date.parse(s.capturedAt)) ||
        !(c.firebaseUid === null || /^[a-zA-Z0-9_-]{1,128}$/.test(c.firebaseUid)))
      throw new Error("mully_invalid_customer_snapshot");
    const canonical = mullyCustomerId(s.projectRef, s.shop, c.id);
    const ref = `supabase:${s.projectRef}:customers:${c.id}:sha256:${digest}`;
    const timeline = input.permissions.filter(p => p.customerId === c.id).sort((a, b) => a.from.localeCompare(b.from));
    if (timeline.some((p, i) => i > 0 && (timeline[i - 1].to === null ||
        Date.parse(timeline[i - 1].to!) > Date.parse(p.from)))) throw new Error("mully_overlapping_permission");
    const current = timeline.find(p => Date.parse(p.from) <= Date.parse(s.capturedAt) &&
      (p.to === null || Date.parse(s.capturedAt) < Date.parse(p.to)));
    if (current?.removed) removedCustomers.push(canonical);
    else if (current?.permitted) currentlyPermitted.push(canonical);
    // Current source presence never certifies complete purchase/migration history.
    customerHistory[canonical] = { expectedSources: ["shopify"], completeSources: [],
      approvalRef: null, migrationsReconciled: false };
    const add = (namespace: string, identifier: string, from: string, conflict = false) => {
      const intervals = timeline.filter(p => p.to === null || Date.parse(p.to) > Date.parse(from));
      // Unknown interval before the first known permission must remain explicit.
      const bounds = new Set([from, ...intervals.flatMap(p =>
        [p.from, p.to].filter((t): t is string => t !== null && Date.parse(t) > Date.parse(from)))]);
      const starts = [...bounds].sort((a, b) => Date.parse(a) - Date.parse(b));
      starts.forEach((start, i) => {
        const p = intervals.find(p => Date.parse(p.from) <= Date.parse(start) &&
          (p.to === null || Date.parse(start) < Date.parse(p.to)));
        identity.push({ namespace, identifier, customerId: canonical, from: start, to: starts[i + 1] ?? null,
          type: "supabase_customer_link", evidenceRef: p ? `${ref};permission:sha256:${evidenceDigest(p)}` : ref,
          mappingVersion: input.mappingVersion, resolution: p?.removed ? "removed" : conflict ? "conflicting" : "resolved",
          consent: p ? p.permitted ? "permitted" : "denied" : "unknown", removal: p?.removed ? "removed" : "active" });
      });
    };
    add("shopify_customer", c.id, c.createdAt ?? s.capturedAt);
    // updated_at does not establish when firebase_uid was set. The current
    // association is only asserted from capture, never retroactively from creation.
    if (c.firebaseUid) add("firebase", c.firebaseUid, s.capturedAt, links.get(c.firebaseUid)!.size > 1);
  }
  const orderIdentities: FullBuildEvidence["orderIdentities"] = [];
  const seen = new Set<string>();
  for (const doc of input.orders) {
    if (doc.shop !== s.shop) throw new Error("mully_order_shop_mismatch");
    const orderId = key(s.shop, shopifyId(doc.order.id, "Order"));
    if (seen.has(orderId)) throw new Error("mully_duplicate_order"); seen.add(orderId);
    if (doc.order.customer !== null) orderIdentities.push({ orderId, namespace: "shopify_customer",
      identifier: id(shopifyId(sourceObject(doc.order.customer).id, "Customer")),
      evidenceRef: `shopify:${s.shop}:${shopifyId(doc.order.id, "Order")}:customer` });
  }
  identity.forEach(row => normalizeIdentity(row, "source-validation"));
  return { identity, currentlyPermitted, removedCustomers, customerHistory, orderIdentities };
}
/** Produces the actual intake packets, not a disconnected diagnostic result.
 * Other sections must still be supplied; this never invents passed controls.
 */
export function mullySourcePackets(input: Parameters<typeof mapMullySource>[0], config: {
  scope: EvidenceScope; sourceId: string; schemaVersion: string;
}): EvidencePacket[] {
  if (config.scope.projectRef !== input.snapshot.projectRef || config.scope.shop !== input.snapshot.shop)
    throw new Error("mully_packet_scope_mismatch");
  const mapped = mapMullySource(input);
  return (Object.keys(mapped) as (keyof typeof mapped)[]).map(section => ({
    section, sourceId: config.sourceId, sourceRecordRef: `sha256:${input.snapshot.digest}`,
    schemaVersion: config.schemaVersion, scope: config.scope, capturedAt: input.snapshot.capturedAt,
    sha256: evidenceDigest(mapped[section]), payload: mapped[section],
  }));
}
