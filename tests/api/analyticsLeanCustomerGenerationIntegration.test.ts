/** Disposable SQL + synthetic retained source. No installed/live acceptance. */
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, afterEach, expect, it, vi } from "vitest";
import { fullFixture, fullShop, orderKey, itemKey } from "../fixtures/analyticsFull";
import { refreshFixture } from "../fixtures/analyticsRefresh";
import { prepareRefresh } from "@/lib/analytics/refreshPlan";
import { runFullReportJob } from "@/lib/analytics/fullReportJob";
import { buildFullReports } from "@/lib/analytics/fullReportBuild";
import { runHistoryCustomerStep } from "@/lib/analytics/historyCustomerSource";
import { validProductionWorkbookPayload } from "@/lib/analytics/productionWorkbookDelivery";
import { key } from "@/lib/analytics/primitives";
import type { AnalyticsRpcClient } from "@/lib/analytics/rpcStore";

const project = /const project = "([^"]+)"/.exec(readFileSync("src/lib/analytics/productionReportDelivery.ts", "utf8"))![1];
const affected = ["store_daily", "acquisition_daily", "customer_cohorts"];
const domains = ["store_daily", "product_daily", "acquisition_daily", "customer_cohorts", "funnel_daily"];
let db: PGlite;
let f: ReturnType<typeof fullFixture>, bundle: ReturnType<typeof prepareRefresh>;
let lastFinish: Record<string, unknown> | undefined;
async function rpc(name: string, args: Record<string, unknown>) {
  return (await db.query<{ value: unknown }>(`select ${name}(${Object.keys(args).map((k, i) => `${k}=>$${i + 1}`).join(",")}) value`,
    Object.entries(args).map(([k, v]) => k === "p_domains" ? v : v && typeof v === "object" ? JSON.stringify(v) : v))).rows[0].value;
}
const client: AnalyticsRpcClient = { async rpc(name, args) {
  if (!["lean_full_inputs", "lean_full_claim", "lean_full_finish", "lean_full_fail",
    "lean_history_customer_claim", "lean_history_customer_finish"].includes(name)) throw new Error("unexpected_rpc");
  if (name === "lean_full_finish") lastFinish = structuredClone(args);
  try { return { data: await rpc(`public.${name}`, args), error: null }; }
  catch (error) { return { data: null, error }; }
} };
const sql = (name: string) => readFileSync(`sql/analytics/${name}.sql`, "utf8");
beforeAll(async () => {
  db = new PGlite();
  await db.exec(`create role anon;create role authenticated;create role service_role;
    alter default privileges in schema public grant execute on functions to anon,authenticated,service_role;`);
  for (const name of ["001_staging", "013_release", "014_reporting_views", "018_history_jobs", "019_spend_jobs",
    "020_observed_report_jobs", "021_full_report_jobs", "022_full_release", "023_posthog_export", "024_full_orchestration",
    "025_refresh_queue", "026_journey_authority", "027_history_update_scans", "029_journey_decisions",
    "030_scoped_release", "031_draft_receipts", "034_commerce_only_refresh", "035_discovery_inventory_fence",
    "036_partitioned_refresh", "037_canonical_journey_timestamps", "038_google_spend_pilot",
    "040_shopify_history_import", "041_history_report_bridge", "053_production_workbook_delivery",
    "proposed_history_customer_source", "customer_generation_full_integration.review"]) await db.exec(sql(name));
}, 30000);
beforeEach(async () => {
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("hosted_network_forbidden"); }));
  await db.exec(`truncate lean_private.history_import_jobs,lean_private.publications,lean_private.history_customer_authority,
    lean_private.full_builds,lean_private.report_builds,lean_private.history_jobs,lean_private.spend_jobs,
    lean_private.refresh_limits cascade;
    truncate lean_export.store_daily,lean_export.product_daily,lean_export.acquisition_daily,
      lean_export.customer_cohorts,lean_export.funnel_daily;
    insert into lean_private.production_workbook_delivery(singleton) values(true);`);
  f = fullFixture();
  lastFinish = undefined;
});
afterEach(() => { expect(fetch).not.toHaveBeenCalled(); vi.unstubAllGlobals(); });
afterAll(async () => { await db?.close(); });

