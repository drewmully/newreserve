import { createHash } from "node:crypto";
import { canonicalJson, evidenceDigest } from "./evidenceIntake";
import { nyDate } from "./primitives";
import { CUSTOMER_PURCHASE_ACCESS_QUERY, CUSTOMER_PURCHASE_SCHEMA } from "./customerScopedPurchaseSource";
import { CUSTOMER_SOURCE_READER_SHA256, type CustomerCyclePacket, type CustomerCycleIdentityReceipt } from "./customerScopedPurchasePacket";
import type { ScopedCustomerPurchaseBinding } from "./customerScopedPurchaseConsumer";

export const CUSTOMER_OPERATION_PACKET_KIND = "customer-one-operation-source-only-v1";
/** One real finite operator approval, never a source-cycle or advertising grant.
 * The operator verifies actual approval and emitted-file pins before reading.
 */
export type CustomerSourceOperation = {
  operationId: string; approvalRef: string; actorRef: string;
  projectRef: string; shop: string; reportDate: string;
  startedAt: string; deadline: string; authorizationRef: string;
  appId: string; installationId: string; sourceReaderSha256: typeof CUSTOMER_SOURCE_READER_SHA256;
  sourceReaderEmissionSha256: string; captureClosureSha256: string;
  maxRequests: 65; maxResponseBytes: 1048576; maxTotalBytes: 16777216; maxActiveMs: 120000;
};
export type CustomerOperationPacket = Omit<CustomerCyclePacket, "kind" | "cycle"> & {
  kind: typeof CUSTOMER_OPERATION_PACKET_KIND; operation: CustomerSourceOperation;
};
const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const hash = (v: unknown) => typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
const text = (v: unknown) => typeof v === "string" && v === v.trim() && v !== "UNSET" && v.length > 0 && v.length <= 512;
function fail(): never { throw new Error("customer_operation_packet_refused"); }
function exact(v: object, fields: string[]) {
  if (!v || typeof v !== "object" || Array.isArray(v) ||
      canonicalJson(Object.keys(v).sort()) !== canonicalJson([...fields].sort())) fail();
}
function at(s: string) { nyDate(s); return Date.parse(s); }
function instant(s: string) {
  nyDate(s);
  return s.replace(/(?:\.(\d+))?Z$/, (_, d: string | undefined) => `.${(d ?? "").padEnd(6, "0")}Z`);
}
export function validateCustomerSourceOperation(c: CustomerSourceOperation) {
  exact(c, ["operationId", "approvalRef", "actorRef", "projectRef", "shop", "reportDate", "startedAt", "deadline",
    "authorizationRef", "appId", "installationId", "sourceReaderSha256", "sourceReaderEmissionSha256", "captureClosureSha256",
    "maxRequests", "maxResponseBytes", "maxTotalBytes", "maxActiveMs"]);
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(c.operationId) ||
      ![c.approvalRef, c.actorRef, c.authorizationRef].every(text) ||
      c.projectRef !== "xnfjdbpjuaezxjgargto" || c.shop !== "mullybox-store.myshopify.com" ||
      !/^\d{4}-\d{2}-\d{2}$/.test(c.reportDate) ||
      new Date(`${c.reportDate}T00:00:00Z`).toISOString().slice(0, 10) !== c.reportDate ||
      nyDate(c.startedAt) <= c.reportDate ||
      c.sourceReaderSha256 !== CUSTOMER_SOURCE_READER_SHA256 ||
      !hash(c.sourceReaderEmissionSha256) || !hash(c.captureClosureSha256) ||
      [c.sourceReaderEmissionSha256, c.captureClosureSha256].includes("f86edbdd17b8c30b5baf0659171ac869e23f2b4a73f3660b4db7267a6b393f20") ||
      !/^gid:\/\/shopify\/App\/[1-9]\d*$/.test(c.appId) || !/^gid:\/\/shopify\/AppInstallation\/[1-9]\d*$/.test(c.installationId) ||
      c.maxRequests !== 65 || c.maxResponseBytes !== 1048576 || c.maxTotalBytes !== 16777216 || c.maxActiveMs !== 120000 ||
      instant(c.deadline) <= instant(c.startedAt) || at(c.deadline) - at(c.startedAt) > 300000) fail();
}
/** Pure provenance validation. Self-consistent JSON does not authorize a read,
 * registration or publication. The unchanged consumer validates every member.
 */
