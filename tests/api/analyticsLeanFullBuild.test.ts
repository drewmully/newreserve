import { expect, it, vi } from "vitest";
import { buildFullReports } from "@/lib/analytics/fullReportBuild";
import { readPosthogBehavior } from "@/lib/analytics/posthogSource";
import { boundBehaviorEvidence } from "@/lib/analytics/fullReportJob";
import { fullFixture, itemKey, orderKey } from "../fixtures/analyticsFull";

it("joins all ten facts and five reports with independent synthetic reconciliations", () => {
  const result = buildFullReports(fullFixture());
  expect(Object.keys(result.facts)).toHaveLength(10);
  expect(Object.keys(result.reports)).toHaveLength(5);
  expect(result.reports.store_daily[0]).toMatchObject({ eligible_orders: 1, new_customers: 1,
    collected_cash_usd: "20.000000", spend_usd: "5.000000", mer: "4.000000", ncac_usd: "5.000000" });
  expect(result.reports.acquisition_daily[0]).toMatchObject({ first_party_roas: "4.000000",
    credited_orders: "1.000000", weighted_new_customers: "1.000000" });
  expect(result.reports.funnel_daily[0]).toMatchObject({ measured_sessions: 1, converted_sessions: 1,
    session_conversion_rate: "1.000000" });
  expect(result.reports.customer_cohorts[0]).toMatchObject({ cohort_customers: 1, mature: true,
    revenue_ltv_usd: "20.000000", repeat_purchase_rate: "0.000000" });
  expect(result.facts.order_item_offers[0]).toMatchObject({ order_item_id: itemKey, offer_id: "offer-fixture" });
  expect(result.manifest).toMatchObject({ nativeEvents: 1, logicalEvents: 1 });
  expect(JSON.stringify(result.manifest)).not.toContain("uid-fixture");
  expect(result.reports.store_daily[0].readiness).toMatchObject({ mer: "observed_unverified" });
});
it("withholds incomplete domains without making missing data a zero", () => {
  const input = fullFixture();
  input.evidence.proofs = input.evidence.proofs.filter(p => p.table !== "marketing_spend_daily");
  const result = buildFullReports(input);
  expect(result.reports.store_daily[0]).toMatchObject({ spend_usd: null, mer: null,
    net_merchandise_sales_usd: "20.000000", eligible_orders: 1 });
  input.evidence.dateCoverage = [];
  expect(buildFullReports(input).reports.store_daily[0].eligible_orders).toBeNull();
});
it("does not let missing browser controls suppress independently reconciled commerce and cash", () => {
  const f = fullFixture();
  for (const name of ["event_customer_fk", "temporal_identity_intervals", "event_session_fk",
    "event_order_diagnostics", "native_project_uuid_lineage", "attribution_touch_event_fk"])
    f.evidence.externalControls[name].passed = false;
  const result = buildFullReports(f);
  expect(result.reports.store_daily[0]).toMatchObject({ eligible_orders: 1,
    net_merchandise_sales_usd: "20.000000", collected_cash_usd: "20.000000",
    spend_usd: "5.000000", mer: "4.000000", new_customers: null, ncac_usd: null });
  expect(result.reports.product_daily[0].net_merchandise_sales_usd).toBe("20.000000");
  expect(result.reports.funnel_daily[0].measured_sessions).toBeNull();
  expect(result.reports.acquisition_daily.every(r => r.first_party_roas === null)).toBe(true);
});
it("rejects unknown behavior modes and events supplied to an explicitly excluded source", () => {
  const f = fullFixture();
  Object.assign(f.policy, { behaviorMode: "fallback_on_error" });
  expect(() => buildFullReports(f)).toThrow("invalid_behavior_mode");
  f.policy.behaviorMode = "excluded";
  expect(() => buildFullReports(f)).toThrow("excluded_behavior_events");
  f.events = [];
  const result = buildFullReports(f);
  expect(result.manifest.gates[0].gates).toMatchObject({ attribution: false, behavior: false, orders: true });
  expect(f.evidence.sessionCoverage.behaviorComplete).toBe(true);
});
it("isolates spend and event-session failures to their dependent metrics", () => {
  const f = fullFixture(); f.evidence.externalControls.compatible_spend_scope.passed = false;
  let result = buildFullReports(f);
  expect(result.reports.store_daily[0]).toMatchObject({ spend_usd: null, mer: null, eligible_orders: 1, new_customers: 1 });
  expect(result.reports.funnel_daily[0].measured_sessions).toBe(1);
  f.evidence.externalControls.event_session_fk.passed = false;
  result = buildFullReports(f);
  expect(result.reports.funnel_daily[0].measured_sessions).toBeNull();
  expect(result.reports.store_daily[0].collected_cash_usd).toBe("20.000000");
});
it("current removal wins over historical permission and clears customer/session links", () => {
  const input = fullFixture(); input.evidence.removedCustomers = ["customer-fixture"];
  const result = buildFullReports(input);
  expect(result.facts.orders[0].customer_id).toBeNull();
  expect(result.facts.customers[0]).toMatchObject({ identity_status: "removed", analytics_permitted: false, history_complete: false });
  expect(result.facts.sessions).toEqual([]);
  expect(result.facts.order_attribution[0].acquisition_session_key).toBeNull();
});
it("does not trust an injected event customer ID or unknown temporal identity", () => {
  const input = fullFixture(); input.events[0].customerId = "forged-customer";
  expect(buildFullReports(input).facts.sessions[0].customer_id).toBe("customer-fixture");
  input.evidence.currentlyPermitted = [];
  expect(buildFullReports(input).facts.sessions).toEqual([]);
});
it("does not turn unresolved eligible buyers into a certified zero new-customer count", () => {
  const input = fullFixture(); input.evidence.orderIdentities = [];
  const result = buildFullReports(input);
  expect(result.reports.store_daily[0].new_customers).toBeNull();
  expect(result.reports.store_daily[0].ncac_usd).toBeNull();
});
it.each(["missing", "wrong-namespace", "expired", "denied", "removed"] as const)(
  "requires authoritative permission for lean events: %s", failure => {
    const input = fullFixture();
    input.policy.stages = { view: "lean_quiz_started" };
    input.events[0] = { ...input.events[0], family: "lean_quiz_started", identityNamespace: "lean_subject" };
    input.evidence.identity = [{ ...input.evidence.identity[0], namespace: "lean_subject",
      customerId: null, resolution: "unresolved" }];
    if (failure === "missing") input.evidence.identity = [];
    if (failure === "wrong-namespace") input.events[0].identityNamespace = "firebase";
    if (failure === "expired") input.evidence.identity[0].to = input.events[0].occurredAt;
    if (failure === "denied") input.evidence.identity[0].consent = "denied";
    if (failure === "removed") input.evidence.identity[0].removal = "removed";
    expect(buildFullReports(input).facts.sessions).toEqual([]);
  });
