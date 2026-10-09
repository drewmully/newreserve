/**
 * Audit-only lifecycle decisions over normalized, authoritative evidence.
 * These are NOT raw Shopify/Loop parsers or a dispatcher. Callers must obtain
 * complete reads from the correct owning sources, not infer coverage from an
 * empty query, a webhook receipt, a profile property, or a push timestamp.
 * No I/O, consent/profile changes, environment switches, or customer sends.
 */
import { createHash } from "node:crypto";
import { classifyPaidOrder, matchOrderDelivery, shopifyId } from "./orderMatching";

export type Provider = "loop" | "shopify_native";
export interface ContractEvidence {
  provider: Provider;
  contractId: string;
  customerId: string;
  status: "active" | "paused" | "cancelled" | "expired" | "failed" | "unknown";
  observedAt: string;
}
export interface CoverageEvidence {
  provider: Provider;
  customerId: string;
  scope: "all_customer_contracts" | "owned_app_only" | "unknown";
  complete: boolean;
  checkedAt: string;
}
export interface MembershipDecision {
  customerId: string | null;
  activeVerified: boolean;
  nonmemberVerified: boolean;
  activeContractKeys: string[];
  activeContractValidUntil: Record<string, string>;
  evaluatedAt: string;
  holds: string[];
}
const HOUR = 3_600_000;
const validKey = (v: unknown): v is string => typeof v === "string" &&
  v.length > 0 && v.length <= 200 && v === v.trim();
const providerValid = (p: unknown): p is Provider => p === "loop" || p === "shopify_native";
const contractKey = (p: Provider, id: string) => JSON.stringify([p, id]);
const fresh = (at: string, now: Date, maxAge: number) => {
  const age = now.getTime() - Date.parse(at);
  return Number.isFinite(age) && age >= 0 && age <= maxAge;
};
const unique = (values: string[]) => [...new Set(values)].sort();

export function reconcileMembership(
  customer: string,
  contracts: ContractEvidence[],
  coverage: CoverageEvidence[],
  now = new Date(),
): MembershipDecision {
  const customerId = shopifyId(customer, "Customer");
  const result: MembershipDecision = {
    customerId, activeVerified: false, nonmemberVerified: false, activeContractKeys: [],
    activeContractValidUntil: {}, evaluatedAt: Number.isFinite(now.getTime()) ? now.toISOString() : "", holds: [],
  };
  if (!customerId || !Number.isFinite(now.getTime())) {
    result.holds.push("invalid_customer_or_clock"); return result;
  }
  const latest = new Map<string, ContractEvidence>();
  const owners = new Map<string, string>();
  for (const row of contracts) {
    const owner = shopifyId(row.customerId, "Customer");
    if (!providerValid(row.provider) || !validKey(row.contractId) || !owner ||
      !Number.isFinite(Date.parse(row.observedAt))) {
      result.holds.push("invalid_contract_evidence"); continue;
    }
    const key = contractKey(row.provider, row.contractId);
    if (owners.has(key) && owners.get(key) !== owner) result.holds.push("contract_identity_conflict");
    owners.set(key, owner);
    if (owner !== customerId) { result.holds.push("customer_mismatch"); continue; }
    const previous = latest.get(key);
    if (previous && Date.parse(previous.observedAt) === Date.parse(row.observedAt) &&
      previous.status !== row.status) result.holds.push("conflicting_contract_snapshot");
    if (!previous || Date.parse(row.observedAt) > Date.parse(previous.observedAt)) latest.set(key, row);
  }
  const integrityHold = result.holds.length > 0;
  for (const [key, row] of latest) {
    if (!fresh(row.observedAt, now, 48 * HOUR)) result.holds.push("stale_contract_evidence");
    else if (row.status === "active") {
      result.activeContractKeys.push(key);
      result.activeContractValidUntil[key] = new Date(Date.parse(row.observedAt) + 48 * HOUR).toISOString();
    }
    else if (!["cancelled", "expired"].includes(row.status)) result.holds.push("nonterminal_contract_state");
  }
  result.activeContractKeys.sort();
  // One fresh positive contract proves active membership. Incomplete negative
  // coverage cannot erase that evidence, unless identity/snapshot integrity fails.
  result.activeVerified = !integrityHold && result.activeContractKeys.length > 0;
  for (const provider of ["loop", "shopify_native"] as const) {
    const entries = coverage.filter(c => c.provider === provider && shopifyId(c.customerId, "Customer") === customerId);
    const newest = [...entries].sort((a,b)=>Date.parse(b.checkedAt)-Date.parse(a.checkedAt))[0];
    if (!newest || !fresh(newest.checkedAt, now, 48 * HOUR) ||
      newest.scope !== "all_customer_contracts" || newest.complete !== true) {
      result.holds.push(`${provider}_coverage_unverified`);
    }
    if (newest && entries.some(c=>c.checkedAt===newest.checkedAt &&
      (c.complete!==newest.complete || c.scope!==newest.scope))) result.holds.push("conflicting_coverage_snapshot");
  }
  result.holds = unique(result.holds);
  result.nonmemberVerified = !result.activeVerified && result.activeContractKeys.length === 0 && result.holds.length === 0;
  return result;
}

