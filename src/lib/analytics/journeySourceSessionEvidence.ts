import { key, nyDate, type Row } from "./primitives";
import { verifyCheckoutContext } from "./checkout-context";
import { nativeSourceSessionId, sourceSessionVersion } from "./journeySourceSessionContract";
import type { IdentityEvidence } from "./identity";
import type { SourceSessionEntry, SessionEntryRelation } from "./sessionEntryInput";
import type { CheckoutEvidence } from "./sessions";
import { nativeEntryFilterSha256 } from "./journeyNativeSessionRead";

export type SourceSessionReceipt = { nativeSessionId: string; capturedAt: string; conflicted: boolean;
  entryUuid: string; sourceStartedAt: string; sourceReadSha256: string; paidLinkUntil: string;
  filterSha256: string; filterResults: (boolean | null)[];
  subjectId: string; permissionEvidenceRef: string; approvalRef: string; validFrom: string; expiresAt: string; removed: boolean };
export type NativeSourceEntry = { project: string; nativeSessionId: string; startedAt: string; endedAt: string;
  entryUuid: string; entryTimestamp: string; entryNativeSessionId: string; entryMatches: number;
  filterSha256: string; filterResults: (boolean | null)[] };
const instant = (v: string) => { nyDate(v); return v.replace(/(?:\.(\d+))?Z$/,
  (_, d: string | undefined) => `.${(d ?? "").padEnd(6, "0")}Z`); };
const ref = (v: string) => typeof v === "string" && !!v.trim() && v.length <= 512;
const filters = (v: unknown): v is (boolean | null)[] => Array.isArray(v) && v.length === 6 && v.every(x=>x === null || typeof x === "boolean");
function afterDays(at: string, days: number) {
  const precise = instant(at), micros = precise.match(/\.(\d{6})Z$/)![1].slice(3);
  return new Date(Date.parse(at) + days * 86400000).toISOString().replace(/Z$/, `${micros}Z`);
}

/** A browser receipt alone is not an entry. Independently read native ID,
 * start/end and the unique native start-event UUID are all required here. */
