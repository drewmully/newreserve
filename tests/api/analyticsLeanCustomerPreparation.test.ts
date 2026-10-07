import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { prepareCustomerHistoryRegistration, selectCompletedCustomerBinding,
  type CustomerAuthorityReceipt, type CustomerHistoryRegistration,
  type CompletedCustomerReceipt } from "@/lib/analytics/customerHistoryPreparation";
import { buildFullReports } from "@/lib/analytics/fullReportBuild";
import type { CustomerGenerationInput } from "@/lib/analytics/historyCustomerSource";
import { runHistoryCustomerStep } from "@/lib/analytics/historyCustomerSource";
import { fullFixture, fullProject, fullShop, orderKey } from "../fixtures/analyticsFull";

const now = "2026-03-02T00:00:00.000000Z", expiry = "2026-03-02T00:04:00.000000Z";
const cutoff = "2026-03-01T00:00:00Z";
function authority(): CustomerAuthorityReceipt {
  return { authorityId: "fixture-authority", projectRef: fullProject, shop: fullShop,
    sourceId: "fixture:processing-removal", schemaVersion: "fixture-v1", scopeRef: "fixture:history",
    revision: "1", fingerprint: "a".repeat(64), available: true,
    evidenceRef: "fixture:authority-receipt", capturedAt: now, validUntil: expiry, maxAgeSeconds: 300 };
}
function fixture() {
  const f = fullFixture(), e = f.evidence, a = authority();
  f.policy.cohorts[0].graceSeconds = 172800;
  const memberEvidence = structuredClone(e);
  Object.assign(memberEvidence.identity[0], { namespace: "shopify_customer", identifier: "90" });
  Object.assign(memberEvidence.orderIdentities[0], { namespace: "shopify_customer", identifier: "90" });
  memberEvidence.proofs.find(p => p.table === "identity_map")!.expectedKeys = [
    JSON.stringify(["shopify_customer", "90", "2025-01-01T00:00:00Z", "identity-v1"]),
  ];
  const input: CustomerHistoryRegistration = {
    runId: "customer-fixture", sourceRun: "history-fixture",
    scope: { projectRef: fullProject, shop: fullShop, asOf: f.policy.asOf, expiresAt: expiry,
      sourceOrigin: "2020-01-01T00:00:00Z", completeThrough: cutoff, mappingVersion: f.policy.mappingVersion,
      policy: { productClasses: { "3": "merchandise" },
        decision: { eligibility: "eligible", commerceSource: "other", acquisitionEligible: true, approvalRef: "fixture:order" },
        financialApprovalRef: "fixture:finance", saleClock: "paid_at", refundClock: "refund_created_at" },
      reporting: { definition: f.policy.definition, fromDate: f.fromDate, throughDate: f.throughDate,
        cohorts: f.policy.cohorts, cohortCoverage: e.cohortCoverage },
      sourceScopeHash: "b".repeat(64), sourceCompletionHash: "c".repeat(64),
      approvalRef: "fixture:owner-scope", inventoryRef: "fixture:independent-inventory",
      migrationEvidenceRef: "fixture:migration-reconciliation", permissionEvidenceRef: a.evidenceRef,
      permissionValidUntil: expiry, maxSourceAgeSeconds: 604800, authorityId: a.authorityId,
      authorityScopeRef: a.scopeRef, authorityRevision: a.revision, authorityFingerprint: a.fingerprint },
    members: [{ memberId: "member1", customerId: "customer-fixture", evidence: {
      ref: e.ref, identity: memberEvidence.identity, currentlyPermitted: e.currentlyPermitted, removedCustomers: e.removedCustomers,
      customerHistory: { "customer-fixture": { ...e.customerHistory["customer-fixture"], completeThrough: cutoff } },
      orderIdentities: memberEvidence.orderIdentities, proofs: memberEvidence.proofs, externalControls: e.externalControls,
      cohortCoverage: e.cohortCoverage,
    } }],
    inventory: [{ memberId: "member1", orderId: "gid://shopify/Order/1", updatedAt: "2026-01-01T13:00:00Z",
      sourceHash: "d".repeat(64),
      decision: { eligibility: "eligible", commerceSource: "other", acquisitionEligible: true, approvalRef: "fixture:order" } }],
  };
  const source = { state: "complete" as const, projectRef: fullProject, shop: fullShop, sourceRun: input.sourceRun,
    includeCustomerId: true as const, sourceScopeHash: input.scope.sourceScopeHash,
    sourceCompletionHash: input.scope.sourceCompletionHash, orderCount: 1, untilTime: cutoff };
  return { input, source, a, f };
}
function receipt(): CompletedCustomerReceipt {
  const { input, a } = fixture();
  const { cohortCoverage: _coverage, ...reporting } = input.scope.reporting; void _coverage;
  return { state: "complete", runId: input.runId, projectRef: fullProject, shop: fullShop,
    sourceRun: input.sourceRun, sourceCompletionHash: input.scope.sourceCompletionHash,
    generationHash: "e".repeat(64), resultHash: "f".repeat(64), mappingVersion: input.scope.mappingVersion,
    asOf: input.scope.asOf, expiresAt: expiry, reporting, authority: a };
}
function selection(receipts = [receipt()]) {
  const { f } = fixture();
  return { registeredRunIds: receipts.map(r => r.runId), receipts, projectRef: fullProject, shop: fullShop,
    fromDate: f.fromDate, throughDate: f.throughDate, policy: f.policy, now };
}