const currentActiveKeys = (m: MembershipDecision, now: Date) =>
  m.activeVerified && fresh(m.evaluatedAt, now, 5 * 60_000) ?
    m.activeContractKeys.filter(k => Date.parse(m.activeContractValidUntil[k]) >= now.getTime()) : [];

export interface PaidCycleEvidence {
  provider: Provider;
  contractId: string;
  customerId: string;
  cycleId: string;
  orderId: string;
  successful: boolean;
  paidAmountMinor: number;
  refunded: boolean;
  cancelled: boolean;
  paidAt: string;
  checkedAt: string;
}
export interface BillingHistoryCoverage {
  customerId: string;
  complete: boolean;
  checkedAt: string;
}

export function verifyPaidCycles(
  membership: MembershipDecision,
  cycles: PaidCycleEvidence[],
  history: BillingHistoryCoverage,
  now = new Date(),
) {
  const holds: string[] = [];
  const activeKeys = currentActiveKeys(membership, now);
  if (!activeKeys.length) holds.push("active_membership_unverified");
  if (!membership.customerId || shopifyId(history.customerId, "Customer") !== membership.customerId ||
    history.complete !== true || !fresh(history.checkedAt, now, 5 * 60_000)) holds.push("billing_history_unverified");
  const latest = new Map<string, PaidCycleEvidence>();
  const orderCycle = new Map<string, string>();
  for (const row of cycles) {
    const orderId = shopifyId(row.orderId, "Order");
    if (!providerValid(row.provider) || !validKey(row.contractId) || !validKey(row.cycleId) || !orderId ||
      shopifyId(row.customerId, "Customer") !== membership.customerId) {
      holds.push("billing_identity_unverified"); continue;
    }
    const key = JSON.stringify([row.provider, row.contractId, row.cycleId]);
    const previous = latest.get(key);
    if (!fresh(row.checkedAt, now, 5 * 60_000)) { holds.push("billing_state_stale"); continue; }
    if (previous && Date.parse(row.checkedAt) === Date.parse(previous.checkedAt) &&
      JSON.stringify(row) !== JSON.stringify(previous)) holds.push("conflicting_cycle_snapshot");
    if (!previous || Date.parse(row.checkedAt) > Date.parse(previous.checkedAt)) latest.set(key, row);
  }
  const perContract = new Map<string, number>();
  for (const [key, row] of latest) {
    // Explicit booleans, positive integer cents, and completed (not future)
    // payments only. Refund/replacement/free orders cannot earn a cycle.
    if (row.successful !== true || row.refunded !== false || row.cancelled !== false ||
      !Number.isSafeInteger(row.paidAmountMinor) || row.paidAmountMinor <= 0 ||
      !Number.isFinite(Date.parse(row.paidAt)) || Date.parse(row.paidAt) > now.getTime()) continue;
    const order = shopifyId(row.orderId, "Order")!;
    if (orderCycle.has(order) && orderCycle.get(order) !== key) holds.push("order_used_for_multiple_cycles");
    orderCycle.set(order, key);
    const contract = contractKey(row.provider, row.contractId);
    perContract.set(contract, (perContract.get(contract) ?? 0) + 1);
  }
  // Conservative tenure interpretation: two completed cycles on one active
  // contract, never two simultaneous first orders on different contracts.
  const completed = Math.max(0, ...activeKeys.map(k=>perContract.get(k) ?? 0));
  return { billingCyclesVerified: holds.length === 0, completedBillingCycles: holds.length ? null : completed,
    vipVerified: holds.length === 0 && completed >= 2, holds: unique(holds) };
}

