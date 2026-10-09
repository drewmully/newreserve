import { describe, expect, it } from "vitest";
import {
  reconcileMembership, verifyPaidCycles, verifyServiceClear, evaluateOrderEligibility,
  type ContractEvidence, type CoverageEvidence, type PaidCycleEvidence, type OrderEligibilityInput,
} from "@/lib/klaviyo/eligibility";

const now = new Date("2026-10-08T20:00:00Z");
const ago = (minutes: number) => new Date(now.getTime() - minutes * 60_000).toISOString();
const contract: ContractEvidence = { provider: "loop", contractId: "10", customerId: "100", status: "active", observedAt: ago(60) };
const coverage: CoverageEvidence[] = ["loop", "shopify_native"].map(provider=>({
  provider: provider as CoverageEvidence["provider"], customerId: "100",
  scope: "all_customer_contracts", complete: true, checkedAt: ago(60),
}));
const member = () => reconcileMembership("100", [contract], coverage, now);
const service = { customerId: "100", complete: true, allChannels: true,
  checkedAt: ago(1), unresolvedCount: 0, reviewOwner: "klaviyo" as const };
const history = { customerId: "100", complete: true, checkedAt: ago(1),
  firstPaidMemberOrderId: "20", firstDeliveredMemberOrderId: "20" };
const cycle = (id: number, change: Partial<PaidCycleEvidence> = {}): PaidCycleEvidence => ({
  provider: "loop", contractId: "10", customerId: "100", cycleId: String(id), orderId: String(1000+id),
  successful: true, paidAmountMinor: 25000, refunded: false, cancelled: false,
  paidAt: ago(id * 100), checkedAt: ago(1), ...change,
});
const line = { id: 101, variant_id: 12345, quantity: 2, requires_shipping: true, sku: "POLO" };
const order = { id: 20, customer: { id: 100 }, test: false, financial_status: "paid", total_price: "80.00",
  refunds: [], cancelled_at: null, source_name: "web", line_items: [line] };
const shipment = { id: 501, order_id: 20, status: "success", shipment_status: "delivered",
  updated_at: ago(30), line_items: [{ id: 101, quantity: 2 }] };
const input = (change: Partial<OrderEligibilityInput> = {}): OrderEligibilityInput => ({
  kind: "shop_purchase", customerId: "100", order, orderCheckedAt: ago(1),
  fulfillments: [shipment], fulfillmentsCheckedAt: ago(1), fulfillmentsComplete: true,
  membership: member(), service, history, emailSubscribed: true, emailMarketable: true, internal: false, now, ...change,
});

describe("normalized membership evidence", () => {
  it("proves fresh positive membership without treating owned-app coverage as complete", () => {
    const m = reconcileMembership("100", [contract], [], now);
    expect(m.activeVerified).toBe(true);
    expect(m.nonmemberVerified).toBe(false);
    expect(m.holds).toContain("shopify_native_coverage_unverified");
  });
  it("never proves nonmembership from missing native coverage or absence of rows alone", () => {
    expect(reconcileMembership("100", [], [], now).nonmemberVerified).toBe(false);
    expect(reconcileMembership("100", [], [coverage[0]], now).nonmemberVerified).toBe(false);
    expect(reconcileMembership("100", [], coverage, now).nonmemberVerified).toBe(true);
    expect(reconcileMembership("100", [], [{ ...coverage[0], scope: "owned_app_only" }, coverage[1]], now).nonmemberVerified).toBe(false);
  });
  it("requires complete fresh negative coverage for both providers", () => {
    for (const change of [{ complete: false }, { checkedAt: ago(49*60) }, { customerId: "101" }]) {
      expect(reconcileMembership("100", [], [{ ...coverage[0], ...change }, coverage[1]], now).nonmemberVerified).toBe(false);
    }
  });
  it("uses latest contract state regardless of arrival order and treats terminal states explicitly", () => {
    const cancelled = { ...contract, status: "cancelled" as const, observedAt: ago(10) };
    for (const rows of [[contract,cancelled], [cancelled,contract]]) {
      expect(reconcileMembership("100", rows, coverage, now)).toMatchObject({ activeVerified: false, nonmemberVerified: true });
    }
    for (const status of ["paused", "failed", "unknown"] as const)
      expect(reconcileMembership("100", [{ ...contract, status }], coverage, now).nonmemberVerified).toBe(false);
  });
  it("rejects stale, future, invalid and conflicting snapshots", () => {
    for (const observedAt of [ago(49*60), ago(-1), "invalid"])
      expect(reconcileMembership("100", [{ ...contract, observedAt }], coverage, now).activeVerified).toBe(false);
    for (const rows of [
      [contract, { ...contract, customerId: "101" }],
      [contract, { ...contract, status: "cancelled" as const }],
    ]) expect(reconcileMembership("100", rows, coverage, now)).toMatchObject({ activeVerified: false, nonmemberVerified: false });
  });
  it("handles duplicate IDs and keeps provider namespaces distinct", () => {
    expect(reconcileMembership("100", [contract,contract], coverage, now).activeContractKeys).toHaveLength(1);
    expect(reconcileMembership("100", [contract,{...contract,provider:"shopify_native"}], coverage, now).activeContractKeys).toHaveLength(2);
  });
  it("rejects conflicting coverage and malformed identity", () => {
    expect(reconcileMembership("100", [], [...coverage,{...coverage[0],complete:false}], now).nonmemberVerified).toBe(false);
    expect(reconcileMembership("gid://shopify/Order/100", [], coverage, now).nonmemberVerified).toBe(false);
    expect(reconcileMembership("100", [], coverage, new Date("bad")).nonmemberVerified).toBe(false);
  });
});