async function stage(bound = true, expiresIn = 3600000, emptyCohorts = false) {
  const refresh = refreshFixture(), asOf = refresh.intake.asOf;
  if (emptyCohorts) refresh.policy.cohorts = [];
  refresh.intake.scope.projectRef = project;
  const expiry = new Date(Date.now() + expiresIn).toISOString(), cutoff = "2026-03-01T00:00:00Z";
  const reporting = { definition: refresh.policy.definition, fromDate: f.fromDate, throughDate: f.throughDate,
    cohorts: refresh.policy.cohorts, cohortCoverage: emptyCohorts ? [] : f.evidence.cohortCoverage };
  const decision = refresh.commercePolicy.decision;
  const money = (amount: string) => ({ shopMoney: { amount, currencyCode: "USD" } });
  const source = { commerce: { shop: fullShop, apiVersion: "2026-07", projection: "financial_customer_id", order: {
    id: "gid://shopify/Order/1", customer: { id: "gid://shopify/Customer/90" },
    createdAt: "2026-01-01T11:00:00Z", updatedAt: "2026-01-01T13:00:00Z", currencyCode: "USD",
    edited: false, taxesIncluded: false, test: false, cancelledAt: null,
    originalTotalPriceSet: money("20"), subtotalPriceSet: money("20"), transactionsCount: { count: 1, precision: "EXACT" },
    transactions: [{ id: "gid://shopify/OrderTransaction/1", kind: "SALE", status: "SUCCESS", gateway: "fixture",
      test: false, createdAt: "2026-01-01T12:00:00Z", processedAt: "2026-01-01T12:00:00Z",
      amountSet: money("20"), parentTransaction: null }],
    lineItems: { nodes: [{ id: "gid://shopify/LineItem/2", sku: "SKU", quantity: 1, isGiftCard: false,
      product: { id: "gid://shopify/Product/3" }, originalUnitPriceSet: money("20"), originalTotalSet: money("20"),
      discountAllocations: [] }], pageInfo: { hasNextPage: false, endCursor: null } },
  } }, financial: { id: "gid://shopify/Order/1", updatedAt: "2026-01-01T13:00:00Z", currencyCode: "USD",
    originalTotalPriceSet: money("20"), totalTaxSet: money("0"), originalTotalDutiesSet: null,
    originalTotalAdditionalFeesSet: null, totalTipReceivedSet: money("0"),
    shippingLines: { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } }, refunds: [] }, refunds: [] };
  const identity = [{ ...f.evidence.identity[0], namespace: "shopify_customer", identifier: "90" }];
  const proof = (table: string, keyFields: string[], keys: unknown[][]) => ({
    table, keyFields, expectedKeys: keys.map(k => JSON.stringify(k)), amountChecks: [], complete: true,
    independentlyExtracted: true, evidenceRef: `fixture:independent:${table}`,
  });
  const evidence = { ref: "fixture:customer-evidence", identity, currentlyPermitted: ["customer-fixture"], removedCustomers: [],
    customerHistory: { "customer-fixture": { ...f.evidence.customerHistory["customer-fixture"], completeThrough: cutoff } },
    orderIdentities: [{ orderId: orderKey, namespace: "shopify_customer", identifier: "90", evidenceRef: "fixture:owner" }],
    proofs: [proof("orders", ["order_id"], [[orderKey]]), proof("order_items", ["order_item_id"], [[itemKey]]),
      proof("customers", ["customer_id"], [["customer-fixture"]]),
      proof("identity_map", ["source_namespace", "source_identifier", "valid_from", "mapping_version"],
        [["shopify_customer", "90", identity[0].from, "identity-v1"]])],
    externalControls: { temporal_identity_intervals: { passed: true, evidenceRef: "fixture:identity-control" } },
    cohortCoverage: [],
  };
  await db.query(`insert into lean_private.history_import_jobs(job_id,scope,expires_at,enabled,state,orders,completion)
    values('source-import',$1,$2,true,'complete',1,'{"eof":true}')`,
  [JSON.stringify({ projectRef: project, shop: fullShop, untilTime: cutoff }), expiry]);
  await db.query(`insert into lean_private.history_report_jobs(run_id,scope,source_job,source_hash,expires_at,state,report_date)
    select 'source-history',$1,job_id,encode(sha256(convert_to(completion::text,'UTF8')),'hex'),$2,'complete','2026-01-01'
    from lean_private.history_import_jobs`,
  [JSON.stringify({ projectRef: project, shop: fullShop, includeCustomerId: true, policy: refresh.commercePolicy }), expiry]);
  const meta = (await db.query<{ source_hash: string; scope_hash: string }>(`select source_hash,
    encode(sha256(convert_to(scope::text,'UTF8')),'hex') scope_hash from lean_private.history_report_jobs`)).rows[0];
  const fingerprint = (await db.query<{ value: string }>(`select encode(sha256(convert_to(
    encode(sha256(convert_to(jsonb_build_array('customer-fixture',$1::jsonb,$2::jsonb,'[]'::jsonb)::text,'UTF8')),'hex'),
    'UTF8')),'hex') value`, [JSON.stringify(identity), JSON.stringify(evidence.currentlyPermitted)])).rows[0].value;
  await db.query(`insert into lean_private.history_customer_authority values('authority',$1,$2,'fixture:scope',
    'fixture:actual-source','fixture-v1',1,$3,$4,$5,300,'fixture:retained-receipt',true)`,
  [project, fullShop, fingerprint, asOf, expiry]);
  const scope = { projectRef: project, shop: fullShop, asOf, expiresAt: expiry, sourceOrigin: "2020-01-01T00:00:00Z",
    completeThrough: cutoff, sourceScopeHash: meta.scope_hash, sourceCompletionHash: meta.source_hash,
    mappingVersion: "identity-v1", policy: refresh.commercePolicy, reporting, approvalRef: "fixture:source",
    inventoryRef: "fixture:original-inventory", migrationEvidenceRef: "fixture:migration",
    permissionEvidenceRef: "fixture:privacy", permissionValidUntil: expiry, maxSourceAgeSeconds: 604800,
    authorityId: "authority", authorityScopeRef: "fixture:scope", authorityRevision: "1", authorityFingerprint: fingerprint };
  await db.query(`insert into lean_private.history_customer_runs(run_id,source_run,scope) values('customer-source','source-history',$1)`,
    [JSON.stringify(scope)]);
  await db.query(`insert into lean_private.history_import_orders values('source-import','gid://shopify/Order/1',$1)`,
    [JSON.stringify({ id: "gid://shopify/Order/1", createdAt: source.commerce.order.createdAt, updatedAt: source.commerce.order.updatedAt })]);
  await db.query(`insert into lean_private.history_report_sources(run_id,order_id,source,captured_at,source_hash,outcome,result_hash)
    values('source-history','gid://shopify/Order/1',$1,$2,encode(sha256(convert_to($1::jsonb::text,'UTF8')),'hex'),'financial_observed','fixture')`,
  [JSON.stringify(source), asOf]);
  await db.query(`insert into lean_private.history_customer_members(run_id,member_id,customer_id,evidence)
    values('customer-source','one','customer-fixture',$1)`, [JSON.stringify(evidence)]);
  await db.query(`insert into lean_private.history_customer_inventory
    select 'customer-source','one',order_id,$1,source_hash,$2 from lean_private.history_report_sources`,
  [source.commerce.order.updatedAt, JSON.stringify(decision)]);
  await rpc("public.lean_history_customer_seal", { p_run: "customer-source" });
  await db.exec("update lean_private.history_customer_runs set enabled=true");
  expect(await runHistoryCustomerStep({ approved: true, client, runId: "customer-source", projectRef: project }))
    .toEqual({ state: "member_written" });
  const sourceRun = (await db.query<{ generation_hash: string; result_hash: string }>(
    "select generation_hash,result_hash from lean_private.history_customer_runs")).rows[0];
  if (bound) refresh.policy.customerGeneration = { runId: "customer-source",
    generationHash: sourceRun.generation_hash, resultHash: sourceRun.result_hash,
    authorityId: "authority", authorityRevision: "1", authorityFingerprint: fingerprint };
  bundle = prepareRefresh(refresh);
  // Real permitted owner registration, not a direct full_builds INSERT.
  expect(await rpc("public.lean_refresh_register", { p_bundle: bundle })).toBe(bundle.runId);
  await db.query(`insert into lean_private.refresh_limits(project_ref,enabled,max_daily_steps,approval_ref,actor_ref)
    values($1,true,5,'fixture:enable','fixture:owner')`, [project]);
  await db.exec(`update lean_private.full_builds set enabled=true;update lean_private.report_builds set enabled=true;
    update lean_private.refresh_queue set enabled=true;update lean_private.history_jobs set enabled=true,complete=true;
    update lean_private.spend_jobs set enabled=true;`);
  await rpc("public.lean_refresh_claim", { p_project_ref: project, p_token: randomUUID() });
  await db.query("insert into lean_private.publications(publication_id,contract_version) values($1,'lean-v1-draft.1')",
    [`observed:${bundle.base.runId}`]);
  for (const [table, rows] of Object.entries(f.base)) await db.query(
    `insert into lean_private.${table} select * from jsonb_populate_recordset(null::lean_private.${table},$1)`,
    [JSON.stringify(rows.map(r => ({ ...r, publication_id: `observed:${bundle.base.runId}` })))]);
  await db.exec("update lean_private.report_builds set completed_at=clock_timestamp(),result_hash='fixture:completed-base'");
}
const args = () => ({ p_run: bundle.runId, p_project_ref: project });
async function build() {
  expect(await runFullReportJob({ client, projectRef: project, databaseUrl: `https://${project}.supabase.co`,
    runId: bundle.runId, posthogKey: "fixture", request: async () => Response.json(f.wire) })).toMatchObject({ state: "complete" });
}
async function select(selected = domains) {
  await rpc("public.lean_scoped_release", { ...args(), p_domains: selected,
    p_expected_previous: Object.fromEntries(selected.map(d => [d, null])),
    p_approval: "fixture:review", p_reconciliation: "fixture:control", p_actor: "fixture:owner" });
  await db.query(`update lean_private.production_workbook_delivery set enabled=true,run_id=$1,
    project_ref=$2,shop=$3,approval_ref='fixture:delivery'`, [bundle.runId, project, fullShop]);
}
const read = () => rpc("public.lean_production_workbook_reports_read", { p_project_ref: project }) as Promise<Record<string, Record<string, unknown>[]>>;
const exportRows = (selected = domains) => rpc("public.lean_scoped_export", { ...args(),
  p_domains: selected, p_approval: "fixture:export", p_actor: "fixture:owner" });

