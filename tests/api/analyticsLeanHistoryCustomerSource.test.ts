/** Synthetic 041 generation in disposable PGlite; no provider or customer data. */
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { normalizeHistoryCustomer, runHistoryCustomerStep, type HistoryCustomerInput } from "@/lib/analytics/historyCustomerSource";
import type { PilotSource } from "@/lib/analytics/shopifyPilotSource";
import { key } from "@/lib/analytics/primitives";
import { buildFullReports } from "@/lib/analytics/fullReportBuild";
import type { CustomerGenerationInput } from "@/lib/analytics/historyCustomerSource";
import { fullFixture, orderKey } from "../fixtures/analyticsFull";

const project = "aaaaaaaaaaaaaaaaaaaa", shop = "fixture.myshopify.com";
const gid = (kind: string, id: string) => `gid://shopify/${kind}/${id}`;
const money = (amount: string) => ({ shopMoney: { amount, currencyCode: "USD" } });
const updated = "2026-01-02T12:00:00Z", completeThrough = "2026-09-25T08:04:00Z";
const decision = { eligibility: "eligible" as const, commerceSource: "other" as const,
  acquisitionEligible: true, approvalRef: "fixture:order-classification" };
const policy = { productClasses: { "3": "merchandise" as const }, decision, financialApprovalRef: "fixture:finance",
  saleClock: "paid_at" as const, refundClock: "refund_created_at" as const };
const reporting = { definition: "fixture-customers-v1", fromDate: "2026-01-01", throughDate: "2026-01-03",
  cohorts: [{ month: "2026-01-01", horizonDays: 30, graceSeconds: 172800, acquisitionDefinition: "first-paid-v1" }],
  cohortCoverage: [{ month: "2026-01-01", horizonDays: 30, fullMonthCovered: true,
    ledgerLineageComplete: true, originalLedgerIds: [], evidenceRef: "fixture:whole-original-cohort" }] };
function source(id = "1", customer = "90"): PilotSource {
  return { commerce: { shop, apiVersion: "2026-07", projection: "financial_customer_id", order: {
    id: gid("Order", id), customer: { id: gid("Customer", customer) },
    createdAt: "2026-01-01T12:00:00Z", updatedAt: updated,
    currencyCode: "USD", edited: false, taxesIncluded: false, test: false, cancelledAt: null,
    originalTotalPriceSet: money("10"), subtotalPriceSet: money("10"),
    transactionsCount: { count: 1, precision: "EXACT" },
    transactions: [{ id: gid("OrderTransaction", id), kind: "SALE", status: "SUCCESS", gateway: "fixture",
      test: false, createdAt: "2026-01-01T12:00:00Z", processedAt: "2026-01-01T12:01:00Z",
      amountSet: money("10"), parentTransaction: null }],
    lineItems: { nodes: [{ id: gid("LineItem", id), sku: "FIXTURE", quantity: 1, isGiftCard: false,
      product: { id: gid("Product", "3") }, originalUnitPriceSet: money("10"),
      originalTotalSet: money("10"), discountAllocations: [] }],
    pageInfo: { hasNextPage: false, endCursor: null } },
  } }, financial: { id: gid("Order", id), updatedAt: updated, currencyCode: "USD",
    originalTotalPriceSet: money("10"), totalTaxSet: money("0"), originalTotalDutiesSet: null,
    originalTotalAdditionalFeesSet: null, totalTipReceivedSet: money("0"),
    shippingLines: { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } }, refunds: [] }, refunds: [] };
}
function evidence(ids = ["1"], customerId = "customer_fixture_90", identifier = "90"): HistoryCustomerInput["evidence"] {
  const identity = [{ namespace: "shopify_customer", identifier, customerId,
    from: "2020-01-01T00:00:00Z", to: null, type: "fixture:independent-history",
    evidenceRef: "fixture:identity", mappingVersion: "identity-v1",
    resolution: "resolved" as const, consent: "permitted" as const, removal: "active" as const }];
  const proof = (table: string, keyFields: string[], keys: unknown[][]) => ({
    table, keyFields, expectedKeys: keys.map(v => JSON.stringify(v)), amountChecks: [],
    complete: true, independentlyExtracted: true, evidenceRef: `fixture:independent:${table}`,
  });
  return {
    ref: "fixture:registered-evidence", identity,
    currentlyPermitted: [customerId], removedCustomers: [],
    customerHistory: { [customerId]: { expectedSources: ["shopify"], completeSources: ["shopify"],
      approvalRef: "fixture:history", migrationsReconciled: true, completeThrough } },
    orderIdentities: ids.map(id => ({ orderId: key(shop, id), namespace: "shopify_customer", identifier,
      evidenceRef: `fixture:order-owner:${id}` })),
    proofs: [
      proof("orders", ["order_id"], ids.map(id => [key(shop, id)])),
      proof("order_items", ["order_item_id"], ids.map(id => [key(shop, id, id)])),
      proof("customers", ["customer_id"], [[customerId]]),
      proof("identity_map", ["source_namespace", "source_identifier", "valid_from", "mapping_version"],
        [["shopify_customer", identifier, "2020-01-01T00:00:00Z", "identity-v1"]]),
    ],
    externalControls: { temporal_identity_intervals: { passed: true, evidenceRef: "fixture:temporal-control" } },
    cohortCoverage: [],
  };
}
function input(): HistoryCustomerInput {
  return {
    version: 1, state: "claimed", runId: "fixture-scale", memberId: "member1",
    projectRef: project, shop, publication: "customer-history:fixture-scale",
    inputHash: "a".repeat(64), generationHash: "b".repeat(64),
    asOf: "2026-09-30T00:00:00Z", expiresAt: "2026-10-01T00:00:00Z", mappingVersion: "identity-v1",
    sourceOrigin: "2020-01-01T00:00:00Z", completeThrough, reporting,
    authority: { authorityId: "fixture-authority", revision: "1", fingerprint: "d".repeat(64),
      sourceId: "fixture:approved-authority", schemaVersion: "fixture-v1", scopeRef: "fixture:whole-history",
      evidenceRef: "fixture:current-receipt", capturedAt: "2026-09-30T11:59:00Z",
      validUntil: "2026-10-01T00:00:00Z", maxAgeSeconds: 300 },
    customerId: "customer_fixture_90", policy, evidence: evidence(),
    orders: [{ id: gid("Order", "1"), updatedAt: updated, sourceHash: "c".repeat(64), decision, source: source() }],
  };
}
const now = "2026-09-30T12:00:00Z";