it("retains a permitted anonymous lean session without manufacturing a customer", () => {
  const input = fullFixture();
  input.policy.stages = { view: "lean_quiz_started" };
  input.events[0] = { ...input.events[0], family: "lean_quiz_started", identityNamespace: "lean_subject" };
  input.evidence.identity = [{ ...input.evidence.identity[0], namespace: "lean_subject",
    customerId: null, resolution: "unresolved" }];
  const result = buildFullReports(input);
  expect(result.facts.sessions).toHaveLength(1);
  expect(result.facts.sessions[0].customer_id).toBeNull();
  input.evidence.identity[0].consent = "denied";
  expect(buildFullReports(input).facts.sessions).toEqual([]);
});
it("requires exact reconciliation keys and independent controls", () => {
  const input = fullFixture(); input.evidence.proofs.find(p => p.table === "orders")!.expectedKeys = [];
  expect(buildFullReports(input).reports.store_daily[0].eligible_orders).toBeNull();
  input.evidence.externalControls.native_project_uuid_lineage.passed = false;
  expect(buildFullReports(input).reports.funnel_daily[0].measured_sessions).toBeNull();
});
it("rejects duplicate evidence, conflicting settlements and cross-shop replacements", () => {
  const a = fullFixture(); a.evidence.orderIdentities.push(a.evidence.orderIdentities[0]);
  expect(() => buildFullReports(a)).toThrow("duplicate");
  const b = fullFixture(); b.evidence.settlements[0].signedAmount = "999";
  expect(() => buildFullReports(b)).toThrow("settlement_conflicts");
  const c = fullFixture(); c.evidence.replacements.push({ snapshot: { ...c.snapshot, shop: "other.myshopify.com" },
    decision: { eligibility: "eligible", commerceSource: "storefront", acquisitionEligible: true, approvalRef: "fixture" },
    evidenceRef: "fixture", movements: [], payments: [] });
  expect(() => buildFullReports(c)).toThrow("replacement_scope");
});
it("rejects unrecognized offer membership claims at the evidence boundary", () => {
  const f = fullFixture();
  Object.assign(f.evidence.offers[0], { membershipBasis: "guessed_from_title" });
  expect(() => buildFullReports(f)).toThrow("offer_membership_basis_invalid");
});
it("replaces a complete original snapshot without duplicating its order or retaining stale financial slices", () => {
  const input = fullFixture();
  input.evidence.replacements.push({ snapshot: input.snapshot,
    decision: { eligibility: "eligible", commerceSource: "subscription_renewal", acquisitionEligible: false, approvalRef: "fixture" },
    evidenceRef: "fixture:original", movements: [], payments: [] });
  const result = buildFullReports(input);
  expect(result.facts.orders).toHaveLength(1);
  expect(result.facts.orders[0]).toMatchObject({ order_id: orderKey, commerce_source: "subscription_renewal" });
  expect(result.facts.sales_ledger).toEqual([]);
  expect(result.reports.store_daily[0].net_merchandise_sales_usd).toBeNull();
});
it("queries only fixed allowlisted event fields and normalizes the real response envelope", async () => {
  const f = fullFixture();
  const fetcher = vi.fn(async () => Response.json(f.wire));
  const events = await readPosthogBehavior(f.behavior, "fixture-secret", fetcher);
  expect(events).toEqual(f.events);
  const [url, request] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
  expect(url).toBe("https://us.posthog.com/api/projects/353503/query/");
  expect(request.redirect).toBe("error");
  expect(request.body).toContain("LIMIT 101");
  expect(request.body).not.toMatch(/email|raw_ip|current_url|SELECT \*/i);
});
it("does not infer consent from string truthiness, identity, or presence of an event", async () => {
  const f = fullFixture(); f.wire.results[0][f.wire.columns.indexOf("analytics_permitted")] = "true";
  const events = await readPosthogBehavior(f.behavior, "fixture", async () => Response.json(f.wire));
  expect(events[0]).toMatchObject({ analyticsPermitted: false, distinctId: null, sourceSessionId: null });
});
it("fails closed on overflow, schema drift, missing dedup keys, and wrong origin", async () => {
  const f = fullFixture(); f.behavior.maxEvents = 1;
  await expect(readPosthogBehavior(f.behavior, "fixture", async () =>
    Response.json({ ...f.wire, results: [...f.wire.results, ...f.wire.results] }))).rejects.toThrow("budget");
  await expect(readPosthogBehavior(f.behavior, "fixture", async () => Response.json({ ...f.wire, columns: [] }))).rejects.toThrow("shape");
  f.wire.results[0][4] = null;
  await expect(readPosthogBehavior(f.behavior, "fixture", async () => Response.json(f.wire))).rejects.toThrow("dedup");
  f.behavior.host = "https://attacker.invalid" as typeof f.behavior.host;
  const never = vi.fn();
  await expect(readPosthogBehavior(f.behavior, "fixture", never)).rejects.toThrow("scope");
  expect(never).not.toHaveBeenCalled();
});
it("does not turn a one-day event read into complete attribution or a mature seven-day session", () => {
  const f = fullFixture();
  f.behavior.from = "2026-01-01T00:00:00Z";
  f.behavior.until = "2026-01-02T00:00:00Z";
  const evidence = boundBehaviorEvidence(f.evidence, f.behavior, f.policy, f.base);
  const result = buildFullReports({ ...f, evidence });
  expect(evidence.sessionCoverage.completeThrough).toBe("2026-01-02T00:00:00.000Z");
  expect(result.facts.order_attribution[0]).toMatchObject({ attribution_complete: false, attribution_status: "pending" });
  expect(result.facts.sessions[0].conversion_window_complete).toBe(false);
  expect(result.reports.acquisition_daily[0].first_party_roas).toBeNull();
  expect(result.reports.funnel_daily[0].session_conversion_rate).toBeNull();
  expect(f.evidence.sessionCoverage.completeThrough).toBe("2026-02-01T00:00:00Z");
});
it("withholds customer metrics with incomplete customer history even when key counts match", () => {
  const f = fullFixture();
  f.evidence.customerHistory["customer-fixture"].migrationsReconciled = false;
  expect(buildFullReports(f).reports.store_daily[0].new_customers).toBeNull();
});
it("accepts only finished asynchronous query envelopes and enforces a bounded history window", async () => {
  const f = fullFixture();
  expect(await readPosthogBehavior(f.behavior, "fixture", async () =>
    Response.json({ ...f.wire, query_status: { complete: true } }))).toHaveLength(1);
  await expect(readPosthogBehavior(f.behavior, "fixture", async () =>
    Response.json({ ...f.wire, query_status: { complete: false } }))).rejects.toThrow("shape");
  f.behavior.from = "2025-01-01T00:00:00Z";
  const never = vi.fn();
  await expect(readPosthogBehavior(f.behavior, "fixture", never)).rejects.toThrow("window_budget");
  expect(never).not.toHaveBeenCalled();
});
