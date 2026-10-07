import { createHash } from "node:crypto";
import { canonicalJson, evidenceDigest } from "./evidenceIntake";
import { nyDate } from "./primitives";
import { CUSTOMER_PURCHASE_ACCESS_QUERY, CUSTOMER_PURCHASE_SCHEMA,
  type CustomerPurchaseObservation } from "./customerScopedPurchaseSource";
import type { ScopedCustomerPurchaseBinding } from "./customerScopedPurchaseConsumer";

export const CUSTOMER_CYCLE_PACKET_KIND = "b1-cycle-customer-source-only-v1";
export const CUSTOMER_SOURCE_READER_SHA256 = "a52c100bed93bd7a9c494c746e175dc4be1e90aa4157472209cd3bb3369b4941";
const oldBundle = "f86edbdd17b8c30b5baf0659171ac869e23f2b4a73f3660b4db7267a6b393f20";
/** These are actual claimed source-cycle fields, not the advertising lease.
 * Emission hashes must come from the immutable source-capture manifest.
 */
export type CustomerSourceCycle = {
  cycleId: string; grantId: string; grantRevision: string; projectRef: string; shop: string;
  reportDate: string; startedAt: string; deadline: string; authorizationRef: string;
  appId: string; installationId: string; sourceReaderSha256: typeof CUSTOMER_SOURCE_READER_SHA256;
  sourceReaderEmissionSha256: string; captureClosureSha256: string;
  maxRequests: 65; maxResponseBytes: 1048576; maxTotalBytes: 16777216; maxActiveMs: 120000;
};
/** Observed first access-query exchange already counted by the unchanged reader.
 * No extra preflight request, token, raw response or guessed capability.
 */
export type CustomerCycleIdentityReceipt = {
  startedAt: string; finishedAt: string; querySha256: string; requestBodySha256: string;
  responseBodySha256: string; httpStatus: 200; apiVersion: "2026-07"; shop: string;
  appId: string; installationId: string;
  capabilities: { read_orders: boolean; write_orders: boolean; read_all_orders: boolean;
    read_customers: boolean; read_products: boolean };
};
export type CustomerCyclePacket = {
  version: 1; kind: typeof CUSTOMER_CYCLE_PACKET_KIND;
  bindingSha256: string; identitySha256: string;
  cycle: CustomerSourceCycle; identityReceipt: CustomerCycleIdentityReceipt;
  source: CustomerPurchaseObservation; retainedSourceReceipts: [];
  sharedUsage: { requests: number; responseBytes: number; activeMs: number; largestResponseBytes: number };
  sourceOnly: true; productionAdmission: false; customerOwnershipAccepted: false;
  financialMappingApproved: false; certified: false; registered: false; enabled: false;
};
const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const hash = (v: unknown) => typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
const text = (v: unknown) => typeof v === "string" && !!v.trim() && v === v.trim() && v !== "UNSET" && v.length <= 512;
function fail(code: string): never { throw new Error(`customer_cycle_packet_${code}`); }
function exact(value: object, keys: string[]) {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      canonicalJson(Object.keys(value).sort()) !== canonicalJson([...keys].sort())) fail("fields");
}
function at(s: string) { nyDate(s); return Date.parse(s); }
const instant = (s: string) => {
  nyDate(s);
  return s.replace(/(?:\.(\d+))?Z$/, (_, digits: string | undefined) => `.${(digits ?? "").padEnd(6, "0")}Z`);
};
/** Structural/source provenance validation only. The source-cycle grant and
 * emitted-file comparison remain the outer capture/registration owner's job.
 */