describe("offline customer preparation", () => {
  it("emits only disabled owner registration, with no generated completion hash or source action", () => {
    const { input, source, a } = fixture(), before = structuredClone(input);
    const result = prepareCustomerHistoryRegistration(input, source, a, now);
    expect(result).toMatchObject({ state: "prepared", registered: false, enabled: false,
      generationHash: null, resultHash: null, registration: { rpc: "lean_history_customer_register" } });
    expect(result.registration.args.p_scope).toEqual(input.scope);
    expect(input).toEqual(before);
  });
  it.each(["unavailable", "stale", "future", "expired", "revision", "fingerprint", "wrong target"] as const)(
    "refuses %s processing/removal authority", kind => {
      const { input, source, a } = fixture();
      if (kind === "unavailable") a.available = false;
      if (kind === "stale") a.capturedAt = "2026-03-01T23:54:59.999999Z";
      if (kind === "future") a.capturedAt = "2026-03-02T00:00:00.000001Z";
      if (kind === "expired") a.validUntil = now;
      if (kind === "revision") a.revision = "2";
      if (kind === "fingerprint") a.fingerprint = "b".repeat(64);
      if (kind === "wrong target") a.projectRef = "b".repeat(20);
      expect(() => prepareCustomerHistoryRegistration(input, source, a, now)).toThrow();
    });
  it.each(["count", "completion", "missing customer projection", "migration", "permission", "duplicate order",
    "duplicate customer", "foreign member", "101 orders", "extra scope", "raw member field",
    "missing order link", "unsupported namespace", "missing independent proof"] as const)(
    "refuses %s rather than silently narrowing source coverage", kind => {
      const { input, source, a } = fixture();
      if (kind === "count") source.orderCount = 2;
      if (kind === "completion") source.sourceCompletionHash = "d".repeat(64);
      if (kind === "missing customer projection") Object.assign(source, { includeCustomerId: false });
      if (kind === "migration") input.members[0].evidence.customerHistory["customer-fixture"].migrationsReconciled = false;
      if (kind === "permission") input.members[0].evidence.currentlyPermitted = [];
      if (kind === "duplicate order") { input.inventory.push(structuredClone(input.inventory[0])); source.orderCount = 2; }
      if (kind === "duplicate customer") input.members.push({ ...structuredClone(input.members[0]), memberId: "member2" });
      if (kind === "foreign member") input.inventory[0].memberId = "missing";
      if (kind === "101 orders") {
        input.inventory = Array.from({ length: 101 }, (_, i) => ({ ...input.inventory[0], orderId: `gid://shopify/Order/${i + 1}` }));
        source.orderCount = 101;
      }
      if (kind === "extra scope") Object.assign(input.scope, { enabled: true });
      if (kind === "raw member field") Object.assign(input.members[0], { email: "synthetic-not-collected" });
      if (kind === "missing order link") input.members[0].evidence.orderIdentities = [];
      if (kind === "unsupported namespace") input.members[0].evidence.orderIdentities[0].namespace = "firebase";
      if (kind === "missing independent proof") input.members[0].evidence.proofs = [];
      expect(() => prepareCustomerHistoryRegistration(input, source, a, now)).toThrow();
    });
  it("does not require a financial proof just to prepare complete customer order history", () => {
    const { input, source, a } = fixture();
    input.members[0].evidence.proofs = input.members[0].evidence.proofs.filter(p => p.table !== "sales_ledger");
    input.members[0].evidence.cohortCoverage[0].ledgerLineageComplete = false;
    expect(prepareCustomerHistoryRegistration(input, source, a, now).enabled).toBe(false);
  });
});

