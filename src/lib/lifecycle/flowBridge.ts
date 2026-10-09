/**
 * Shopify Flow -> MyMully bridge for Shopify-native subscription contracts.
 *
 * Shopify Subscriptions (first-party) owns native outfit contracts, so no
 * custom app can list them. Shopify Flow can: its subscription triggers and
 * "Get subscription contract data" action cover first-party contracts. The
 * templates in docs/lifecycle-native-flow-bridge.md send ONLY Shopify IDs,
 * statuses and timestamps. This module validates those bodies strictly and
 * builds eligibility evidence. No email, address, payment or raw body is kept.
 */
import { createHash, timingSafeEqual } from "node:crypto";
import { shopifyId } from "@/lib/klaviyo/orderMatching";
import type { ContractEvidence, CoverageEvidence, PaidCycleEvidence } from "@/lib/klaviyo/eligibility";
import type { CustomerOrderHistory } from "./orderHistory";

export const FLOW_SECRET_HEADER = "x-mully-flow-secret";
export const FLOW_SNAPSHOT_LIMIT = 100; // Flow "Get data" returns at most 100 records per run.

export type FlowEventKind =
  | "contract_created" | "contract_updated" | "billing_success" | "billing_failure"
  | "contract_snapshot" | "snapshot_run";
const KINDS = new Set<FlowEventKind>([
  "contract_created", "contract_updated", "billing_success", "billing_failure", "contract_snapshot", "snapshot_run",
]);
export type ContractStatus = ContractEvidence["status"];
const STATUSES: Record<string, ContractStatus> = {
  ACTIVE: "active", PAUSED: "paused", CANCELLED: "cancelled", EXPIRED: "expired", FAILED: "failed",
};

export interface FlowEvent {
  idempotencyKey: string;
  kind: FlowEventKind;
  occurredAt: string;
  runId: string | null;
  contractId: string | null;
  customerId: string | null;
  orderId: string | null;
  status: ContractStatus | null;
  snapshotCount: number | null;
}

