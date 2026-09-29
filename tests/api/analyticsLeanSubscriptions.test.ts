import { afterEach, expect, it, vi } from "vitest";
import { buildSubscriptionSnapshot, type SubscriptionPolicy } from "@/lib/analytics/subscriptions";

const asOf = "2026-09-01T00:00:00Z", day = 86400;
const epoch = Date.parse(asOf) / 1000;
const policy = (): SubscriptionPolicy => ({
  definitionRef: "fixture:proposed-count-v1", countedStatuses: ["ACTIVE"],
  excludedStatuses: ["PAUSED", "CANCELLED", "FAILED"],
  deduplication: "identical_normalized_contract", subscriberBasis: "shopify_customer_id",
  renewalDays: 30, recurringValue: null,
});
const contract = (id = "1", subscriber = "10") => ({
  id, status: "ACTIVE", customer: { shopifyId: subscriber },
  nextBillingDateEpoch: epoch + day, currencyCode: "USD", isPrepaid: false,
  billingPolicy: { interval: "MONTH", intervalCount: 1 },
  lines: [{ price: "10.00", quantity: 2 }, { price: "5.25", quantity: 1 }],
});
const snapshot = (rows: unknown[] = [contract()]) => ({
  shop: "fixture.myshopify.com", asOf, evidenceRef: "fixture:retained-snapshot",
  scopeComplete: true, pages: [{ pageNo: 1, hasNextPage: false, rows }],
});
const recurring = (): SubscriptionPolicy => ({
  ...policy(), recurringValue: { definitionRef: "fixture:proposed-value-v1", currencyCode: "USD",
    amountBasis: "trusted_complete_billing_cycle", prepaid: "withhold",
    annualization: "mrr_times_12", rounding: "per_contract_truncate_6dp" },
});
const assertion = (contractId = "1", amount = "20.00") => ({
  contractId, asOf, amount, currencyCode: "USD", evidenceRef: "fixture:independent-cycle-amount",
});
const build = (input: unknown = snapshot(), p = policy()) => buildSubscriptionSnapshot(input, p);
afterEach(() => vi.unstubAllGlobals());