it("registers six immutable policy references through actual preparation/owner registration and derives input", async () => {
  await stage();
  const stored = (await db.query<{ policy: unknown; evidence: Record<string, unknown> }>("select policy,evidence from lean_private.full_builds")).rows[0];
  expect(stored.policy).toEqual(bundle.full.policy); expect(stored.evidence).not.toHaveProperty("customerGeneration");
  const input = await rpc("public.lean_full_inputs", args()) as Record<string, unknown>;
  expect(input).toMatchObject({ state: "ready", evidence: { ref: bundle.full.evidence.ref, customerGeneration: {
    runId: "customer-source", sourcePublication: "customer-history:customer-source", dates: [{ date: f.fromDate, newCustomers: 1 }],
  } } });
  expect(JSON.stringify(input).length).toBeLessThan(8000000);
  await expect(db.exec(`update lean_private.full_builds set policy=policy-'customerGeneration'`)).rejects.toThrow(/immutable/);
});
it("uses the actual full job, selected reader and common publication without copying lifetime facts", async () => {
  await stage(); await build(); await select();
  const payload = await read(); expect(validProductionWorkbookPayload(payload)).toBe(true);
  expect(payload.store_daily[0].new_customers).toBe("1");
  expect(payload.customer_cohorts[0]).toMatchObject({ repeat_customers: "0", revenue_ltv_usd: null });
  expect(new Set(payload.report_status.map(r => r.publication_id))).toEqual(new Set([`full:${bundle.runId}`]));
  expect((await db.query("select count(*)::int n from lean_private.orders where publication_id=$1",
    [`full:${bundle.runId}`])).rows).toEqual([{ n: 1 }]);
});
it.each(["policy extra", "policy null", "precomputed evidence"] as const)("rejects %s through actual registration", async kind => {
  const input = refreshFixture();
  if (kind === "policy null") Object.assign(input.policy, { customerGeneration: null });
  else Object.assign(input.policy, { customerGeneration: { runId: "x", generationHash: "a".repeat(64),
    resultHash: "b".repeat(64), authorityId: "authority", authorityRevision: "1", authorityFingerprint: "c".repeat(64),
    ...(kind === "policy extra" ? { fabricated: true } : {}) } });
  const b = prepareRefresh(input);
  if (kind === "precomputed evidence") Object.assign(b.full.evidence, { customerGeneration: { dates: [] } });
  await expect(rpc("public.lean_refresh_register", { p_bundle: b })).rejects.toThrow();
  expect((await db.query("select count(*)::int n from lean_private.full_builds")).rows).toEqual([{ n: 0 }]);
});
it.each(["input hash", "source killed", "authority revoked"] as const)("fences %s after claim before finish", async kind => {
  await stage();
  const input = await rpc("public.lean_full_inputs", args()) as Parameters<typeof buildFullReports>[0] & { facts: typeof f.base; inputHash: string };
  const token = randomUUID(); await rpc("public.lean_full_claim", { ...args(), p_token: token });
  const result = buildFullReports({ ...input, base: input.facts, events: f.events });
  if (kind === "source killed") await db.exec("update lean_private.history_import_jobs set enabled=false");
  if (kind === "authority revoked") await db.exec("update lean_private.history_customer_authority set revision=2,available=false");
  const finish = () => rpc("public.lean_full_finish", { ...args(), p_token: token,
    p_input_hash: kind === "input hash" ? "changed" : input.inputHash,
    p_facts: result.facts, p_reports: result.reports, p_manifest: result.manifest });
  if (kind === "input hash") expect(await finish()).toBe(false); else await expect(finish()).rejects.toThrow();
  expect((await db.query("select publication_id from lean_private.publications where publication_id=$1",
    [`full:${bundle.runId}`])).rows).toEqual([]);
});
it("checks authority before completed-result replay rather than using 021's early true return", async () => {
  await stage(); await build();
  expect(lastFinish).toBeDefined();
  expect(await rpc("public.lean_full_finish", lastFinish!)).toBe(true);
  await db.exec("update lean_private.history_customer_authority set revision=2,available=false");
  await expect(rpc("public.lean_full_finish", lastFinish!)).rejects.toThrow("history customer current authority unavailable");
});
it("withdraws only bound customer domains after finish/selection and cannot reselect them", async () => {
  await stage(); await build(); await select();
  const before = await read();
  await db.exec("update lean_private.history_customer_authority set revision=2,available=false");
  const after = await read();
  for (const d of affected) expect(after[d]).toEqual([]);
  expect(after.product_daily).toEqual(before.product_daily); expect(after.funnel_daily).toEqual(before.funnel_daily);
  expect(validProductionWorkbookPayload(after)).toBe(true);
  expect(after.report_status.filter(r => affected.includes(String(r.resource_name)))
    .every(r => r.state === "not_selected" && r.row_count === null && r.is_stale === null)).toBe(true);
  await expect(rpc("public.lean_select_publication", { p_domain: "store_daily", p_publication: `full:${bundle.runId}`,
    p_expected_previous: null, p_approval: "fixture:cannot-replay" })).rejects.toThrow();
});
it("retains selection for a genuine same-revision reread without extending authority validity", async () => {
  await stage(); await build(); await select();
  const before = await read();
  await db.exec(`update lean_private.history_customer_authority
    set captured_at=clock_timestamp(),evidence_ref='fixture:independent-reread'`);
  expect(await read()).toEqual(before);
  expect((await db.query("select domain from lean_private.selected_publications")).rows).toHaveLength(5);
});
it("blocks affected owner release after withdrawal but allows independent product/funnel release", async () => {
  await stage(); await build();
  await db.exec("update lean_private.history_customer_authority set revision=2,available=false");
  await expect(select(["store_daily"])).rejects.toThrow("history customer current authority unavailable");
  await expect(rpc("public.lean_full_release", { ...args(),
    p_expected_previous: Object.fromEntries(domains.map(d => [d, null])),
    p_approval: "fixture:release", p_reconciliation: "fixture:independent", p_actor: "fixture:owner" }))
    .rejects.toThrow("history customer current authority unavailable");
  await select(["product_daily", "funnel_daily"]);
  const payload = await read();
  expect(payload.store_daily).toEqual([]); expect(payload.product_daily).toHaveLength(1);
  expect(validProductionWorkbookPayload(payload)).toBe(true);
});
it("cleans only matching customer cache rows and retains independent and unrelated cached publications", async () => {
  await stage(); await build(); await select();
  await exportRows(["product_daily", "funnel_daily"]);
  // Simulate owner-held legacy residue, not a successful new export path.
  await db.exec(`insert into lean_export.store_daily select * from lean_private.report_store_daily;
    insert into lean_export.store_daily select (jsonb_populate_record(null::lean_export.store_daily,
      to_jsonb(x)||'{"publication_id":"fixture:unrelated"}'::jsonb)).* from lean_private.report_store_daily x;`);
  await db.exec("update lean_private.history_customer_authority set revision=2,available=false");
  expect((await db.query("select publication_id from lean_export.store_daily")).rows)
    .toEqual([{ publication_id: "fixture:unrelated" }]);
  expect((await db.query("select count(*)::int n from lean_export.product_daily")).rows).toEqual([{ n: 1 }]);
  expect((await read()).store_daily).toEqual([]);
});
it("withholds on time-only expiry without an UPDATE and without deleting independent selection", async () => {
  await stage(true, 3000); await build(); await select();
  const before = await read();
  const expiry = (await db.query<{ expiry: string }>(
    "select scope->>'expiresAt' expiry from lean_private.history_customer_runs")).rows[0].expiry;
  await new Promise(resolve => setTimeout(resolve, Math.max(0, Date.parse(expiry) - Date.now()) + 30));
  const after = await read();
  for (const d of affected) expect(after[d]).toEqual([]);
  expect(after.product_daily).toEqual(before.product_daily); expect(after.funnel_daily).toEqual(before.funnel_daily);
  expect((await db.query("select domain from lean_private.selected_publications")).rows).toHaveLength(5);
  expect(validProductionWorkbookPayload(after)).toBe(true);
}, 10000);
it.each([{ selected: ["store_daily"] }, { selected: ["product_daily", "customer_cohorts"] }, { selected: domains }])(
  "denies customer-bound scoped legacy export for $selected even before expiry", async ({ selected }) => {
    await stage(); await build(); await select();
    await expect(exportRows(selected)).rejects.toThrow("customer generation requires canonical delivery");
    expect((await db.query("select count(*)::int n from lean_export.store_daily")).rows).toEqual([{ n: 0 }]);
  });