/** Constant-time shared-secret check. Secrets shorter than 32 chars are refused. */
export function verifyFlowSecret(header: string | null, secret: string | undefined): boolean {
  if (!secret || secret.length < 32 || !header) return false;
  const a = Buffer.from(header, "utf8"), b = Buffer.from(secret, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

type Bag = Record<string, unknown>;
const ALLOWED_KEYS = new Set(["version", "kind", "occurredAt", "runId", "contractId", "customerId", "orderId", "status", "count"]);
const MAX_SKEW_MS = 7 * 86_400_000;

export function parseFlowEvent(body: unknown, now = new Date()): { ok: true; event: FlowEvent } | { ok: false; reason: string } {
  if (body === null || typeof body !== "object" || Array.isArray(body)) return { ok: false, reason: "invalid_body" };
  const b = body as Bag;
  // Reject unexpected fields so a template change cannot smuggle in PII.
  if (Object.keys(b).some((k) => !ALLOWED_KEYS.has(k))) return { ok: false, reason: "unexpected_field" };
  if (b.version !== 1) return { ok: false, reason: "unsupported_version" };
  if (typeof b.kind !== "string" || !KINDS.has(b.kind as FlowEventKind)) return { ok: false, reason: "unknown_kind" };
  const kind = b.kind as FlowEventKind;
  const at = typeof b.occurredAt === "string" ? Date.parse(b.occurredAt) : NaN;
  if (!Number.isFinite(at) || Math.abs(now.getTime() - at) > MAX_SKEW_MS) return { ok: false, reason: "occurred_at_invalid" };
  const runId = b.runId == null ? null : typeof b.runId === "string" && /^[A-Za-z0-9:_.-]{8,80}$/.test(b.runId) ? b.runId : undefined;
  if (runId === undefined) return { ok: false, reason: "run_id_invalid" };
  const id = (v: unknown, r: string) => (v == null || v === "" ? null : shopifyId(v, r) ?? undefined);
  const contractId = id(b.contractId, "SubscriptionContract"), customerId = id(b.customerId, "Customer"), orderId = id(b.orderId, "Order");
  if (contractId === undefined || customerId === undefined || orderId === undefined) return { ok: false, reason: "id_invalid" };
  const status = b.status == null || b.status === "" ? null : STATUSES[String(b.status).toUpperCase()] ?? undefined;
  if (status === undefined) return { ok: false, reason: "status_invalid" };
  let snapshotCount: number | null = null;
  if (kind === "snapshot_run") {
    if (!runId || typeof b.count !== "number" || !Number.isSafeInteger(b.count) || b.count < 0) return { ok: false, reason: "snapshot_run_invalid" };
    if (contractId || customerId || orderId || status) return { ok: false, reason: "snapshot_run_invalid" };
    snapshotCount = b.count;
  } else {
    if (b.count != null) return { ok: false, reason: "unexpected_count" };
    if (!contractId || !customerId) return { ok: false, reason: "contract_identity_required" };
    if (kind === "contract_snapshot" && (!runId || !status)) return { ok: false, reason: "snapshot_invalid" };
    if ((kind === "contract_created" || kind === "contract_updated") && !status) return { ok: false, reason: "status_required" };
    if (kind === "billing_success" && !orderId) return { ok: false, reason: "order_required" };
  }
  const occurredAt = new Date(at).toISOString();
  const idempotencyKey = createHash("sha256")
    .update(JSON.stringify(["mully-flow-v1", kind, occurredAt, runId, contractId, customerId, orderId, status, snapshotCount]))
    .digest("hex");
  return { ok: true, event: { idempotencyKey, kind, occurredAt, runId, contractId, customerId, orderId, status, snapshotCount } };
}

/** Row shape persisted in lifecycle_native_subscription_events (IDs only). */
export const toRow = (e: FlowEvent) => ({
  idempotency_key: e.idempotencyKey, kind: e.kind, occurred_at: e.occurredAt, run_id: e.runId,
  shopify_contract_id: e.contractId, shopify_customer_id: e.customerId, shopify_order_id: e.orderId,
  status: e.status, snapshot_count: e.snapshotCount,
});
export type FlowRow = ReturnType<typeof toRow>;
export const fromRow = (r: FlowRow): FlowEvent => ({
  idempotencyKey: r.idempotency_key, kind: r.kind as FlowEventKind, occurredAt: r.occurred_at, runId: r.run_id,
  contractId: r.shopify_contract_id, customerId: r.shopify_customer_id, orderId: r.shopify_order_id,
  status: r.status as ContractStatus | null, snapshotCount: r.snapshot_count,
});

const HOUR = 3_600_000;

/** Newest snapshot run within 48h whose per-contract rows all arrived. */
export function latestCompleteSnapshot(events: FlowEvent[], now = new Date()) {
  const runs = events.filter((e) => e.kind === "snapshot_run" && e.runId)
    .sort((a, b) => Date.parse(b.occurredAt) - Date.parse(a.occurredAt));
  for (const run of runs) {
    const age = now.getTime() - Date.parse(run.occurredAt);
    if (!(age >= 0 && age <= 48 * HOUR)) continue;
    if (run.snapshotCount === null || run.snapshotCount >= FLOW_SNAPSHOT_LIMIT) return null; // Possibly truncated.
    const rows = events.filter((e) => e.kind === "contract_snapshot" && e.runId === run.runId);
    const contracts = new Set(rows.map((r) => r.contractId));
    if (contracts.size !== run.snapshotCount || rows.length !== run.snapshotCount) continue;
    return { run, rows };
  }
  return null;
}

export interface NativeEvidence {
  contracts: ContractEvidence[];
  coverage: CoverageEvidence[];
  cycles: PaidCycleEvidence[];
  holds: string[];
}

/**
 * Native evidence for one customer: contract status, coverage and paid cycles.
 * Coverage is complete only with a fresh complete snapshot AND a complete
 * storewide order history in which every native order maps to a known contract.
 */
export function buildNativeEvidence(customer: string, events: FlowEvent[], history: CustomerOrderHistory, now = new Date()): NativeEvidence {
  const customerId = shopifyId(customer, "Customer");
  const holds: string[] = [];
  const mine = events.filter((e) => e.customerId === customerId && e.contractId);
  const owners = new Map<string, string>();
  for (const e of events) {
    if (!e.contractId || !e.customerId) continue;
    if (owners.has(e.contractId) && owners.get(e.contractId) !== e.customerId) holds.push("native_contract_identity_conflict");
    owners.set(e.contractId, e.customerId);
  }
  const contracts: ContractEvidence[] = mine.filter((e) => e.status && e.kind !== "billing_success" && e.kind !== "billing_failure")
    .map((e) => ({ provider: "shopify_native", contractId: e.contractId!, customerId: e.customerId!, status: e.status!, observedAt: e.occurredAt }));
  const orderContract = new Map<string, string>();
  for (const e of mine) {
    if (!e.orderId || !(e.kind === "billing_success" || e.kind === "contract_created")) continue;
    if (orderContract.has(e.orderId) && orderContract.get(e.orderId) !== e.contractId) holds.push("native_order_contract_conflict");
    orderContract.set(e.orderId, e.contractId!);
  }
  const snapshot = latestCompleteSnapshot(events, now);
  if (!snapshot) holds.push("native_snapshot_unavailable");
  if (!history.complete || history.customerId !== customerId) holds.push("native_order_history_incomplete");
  const nativeOrders = history.subscriptionOrders.filter((o) => o.provider === "shopify_native");
  for (const o of nativeOrders) if (!orderContract.has(o.orderId)) holds.push("native_order_without_contract_event");
  const cycles: PaidCycleEvidence[] = nativeOrders.filter((o) => o.qualifiesAsPaidCycle && orderContract.has(o.orderId))
    .map((o) => ({
      provider: "shopify_native", contractId: orderContract.get(o.orderId)!, customerId: customerId ?? "",
      cycleId: o.orderId, orderId: o.orderId, successful: true, paidAmountMinor: o.paidAmountMinor,
      refunded: false, cancelled: false, paidAt: o.paidAt, checkedAt: history.checkedAt,
    }));
  const uniqueHolds = [...new Set(holds)].sort();
  const complete = uniqueHolds.length === 0 && !!customerId;
  return {
    contracts,
    coverage: customerId ? [{
      provider: "shopify_native", customerId, scope: complete ? "all_customer_contracts" : "unknown", complete,
      // Coverage is only as fresh as the older of the snapshot and order read.
      checkedAt: snapshot ? new Date(Math.min(Date.parse(snapshot.run.occurredAt), Date.parse(history.checkedAt))).toISOString() : history.checkedAt,
    }] : [],
    cycles,
    holds: uniqueHolds,
  };
}