export function admitSourceSessionReceipt(receipt: SourceSessionReceipt, native: NativeSourceEntry, scope: {
  project: string; mappingVersion: string; actionNamespace: string; nativeReadRef: string;
  authorityReadRef: string; capturedAt: string; asOf: string; maxReadAgeSeconds: number;
}) {
  if (scope.project !== "353503" || native.project !== scope.project ||
    ![scope.mappingVersion, scope.actionNamespace, scope.nativeReadRef, scope.authorityReadRef].every(ref) ||
    !Number.isSafeInteger(scope.maxReadAgeSeconds) || scope.maxReadAgeSeconds < 1 || scope.maxReadAgeSeconds > 3600 ||
    instant(scope.capturedAt) > instant(scope.asOf) ||
    Date.parse(scope.asOf) - Date.parse(scope.capturedAt) > scope.maxReadAgeSeconds * 1000)
    throw new Error("source_entry_read_scope");
  if (!nativeSourceSessionId.test(native.nativeSessionId) || !nativeSourceSessionId.test(receipt.nativeSessionId) ||
    native.nativeSessionId !== receipt.nativeSessionId || native.entryNativeSessionId !== native.nativeSessionId ||
    !nativeSourceSessionId.test(native.entryUuid) || receipt.entryUuid !== native.entryUuid ||
    instant(receipt.sourceStartedAt) !== instant(native.startedAt) ||
    !/^[a-f0-9]{64}$/.test(receipt.sourceReadSha256) ||
    receipt.filterSha256 !== nativeEntryFilterSha256 || native.filterSha256 !== nativeEntryFilterSha256 ||
    !filters(receipt.filterResults) || !filters(native.filterResults) ||
    JSON.stringify(receipt.filterResults) !== JSON.stringify(native.filterResults) ||
    instant(receipt.paidLinkUntil) !== instant(afterDays(native.startedAt,9)) || native.entryMatches !== 1 ||
    instant(native.startedAt) !== instant(native.entryTimestamp) || instant(native.endedAt) < instant(native.startedAt) ||
    instant(native.endedAt) > instant(scope.capturedAt)) return { state: "unavailable" as const, reason: "native_entry_unverified" };
  if (!/^[a-f0-9]{64}$/.test(receipt.subjectId) || !ref(receipt.approvalRef) ||
    receipt.permissionEvidenceRef !== `explicit-browser-choice:${sourceSessionVersion}:${receipt.subjectId}` ||
    typeof receipt.conflicted !== "boolean" || typeof receipt.removed !== "boolean") throw new Error("source_entry_authority_shape");
  if (receipt.removed || receipt.conflicted) return { state: "unavailable" as const, reason: "authority_unavailable" };
  if (instant(receipt.expiresAt) <= instant(receipt.validFrom) ||
    Date.parse(receipt.expiresAt) - Date.parse(receipt.validFrom) > 86400000 ||
    instant(receipt.capturedAt) < instant(receipt.validFrom) || instant(receipt.capturedAt) >= instant(receipt.expiresAt) ||
    instant(receipt.capturedAt) > instant(scope.capturedAt)) throw new Error("source_entry_authority_clock");
  // Allow on an existing visit cannot retroactively admit its earlier entry.
  if (instant(native.startedAt) < instant(receipt.validFrom) || instant(native.startedAt) >= instant(receipt.expiresAt) ||
    instant(native.startedAt) > instant(receipt.capturedAt))
    return { state: "unavailable" as const, reason: "entry_outside_permission" };
  const evidence = `${scope.authorityReadRef}:${receipt.nativeSessionId}`;
  const entry: SourceSessionEntry = { sourceSessionId: native.nativeSessionId, startedAt: native.startedAt,
    endedAt: native.endedAt, clock: "source_session_start", sourceRecordRef: `posthog:${scope.project}:${native.entryUuid}`,
    identityNamespace: "lean_subject", identifier: receipt.subjectId, subjectEvidenceRef: evidence,
    filterResults: [...native.filterResults] };
  const relation: SessionEntryRelation = { actionNamespace: scope.actionNamespace, actionSessionId: native.nativeSessionId,
    sourceSessionId: native.nativeSessionId, identityNamespace: "lean_subject", identifier: receipt.subjectId, evidenceRef: evidence };
  const permission: IdentityEvidence = { namespace: "lean_subject", identifier: receipt.subjectId, customerId: null,
    from: receipt.validFrom, to: receipt.expiresAt, type: "analytics_permission_authority",
    evidenceRef: receipt.permissionEvidenceRef, mappingVersion: scope.mappingVersion,
    resolution: "unresolved", consent: "permitted", removal: "active" };
  return { state: "eligible" as const, entry, relation, permission,
    nativeReadRef: scope.nativeReadRef, authorityReadRef: scope.authorityReadRef, capturedAt: scope.capturedAt };
}

export type SourcePaidReceipt = { orderGid: string; cartToken: string; nativeSessionId: string; payloadSha256: string;
  deliveryId: string; shop: string; topic: string; verificationVersion: string; webhookKeySha256: string;
  orderCreatedAt: string; orderProcessedAt: string | null; orderUpdatedAt: string | null; receivedAt: string;
  cartCapturedAt: string; contextToken: string; subjectId: string; permissionEvidenceRef: string;
  paidLinkUntil: string;
  removed: boolean; conflicted: boolean };
/** Exact order/cart receipt plus independent successful-transaction commerce.
 * No root processed/updated clock can supply paid_at. No customer is assigned. */