export interface ServiceEvidence {
  customerId: string;
  complete: boolean;
  allChannels: boolean;
  checkedAt: string;
  unresolvedCount: number; // Includes snoozed and unresolved archived cases.
  /** Who sends product-review requests. Junip owns them as of Oct 9, 2026,
   * so Klaviyo delivery emails must not ask for reviews. */
  reviewOwner: "klaviyo" | "junip" | "other" | "unknown";
}
export function verifyServiceClear(customerId: string, service: ServiceEvidence, now = new Date()) {
  const holds: string[] = [];
  if (!shopifyId(customerId, "Customer") ||
    shopifyId(service.customerId, "Customer") !== shopifyId(customerId, "Customer")) holds.push("service_identity_unverified");
  if (service.complete !== true || service.allChannels !== true ||
    !fresh(service.checkedAt, now, 15 * 60_000)) holds.push("service_coverage_unverified");
  if (!Number.isSafeInteger(service.unresolvedCount) || service.unresolvedCount < 0) holds.push("service_count_unverified");
  else if (service.unresolvedCount > 0) holds.push("unresolved_service_issue");
  // Delivery programs need a KNOWN review owner, so two systems never both ask.
  const ownerKnown = service.reviewOwner === "klaviyo" || service.reviewOwner === "junip";
  return { clear: holds.length === 0, reviewOwnerClear: holds.length === 0 && ownerKnown,
    klaviyoMayAskForReview: holds.length === 0 && service.reviewOwner === "klaviyo", holds };
}

export type OrderLifecycle = "shop_purchase" | "shop_delivery" | "member_start" | "member_first_delivery";
export interface OrderHistoryEvidence {
  customerId: string;
  complete: boolean;
  checkedAt: string;
  firstPaidMemberOrderId: string | null;
  firstDeliveredMemberOrderId: string | null;
}
export interface OrderEligibilityInput {
  kind: OrderLifecycle;
  customerId: string;
  order: unknown;
  orderCheckedAt: string;
  fulfillments: unknown[];
  fulfillmentsCheckedAt: string;
  fulfillmentsComplete: boolean;
  membership: MembershipDecision;
  service: ServiceEvidence;
  history: OrderHistoryEvidence;
  emailSubscribed: boolean;
  emailMarketable: boolean;
  internal: boolean;
  now?: Date;
}
export function evaluateOrderEligibility(input: OrderEligibilityInput) {
  const now = input.now ?? new Date(), holds: string[] = [];
  const match = classifyPaidOrder(input.order), customerId = shopifyId(input.customerId, "Customer");
  const order = input.order as { customer?: { id?: unknown } } | null;
  const delivery = input.kind.endsWith("delivery"), member = input.kind.startsWith("member_");
  if (!["shop_purchase", "shop_delivery", "member_start", "member_first_delivery"].includes(input.kind)) holds.push("unknown_program");
  if (!customerId || shopifyId(order?.customer?.id, "Customer") !== customerId) holds.push("order_customer_mismatch");
  if (input.internal !== false) holds.push("internal_or_unverified_identity");
  if (input.emailSubscribed !== true || input.emailMarketable !== true) holds.push("email_consent_unverified");
  if (!fresh(input.orderCheckedAt, now, 5 * 60_000)) holds.push("fresh_order_read_required");
  if (!match.paidCandidate) holds.push(match.reason);
  if (match.kind !== (member ? "subscription" : "shop")) holds.push("order_program_mismatch");
  const service = verifyServiceClear(input.customerId, input.service, now);
  holds.push(...service.holds);
  if (member) {
    if (!currentActiveKeys(input.membership, now).length || input.membership.customerId !== customerId) holds.push("active_membership_unverified");
    if (input.history.complete !== true || shopifyId(input.history.customerId, "Customer") !== customerId ||
      !fresh(input.history.checkedAt, now, 5 * 60_000)) holds.push("first_member_order_history_unverified");
    const first = delivery ? input.history.firstDeliveredMemberOrderId : input.history.firstPaidMemberOrderId;
    if (shopifyId(first, "Order") !== match.orderId) holds.push("not_first_member_order");
  }
  if (delivery) {
    if (input.fulfillmentsComplete !== true || !fresh(input.fulfillmentsCheckedAt, now, 5 * 60_000)) holds.push("fresh_complete_fulfillment_read_required");
    const delivered = matchOrderDelivery(input.order, input.fulfillments);
    if (!delivered.complete) holds.push(delivered.reason);
    if (!service.reviewOwnerClear) holds.push("review_owner_unverified");
  }
  const candidate = holds.length === 0;
  const dedupeKey = candidate ? `mully-lifecycle-v1:${createHash("sha256")
    .update(JSON.stringify(["mully", input.kind, customerId, match.orderId])).digest("hex")}` : null;
  // A stable key is not an idempotency ledger. Keep actual dispatch impossible
  // until the durable outbox, live source adapters, rechecks and launch approval.
  return { auditCandidate: candidate, dispatchEligible: false as const, dedupeKey,
    orderId: match.orderId, kind: input.kind, holds: unique(holds),
    dispatchHolds: ["authoritative_source_adapters", "durable_dispatch_ledger", "flow_event_rewire", "human_launch_approval"] };
}