describe("actual customer registration SQL", () => {
  let db: PGlite;
  const query = async (sql: string, params: unknown[] = []) =>
    (await db.query<Record<string, unknown>>(sql, params)).rows;
  beforeAll(async () => {
    db = new PGlite();
    await db.exec("create role anon;create role authenticated;create role service_role;");
    for (const file of ["001_staging", "019_spend_jobs", "040_shopify_history_import",
      "041_history_report_bridge", "proposed_history_customer_source", "customer_history_registration.review"])
      await db.exec(readFileSync(`sql/analytics/${file}.sql`, "utf8"));
  }, 30000);
  afterAll(async () => { await db?.close(); });
  async function stage() {
    await db.exec("truncate lean_private.history_import_jobs,lean_private.publications,lean_private.history_customer_authority cascade;");
    const { input, source: control, a } = fixture(), e = input.members[0].evidence;
    const asOf = new Date(Date.now() - 1000).toISOString(), expiresAt = new Date(Date.now() + 60000).toISOString();
    Object.assign(input.scope, { asOf, expiresAt, permissionValidUntil: expiresAt });
    Object.assign(a, { capturedAt: asOf, validUntil: expiresAt });
    Object.assign(e.identity[0], { namespace: "shopify_customer", identifier: "90" });
    Object.assign(e.orderIdentities[0], { namespace: "shopify_customer", identifier: "90" });
    e.proofs = e.proofs.filter(p => ["orders", "order_items", "customers", "identity_map"].includes(p.table));
    e.proofs.find(p => p.table === "identity_map")!.expectedKeys = [
      JSON.stringify(["shopify_customer", "90", "2025-01-01T00:00:00Z", "identity-v1"]),
    ];
    const gid = (kind: string, id: string) => `gid://shopify/${kind}/${id}`;
    const money = (amount: string) => ({ shopMoney: { amount, currencyCode: "USD" } });
    const updatedAt = input.inventory[0].updatedAt;
    const source = {
      commerce: { shop: fullShop, apiVersion: "2026-07", projection: "financial_customer_id", order: {
        id: gid("Order", "1"), customer: { id: gid("Customer", "90") },
        createdAt: "2026-01-01T11:00:00Z", updatedAt, currencyCode: "USD", edited: false,
        taxesIncluded: false, test: false, cancelledAt: null, originalTotalPriceSet: money("20"),
        subtotalPriceSet: money("20"), transactionsCount: { count: 1, precision: "EXACT" },
        transactions: [{ id: gid("OrderTransaction", "4"), kind: "SALE", status: "SUCCESS", gateway: "fixture",
          test: false, createdAt: "2026-01-01T12:00:00Z", processedAt: "2026-01-01T12:00:00Z",
          amountSet: money("20"), parentTransaction: null }],
        lineItems: { nodes: [{ id: gid("LineItem", "2"), sku: "SKU", quantity: 1, isGiftCard: false,
          product: { id: gid("Product", "3") }, originalUnitPriceSet: money("20"), originalTotalSet: money("20"),
          discountAllocations: [] }], pageInfo: { hasNextPage: false, endCursor: null } },
      } },
      financial: { id: gid("Order", "1"), updatedAt, currencyCode: "USD", originalTotalPriceSet: money("20"),
        totalTaxSet: money("0"), originalTotalDutiesSet: null, originalTotalAdditionalFeesSet: null,
        totalTipReceivedSet: money("0"), shippingLines: { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } },
        refunds: [] }, refunds: [],
    };
    await query(`insert into lean_private.history_import_jobs(job_id,scope,expires_at,enabled,state,orders,completion)
      values('import-fixture',$1,$2,true,'complete',1,'{"eof":true}')`,
    [JSON.stringify({ projectRef: fullProject, shop: fullShop, untilTime: cutoff }), expiresAt]);
    await query(`insert into lean_private.history_import_orders values('import-fixture',$1,$2)`,
      [gid("Order", "1"), JSON.stringify({ id: gid("Order", "1"), createdAt: "2026-01-01T11:00:00Z", updatedAt })]);
    await query(`insert into lean_private.history_report_jobs(run_id,scope,source_job,source_hash,expires_at,state,report_date)
      select 'history-fixture',$1,'import-fixture',encode(sha256(convert_to(completion::text,'UTF8')),'hex'),$2,'complete','2026-01-01'
      from lean_private.history_import_jobs`,
    [JSON.stringify({ projectRef: fullProject, shop: fullShop, includeCustomerId: true, policy: input.scope.policy }), expiresAt]);
    await query(`insert into lean_private.history_report_sources(run_id,order_id,source,captured_at,source_hash,outcome,result_hash)
      values('history-fixture',$1,$2,$3,encode(sha256(convert_to($2::jsonb::text,'UTF8')),'hex'),'financial_observed','fixture')`,
    [gid("Order", "1"), JSON.stringify(source), asOf]);
    const hashes = (await query(`select h.source_hash as completion,
      encode(sha256(convert_to(h.scope::text,'UTF8')),'hex') as scope,
      s.source_hash as source from lean_private.history_report_jobs h
      join lean_private.history_report_sources s on s.run_id=h.run_id`))[0];
    input.scope.sourceCompletionHash = control.sourceCompletionHash = String(hashes.completion);
    input.scope.sourceScopeHash = control.sourceScopeHash = String(hashes.scope);
    input.inventory[0].sourceHash = String(hashes.source);
    const fingerprint = (await query(`select encode(sha256(convert_to(encode(sha256(convert_to(
      jsonb_build_array('customer-fixture',$1::jsonb->'identity',$1::jsonb->'currentlyPermitted',
        $1::jsonb->'removedCustomers')::text,'UTF8')),'hex'),'UTF8')),'hex') as value`, [JSON.stringify(e)]))[0].value;
    input.scope.authorityFingerprint = a.fingerprint = String(fingerprint);
    await query(`insert into lean_private.history_customer_authority values(
      $1,$2,$3,$4,$5,$6,1,$7,$8,$9,300,$10,true)`,
    [a.authorityId, fullProject, fullShop, a.scopeRef, a.sourceId, a.schemaVersion, a.fingerprint,
      a.capturedAt, a.validUntil, a.evidenceRef]);
    return { input, control, a };
  }
  const register = async (input: CustomerHistoryRegistration) => (await query(
    "select public.lean_history_customer_register($1,$2,$3,$4,$5) as value",
    [input.runId, input.sourceRun, JSON.stringify(input.scope), JSON.stringify(input.members), JSON.stringify(input.inventory)]))[0].value;
  it("atomically reuses the real seal, stays disabled and denies runtime preparation/binding reads", async () => {
    const { input } = await stage();
    const registration = await register(input);
    expect(registration).toMatchObject({ state: "sealed", enabled: false, resultHash: null });
    const privileges = (await query(`select
      has_function_privilege('service_role','public.lean_history_customer_register(text,text,jsonb,jsonb,jsonb)','execute') as register,
      has_function_privilege('service_role','public.lean_history_customer_completed_binding(text,text)','execute') as binding`))[0];
    expect(privileges).toEqual({ register: false, binding: false });
    await expect(query("select public.lean_history_customer_completed_binding($1,$2)", [input.runId, fullProject])).rejects.toThrow();
    await expect(register(input)).rejects.toThrow();
    expect((await query("select count(*)::integer as n from lean_private.history_customer_runs"))[0].n).toBe(1);
  });
  it("rolls back all new input rows when exact retained revision validation fails", async () => {
    const { input } = await stage();
    input.inventory[0].sourceHash = "0".repeat(64);
    await expect(register(input)).rejects.toThrow();
    for (const table of ["history_customer_runs", "history_customer_members", "history_customer_inventory"])
      expect((await query(`select count(*)::integer as n from lean_private.${table}`))[0].n).toBe(0);
  });
  it("returns a binding only after the real member worker completes, and rechecks revocation", async () => {
    const { input, control, a } = await stage();
    const prepared = prepareCustomerHistoryRegistration(input, control, a, new Date().toISOString());
    expect(prepared.registered).toBe(false);
    await register(input);
    await query("update lean_private.history_customer_runs set enabled=true where run_id=$1", [input.runId]);
    const result = await runHistoryCustomerStep({ approved: true, runId: input.runId, projectRef: fullProject,
      client: { async rpc(name, args) {
        if (!["lean_history_customer_claim", "lean_history_customer_finish"].includes(name)) throw new Error("fixture rpc");
        const rows = await query(`select public.${name}(${Object.keys(args).map((k, i) => `${k}=>$${i + 1}`).join(",")}) as value`,
          Object.values(args).map(v => typeof v === "object" && v !== null ? JSON.stringify(v) : v));
        return { data: rows[0].value, error: null };
      } } });
    expect(result.state).toBe("member_written");
    const completed = (await query("select public.lean_history_customer_completed_binding($1,$2) as value",
      [input.runId, fullProject]))[0].value as CompletedCustomerReceipt;
    expect(completed.state).toBe("complete");
    expect(completed.reporting).not.toHaveProperty("cohortCoverage");
    const s = selection([completed]); s.policy.asOf = input.scope.asOf; s.now = new Date().toISOString();
    expect(selectCompletedCustomerBinding(s).resultHash).toMatch(/^[a-f0-9]{64}$/);
    await query("update lean_private.history_customer_authority set available=false,revision=revision+1 where authority_id=$1", [a.authorityId]);
    await expect(query("select public.lean_history_customer_completed_binding($1,$2)", [input.runId, fullProject])).rejects.toThrow();
  });
});