it("denies actual full export and preserves product/funnel-only export after privacy withdrawal", async () => {
  await stage(); await build(); await select();
  await expect(rpc("public.lean_full_export", { ...args(), p_approval: "fixture:export", p_actor: "fixture:owner" }))
    .rejects.toThrow("customer generation requires canonical delivery");
  await db.exec("update lean_private.history_customer_authority set revision=2,available=false");
  expect(await exportRows(["product_daily", "funnel_daily"])).toMatchObject({ product_daily: 1 });
});
it("denies a selected zero-row customer export rather than treating empty as permission", async () => {
  await stage(true, 3600000, true); await build();
  await rpc("public.lean_full_release", { ...args(),
    p_expected_previous: Object.fromEntries(domains.map(d => [d, null])),
    p_approval: "fixture:release", p_reconciliation: "fixture:control", p_actor: "fixture:owner" });
  expect((await db.query("select count(*)::int n from lean_private.report_customer_cohorts")).rows).toEqual([{ n: 0 }]);
  await expect(exportRows(["customer_cohorts"])).rejects.toThrow("customer generation requires canonical delivery");
  expect((await db.query("select count(*)::int n from lean_export.customer_cohorts")).rows).toEqual([{ n: 0 }]);
});
it("does not turn an ordinary source pause or missing ledger evidence into a privacy blanket gate", async () => {
  await stage(); await build(); await select();
  const before = await read();
  await db.exec("update lean_private.history_import_jobs set enabled=false");
  expect(await read()).toEqual(before);
  expect(before.customer_cohorts[0].revenue_ltv_usd).toBeNull();
  expect(before.customer_cohorts[0].repeat_purchase_rate).toBe("0.000000");
});
it("allows conservative mark-stale after a source pause but still denies clearing or reselecting", async () => {
  await stage(); await build(); await select();
  await db.exec("update lean_private.history_import_jobs set enabled=false");
  await rpc("public.lean_mark_publication_stale", { p_domain: "store_daily" });
  await rpc("public.lean_mark_publication_stale", { p_domain: "store_daily" });
  expect((await db.query("select is_stale from lean_private.selected_publications where domain='store_daily'")).rows)
    .toEqual([{ is_stale: true }]);
  const payload = await read();
  expect(payload.store_daily).toHaveLength(1);
  expect(payload.store_daily[0].is_stale).toBe(true);
  expect(payload.report_status.find(r => r.resource_name === "store_daily")?.is_stale).toBe(true);
  await expect(db.exec("update lean_private.selected_publications set is_stale=false where domain='store_daily'"))
    .rejects.toThrow();
  await expect(rpc("public.lean_select_publication", { p_domain: "store_daily",
    p_publication: `full:${bundle.runId}`, p_expected_previous: `full:${bundle.runId}`, p_approval: "fixture:reselect" }))
    .rejects.toThrow();
});
it("takes the selection lock before delegating both actual owner-only export entrypoints", async () => {
  for (const name of ["lean_scoped_export", "lean_full_export"]) {
    const body = (await db.query<{ body: string }>(`select prosrc body from pg_proc
      where pronamespace='public'::regnamespace and proname=$1`, [name])).rows[0].body;
    expect(body.indexOf("lock table lean_private.selected_publications in share mode")).toBeGreaterThanOrEqual(0);
    expect(body.indexOf("lock table lean_private.selected_publications in share mode"))
      .toBeLessThan(body.indexOf(`return public.${name}_before_customer_generation`));
  }
});
it("leaves legacy registration/input/export and absent optional fields compatible", async () => {
  await stage(false);
  const input = await rpc("public.lean_full_inputs", args()) as { evidence: unknown };
  expect(input.evidence).not.toHaveProperty("customerGeneration");
  await build(); await select(); expect(await exportRows()).toMatchObject({ store_daily: 1 });
});
it("denies effective runtime alias/release/helper/authority access", async () => {
  const aliases = ["public.lean_full_inputs_before_customer_generation(text,text)",
    "public.lean_full_finish_before_customer_generation(text,text,uuid,text,jsonb,jsonb,jsonb)",
    "public.lean_workbook_read_before_customer_generation(text)",
    "public.lean_scoped_release_before_customer_generation(text,text,text[],jsonb,text,text,text)",
    "public.lean_full_release_before_customer_generation(text,text,jsonb,text,text,text)",
    "public.lean_scoped_export_before_customer_generation(text,text,text[],text,text)",
    "public.lean_full_export_before_customer_generation(text,text,text,text)",
    "public.lean_full_inputs_021(text,text)", "public.lean_full_finish_021(text,text,uuid,text,jsonb,jsonb,jsonb)",
    "lean_private.customer_generation_full_check(text,text,boolean)",
    "public.lean_scoped_release(text,text,text[],jsonb,text,text,text)",
    "public.lean_full_release(text,text,jsonb,text,text,text)",
    "public.lean_scoped_export(text,text,text[],text,text)", "public.lean_full_export(text,text,text,text)"];
  for (const fn of aliases) expect((await db.query(`select has_function_privilege(r,$1,'execute') allowed
    from unnest(array['service_role','anon','authenticated','lean_posthog_reader']) r`, [fn])).rows)
    .toEqual(Array.from({ length: 4 }, () => ({ allowed: false })));
  expect((await db.query(`select has_table_privilege('service_role',
    'lean_private.history_customer_authority','insert,update,delete') allowed`)).rows).toEqual([{ allowed: false }]);
  await db.exec("set role service_role");
  try { await expect(rpc("public.lean_full_inputs_before_customer_generation", { p_run: "x", p_project_ref: project }))
    .rejects.toThrow(/permission denied/); } finally { await db.exec("reset role"); }
});
it("uses the exact compact replacement key without accepting caller-derived bindings", async () => {
  await stage();
  const expected = key(fullShop, "1");
  expect((await db.query<{ key: string }>(`select encode(sha256(convert_to('['||to_json($1::text)::text||','||
    to_json($2::text)::text||']','UTF8')),'hex') key`, [fullShop, "1"])).rows[0].key).toBe(expected);
  const input = await rpc("public.lean_full_inputs", args()) as { evidence: { customerGeneration: { orderBindings: { orderId: string }[] } } };
  expect(input.evidence.customerGeneration.orderBindings.map(r => r.orderId)).toEqual([expected]);
});
it("aborts its actual ACL guard if owner-role inheritance leaves an effective alias bypass", async () => {
  const text = sql("customer_generation_full_integration.review");
  const guard = text.slice(text.indexOf("do $acl$")).replace(/\ncommit;\s*$/, "");
  await db.exec("begin;grant postgres to service_role");
  try {
    expect((await db.query(`select has_function_privilege('service_role',
      'public.lean_workbook_read_before_customer_generation(text)','execute') allowed`)).rows)
      .toEqual([{ allowed: true }]);
    await expect(db.exec(guard)).rejects.toThrow("unexpected customer integration effective execute");
  } finally { await db.exec("rollback"); }
});