function fullGenerationFixture() {
  const f = fullFixture();
  f.evidence.customerHistory["customer-fixture"].completeSources = [];
  // This report-window order set does not certify the lifetime source population.
  f.evidence.dateCoverage[0].gates.orders = false;
  f.policy.customerGeneration = { runId: "fixture-scale", generationHash: "a".repeat(64), resultHash: "b".repeat(64),
    authorityId: "fixture-authority", authorityRevision: "1", authorityFingerprint: "c".repeat(64) };
  const source: CustomerGenerationInput = {
    version: 1, runId: "fixture-scale", sourcePublication: "customer-history:fixture-scale", sourceRun: "history-fixture",
    sourceCompletionHash: "d".repeat(64), generationHash: "a".repeat(64), resultHash: "b".repeat(64),
    projectRef: project, shop, fromDate: f.fromDate, throughDate: f.throughDate, definition: f.policy.definition,
    mappingVersion: f.policy.mappingVersion, asOf: f.policy.asOf, sourceOrigin: "2020-01-01T00:00:00Z",
    completeThrough: "2026-03-01T00:00:00Z",
    authority: { ...input().authority, fingerprint: "c".repeat(64) },
    dates: [{ date: f.fromDate, newCustomers: 3 }],
    cohorts: [{ cohortMonth: "2026-01-01", horizonDays: 30, graceSeconds: 0, acquisitionDefinition: "first-order-v1",
      asOf: f.policy.asOf, mature: true, cohortCustomers: 3, repeatCustomers: 1, revenueUsd: "2.000000" }],
    orderBindings: [{ orderId: orderKey, customerId: "customer-fixture",
      paidAt: "2026-01-01T12:00:00.000000Z", sourceUpdatedAt: "2026-01-01T13:00:00.000000Z",
      eligibility: "eligible", firstEligibleOrder: true }],
  };
  f.evidence.customerGeneration = source;
  return f;
}