it("counts all contracts, distinct subscribers, and renewals without a provider call or raw IDs", () => {
  vi.stubGlobal("fetch", () => { throw new Error("network_forbidden"); });
  const out = build(snapshot([contract("11111", "22222"), contract("33333", "22222"), contract("44444", "55555")]));
  expect(out.metrics.activeContracts).toMatchObject({ value: 3, readiness: "observed_unverified" });
  expect(out.metrics.distinctSubscribers.value).toBe(2);
  expect(out.metrics.renewingContractsInWindow.value).toBe(3);
  expect(out.metrics.nextRenewalAt.value).toBe("2026-09-02T00:00:00.000Z");
  expect(out.rows[0].lines).toEqual([{ unitPrice: "10.000000", quantity: 2 }, { unitPrice: "5.250000", quantity: 1 }]);
  expect(out.metrics.proposedMrr).toMatchObject({ value: null, reasons: ["recurring_policy_missing"] });
  expect(out.scope).toMatchObject({ definitionStatus: "proposed", certified: false, historicalTrendsSupported: false });
  for (const raw of ["11111", "22222", "33333", "44444", "55555"]) expect(JSON.stringify(out)).not.toContain(raw);
});
it("requires an explicit status definition and treats unrecognized statuses as incomplete, not excluded", () => {
  const rows = [contract(), { ...contract("2"), status: "PAUSED" }];
  expect(build(snapshot(rows)).metrics.activeContracts.value).toBe(1);
  const p = policy(); p.countedStatuses.push("PAUSED"); p.excludedStatuses = ["CANCELLED", "FAILED"];
  expect(build(snapshot(rows), p).metrics.activeContracts.value).toBe(2);
  const unknown = build(snapshot([{ ...contract(), status: "UNRECOGNIZED" }]));
  for (const m of Object.values(unknown.metrics)) expect(m).toMatchObject({ value: null, readiness: "withheld" });
  expect(unknown.metrics.activeContracts.reasons).toEqual(["unknown_status"]);
});
it("deduplicates only identical normalized contracts, never merges conflicting revisions", () => {
  const a = contract(), b = { ...a, lines: [{ price: "10", quantity: 2 }, { price: "5.250000", quantity: 1 }] };
  expect(build(snapshot([a, b]))).toMatchObject({ duplicates: 1, metrics: { activeContracts: { value: 1 } } });
  expect(() => build(snapshot([a, { ...a, status: "PAUSED" }]))).toThrow("duplicate_conflict");
  expect(() => build(snapshot([a, { ...a, customer: { shopifyId: "20" } }]))).toThrow("duplicate_conflict");
});
it.each(["partial", "unknown-scope"])("withholds every aggregate for %s inventory", kind => {
  const input = snapshot();
  if (kind === "partial") input.pages[0].hasNextPage = true;
  else input.scopeComplete = false;
  for (const metric of Object.values(build(input).metrics)) {
    expect(metric.value).toBeNull();
    expect(metric.reasons).toContain("incomplete_snapshot_scope");
  }
});
it("distinguishes a complete empty snapshot from missing pages", () => {
  const out = build(snapshot([]), recurring());
  expect(out.metrics.activeContracts).toMatchObject({ value: 0, readiness: "observed_unverified" });
  expect(out.metrics.distinctSubscribers.value).toBe(0);
  expect(out.metrics.renewingContractsInWindow.value).toBe(0);
  expect(out.metrics.nextRenewalAt).toMatchObject({ value: null, readiness: "observed_unverified", reasons: [] });
  expect(out.metrics.proposedMrr.value).toBe("0.000000");
  expect(() => build({ ...snapshot(), pages: [] })).toThrow("subscription_pages");
});
it("withholds subscriber count only when a counted contract lacks customer identity", () => {
  const out = build(snapshot([{ ...contract(), customer: null }]));
  expect(out.metrics.activeContracts.value).toBe(1);
  expect(out.metrics.distinctSubscribers).toMatchObject({ value: null, reasons: ["missing_subscriber_id"] });
  expect(out.metrics.renewingContractsInWindow.value).toBe(1);
  expect(out.rows[0].subscriberKey).toBeNull();
});
it("uses UTC half-open renewal boundaries and does not manufacture dates", () => {
  const out = build(snapshot([contract(), { ...contract("2"), nextBillingDateEpoch: epoch },
    { ...contract("3"), nextBillingDateEpoch: epoch + 30 * day }]));
  expect(out.metrics.renewingContractsInWindow.value).toBe(2);
  expect(out.metrics.nextRenewalAt.value).toBe("2026-09-01T00:00:00.000Z");
  for (const [date, reason] of [[null, "missing_next_billing_date"], [epoch - 1, "past_next_billing_date"]] as const) {
    const metrics = build(snapshot([{ ...contract(), nextBillingDateEpoch: date }])).metrics;
    expect(metrics.renewingContractsInWindow).toMatchObject({ value: null, reasons: [reason] });
    expect(metrics.activeContracts.value).toBe(1);
  }
});
it("does not treat multiple line prices or quantities as a complete recurring amount", () => {
  expect(build(snapshot(), recurring()).metrics.proposedMrr)
    .toMatchObject({ value: null, reasons: ["complete_cycle_amount_missing"] });
  const input = { ...snapshot(), recurringAmounts: [assertion()] };
  const out = build(input, recurring()); // Verified full-cycle $20, NOT $25.25 from displayed lines.
  expect(out.metrics.proposedMrr.value).toBe("20.000000");
  expect(out.metrics.proposedArr.value).toBe("240.000000");
  expect(out.scope.recurringEvidenceRefs).toEqual(["fixture:independent-cycle-amount"]);
});
it("normalizes monthly/multi-month/annual billing using exact decimals and explicit truncation", () => {
  const rows = [contract(), { ...contract("2"), billingPolicy: { interval: "MONTH", intervalCount: 3 } },
    { ...contract("3"), billingPolicy: { interval: "YEAR", intervalCount: 1 } }];
  const input = { ...snapshot(rows), recurringAmounts: [assertion("1", "0"), assertion("2", "10"), assertion("3", "120")] };
  const out = build(input, recurring());
  expect(out.metrics.proposedMrr.value).toBe("13.333333");
  expect(out.metrics.proposedArr.value).toBe("159.999996"); // Defined as 12 × truncated per-contract MRR.
});
it.each([
  [{ billingPolicy: { interval: "WEEK", intervalCount: 1 } }, "unsupported_billing_cadence"],
  [{ billingPolicy: null }, "unsupported_billing_cadence"],
  [{ currencyCode: null }, "contract_currency_missing"],
  [{ currencyCode: "CAD" }, "currency_mismatch"],
  [{ isPrepaid: null }, "prepaid_unknown"],
  [{ isPrepaid: true }, "prepaid_value_withheld"],
])("withholds full recurring total for unsupported input %j", (change, reason) => {
  const input = { ...snapshot([contract(), { ...contract("2"), ...change }]),
    recurringAmounts: [assertion(), assertion("2")] };
  const out = build(input, recurring());
  expect(out.metrics.proposedMrr).toMatchObject({ value: null, readiness: "withheld", reasons: [reason] });
  expect(out.metrics.activeContracts.value).toBe(2); // Never publish a partial revenue sum.
});
it("requires explicit prepaid normalization policy and bill-cycle evidence, never delivery cadence", () => {
  const input = { ...snapshot([{ ...contract(), isPrepaid: true,
    billingPolicy: { interval: "MONTH", intervalCount: 12 } }]), recurringAmounts: [assertion("1", "240")] };
  const p = recurring(); p.recurringValue!.prepaid = "normalize_billing_cycle";
  expect(build(input, p).metrics.proposedMrr.value).toBe("20.000000");
});
it.each(["wrong-id", "duplicate", "wrong-time", "wrong-currency", "number-money"])("rejects/withholds %s amount evidence", kind => {
  const a: Record<string, unknown> = assertion();
  if (kind === "wrong-id") a.contractId = "999";
  if (kind === "wrong-time") a.asOf = "2026-08-01T00:00:00Z";
  if (kind === "wrong-currency") a.currencyCode = "CAD";
  if (kind === "number-money") a.amount = 20;
  const input = { ...snapshot(), recurringAmounts: kind === "duplicate" ? [a, a] : [a] };
  if (kind === "wrong-currency") expect(build(input, recurring()).metrics.proposedMrr.reasons).toEqual(["currency_mismatch"]);
  else expect(() => build(input, recurring())).toThrow();
});
it.each(["email", "shippingAddress", "customerPaymentMethodId", "planPrice"])("rejects raw/nonprojected field %s", field => {
  expect(() => build(snapshot([{ ...contract(), [field]: null }]))).toThrow("subscription_shape");
});
it("rejects nested PII and unsafe/missing IDs, while preserving large string IDs", () => {
  expect(() => build(snapshot([{ ...contract(), customer: { shopifyId: "10", email: "fixture@example.invalid" } }]))).toThrow("shape");
  for (const id of [null, "", "001", 9007199254740992])
    expect(() => build(snapshot([{ ...contract(), id }]))).toThrow("identifier");
  expect(build(snapshot([contract("9007199254740993")])).metrics.activeContracts.value).toBe(1);
});
it("checks source-page continuity, strict booleans, scope caps, and required business policy", () => {
  expect(() => build({ ...snapshot(), scopeComplete: "true" })).toThrow("scope");
  expect(() => build({ ...snapshot(), pages: [{ pageNo: 2, hasNextPage: false, rows: [] }] })).toThrow("sequence");
  expect(() => build({ ...snapshot(), pages: [{ pageNo: 1, hasNextPage: "false", rows: [] }] })).toThrow("sequence");
  const pages = [1, 2, 3].map(pageNo => ({ pageNo, hasNextPage: pageNo < 3, rows: Array(400).fill(contract()) }));
  expect(() => build({ ...snapshot(), pages })).toThrow("row_budget");
  const p = policy(); p.excludedStatuses.push("ACTIVE");
  expect(() => build(snapshot(), p)).toThrow("count_policy");
  expect(() => build(snapshot(), { ...policy(), renewalDays: 91 })).toThrow("integer");
  expect(() => build(snapshot(), { ...policy(), recurringValue: undefined } as unknown as SubscriptionPolicy)).toThrow();
});
it("is deterministic across page order of distinct contracts without mutating inputs", () => {
  const a = snapshot([contract(), contract("2")]), saved = JSON.stringify(a);
  const b = { ...snapshot(), pages: [{ pageNo: 1, hasNextPage: true, rows: [contract("2")] },
    { pageNo: 2, hasNextPage: false, rows: [contract()] }] };
  expect(build(a)).toEqual(build(b));
  expect(JSON.stringify(a)).toBe(saved);
});
it("keeps absent line data unknown, rejects ambiguous numeric amounts and non-boolean prepaid flags", () => {
  expect(build(snapshot([{ ...contract(), lines: null }])).rows[0].lines).toBeNull();
  for (const row of [{ ...contract(), lines: [{ price: 10, quantity: 1 }] },
    { ...contract(), lines: [{ price: "10", quantity: 0 }] }, { ...contract(), isPrepaid: "false" }])
    expect(() => build(snapshot([row]))).toThrow();
});
it("rejects unknown metadata and policy fields instead of suggesting ignored controls were enforced", () => {
  expect(() => build({ ...snapshot(), customerEmail: null })).toThrow("shape");
  expect(() => build(snapshot(), { ...policy(), approveHistory: true } as SubscriptionPolicy)).toThrow("shape");
  const p = recurring();
  Object.assign(p.recurringValue!, { guessedDiscounts: true });
  expect(() => build(snapshot(), p)).toThrow("shape");
});