export function sourceSessionPaidEvidence(receipt: SourcePaidReceipt, admission: ReturnType<typeof admitSourceSessionReceipt>,
  order: Row, scope: { project: string; sessionVersion: string; receiptReadRef: string; orderEvidenceRef: string;
    capturedAt: string; asOf: string; maxReadAgeSeconds: number; webhookKeySha256: string }, secret: string): Omit<CheckoutEvidence, "publication"> | null {
  if (admission.state !== "eligible" || scope.project !== "353503" ||
    ![scope.sessionVersion, scope.receiptReadRef, scope.orderEvidenceRef].every(ref) ||
    !Number.isSafeInteger(scope.maxReadAgeSeconds) || scope.maxReadAgeSeconds < 1 || scope.maxReadAgeSeconds > 3600 ||
    instant(scope.capturedAt) > instant(scope.asOf) || Date.parse(scope.asOf) - Date.parse(scope.capturedAt) > scope.maxReadAgeSeconds * 1000)
    return null;
  if (instant(admission.capturedAt) > instant(scope.asOf) ||
    Date.parse(scope.asOf) - Date.parse(admission.capturedAt) > scope.maxReadAgeSeconds * 1000) return null;
  const id = receipt.orderGid.match(/^gid:\/\/shopify\/Order\/([1-9]\d{0,24})$/)?.[1];
  if (!id || receipt.shop !== "mullybox-store.myshopify.com" || receipt.topic !== "orders/paid" ||
    receipt.verificationVersion !== "shopify-hmac-sha256:source-session-v3" ||
    !/^[a-f0-9]{64}$/.test(receipt.payloadSha256) || !nativeSourceSessionId.test(receipt.deliveryId) ||
    !/^[a-f0-9]{64}$/.test(receipt.webhookKeySha256) || receipt.webhookKeySha256 !== scope.webhookKeySha256 ||
    receipt.removed !== false || receipt.conflicted !== false || receipt.nativeSessionId !== admission.entry.sourceSessionId ||
    receipt.subjectId !== admission.entry.identifier || receipt.permissionEvidenceRef !== admission.permission.evidenceRef ||
    order.order_id !== key(receipt.shop, id) || order.shop_id !== receipt.shop || order.eligibility_status !== "eligible" ||
    typeof order.paid_at !== "string" || typeof order.created_at !== "string") return null;
  for (const at of [receipt.orderCreatedAt, receipt.receivedAt, receipt.cartCapturedAt, order.created_at, order.paid_at]) nyDate(at);
  if (instant(order.created_at) !== instant(receipt.orderCreatedAt) ||
    instant(order.paid_at) < instant(admission.entry.startedAt) || instant(order.paid_at) < instant(receipt.cartCapturedAt) ||
    instant(order.paid_at) > instant(receipt.receivedAt) || instant(receipt.receivedAt) > instant(scope.capturedAt) ||
    instant(receipt.cartCapturedAt) < instant(admission.permission.from) ||
    instant(receipt.cartCapturedAt) >= instant(admission.permission.to!) ||
    instant(receipt.paidLinkUntil) !== instant(afterDays(admission.entry.startedAt,9)) ||
    instant(order.paid_at) >= instant(afterDays(admission.entry.startedAt,7)) ||
    instant(receipt.receivedAt) >= instant(receipt.paidLinkUntil)) return null;
  const context = verifyCheckoutContext(receipt.contextToken, { project: scope.project, shop: receipt.shop,
    checkoutId: receipt.cartToken, serverSubject: receipt.subjectId, analyticsPermitted: true,
    now: Math.floor(Date.parse(receipt.cartCapturedAt) / 1000) }, secret);
  if (!context || context.sessionId !== receipt.nativeSessionId) return null;
  return { orderId: String(order.order_id), sessionKey: key(scope.project, scope.sessionVersion, receipt.nativeSessionId),
    method: "verified_first_party_context", evidenceRef: `${scope.receiptReadRef}:${receipt.payloadSha256}:${scope.orderEvidenceRef}` };
}