export function validateCustomerCyclePacket(packet: CustomerCyclePacket, expectedCycle: CustomerSourceCycle): void {
  exact(packet, ["version", "kind", "bindingSha256", "identitySha256", "cycle", "identityReceipt", "source",
    "retainedSourceReceipts", "sharedUsage", "sourceOnly", "productionAdmission", "customerOwnershipAccepted",
    "financialMappingApproved", "certified", "registered", "enabled"]);
  const c = packet.cycle, i = packet.identityReceipt, s = packet.source, usage = packet.sharedUsage;
  exact(c, ["cycleId", "grantId", "grantRevision", "projectRef", "shop", "reportDate", "startedAt", "deadline",
    "authorizationRef", "appId", "installationId", "sourceReaderSha256", "sourceReaderEmissionSha256", "captureClosureSha256",
    "maxRequests", "maxResponseBytes", "maxTotalBytes", "maxActiveMs"]);
  exact(i, ["startedAt", "finishedAt", "querySha256", "requestBodySha256", "responseBodySha256", "httpStatus",
    "apiVersion", "shop", "appId", "installationId", "capabilities"]);
  exact(i.capabilities, ["read_orders", "write_orders", "read_all_orders", "read_customers", "read_products"]);
  exact(usage, ["requests", "responseBytes", "activeMs", "largestResponseBytes"]);
  if (packet.version !== 1 || packet.kind !== CUSTOMER_CYCLE_PACKET_KIND ||
      canonicalJson(c) !== canonicalJson(expectedCycle) ||
      !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(c.cycleId) ||
      !text(c.grantId) || !text(c.authorizationRef) || typeof c.grantRevision !== "string" ||
      !/^[1-9]\d{0,18}$/.test(c.grantRevision) || BigInt(c.grantRevision) > BigInt("9223372036854775807") ||
      c.projectRef !== "xnfjdbpjuaezxjgargto" || c.shop !== "mullybox-store.myshopify.com" ||
      !/^\d{4}-\d{2}-\d{2}$/.test(c.reportDate) ||
      new Date(`${c.reportDate}T00:00:00Z`).toISOString().slice(0, 10) !== c.reportDate ||
      c.sourceReaderSha256 !== CUSTOMER_SOURCE_READER_SHA256 ||
      !hash(c.sourceReaderEmissionSha256) || !hash(c.captureClosureSha256) ||
      c.sourceReaderEmissionSha256 === oldBundle || c.captureClosureSha256 === oldBundle ||
      c.maxRequests !== 65 || c.maxResponseBytes !== 1048576 || c.maxTotalBytes !== 16777216 || c.maxActiveMs !== 120000 ||
      !/^gid:\/\/shopify\/App\/[1-9]\d*$/.test(c.appId) ||
      !/^gid:\/\/shopify\/AppInstallation\/[1-9]\d*$/.test(c.installationId)) fail("cycle");
  if (instant(c.deadline) <= instant(c.startedAt) || at(c.deadline) - at(c.startedAt) > 300000 ||
      instant(s.startedAt) < instant(c.startedAt) || instant(s.capturedAt) >= instant(c.deadline) ||
      instant(s.capturedAt) < instant(s.startedAt) || at(s.capturedAt) - at(s.startedAt) >= 120000 ||
      instant(s.scope.expiresAt) > instant(c.deadline) || instant(s.capturedAt) >= instant(s.scope.expiresAt) ||
      s.scope.projectRef !== c.projectRef || s.scope.shop !== c.shop ||
      s.scope.authorizationRef !== c.authorizationRef || s.scope.appId !== c.appId ||
      s.scope.installationId !== c.installationId ||
      !Number.isSafeInteger(s.scope.maxRequests) || s.scope.maxRequests < s.requests || s.scope.maxRequests > 64 ||
      !Number.isSafeInteger(s.scope.maxBytes) || s.scope.maxBytes < s.responseBytes || s.scope.maxBytes > c.maxTotalBytes)
    fail("source_cycle");
  if (i.httpStatus !== 200 || i.apiVersion !== "2026-07" || i.shop !== c.shop ||
      i.appId !== c.appId || i.installationId !== c.installationId ||
      i.querySha256 !== sha(CUSTOMER_PURCHASE_ACCESS_QUERY) ||
      i.requestBodySha256 !== sha(JSON.stringify({ query: CUSTOMER_PURCHASE_ACCESS_QUERY, variables: {} })) ||
      !hash(i.responseBodySha256) || instant(i.startedAt) < instant(s.startedAt) ||
      instant(i.finishedAt) < instant(i.startedAt) || instant(i.finishedAt) > instant(s.capturedAt) ||
      i.capabilities.read_orders !== true || i.capabilities.read_all_orders !== true ||
      i.capabilities.read_customers !== true || i.capabilities.read_products !== true ||
      typeof i.capabilities.write_orders !== "boolean") fail("identity");
  const { digest, ...payload } = s;
  if (s.schemaVersion !== CUSTOMER_PURCHASE_SCHEMA || evidenceDigest(payload) !== digest ||
      packet.bindingSha256 !== evidenceDigest(c) || packet.identitySha256 !== evidenceDigest(i) ||
      s.productionAdmission !== false || packet.sourceOnly !== true ||
      [packet.productionAdmission, packet.customerOwnershipAccepted, packet.financialMappingApproved,
        packet.certified, packet.registered, packet.enabled].some(v => v !== false) ||
      !Array.isArray(packet.retainedSourceReceipts) || packet.retainedSourceReceipts.length ||
      !Array.isArray(s.members) || !s.members.length ||
      s.members.some(m => !Array.isArray(m.sources) || m.sources.some(row => row.hydration !== "read")))
    fail("source_provenance");
  // The B1 capture owns a finite source budget. This constructor never creates
  // an additional customer allowance; the preflight is already in s.requests.
  if (!Number.isSafeInteger(usage.requests) || usage.requests < s.requests || usage.requests > c.maxRequests ||
      !Number.isSafeInteger(usage.responseBytes) || usage.responseBytes < s.responseBytes ||
      usage.responseBytes > c.maxTotalBytes || !Number.isSafeInteger(usage.activeMs) ||
      usage.activeMs < at(s.capturedAt) - at(s.startedAt) || usage.activeMs >= c.maxActiveMs ||
      usage.activeMs > at(c.deadline) - at(c.startedAt) ||
      !Number.isSafeInteger(usage.largestResponseBytes) || usage.largestResponseBytes < 1 ||
      usage.largestResponseBytes > c.maxResponseBytes || usage.largestResponseBytes > usage.responseBytes ||
      !Number.isSafeInteger(s.requests) || s.requests < 1 || s.requests > usage.requests ||
      !Number.isSafeInteger(s.responseBytes) || s.responseBytes < 1) fail("shared_budget");
}