describe("two completed paid billing cycles, not an order count", () => {
  it("requires two distinct cycles on an active contract", () => {
    expect(verifyPaidCycles(member(), [cycle(1)], history, now).vipVerified).toBe(false);
    expect(verifyPaidCycles(member(), [cycle(1),cycle(2)], history, now))
      .toMatchObject({ completedBillingCycles: 2, vipVerified: true, billingCyclesVerified: true });
  });
  it("does not double-count retries, duplicate records, replacements or free orders", () => {
    expect(verifyPaidCycles(member(), [cycle(1),cycle(1)], history, now).completedBillingCycles).toBe(1);
    for (const change of [{successful:false},{paidAmountMinor:0},{paidAmountMinor:1.5},{refunded:true},{cancelled:true},{paidAt:ago(-1)}]) {
      expect(verifyPaidCycles(member(), [cycle(1),cycle(2,change)], history, now).vipVerified).toBe(false);
    }
  });
  it("rechecks refunds using latest cycle evidence, independent of arrival order", () => {
    const refunded=cycle(2,{refunded:true,checkedAt:ago(0)});
    for(const rows of [[cycle(1),cycle(2),refunded],[refunded,cycle(2),cycle(1)]])
      expect(verifyPaidCycles(member(),rows,history,now).vipVerified).toBe(false);
  });
  it("rejects ambiguous snapshots, reused orders and mismatched customers", () => {
    for(const rows of [
      [cycle(1),cycle(2,{orderId:"1001"})],
      [cycle(1),cycle(2,{customerId:"101"})],
      [cycle(1),cycle(2),cycle(2,{refunded:true})],
    ]) expect(verifyPaidCycles(member(),rows,history,now).billingCyclesVerified).toBe(false);
  });
  it("does not combine simultaneous first cycles across contracts", () => {
    const m = reconcileMembership("100",[contract,{...contract,contractId:"11"}],coverage,now);
    expect(verifyPaidCycles(m,[cycle(1),cycle(1,{contractId:"11",orderId:"1002"})],history,now).vipVerified).toBe(false);
  });
  it("requires complete fresh history and fresh membership evaluation", () => {
    for(const h of [{...history,complete:false},{...history,checkedAt:ago(6)}])
      expect(verifyPaidCycles(member(),[cycle(1),cycle(2)],h,now).vipVerified).toBe(false);
    const later = new Date(now.getTime()+6*60_000);
    expect(verifyPaidCycles(member(),[cycle(1),cycle(2)],history,later).vipVerified).toBe(false);
    expect(verifyPaidCycles(member(),[cycle(1,{checkedAt:ago(6)}),cycle(2)],history,now).vipVerified).toBe(false);
  });
  it("expires a contract even inside the five-minute decision window", () => {
    const m = reconcileMembership("100",[{...contract,observedAt:ago(48*60-1)}],coverage,now);
    const later = new Date(now.getTime()+2*60_000);
    expect(verifyPaidCycles(m,[cycle(1),cycle(2)],history,later).vipVerified).toBe(false);
  });
});