describe("completed-only customer selection", () => {
  it("selects the exact registered completed window, not a later run", () => {
    const ready = receipt(), later = structuredClone(ready);
    later.runId = "next-window"; later.reporting.fromDate = "2026-01-02"; later.reporting.throughDate = "2026-01-02";
    const result = selectCompletedCustomerBinding(selection([ready, later]));
    expect(result).toEqual({ runId: ready.runId, generationHash: ready.generationHash, resultHash: ready.resultHash,
      authorityId: ready.authority.authorityId, authorityRevision: "1", authorityFingerprint: ready.authority.fingerprint });
    expect(Object.keys(result)).toHaveLength(6);
  });
  it.each(["unregistered", "unfinished", "missing result", "duplicate", "ambiguous", "stale", "revoked",
    "expired", "wrong window", "changed scope", "changed binding"] as const)("refuses %s receipt", kind => {
      const value = selection(), r = value.receipts[0];
      if (kind === "unregistered") value.registeredRunIds = ["some-other-run"];
      if (kind === "unfinished") Object.assign(r, { state: "sealed" });
      if (kind === "missing result") Object.assign(r, { resultHash: null });
      if (kind === "duplicate") value.receipts.push(structuredClone(r));
      if (kind === "ambiguous") { value.registeredRunIds.push("other"); value.receipts.push({ ...r, runId: "other" }); }
      if (kind === "stale") r.authority.capturedAt = "2026-03-01T23:54:59Z";
      if (kind === "revoked") r.authority.available = false;
      if (kind === "expired") r.expiresAt = now;
      if (kind === "wrong window") r.reporting.fromDate = "2026-01-02";
      if (kind === "changed scope") r.authority.shop = "another.myshopify.com";
      if (kind === "changed binding") value.policy.customerGeneration = {
        runId: r.runId, generationHash: r.generationHash, resultHash: "0".repeat(64),
        authorityId: r.authority.authorityId, authorityRevision: "1", authorityFingerprint: r.authority.fingerprint };
      expect(() => selectCompletedCustomerBinding(value)).toThrow();
    });
  it.each([true, false])("uses existing full builder with ledgerComplete=%s and fixed expected customer values", complete => {
    const { f } = fixture(), r = receipt();
    f.policy.customerGeneration = selectCompletedCustomerBinding(selection());
    f.evidence.customerHistory["customer-fixture"].completeSources = [];
    f.evidence.dateCoverage[0].gates.orders = false;
    f.evidence.dateCoverage[0].gates.ledger = complete;
    f.evidence.cohortCoverage[0].ledgerLineageComplete = complete;
    // Synthetic SQL-derived envelope, not a preparation output or live record.
    const derived: CustomerGenerationInput = {
      version: 1, runId: r.runId, sourcePublication: `customer-history:${r.runId}`,
      sourceRun: r.sourceRun, sourceCompletionHash: r.sourceCompletionHash,
      generationHash: r.generationHash, resultHash: r.resultHash, projectRef: fullProject, shop: fullShop,
      fromDate: f.fromDate, throughDate: f.throughDate, definition: f.policy.definition,
      mappingVersion: f.policy.mappingVersion, asOf: f.policy.asOf,
      sourceOrigin: "2020-01-01T00:00:00Z", completeThrough: cutoff,
      authority: r.authority, dates: [{ date: f.fromDate, newCustomers: 2 }],
      cohorts: [{ cohortMonth: "2026-01-01", horizonDays: 30, graceSeconds: 172800,
        acquisitionDefinition: "first-order-v1", asOf: f.policy.asOf, mature: true,
        cohortCustomers: 2, repeatCustomers: 1, revenueUsd: complete ? "30.000000" : null }],
      orderBindings: [{ orderId: orderKey, customerId: "customer-fixture", paidAt: "2026-01-01T12:00:00Z",
        sourceUpdatedAt: "2026-01-01T13:00:00Z", eligibility: "eligible", firstEligibleOrder: true }],
    };
    f.evidence.customerGeneration = derived;
    const out = buildFullReports(f);
    expect(out.reports.store_daily[0]).toMatchObject({ new_customers: 2, ncac_usd: "2.500000" });
    expect(out.reports.customer_cohorts[0]).toMatchObject({ cohort_customers: 2, repeat_customers: 1,
      repeat_purchase_rate: "0.500000", revenue_ltv_usd: complete ? "15.000000" : null });
    Object.assign(derived.cohorts[0], { mature: false, cohortCustomers: null, repeatCustomers: null, revenueUsd: null });
    const immature = buildFullReports(f);
    expect(immature.reports.store_daily[0].new_customers).toBe(2);
    expect(immature.reports.customer_cohorts[0]).toMatchObject({
      mature: false, repeat_purchase_rate: null, revenue_ltv_usd: null,
    });
  });
});