describe("actual full consumer of source-derived primitives", () => {
  it("recomputes ratios once without promoting report-window fact gates", () => {
    const result = buildFullReports(fullGenerationFixture());
    expect(result.reports.store_daily[0]).toMatchObject({ new_customers: 3, ncac_usd: "1.666666", eligible_orders: null });
    expect(result.reports.customer_cohorts[0]).toMatchObject({ cohort_customers: 3, repeat_customers: 1,
      repeat_purchase_rate: "0.333333", revenue_ltv_usd: "0.666666" });
    expect(result.manifest.gates[0].gates.customers).toBe(false);
    expect(result.facts.customers[0].history_complete).toBe(false);
  });
  it("preserves order-history metrics when ledger readiness or lineage is missing", () => {
    const f = fullGenerationFixture();
    f.evidence.dateCoverage[0].gates.ledger = false;
    f.evidence.cohortCoverage[0].ledgerLineageComplete = false;
    const out = buildFullReports(f);
    expect(out.reports.store_daily[0]).toMatchObject({ new_customers: 3, ncac_usd: "1.666666",
      net_merchandise_sales_usd: null, mer: null });
    expect(out.reports.customer_cohorts[0]).toMatchObject({ cohort_customers: 3, repeat_purchase_rate: "0.333333",
      revenue_ltv_usd: null, observed_net_merchandise_sales_usd: null });
  });
  it("does not let missing cohort coverage suppress independent store inputs", () => {
    const f = fullGenerationFixture(); f.evidence.cohortCoverage = [];
    const out = buildFullReports(f);
    expect(out.reports.customer_cohorts[0]).toMatchObject({ mature: false, cohort_customers: null, repeat_purchase_rate: null });
    expect(out.reports.store_daily[0]).toMatchObject({ new_customers: 3, spend_usd: "5.000000" });
  });
  it.each(["missing binding", "missing derived input", "changed result", "removed", "wrong paid clock",
    "duplicate binding", "inconsistent cohort", "oversized count", "conflicting day coverage"] as const)(
    "rejects %s instead of using legacy/fabricated customer numbers", kind => {
      const f = fullGenerationFixture(), source = f.evidence.customerGeneration!;
      if (kind === "missing binding") delete f.policy.customerGeneration;
      if (kind === "missing derived input") delete f.evidence.customerGeneration;
      if (kind === "changed result") source.resultHash = "e".repeat(64);
      if (kind === "removed") f.evidence.removedCustomers = ["customer-fixture"];
      if (kind === "wrong paid clock") source.orderBindings[0].paidAt = "2026-01-02T12:00:00Z";
      if (kind === "duplicate binding") source.orderBindings.push(structuredClone(source.orderBindings[0]));
      if (kind === "inconsistent cohort") source.cohorts[0].repeatCustomers = 4;
      if (kind === "oversized count") source.dates[0].newCustomers = 70001;
      if (kind === "conflicting day coverage") f.evidence.dateCoverage[0].gates.orders = true;
      expect(() => buildFullReports(f)).toThrow();
    });
});

describe("retained complete-customer normalization", () => {
  it("derives the real paid clock/first order and preserves missing ledger proof", () => {
    const out = normalizeHistoryCustomer(input(), now);
    expect(out.customerComplete).toBe(true);
    expect(out.ledgerComplete).toBe(false);
    expect(out.facts.customers[0].first_eligible_order_at).toBe("2026-01-01T12:01:00Z");
    expect(out.facts.customers[0].acquisition_date).toBe("2026-01-01");
    expect(out.facts.orders[0].customer_id).toBe("customer_fixture_90");
    expect(out.facts.sales_ledger.length).toBeGreaterThan(0);
  });
  it.each(["missing projection", "changed revision", "wrong shard", "changed ownership", "denied", "removed",
    "incomplete history", "pending eligibility", "independent inventory missing", "expired"] as const)(
    "fails closed for %s", kind => {
      const v = input();
      if (kind === "missing projection") delete v.orders[0].source.commerce.order.customer;
      if (kind === "changed revision") v.orders[0].source.commerce.order.updatedAt = "2026-01-03T00:00:00Z";
      if (kind === "wrong shard") v.customerId = "customer_elsewhere";
      if (kind === "changed ownership") v.evidence.identity[0].from = "2026-02-01T00:00:00Z";
      if (kind === "denied") v.evidence.currentlyPermitted = [];
      if (kind === "removed") v.evidence.removedCustomers = [v.customerId!];
      if (kind === "incomplete history") v.evidence.customerHistory[v.customerId!].completeSources = [];
      if (kind === "pending eligibility") v.orders[0].decision = { ...decision, eligibility: "pending" };
      if (kind === "independent inventory missing") v.evidence.proofs[0].expectedKeys = [];
      if (kind === "expired") v.expiresAt = now;
      expect(() => normalizeHistoryCustomer(v, now)).toThrow();
    });
  it("rejects a 101-order member before mapping instead of splitting lifetime history", () => {
    const v = input(); v.orders = Array.from({ length: 101 }, () => structuredClone(v.orders[0]));
    expect(() => normalizeHistoryCustomer(v, now)).toThrow("history_customer_shard_budget");
  });
  it("can retain order history when the financial mapper cannot establish ledger values", () => {
    const v = input(); v.orders[0].source.financial.totalTipReceivedSet = money("1");
    const out = normalizeHistoryCustomer(v, now);
    expect(out.customerComplete).toBe(true);
    expect(out.ledgerComplete).toBe(false);
    expect(out.facts.sales_ledger).toEqual([]);
    expect(out.facts.customers[0].first_eligible_order_id).toBe(key(shop, "1"));
  });
  it("does not call storage when disabled", async () => {
    const rpc = vi.fn();
    expect(await runHistoryCustomerStep({ approved: false, client: { rpc },
      runId: "fixture-scale", projectRef: project })).toEqual({ state: "disabled" });
    expect(rpc).not.toHaveBeenCalled();
  });
  it("keeps an explicit eligible guest unresolved rather than inventing a customer or zero", () => {
    const v = input(); v.customerId = null; v.orders[0].source.commerce.order.customer = null;
    v.evidence.identity = []; v.evidence.currentlyPermitted = []; v.evidence.customerHistory = {};
    v.evidence.orderIdentities = [];
    for (const proof of v.evidence.proofs)
      if (["customers", "identity_map"].includes(proof.table)) proof.expectedKeys = [];
    const out = normalizeHistoryCustomer(v, now);
    expect(out.customerComplete).toBe(false);
    expect(out.facts.customers).toEqual([]);
    expect(out.facts.orders[0].customer_id).toBeNull();
    expect(out.components).toEqual([]);
  });
});