export function validateCustomerOperationPacket(p: CustomerOperationPacket, expected: CustomerSourceOperation) {
  exact(p, ["version", "kind", "bindingSha256", "identitySha256", "operation", "identityReceipt", "source",
    "retainedSourceReceipts", "sharedUsage", "sourceOnly", "productionAdmission", "customerOwnershipAccepted",
    "financialMappingApproved", "certified", "registered", "enabled"]);
  const c = p.operation, i = p.identityReceipt, s = p.source, u = p.sharedUsage;
  validateCustomerSourceOperation(c);
  exact(i, ["startedAt", "finishedAt", "querySha256", "requestBodySha256", "responseBodySha256", "httpStatus", "apiVersion",
    "shop", "appId", "installationId", "capabilities"]);
  exact(i.capabilities, ["read_orders", "write_orders", "read_all_orders", "read_customers", "read_products"]);
  exact(u, ["requests", "responseBytes", "activeMs", "largestResponseBytes"]);
  if (p.version !== 1 || p.kind !== CUSTOMER_OPERATION_PACKET_KIND || canonicalJson(c) !== canonicalJson(expected)) fail();
  if (instant(s.startedAt) < instant(c.startedAt) || instant(s.capturedAt) >= instant(c.deadline) ||
      instant(s.capturedAt) < instant(s.startedAt) || at(s.capturedAt) - at(s.startedAt) >= c.maxActiveMs ||
      instant(s.scope.expiresAt) > instant(c.deadline) || instant(s.capturedAt) >= instant(s.scope.expiresAt) ||
      s.scope.projectRef !== c.projectRef || s.scope.shop !== c.shop || s.scope.authorizationRef !== c.authorizationRef ||
      s.scope.appId !== c.appId || s.scope.installationId !== c.installationId ||
      !Number.isSafeInteger(s.scope.maxRequests) || s.scope.maxRequests < s.requests || s.scope.maxRequests > 64 ||
      !Number.isSafeInteger(s.scope.maxBytes) || s.scope.maxBytes < s.responseBytes || s.scope.maxBytes > c.maxTotalBytes) fail();
  if (i.httpStatus !== 200 || i.apiVersion !== "2026-07" || i.shop !== c.shop || i.appId !== c.appId ||
      i.installationId !== c.installationId || i.querySha256 !== sha(CUSTOMER_PURCHASE_ACCESS_QUERY) ||
      i.requestBodySha256 !== sha(JSON.stringify({ query: CUSTOMER_PURCHASE_ACCESS_QUERY, variables: {} })) ||
      !hash(i.responseBodySha256) || instant(i.startedAt) < instant(s.startedAt) ||
      instant(i.finishedAt) < instant(i.startedAt) || instant(i.finishedAt) > instant(s.capturedAt) ||
      i.capabilities.read_orders !== true || i.capabilities.read_all_orders !== true ||
      i.capabilities.read_customers !== true || i.capabilities.read_products !== true ||
      typeof i.capabilities.write_orders !== "boolean") fail();
  const { digest, ...body } = s;
  if (s.schemaVersion !== CUSTOMER_PURCHASE_SCHEMA || evidenceDigest(body) !== digest ||
      p.bindingSha256 !== evidenceDigest(c) || p.identitySha256 !== evidenceDigest(i) || s.productionAdmission !== false ||
      p.sourceOnly !== true || [p.productionAdmission, p.customerOwnershipAccepted, p.financialMappingApproved,
        p.certified, p.registered, p.enabled].some(v => v !== false) ||
      !Array.isArray(p.retainedSourceReceipts) || p.retainedSourceReceipts.length ||
      !Array.isArray(s.members) || !s.members.length || s.members.length > 4 ||
      s.members.some(m => !Array.isArray(m.sources) || m.sources.some(r => r.hydration !== "read"))) fail();
  if (!Number.isSafeInteger(s.requests) || s.requests < 1 || !Number.isSafeInteger(s.responseBytes) || s.responseBytes < 1 ||
      !Number.isSafeInteger(u.requests) || u.requests < s.requests || u.requests > c.maxRequests ||
      !Number.isSafeInteger(u.responseBytes) || u.responseBytes < s.responseBytes || u.responseBytes > c.maxTotalBytes ||
      !Number.isSafeInteger(u.activeMs) || u.activeMs < at(s.capturedAt) - at(s.startedAt) || u.activeMs >= c.maxActiveMs ||
      u.activeMs > at(c.deadline) - at(c.startedAt) || !Number.isSafeInteger(u.largestResponseBytes) ||
      u.largestResponseBytes < 1 || u.largestResponseBytes > c.maxResponseBytes || u.largestResponseBytes > u.responseBytes) fail();
}

export function compileCustomerOperationPacket(input: {
  source: CustomerOperationPacket["source"]; operation: CustomerSourceOperation;
  identityReceipt: CustomerCycleIdentityReceipt; sharedUsage: CustomerOperationPacket["sharedUsage"];
  definition: Pick<ScopedCustomerPurchaseBinding, "definition" | "businessEvidence">;
}): { packetJson: string; binding: ScopedCustomerPurchaseBinding & { operation: CustomerSourceOperation } } {
  exact(input, ["source", "operation", "identityReceipt", "sharedUsage", "definition"]);
  exact(input.definition, ["definition", "businessEvidence"]);
  const p: CustomerOperationPacket = { version: 1, kind: CUSTOMER_OPERATION_PACKET_KIND,
    bindingSha256: evidenceDigest(input.operation), identitySha256: evidenceDigest(input.identityReceipt),
    operation: structuredClone(input.operation), identityReceipt: structuredClone(input.identityReceipt),
    source: structuredClone(input.source), retainedSourceReceipts: [], sharedUsage: structuredClone(input.sharedUsage),
    sourceOnly: true, productionAdmission: false, customerOwnershipAccepted: false,
    financialMappingApproved: false, certified: false, registered: false, enabled: false };
  validateCustomerOperationPacket(p, input.operation);
  const packetJson = JSON.stringify(p), c = p.operation, s = p.source;
  if (Buffer.byteLength(packetJson) > 16777216) fail();
  return { packetJson, binding: { version: 1, packetSha256: sha(packetJson), sourceDigest: s.digest,
    bindingSha256: p.bindingSha256, identitySha256: p.identitySha256, projectRef: c.projectRef, shop: c.shop,
    authorizationRef: c.authorizationRef, appId: c.appId, installationId: c.installationId,
    startedAt: s.startedAt, capturedAt: s.capturedAt, ...structuredClone(input.definition), operation: structuredClone(c) } };
}
