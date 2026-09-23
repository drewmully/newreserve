import contracts from "@/lib/analytics/lean-contracts.json";
import { key } from "@/lib/analytics/primitives";
import { normalizeCommerce } from "@/lib/analytics/commerce";
import { normalizeLedger, normalizePayment } from "@/lib/analytics/financial";
import { normalizeSpendBase } from "@/lib/analytics/spend";
import { externalJoinControls, type Candidate, type Reconciliation } from "@/lib/analytics/certification";
import type { FullBuildEvidence, FullBuildPolicy } from "@/lib/analytics/fullReportBuild";
import type { ObservedEvent } from "@/lib/analytics/sessions";
import type { BehaviorSource } from "@/lib/analytics/posthogSource";

export const fullShop = "fixture.myshopify.com", fullProject = "a".repeat(20);
export const orderKey = key(fullShop, "1"), itemKey = key(fullShop, "1", "2");
export const sessionKey = key("353503", "session-v1", "session-fixture");
export const campaignKey = key("google_ads", "1234567890", "7");
export function fullFixture() {
  const base: Candidate = Object.fromEntries(contracts.tables.map(t => [t.name, []]));
  const snapshot = { shop: fullShop, id: "1", createdAt: "2026-01-01T11:00:00Z", updatedAt: "2026-01-01T13:00:00Z",
    currency: "USD", paidAt: "2026-01-01T12:00:00Z", paidEvidenceRef: "fixture:paid", checkoutId: "checkout-1",
    shippingCountry: null, shippingRegion: null, linesComplete: true, lines: [{
      id: "2", sku: "SKU", productId: "3", quantity: 1, itemClass: "merchandise" as const,
      unitPrice: "20", merchandiseDiscount: "0", purchaseEvidenceRef: "fixture:original", offers: [],
    }] };
  Object.assign(base, normalizeCommerce(snapshot, { eligibility: "eligible", commerceSource: "storefront",
    acquisitionEligible: true, approvalRef: "fixture:decision" }, "base"));
  base.sales_ledger = normalizeLedger({ shop: fullShop, id: "sale-1", orderId: "1",
    effectiveAt: "2026-01-01T12:00:00Z", currency: "USD", sourceTotal: "20",
    evidenceRef: "fixture:sale", kind: "sale", salesEligible: true,
    slices: [{ id: "gross", component: "merchandise_gross", amount: "20", lineId: "2",
      allocation: "allocated", reversesEntryId: null }] }, "base");
  const settlement = { shop: fullShop, gateway: "fixture", id: "4", orderId: "1", parentId: null,
    kind: "sale" as const, status: "succeeded" as const, signedAmount: "20", currency: "USD",
    settledAt: "2026-01-01T14:00:00Z", settlementEvidenceRef: "fixture:bank", adjustmentApproved: false };
  base.payments = [normalizePayment({ ...settlement, settledAt: null, settlementEvidenceRef: null }, "base")];
  base.marketing_spend_daily = normalizeSpendBase({ provider: "google_ads", accountId: "1234567890",
    date: "2026-01-01", baseReportId: "spend-1", sourceTimezone: "America/New_York", sourceCurrency: "USD",
    completedAt: "2026-01-02T00:00:00Z", paginationComplete: true, verifiedEmpty: false, evidenceRef: "fixture:google",
    rows: [{ campaignId: "7", costMicros: "5000000" }] }, "base");
  const policy: FullBuildPolicy = { definition: "full-v1", mappingVersion: "identity-v1", sessionVersion: "session-v1",
    funnelVersion: "funnel-v1", normalizationVersion: "norm-v1", project: "353503", asOf: "2026-03-02T00:00:00Z",
    approvalRef: "fixture:policy", stages: { view: "page_view" },
    attribution: { modelVersion: "last-touch-v1", lookbackDays: 30, approvalRef: "fixture:model", allowObservedDirectFallback: false },
    cohorts: [{ month: "2026-01-01", horizonDays: 30, graceSeconds: 0, acquisitionDefinition: "first-order-v1" }] };
  const keys: Record<string, [string[], unknown[][], { field: string; expectedTotal: string }[]]> = {
    customers: [["customer_id"], [["customer-fixture"]], []],
    identity_map: [["source_namespace", "source_identifier", "valid_from", "mapping_version"],
      [["firebase", "uid-fixture", "2025-01-01T00:00:00Z", "identity-v1"]], []],
    orders: [["order_id"], [[orderKey]], []],
    order_items: [["order_item_id"], [[itemKey]], []],
    sales_ledger: [["ledger_entry_id"], [[key(fullShop, "sale-1", "merchandise_gross", "gross")]],
      [{ field: "amount_usd", expectedTotal: "20" }]],
    payments: [["payment_id"], [[key(fullShop, "fixture", "4")]], [{ field: "source_amount", expectedTotal: "20" }]],
    sessions: [["session_key"], [[sessionKey]], []],
    marketing_spend_daily: [["provider", "account_id", "campaign_key", "report_date", "base_report_id"],
      [["google_ads", "1234567890", campaignKey, "2026-01-01", "spend-1"]], [{ field: "spend_usd", expectedTotal: "5" }]],
    order_attribution: [["order_id", "model_version"], [[orderKey, "last-touch-v1"]], []],
    order_item_offers: [["order_item_id", "offer_id"], [[itemKey, "offer-fixture"]], []],
  };
  const proofs: Reconciliation[] = Object.entries(keys).map(([table, [keyFields, expected, amountChecks]]) => ({
    table, keyFields, expectedKeys: expected.map(k => JSON.stringify(k)), amountChecks,
    evidenceRef: "fixture:independent-export", independentlyExtracted: true, complete: true,
  }));
  const evidence: FullBuildEvidence = { ref: "fixture:evidence-v1",
    identity: [{ namespace: "firebase", identifier: "uid-fixture", customerId: "customer-fixture",
      from: "2025-01-01T00:00:00Z", to: null, type: "verified_auth", evidenceRef: "fixture:auth",
      mappingVersion: "identity-v1", resolution: "resolved", consent: "permitted", removal: "active" }],
    currentlyPermitted: ["customer-fixture"], removedCustomers: [],
    customerHistory: { "customer-fixture": { expectedSources: ["shopify"], completeSources: ["shopify"],
      approvalRef: "fixture:history", migrationsReconciled: true } },
    orderIdentities: [{ orderId: orderKey, namespace: "firebase", identifier: "uid-fixture", evidenceRef: "fixture:order-auth" }],
    checkout: [{ orderId: orderKey, sessionKey, method: "corroborated_checkout_id", evidenceRef: "fixture:checkout" }],
    campaigns: [{ sessionKey, context: { channel: "google_ads", campaignKey, direct: false, evidenceRef: "fixture:utm" } }],
    sessionCoverage: { behaviorComplete: true, completeThrough: "2026-02-01T00:00:00Z", graceSeconds: 0, approvalRef: "fixture:coverage" },
    attributionCoverage: [{ orderId: orderKey, coverage: { lookbackComplete: true, identityComplete: true, graceComplete: true },
      evidenceRef: "fixture:lookback" }], replacements: [], settlements: [settlement],
    offers: [{ orderItemId: itemKey, offerId: "offer-fixture", evidenceRef: "fixture:offer", mappingVersion: "offer-v1" }],
    proofs, externalControls: Object.fromEntries(externalJoinControls.map(k => [k, { passed: true, evidenceRef: "fixture:control" }])),
    dateCoverage: [{ date: "2026-01-01", evidenceRef: "fixture:day", gates: { ledger: true, cash: true, orders: true,
      purchase: true, customers: true, spend: true, attribution: true, behavior: true, productAllocation: true } }],
    comparisons: [JSON.stringify(["google_ads", campaignKey])],
    cohortCoverage: [{ month: "2026-01-01", horizonDays: 30, fullMonthCovered: true,
      ledgerLineageComplete: true, originalLedgerIds: [key(fullShop, "sale-1", "merchandise_gross", "gross")],
      evidenceRef: "fixture:cohort" }],
  };
  const events: ObservedEvent[] = [{ project: "353503", producer: "web", actionId: "event-1",
    nativeUuid: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", family: "page_view", schemaVersion: "legacy-v1",
    occurredAt: "2026-01-01T11:00:00Z", receivedAt: null, sourceSessionId: "session-fixture",
    distinctId: "uid-fixture", identityNamespace: "firebase", customerId: null, analyticsPermitted: true }];
  const behavior: BehaviorSource = { host: "https://us.posthog.com", project: "353503",
    from: "2025-12-01T00:00:00Z", until: "2026-02-01T00:00:00Z", maxEvents: 100, approvalRef: "fixture:behavior",
    families: { page_view: { producer: "web", schemaVersion: "legacy-v1", identityNamespace: "firebase",
      actionProperty: "event_id", sessionProperty: "session_id", identityProperty: "distinct_id",
      consentProperty: "analytics_permitted" } } };
  const wire = { columns: ["uuid", "event", "timestamp", "distinct_id", "event_id", "insert_id",
    "session_id", "ph_session_id", "anonymous_id", "analytics_permitted", "analytics_consent"],
  results: [[events[0].nativeUuid, "page_view", events[0].occurredAt, "uid-fixture",
    "event-1", null, "session-fixture", null, null, true, null]] };
  return { base, policy, evidence, events, behavior, wire, snapshot,
    publication: "full:fixture", shop: fullShop, fromDate: "2026-01-01", throughDate: "2026-01-01" };
}