describe("actual SQL retained-generation reader/finalizer", () => {
  let db: PGlite;
  const query = async <T extends Record<string, unknown>>(sql: string, params: unknown[] = []) =>
    (await db.query<T>(sql, params)).rows;
  const rpc = async (name: string, args: Record<string, unknown>) => {
    if (!/^lean_history_customer_(claim|finish)$/.test(name)) throw new Error("unexpected_rpc");
    try {
      const rows = await query(`select public.${name}(${Object.keys(args).map((k, i) => `${k}=>$${i + 1}`).join(",")}) as value`,
        Object.values(args).map(v => v && typeof v === "object" ? JSON.stringify(v) : v));
      return { data: rows[0].value, error: null };
    } catch (error) { return { data: null, error }; }
  };
  beforeAll(async () => {
    db = new PGlite();
    await db.exec("create role anon;create role authenticated;create role service_role;");
    for (const file of ["001_staging", "019_spend_jobs", "040_shopify_history_import",
      "041_history_report_bridge", "proposed_history_customer_source"])
      await db.exec(readFileSync(`sql/analytics/${file}.sql`, "utf8"));
  }, 30000);
  afterAll(async () => { await db?.close(); });
  beforeEach(async () => {
    await db.exec("truncate lean_private.history_import_jobs,lean_private.publications,lean_private.history_customer_authority cascade;");
  });
  async function stage(two = false, cutoff = completeThrough, reportConfig = reporting,
    editEvidence?: (e: HistoryCustomerInput["evidence"], id: string) => void) {
    const asOf = new Date(Date.now() - 1000).toISOString(), expiry = new Date(Date.now() + 3600000).toISOString();
    const importScope = { projectRef: project, shop, untilTime: completeThrough };
    await query(`insert into lean_private.history_import_jobs(job_id,scope,expires_at,enabled,state,orders,completion)
      values('import-fixture',$1,$2,true,'complete',$3,'{"eof":true}')`, [JSON.stringify(importScope), expiry, two ? 2 : 1]);
    const hscope = { projectRef: project, shop, includeCustomerId: true, policy };
    await query(`insert into lean_private.history_report_jobs(run_id,scope,source_job,source_hash,expires_at,state,report_date)
      select 'history-fixture',$1,'import-fixture',encode(sha256(convert_to(completion::text,'UTF8')),'hex'),$2,'complete','2026-01-01'
      from lean_private.history_import_jobs where job_id='import-fixture'`, [JSON.stringify(hscope), expiry]);
    const bindings = (await query(`select h.source_hash,
      encode(sha256(convert_to(h.scope::text,'UTF8')),'hex') as scope_hash from lean_private.history_report_jobs h`))[0];
    const members = (two ? ["1", "2"] : ["1"]).map(id => {
      const customer = id === "1" ? "90" : "91", customerId = `customer_fixture_${customer}`;
      const memberEvidence = evidence([id], customerId, customer);
      memberEvidence.customerHistory[customerId].completeThrough = cutoff;
      editEvidence?.(memberEvidence, id);
      return { id, customer, customerId, evidence: memberEvidence };
    });
    const fingerprint = (await query(`select encode(sha256(convert_to(string_agg(encode(sha256(convert_to(
      jsonb_build_array(m->>'customerId',m#>'{evidence,identity}',m#>'{evidence,currentlyPermitted}',
        m#>'{evidence,removedCustomers}')::text,'UTF8')),'hex'),'' order by m->>'customerId'),'UTF8')),'hex') as digest
      from jsonb_array_elements($1::jsonb) m`, [JSON.stringify(members)]))[0].digest;
    await query(`insert into lean_private.history_customer_authority values('fixture-authority',$1,$2,
      'fixture:whole-history','fixture:approved-authority','fixture-v1',1,$3,$4,$5,300,'fixture:current-receipt',true)`,
      [project, shop, fingerprint, asOf, expiry]);
    const scope = { projectRef: project, shop, asOf, expiresAt: expiry, sourceOrigin: "2020-01-01T00:00:00Z",
      completeThrough: cutoff, sourceScopeHash: bindings.scope_hash, sourceCompletionHash: bindings.source_hash,
      mappingVersion: "identity-v1", policy, approvalRef: "fixture:review",
      inventoryRef: "fixture:independent-original-inventory", migrationEvidenceRef: "fixture:migration",
      permissionEvidenceRef: "fixture:current-privacy", permissionValidUntil: expiry, maxSourceAgeSeconds: 604800,
      authorityId: "fixture-authority", authorityScopeRef: "fixture:whole-history",
      authorityRevision: "1", authorityFingerprint: fingerprint, reporting: reportConfig };
    await query(`insert into lean_private.history_customer_runs(run_id,source_run,scope)
      values('fixture-scale','history-fixture',$1)`, [JSON.stringify(scope)]);
    for (const { id, customer, customerId, evidence: memberEvidence } of members) {
      const doc = source(id, customer);
      await query("insert into lean_private.history_import_orders values('import-fixture',$1,$2)",
        [gid("Order", id), JSON.stringify({ id: gid("Order", id), createdAt: "2026-01-01T12:00:00Z", updatedAt: updated })]);
      await query(`insert into lean_private.history_report_sources(run_id,order_id,source,captured_at,source_hash,outcome,result_hash)
        values('history-fixture',$1,$2,$3,encode(sha256(convert_to($2::jsonb::text,'UTF8')),'hex'),'financial_observed','fixture')`,
        [gid("Order", id), JSON.stringify(doc), asOf]);
      await query(`insert into lean_private.history_customer_members(run_id,member_id,customer_id,evidence)
        values('fixture-scale',$1,$2,$3)`, [`member${id}`, customerId, JSON.stringify(memberEvidence)]);
      await query(`insert into lean_private.history_customer_inventory
        select 'fixture-scale',$1,order_id,$2,source_hash,$3 from lean_private.history_report_sources where order_id=$4`,
        [`member${id}`, updated, JSON.stringify(decision), gid("Order", id)]);
    }
    return scope;
  }
  const seal = () => query("select public.lean_history_customer_seal('fixture-scale') as digest");
  const step = () => runHistoryCustomerStep({ approved: true, client: { rpc }, runId: "fixture-scale", projectRef: project });
  it("seals off by default and denies runtime registration/direct source access", async () => {
    await stage(); await seal();
    expect(await step()).toEqual({ state: "disabled" });
    const acl = (await query(`select has_function_privilege('service_role','public.lean_history_customer_seal(text)','execute') as seal,
      has_table_privilege('service_role','lean_private.history_customer_inventory','select') as inventory`))[0];
    expect(acl).toEqual({ seal: false, inventory: false });
  });
  it("finishes two complete customers into one private candidate, not reports", async () => {
    await stage(true); await seal();
    await db.exec("update lean_private.history_customer_runs set enabled=true;");
    expect(await step()).toEqual({ state: "member_written" });
    expect((await query("select state,processed from lean_private.history_customer_runs"))[0]).toEqual({ state: "sealed", processed: 1 });
    expect(await step()).toEqual({ state: "member_written" });
    expect((await query("select state,processed from lean_private.history_customer_runs"))[0]).toEqual({ state: "complete", processed: 2 });
    expect((await query("select count(*)::integer as n,count(distinct publication_id)::integer as pubs from lean_private.customers"))[0])
      .toEqual({ n: 2, pubs: 1 });
    expect((await query("select state from lean_private.publications"))[0].state).toBe("candidate");
    const scope = (await query("select scope from lean_private.history_customer_runs"))[0].scope as Record<string, unknown>;
    const derived = (await query(`select lean_private.history_customer_report_input('fixture-scale',$1,'2026-01-01','2026-01-03',$2,$3) as value`,
      [project, JSON.stringify({ definition: reporting.definition, mappingVersion: "identity-v1", asOf: scope.asOf, cohorts: reporting.cohorts }),
        [key(shop, "1"), key(shop, "2")]]))[0].value as { dates: unknown[]; cohorts: Record<string, unknown>[]; orderBindings: unknown[] };
    expect(derived.dates).toEqual([{ date: "2026-01-01", newCustomers: 2 },
      { date: "2026-01-02", newCustomers: 0 }, { date: "2026-01-03", newCustomers: 0 }]);
    expect(derived.cohorts[0]).toMatchObject({ mature: true, cohortCustomers: 2, repeatCustomers: 0, revenueUsd: null });
    expect(derived.orderBindings).toHaveLength(2);
    expect(await step()).toEqual({ state: "complete" });
    await expect(db.exec("update lean_private.customers set history_complete=false;")).rejects.toThrow(/fact immutable/);
  });
  it("rejects missing independent inventory before sealing", async () => {
    await stage(true);
    await db.exec("delete from lean_private.history_customer_inventory where member_id='member2';");
    await expect(seal()).rejects.toThrow(/independent inventory/);
  });
  it("rejects overlapping canonical customers and duplicate order ownership", async () => {
    await stage(true);
    await expect(query(`insert into lean_private.history_customer_members(run_id,member_id,customer_id,evidence)
      select run_id,'split-member',customer_id,evidence from lean_private.history_customer_members where member_id='member1'`))
      .rejects.toThrow(/unique constraint/);
    await expect(query(`insert into lean_private.history_customer_inventory
      select run_id,'member2',order_id,updated_at,source_hash,decision from lean_private.history_customer_inventory where member_id='member1'`))
      .rejects.toThrow(/unique constraint/);
  });
  it("rejects cross-member temporal ownership conflicts even with a matching independent fingerprint", async () => {
    await stage(true, completeThrough, reporting, e => { e.identity[0].identifier = "shared-fixture"; });
    await expect(seal()).rejects.toThrow("history customer cross-member identity conflict");
  });
  it("keeps touching half-open temporal ownership intervals distinct at sealing", async () => {
    await stage(true, completeThrough, reporting, (e, id) => {
      e.identity[0].identifier = "shared-fixture";
      if (id === "1") e.identity[0].to = "2025-01-01T00:00:00Z";
      else e.identity[0].from = "2025-01-01T00:00:00Z";
    });
    // This is only the global overlap check. Actual order ownership still has
    // to match the source and per-member proofs at normalization.
    await expect(seal()).resolves.toBeDefined();
  });
  it.each(["missing-date", "duplicate-cohort", "negative-horizon"] as const)(
    "rejects malformed registered reporting policy: %s", async variant => {
      const config = structuredClone(reporting);
      if (variant === "missing-date") delete (config as Partial<typeof config>).fromDate;
      if (variant === "duplicate-cohort") config.cohorts.push({ ...config.cohorts[0] });
      if (variant === "negative-horizon") config.cohorts[0].horizonDays = -1;
      await stage(false, completeThrough, config);
      await expect(seal()).rejects.toThrow(/history customer/);
    });
  it("does not drop a later immature original member from the whole cohort denominator", async () => {
    const scope = await stage(true, "2026-02-03T00:00:00Z");
    const late = source("2", "91");
    late.commerce.order.updatedAt = "2026-01-31T12:00:00Z";
    late.financial.updatedAt = "2026-01-31T12:00:00Z";
    (late.commerce.order.transactions as Record<string, unknown>[])[0].processedAt = "2026-01-31T12:00:00Z";
    await query(`update lean_private.history_report_sources set source=$1,
      source_hash=encode(sha256(convert_to($1::jsonb::text,'UTF8')),'hex') where order_id=$2`,
      [JSON.stringify(late), gid("Order", "2")]);
    await query(`update lean_private.history_import_orders set source=jsonb_set(source,'{updatedAt}','"2026-01-31T12:00:00Z"') where id=$1`,
      [gid("Order", "2")]);
    await db.exec(`update lean_private.history_customer_inventory i set updated_at='2026-01-31T12:00:00Z',
      source_hash=s.source_hash from lean_private.history_report_sources s where i.order_id=s.order_id and i.member_id='member2';`);
    await seal(); await db.exec("update lean_private.history_customer_runs set enabled=true;");
    await step(); await step();
    const rows = await query(`select lean_private.history_customer_report_input('fixture-scale',$1,'2026-01-01','2026-01-03',$2,$3) as value`,
      [project, JSON.stringify({ definition: reporting.definition, mappingVersion: "identity-v1", asOf: scope.asOf, cohorts: reporting.cohorts }),
        [key(shop, "1"), key(shop, "2")]]);
    const out = rows[0].value as { cohorts: Record<string, unknown>[] };
    expect(out.cohorts[0]).toMatchObject({ mature: false, cohortCustomers: null, repeatCustomers: null, revenueUsd: null });
    const members = await query("select member_id,components->0->'mature' as mature from lean_private.history_customer_members order by member_id");
    expect(members).toEqual([{ member_id: "member1", mature: true }, { member_id: "member2", mature: false }]);
  });
  it("blocks changed source payload under an unchanged saved hash", async () => {
    await stage(); await seal();
    await db.exec(`update lean_private.history_customer_runs set enabled=true;
      update lean_private.history_report_sources set source=jsonb_set(source,'{commerce,order,updatedAt}','"2026-01-03T00:00:00Z"');`);
    await expect(step()).rejects.toThrow("pipeline_storage_unavailable");
    expect((await query("select processed from lean_private.history_customer_runs"))[0].processed).toBe(0);
  });
  it("keeps sealed ownership and scope immutable", async () => {
    await stage(); await seal();
    await expect(db.exec("update lean_private.history_customer_inventory set member_id='other';")).rejects.toThrow(/sealed/);
    await expect(db.exec("update lean_private.history_customer_runs set state='staging';")).rejects.toThrow(/state transition/);
  });
  it("rechecks the exact source between claim and finish and writes nothing on mismatch", async () => {
    await stage(); await seal(); await db.exec("update lean_private.history_customer_runs set enabled=true;");
    const token = randomUUID();
    const claimed = (await query("select public.lean_history_customer_claim('fixture-scale',$1,$2) as value", [project, token]))[0].value as HistoryCustomerInput;
    const result = normalizeHistoryCustomer(claimed, new Date().toISOString());
    await db.exec("update lean_private.history_report_sources set source_hash=repeat('f',64);");
    await expect(query("select public.lean_history_customer_finish('fixture-scale',$1,$2,'member1',$3,$4)",
      [project, token, claimed.inputHash, JSON.stringify(result)])).rejects.toThrow(/changed shard/);
    expect((await query("select count(*)::integer as n from lean_private.orders"))[0].n).toBe(0);
  });
  it.each(["missing", "revision", "revoked", "shortened expiry"] as const)(
    "rejects %s authority before claim and before a completed-state response", async kind => {
      await stage(); await seal(); await db.exec("update lean_private.history_customer_runs set enabled=true;");
      expect(await step()).toEqual({ state: "member_written" });
      if (kind === "missing") await db.exec("delete from lean_private.history_customer_authority;");
      if (kind === "revision") await db.exec("update lean_private.history_customer_authority set revision=revision+1;");
      if (kind === "revoked") await db.exec("update lean_private.history_customer_authority set revision=revision+1,available=false;");
      if (kind === "shortened expiry") await db.exec("update lean_private.history_customer_authority set valid_until=clock_timestamp()+interval '1 second';");
      await expect(step()).rejects.toThrow("pipeline_storage_unavailable");
    });
  it("cannot renew authority expiry under the same semantic revision", async () => {
    await stage();
    await expect(db.exec("update lean_private.history_customer_authority set valid_until=valid_until+interval '1 hour';"))
      .rejects.toThrow(/revision required/);
    const acl = (await query(`select has_table_privilege('service_role',
      'lean_private.history_customer_authority','insert,update,delete') as authority_write`))[0];
    expect(acl.authority_write).toBe(false);
  });
  it("rejects a nonnull revenue primitive when the worker admits no complete ledger", async () => {
    await stage(); await seal(); await db.exec("update lean_private.history_customer_runs set enabled=true;");
    const token = randomUUID();
    const claimed = (await query("select public.lean_history_customer_claim('fixture-scale',$1,$2) as value", [project, token]))[0].value as HistoryCustomerInput;
    const result = normalizeHistoryCustomer(claimed, new Date().toISOString());
    expect(result.ledgerComplete).toBe(false);
    result.components[0].revenueUsd = "10.000000";
    await expect(query("select public.lean_history_customer_finish('fixture-scale',$1,$2,'member1',$3,$4)",
      [project, token, claimed.inputHash, JSON.stringify(result)])).rejects.toThrow("history customer revenue admission");
    expect((await query("select processed from lean_private.history_customer_runs"))[0].processed).toBe(0);
  });
  it("uses elapsed H days, not NY calendar days, in the SQL maturity fence across DST", async () => {
    const dstReporting = { ...reporting, fromDate: "2026-03-05", throughDate: "2026-03-05",
      cohorts: [{ ...reporting.cohorts[0], month: "2026-03-01", graceSeconds: 0 }],
      cohortCoverage: [{ ...reporting.cohortCoverage[0], month: "2026-03-01" }] };
    await stage(false, "2026-04-04T11:30:00Z", dstReporting);
    const dst = source(); dst.commerce.order.updatedAt = "2026-03-05T13:00:00Z";
    dst.financial.updatedAt = "2026-03-05T13:00:00Z";
    (dst.commerce.order.transactions as Record<string, unknown>[])[0].processedAt = "2026-03-05T12:00:00Z";
    await query(`update lean_private.history_report_sources set source=$1,
      source_hash=encode(sha256(convert_to($1::jsonb::text,'UTF8')),'hex')`, [JSON.stringify(dst)]);
    await db.exec(`update lean_private.history_import_orders set source=jsonb_set(source,'{updatedAt}','"2026-03-05T13:00:00Z"');
      update lean_private.history_customer_inventory i set updated_at='2026-03-05T13:00:00Z',source_hash=s.source_hash
        from lean_private.history_report_sources s where i.order_id=s.order_id;`);
    await seal(); await db.exec("update lean_private.history_customer_runs set enabled=true;set time zone 'America/New_York';");
    try {
      const token = randomUUID();
      const claimed = (await query("select public.lean_history_customer_claim('fixture-scale',$1,$2) as value", [project, token]))[0].value as HistoryCustomerInput;
      const result = normalizeHistoryCustomer(claimed, new Date().toISOString());
      expect(result.components[0].mature).toBe(false);
      Object.assign(result.components[0], { mature: true, cohortCustomers: 1, repeatCustomers: 0 });
      await expect(query("select public.lean_history_customer_finish('fixture-scale',$1,$2,'member1',$3,$4)",
        [project, token, claimed.inputHash, JSON.stringify(result)])).rejects.toThrow("history customer component value");
      expect((await query("select processed from lean_private.history_customer_runs"))[0].processed).toBe(0);
    } finally { await db.exec("set time zone 'UTC';"); }
  });
  it.each(["authority", "lease"] as const)("rolls back facts when %s expires during the final write", async expiry => {
    await stage(); await seal(); await db.exec("update lean_private.history_customer_runs set enabled=true;");
    if (expiry === "authority") await db.exec(`update lean_private.history_customer_authority
      set captured_at=clock_timestamp(),max_age_seconds=1;`);
    const token = randomUUID();
    const claimed = (await query("select public.lean_history_customer_claim('fixture-scale',$1,$2) as value", [project, token]))[0].value as HistoryCustomerInput;
    const result = normalizeHistoryCustomer(claimed, new Date().toISOString());
    if (expiry === "lease") await db.exec(`update lean_private.history_customer_runs set lease_until=clock_timestamp()+interval '0.05 seconds';`);
    await db.exec(`create function lean_private.fixture_delay_customer_write() returns trigger language plpgsql as $$
      begin perform pg_sleep(1.1); return new; end $$;
      create trigger fixture_delay_customer_write before update on lean_private.history_customer_members
      for each row execute function lean_private.fixture_delay_customer_write();`);
    try {
      await expect(query("select public.lean_history_customer_finish('fixture-scale',$1,$2,'member1',$3,$4)",
        [project, token, claimed.inputHash, JSON.stringify(result)])).rejects.toThrow(
        expiry === "authority" ? "history customer current authority unavailable" : "history customer finish expired");
      expect((await query("select processed from lean_private.history_customer_runs"))[0].processed).toBe(0);
      expect((await query("select count(*)::int as n from lean_private.orders"))[0].n).toBe(0);
    } finally {
      await db.exec(`drop trigger fixture_delay_customer_write on lean_private.history_customer_members;
        drop function lean_private.fixture_delay_customer_write();`);
    }
  });
});