describe("service coverage", () => {
  it("does not equate an empty or stale mirror with all channels clear", () => {
    expect(verifyServiceClear("100",service,now)).toMatchObject({clear:true,reviewOwnerClear:true});
    for(const change of [{complete:false},{allChannels:false},{checkedAt:ago(16)},{customerId:"101"},{unresolvedCount:1},{unresolvedCount:-1}])
      expect(verifyServiceClear("100",{...service,...change},now).clear).toBe(false);
    expect(verifyServiceClear("100",{...service,reviewOwner:"other"},now)).toMatchObject({clear:true,reviewOwnerClear:false});
    expect(verifyServiceClear("100",{...service,reviewOwner:"junip"},now)).toMatchObject({clear:true,reviewOwnerClear:true,klaviyoMayAskForReview:false});
  });
});

describe("exact order lifecycle eligibility remains audit-only", () => {
  it("returns a stable order-scoped key but cannot dispatch", () => {
    const result=evaluateOrderEligibility(input());
    expect(result).toMatchObject({auditCandidate:true,dispatchEligible:false});
    expect(result.dedupeKey).toMatch(/^mully-lifecycle-v1:[a-f0-9]{64}$/);
    expect(evaluateOrderEligibility(input()).dedupeKey).toBe(result.dedupeKey);
    expect(evaluateOrderEligibility(input({kind:"shop_delivery"})).dedupeKey).not.toBe(result.dedupeKey);
    expect(evaluateOrderEligibility(input({order:{...order,id:21}})).dedupeKey).not.toBe(result.dedupeKey);
  });
  it.each([
    {emailSubscribed:false}, {emailMarketable:false}, {internal:true}, {orderCheckedAt:ago(6)},
    {customerId:"101"}, {order:{...order,customer:undefined}}, {order:{...order,cancelled_at:ago(1)}},
    {order:{...order,refunds:[{}]}}, {service:{...service,unresolvedCount:1}},
  ])("blocks unsafe purchase evidence: %j",change=>{
    expect(evaluateOrderEligibility(input(change))).toMatchObject({auditCandidate:false,dispatchEligible:false,dedupeKey:null});
  });
  it("requires full delivered quantities and fresh complete fulfillment reads", () => {
    expect(evaluateOrderEligibility(input({kind:"shop_delivery"})).auditCandidate).toBe(true);
    for(const change of [
      {fulfillmentsComplete:false}, {fulfillmentsCheckedAt:ago(6)},
      {fulfillments:[{...shipment,shipment_status:"in_transit"}]},
      {fulfillments:[{...shipment,order_id:21}]},
      {fulfillments:[{...shipment,line_items:[{id:101,quantity:1}]}]},
      {service:{...service,reviewOwner:"unknown" as const}},
    ]) expect(evaluateOrderEligibility(input({kind:"shop_delivery",...change})).auditCandidate).toBe(false);
  });
  it("requires verified first-member-order history and current active membership", () => {
    const subscription={...order,line_items:[{...line,sku:"RES-MEM"}]};
    const candidate=input({kind:"member_start",order:subscription});
    expect(evaluateOrderEligibility(candidate).auditCandidate).toBe(true);
    expect(evaluateOrderEligibility({...candidate,history:{...history,complete:false}}).auditCandidate).toBe(false);
    expect(evaluateOrderEligibility({...candidate,history:{...history,firstPaidMemberOrderId:"21"}}).auditCandidate).toBe(false);
    expect(evaluateOrderEligibility({...candidate,membership:reconcileMembership("100",[],[],now)}).auditCandidate).toBe(false);
    expect(evaluateOrderEligibility({...candidate,kind:"shop_purchase"}).auditCandidate).toBe(false);
    expect(evaluateOrderEligibility({...candidate,kind:"member_first_delivery"}).auditCandidate).toBe(true);
    expect(evaluateOrderEligibility({...candidate,kind:"member_first_delivery",history:{...history,firstDeliveredMemberOrderId:"21"}}).auditCandidate).toBe(false);
  });
});