/** Pure default-off constructor. It records actual provenance, not credentials,
 * operating authority, whole-store history or a completed customer generation.
 * The consumer separately checks catalog facts and every source/target order.
 */
export function compileCustomerCyclePacket(input: {
  source: CustomerPurchaseObservation; cycle: CustomerSourceCycle;
  identityReceipt: CustomerCycleIdentityReceipt; sharedUsage: CustomerCyclePacket["sharedUsage"];
  definition: Pick<ScopedCustomerPurchaseBinding, "definition" | "businessEvidence">;
}): { packetJson: string; binding: ScopedCustomerPurchaseBinding & { cycle: CustomerSourceCycle } } {
  exact(input, ["source", "cycle", "identityReceipt", "sharedUsage", "definition"]);
  exact(input.definition, ["definition", "businessEvidence"]);
  const packet: CustomerCyclePacket = {
    version: 1, kind: CUSTOMER_CYCLE_PACKET_KIND, bindingSha256: evidenceDigest(input.cycle),
    identitySha256: evidenceDigest(input.identityReceipt), cycle: structuredClone(input.cycle),
    identityReceipt: structuredClone(input.identityReceipt), source: structuredClone(input.source),
    retainedSourceReceipts: [], sharedUsage: structuredClone(input.sharedUsage),
    sourceOnly: true, productionAdmission: false, customerOwnershipAccepted: false,
    financialMappingApproved: false, certified: false, registered: false, enabled: false,
  };
  validateCustomerCyclePacket(packet, input.cycle);
  const packetJson = JSON.stringify(packet);
  if (Buffer.byteLength(packetJson) > 16777216) fail("packet_budget");
  const s = packet.source, c = packet.cycle;
  return { packetJson, binding: {
    version: 1, packetSha256: sha(packetJson), sourceDigest: s.digest,
    bindingSha256: packet.bindingSha256, identitySha256: packet.identitySha256,
    projectRef: c.projectRef, shop: c.shop, authorizationRef: c.authorizationRef,
    appId: c.appId, installationId: c.installationId, startedAt: s.startedAt, capturedAt: s.capturedAt,
    ...structuredClone(input.definition), cycle: structuredClone(c),
  } };
}
