/** Disposable SQL and retained synthetic inputs only. No live acceptance or tokens. */
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { fullFixture, fullShop, orderKey, itemKey } from "../fixtures/analyticsFull";
import { refreshFixture } from "../fixtures/analyticsRefresh";
import { prepareRefresh } from "@/lib/analytics/refreshPlan";
import { runHistoryCustomerStep } from "@/lib/analytics/historyCustomerSource";
import { runFullReportJob } from "@/lib/analytics/fullReportJob";
import { productionReportGet } from "@/lib/analytics/productionReportDelivery";
import { validProductionWorkbookPayload, workbookResources } from "@/lib/analytics/productionWorkbookDelivery";
import { productionWorkbookRuntimeGet, workbookRuntimePath, workbookRuntimeManifestHash } from "@/lib/analytics/productionWorkbookRuntime";
import type { AnalyticsRpcClient } from "@/lib/analytics/rpcStore";

const project = "xnfjdbpjuaezxjgargto", source = "01a0f3c6-8758-0000-378b-d15c40a96f3a";
const secret = "synthetic-workbook-bearer-never-a-real-token";
const observed = "synthetic-observed-bearer-never-a-real-token";
const digest = (s: string) => createHash("sha256").update(s).digest("hex");
const domains = Object.keys(workbookResources);
const env = {
  LEAN_PRODUCTION_REPORTS_ENABLED: "true", VERCEL_ENV: "production", VERCEL_GIT_COMMIT_REF: "main",
  LEAN_PRODUCTION_REPORTS_SECRET: observed, LEAN_ANALYTICS_PIPELINE_PROJECT_REF: project,
  LEAN_ANALYTICS_SUPABASE_URL: `https://${project}.supabase.co`, LEAN_ANALYTICS_SUPABASE_SERVICE_ROLE_KEY: "fixture-service-key",
};
type Payload = Record<string, Record<string, unknown>[]>;
let db: PGlite, f: ReturnType<typeof fullFixture>, runId: string;
let auth: Record<string, string>, payload: Payload;
const sql = (n: string) => readFileSync(`sql/analytics/${n}.sql`, "utf8");
async function rpc(name: string, args: Record<string, unknown>) {
  return (await db.query<{ result: unknown }>(`select public.${name}(${
    Object.keys(args).map((k, i) => `${k}=>$${i + 1}`).join(",")}) result`,
  Object.entries(args).map(([k, v]) => k === "p_domains" ? v :
    v && typeof v === "object" ? JSON.stringify(v) : v))).rows[0].result;
}
const client: AnalyticsRpcClient = { async rpc(name, args) {
  if (!["lean_full_inputs", "lean_full_claim", "lean_full_finish", "lean_full_fail",
    "lean_history_customer_claim", "lean_history_customer_finish"].includes(name)) throw new Error("unexpected_rpc");
  try { return { data: await rpc(name, args), error: null }; }
  catch (error) { return { data: null, error }; }
} };
const request = (token = secret, path = workbookRuntimePath, init: RequestInit = {}) =>
  new Request(`https://www.mymully.com${path}`, { headers: { authorization: `Bearer ${token}` }, ...init });
const transport = () => vi.fn<typeof fetch>(async (url, init) => {
  expect(String(url).startsWith(`https://${project}.supabase.co/rest/v1/rpc/`)).toBe(true);
  expect(init?.method).toBe("POST"); expect(init?.redirect).toBe("error");
  expect(init?.signal).toBeInstanceOf(AbortSignal);
  const name = String(url).split("/").at(-1)!;
  expect(["lean_workbook_runtime_auth", "lean_workbook_runtime_read"]).toContain(name);
  return Response.json(await rpc(name, JSON.parse(String(init?.body))));
});
const canned = () => vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json(auth)).mockResolvedValueOnce(Response.json(payload));
beforeAll(async () => {
  db = new PGlite();
  await db.exec(`create role anon;create role authenticated;create role service_role;
    alter default privileges in schema public grant execute on functions to anon,authenticated,service_role;`);
  for (const n of ["001_staging", "013_release", "014_reporting_views", "018_history_jobs", "019_spend_jobs",
    "020_observed_report_jobs", "021_full_report_jobs", "022_full_release", "023_posthog_export", "024_full_orchestration",
    "025_refresh_queue", "026_journey_authority", "027_history_update_scans", "029_journey_decisions",
    "030_scoped_release", "031_draft_receipts", "034_commerce_only_refresh", "035_discovery_inventory_fence",
    "036_partitioned_refresh", "037_canonical_journey_timestamps", "038_google_spend_pilot",
    "040_shopify_history_import", "041_history_report_bridge", "053_production_workbook_delivery",
    "proposed_history_customer_source", "customer_generation_full_integration.review",
    "workbook_runtime_authorization.review"]) await db.exec(sql(n));
}, 30000);
beforeEach(async () => {
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("hosted_network_forbidden"); }));
  await db.exec(`truncate lean_private.history_import_jobs,lean_private.publications,lean_private.history_customer_authority,
    lean_private.full_builds,lean_private.report_builds,lean_private.history_jobs,lean_private.spend_jobs,
    lean_private.refresh_limits cascade;
    truncate lean_export.store_daily,lean_export.product_daily,lean_export.acquisition_daily,
      lean_export.customer_cohorts,lean_export.funnel_daily;
    insert into lean_private.production_workbook_delivery(singleton) values(true);`);
  f = fullFixture(); runId = "fixture";
  await db.query(`insert into lean_private.report_builds
    (run_id,project_ref,shop,history_runs,from_date,through_date,policy,approval_ref,actor_ref,enabled,completed_at,result_hash)
    values('base',$1,$2,array['fixture-history'],'2026-01-01','2026-01-01','{}','fixture:approval','fixture:actor',true,now(),'fixture')`,
  [project, fullShop]);
  await db.exec("insert into lean_private.publications(publication_id,contract_version) values('observed:base','lean-v1-draft.1')");
  await insertBase("base");
  await db.query(`insert into lean_private.full_builds
    (run_id,project_ref,base_run,policy,evidence,behavior,approval_ref,actor_ref,enabled)
    values('fixture',$1,'base',$2,$3,$4,'fixture:approval','fixture:actor',true)`,
  [project, JSON.stringify(f.policy), JSON.stringify(f.evidence), JSON.stringify(f.behavior)]);
  await buildAndSelect();
  await authorize();
  auth = await rpc("lean_workbook_runtime_auth", { p_project_ref: project }) as Record<string, string>;
  payload = await rpc("lean_production_workbook_reports_read", { p_project_ref: project }) as Payload;
});
afterEach(() => {
  expect(fetch).not.toHaveBeenCalled(); vi.unstubAllGlobals(); vi.useRealTimers(); vi.restoreAllMocks();
});
afterAll(async () => { await db?.close(); });
async function insertBase(base: string) {
  for (const [table, rows] of Object.entries(f.base)) await db.query(
    `insert into lean_private.${table} select * from jsonb_populate_recordset(null::lean_private.${table},$1)`,
    [JSON.stringify(rows.map(r => ({ ...r, publication_id: `observed:${base}` })))]);
}
async function buildAndSelect() {
  expect(await runFullReportJob({ client, projectRef: project, databaseUrl: `https://${project}.supabase.co`,
    runId, posthogKey: "fixture", request: async () => Response.json(f.wire) })).toMatchObject({ state: "complete" });
  await rpc("lean_scoped_release", { p_run: runId, p_project_ref: project, p_domains: domains,
    p_expected_previous: Object.fromEntries(domains.map(d => [d, null])),
    p_approval: "fixture:review", p_reconciliation: "fixture:control", p_actor: "fixture:owner" });
  await db.query(`update lean_private.production_workbook_delivery set enabled=true,run_id=$1,
    project_ref=$2,shop=$3,approval_ref='fixture:delivery'`, [runId, project, fullShop]);
}
async function authorize() {
  await db.query(`insert into lean_private.workbook_runtime_authorization(singleton,enabled,mode,revision,
    project_ref,source_id,audience,path,manifest_sha256,run_id,publication_id,result_hash,shop,token_sha256,
    approval_ref,delivery_approval_ref,not_before,expires_at)
    select true,true,'workbook',1,$1,$2,$3,$4,$5,run_id,'full:'||run_id,result_hash,$6,$7,
      'fixture:separate-destination-approval','fixture:delivery',clock_timestamp()-interval '1 minute',
      clock_timestamp()+interval '10 minutes' from lean_private.full_builds where run_id=$8`,
  [project, source, `posthog:353503:source:${source}`, workbookRuntimePath, workbookRuntimeManifestHash, fullShop, digest(secret), runId]);
}
const readArgs = () => ({ p_project_ref: project, p_revision: auth.revision, p_snapshot_hash: auth.snapshot_hash });

it("serves exactly the current installed reader via two real bounded RPCs, without auth metadata", async () => {
  const send = transport(), res = await productionWorkbookRuntimeGet(request(), env, send);
  expect(res.status).toBe(200); expect(await res.json()).toEqual(payload);
  expect(send).toHaveBeenCalledTimes(2);
  expect(send.mock.calls[1][1]?.body).toBe(JSON.stringify(readArgs()));
  expect(res.headers.get("cache-control")).toBe("no-store");
  expect(validProductionWorkbookPayload(payload)).toBe(true);
  expect(JSON.stringify(payload)).not.toContain(digest(secret));
});
it.each(["repeatable read", "serializable", "read committed"] as const)(
  "supports only a current read-committed snapshot, not %s retention", async isolation => {
    await db.exec(`begin isolation level ${isolation}`);
    try {
      // Establish the transaction snapshot before calling either new RPC.
      await db.exec("select count(*) from pg_class");
      const a = await rpc("lean_workbook_runtime_auth", { p_project_ref: project });
      const p = await rpc("lean_workbook_runtime_read", readArgs());
      if (isolation === "read committed") { expect(a).toEqual(auth); expect(p).toEqual(payload); }
      else { expect(a).toBeNull(); expect(p).toBeNull(); }
    } finally { await db.exec("rollback"); }
  });
it("keeps manifest selectors, both existing names and actual manifest primary keys", () => {
  const raw = readFileSync("docs/analytics/production-workbook-runtime-posthog-manifest.json", "utf8");
  expect(digest(raw)).toBe(workbookRuntimeManifestHash);
  const old = JSON.parse(readFileSync("docs/analytics/production-workbook-posthog-manifest.json", "utf8"));
  for (const r of old.resources) r.endpoint.path = workbookRuntimePath;
  expect(JSON.parse(raw)).toEqual(old);
  expect(old.resources.map((r: { name: string }) => r.name)).toEqual([...domains, "report_status"]);
  expect(old.resources.every((r: { primary_key: string[] }) => r.primary_key.includes("publication_id"))).toBe(true);
});
it.each(["absent", "disabled", "expired", "future", "wrong full result", "delivery disabled", "delivery changed"] as const)(
  "fails closed for %s authorization", async kind => {
    if (kind === "absent") await db.exec("delete from lean_private.workbook_runtime_authorization");
    if (kind === "disabled") await db.exec("update lean_private.workbook_runtime_authorization set enabled=false,revision=2");
    if (kind === "expired") await db.exec(`update lean_private.workbook_runtime_authorization set revision=2,
      not_before=clock_timestamp()-interval '20 minutes',expires_at=clock_timestamp()-interval '1 minute'`);
    if (kind === "future") await db.exec(`update lean_private.workbook_runtime_authorization set revision=2,
      not_before=clock_timestamp()+interval '1 minute',expires_at=clock_timestamp()+interval '2 minutes'`);
    if (kind === "wrong full result") await db.exec("update lean_private.workbook_runtime_authorization set revision=2,result_hash='different'");
    if (kind === "delivery disabled") await db.exec("update lean_private.production_workbook_delivery set enabled=false");
    if (kind === "delivery changed") await db.exec("update lean_private.production_workbook_delivery set approval_ref='different'");
    const send = transport(), res = await productionWorkbookRuntimeGet(request(), env, send);
    expect(res.status).toBe(503); expect(await res.text()).toBe(""); expect(send).toHaveBeenCalledTimes(1);
  });
it.each(["revision", "token", "expiry", "delivery"] as const)("rejects %s changing between the two RPCs", async kind => {
  const send = transport();
  const raced = vi.fn<typeof fetch>(async (url, init) => {
    if (String(url).endsWith("/lean_workbook_runtime_read")) {
      if (kind === "revision") await db.exec("update lean_private.workbook_runtime_authorization set revision=2");
      if (kind === "token") await db.exec(`update lean_private.workbook_runtime_authorization set revision=2,token_sha256=repeat('a',64)`);
      if (kind === "expiry") await db.exec(`update lean_private.workbook_runtime_authorization set revision=2,
        not_before=clock_timestamp()-interval '2 minutes',expires_at=clock_timestamp()-interval '1 minute'`);
      if (kind === "delivery") await db.exec("update lean_private.production_workbook_delivery set approval_ref='other'");
    }
    return send(url, init);
  });
  expect((await productionWorkbookRuntimeGet(request(), env, raced)).status).toBe(503);
  expect(raced).toHaveBeenCalledTimes(2);
});
it("uses clock time for expiry without UPDATE and never extends the one-hour maximum", async () => {
  await db.exec(`update lean_private.workbook_runtime_authorization set revision=2,
    not_before=clock_timestamp()-interval '1 minute',expires_at=clock_timestamp()+interval '0.1 second'`);
  const a = await rpc("lean_workbook_runtime_auth", { p_project_ref: project }) as Record<string, string>;
  await new Promise(resolve => setTimeout(resolve, 130));
  expect(await rpc("lean_workbook_runtime_read", { p_project_ref: project, p_revision: a.revision, p_snapshot_hash: a.snapshot_hash })).toBeNull();
  await expect(db.exec(`update lean_private.workbook_runtime_authorization set revision=3,
    expires_at=not_before+interval '61 minutes'`)).rejects.toThrow();
  await expect(db.exec("update lean_private.workbook_runtime_authorization set approval_ref='no revision'")).rejects.toThrow(/revision/);
});
it("preserves selected-empty versus unavailable, stale, precision and null readiness", async () => {
  await db.exec("delete from lean_private.selected_publications where domain='acquisition_daily'");
  await rpc("lean_mark_publication_stale", { p_domain: "store_daily" });
  const result = await productionWorkbookRuntimeGet(request(), env, transport());
  expect(result.status).toBe(200);
  const p = await result.json() as Payload;
  expect(p.acquisition_daily).toEqual([]);
  expect(p.report_status.find(s => s.resource_name === "acquisition_daily")).toMatchObject({ state: "not_selected", row_count: null, is_stale: null });
  expect(p.store_daily[0]).toMatchObject({ total_sales_usd: "20.000000", is_stale: true });
  expect(validProductionWorkbookPayload(p)).toBe(true);
});
it.each(["missing", "observed", "wrong", "reuse"] as const)("rejects %s bearer and never falls back", async kind => {
  if (kind === "reuse") await db.query("update lean_private.workbook_runtime_authorization set revision=2,token_sha256=$1", [digest(observed)]);
  const send = transport();
  const req = kind === "missing" ? new Request(`https://www.mymully.com${workbookRuntimePath}`) :
    request(kind === "wrong" ? "x".repeat(40) : observed);
  const response = await productionWorkbookRuntimeGet(req, env, send);
  expect(response.status).toBe(401); expect(send).toHaveBeenCalledTimes(kind === "wrong" ? 1 : 0);
});
it.each(["off", "preview", "branch", "project", "database", "key", "observed config"] as const)(
  "preserves existing server guard %s", async kind => {
    const changed = { ...env };
    if (kind === "off") changed.LEAN_PRODUCTION_REPORTS_ENABLED = "false";
    if (kind === "preview") changed.VERCEL_ENV = "preview";
    if (kind === "branch") changed.VERCEL_GIT_COMMIT_REF = "feature";
    if (kind === "project") changed.LEAN_ANALYTICS_PIPELINE_PROJECT_REF = "a".repeat(20);
    if (kind === "database") changed.LEAN_ANALYTICS_SUPABASE_URL += "/";
    if (kind === "key") changed.LEAN_ANALYTICS_SUPABASE_SERVICE_ROLE_KEY = "";
    if (kind === "observed config") changed.LEAN_PRODUCTION_REPORTS_SECRET = "";
    const send = canned();
    expect([404, 503]).toContain((await productionWorkbookRuntimeGet(request(), changed, send)).status);
    expect(send).not.toHaveBeenCalled();
  });
it.each(["query", "path", "post", "transfer", "length"] as const)("refuses caller scope through %s", async kind => {
  const req = request(secret, kind === "query" ? `${workbookRuntimePath}?publication=other` :
    kind === "path" ? "/api/analytics/reports/production" : workbookRuntimePath,
  kind === "post" ? { method: "POST", body: "{}" } : kind === "transfer" || kind === "length" ?
    { headers: { authorization: `Bearer ${secret}`, [kind === "transfer" ? "transfer-encoding" : "content-length"]: "1" } } : {});
  const send = canned();
  expect([400, 405]).toContain((await productionWorkbookRuntimeGet(req, env, send)).status); expect(send).not.toHaveBeenCalled();
});
it("does not loosen the old endpoint's independent secret or mode", async () => {
  const send = canned();
  expect((await productionReportGet(request(secret, "/api/analytics/reports/production"), env, send)).status).toBe(401);
  expect((await productionReportGet(request(observed, "/api/analytics/reports/production"), {
    ...env, LEAN_PRODUCTION_REPORTS_MODE: "workbook", LEAN_PRODUCTION_WORKBOOK_REPORTS_ENABLED: "true",
    LEAN_PRODUCTION_WORKBOOK_REPORTS_SECRET: observed,
  }, send)).status).toBe(503);
  expect(send).not.toHaveBeenCalled();
});
it.each(["partial", "extra", "mixed", "numeric", "unavailable numeric", "auth extra", "auth scope", "invalid json", "utf8",
  "redirect", "auth bytes", "data bytes"] as const)("rejects malformed or ambiguous %s without diagnostic leakage", async kind => {
  const p = structuredClone(payload), a = { ...auth };
  if (kind === "partial") delete p.report_status;
  if (kind === "extra") p.raw_identity = [];
  if (kind === "mixed") p.report_status[1].publication_id = "full:other";
  if (kind === "numeric") p.store_daily[0].total_sales_usd = 20;
  if (kind === "unavailable numeric") p.report_status[0].state = "not_selected";
  if (kind === "auth extra") a.raw_secret = secret;
  if (kind === "auth scope") a.source_id = "another-source";
  const send = vi.fn<typeof fetch>().mockResolvedValueOnce(kind === "auth bytes" ? new Response(" ".repeat(8193)) : Response.json(a))
    .mockResolvedValueOnce(kind === "invalid json" ? new Response(secret) : kind === "utf8" ? new Response(new Uint8Array([255])) :
      kind === "redirect" ? new Response(secret, { status: 302 }) :
        kind === "data bytes" ? new Response(" ".repeat(4194305)) : Response.json(p));
  const result = await productionWorkbookRuntimeGet(request(), env, send);
  expect(result.status).toBe(503); expect(await result.text()).toBe("");
});
it.each(["transport", "first body", "second body", "near deadline second RPC"] as const)(
  "aborts and returns at a single deadline for stalled %s, including ignored AbortSignal", async kind => {
    vi.useFakeTimers();
    const pending = () => new Promise<Response>(() => {});
    const stream = () => new Response(new ReadableStream({ pull: () => new Promise<void>(() => {}) }));
    let signal: AbortSignal | undefined;
    const send = vi.fn<typeof fetch>(async (_url, init) => {
      signal = init?.signal as AbortSignal;
      if (kind === "transport") return pending();
      if (send.mock.calls.length === 1) {
        if (kind === "first body") return stream();
        if (kind === "near deadline second RPC") await new Promise(resolve => setTimeout(resolve, 14900));
        return Response.json(auth);
      }
      return stream();
    });
    const promise = productionWorkbookRuntimeGet(request(), env, send);
    await vi.advanceTimersByTimeAsync(15000);
    const result = await promise;
    expect(result.status).toBe(503); expect(await result.text()).toBe("");
    expect(signal?.aborted).toBe(true); expect(send.mock.calls.length).toBeLessThanOrEqual(2);
  });
it("propagates caller abort without retry and rechecks authorization after a delayed body", async () => {
  const controller = new AbortController(); let signal: AbortSignal | undefined;
  const send = vi.fn<typeof fetch>(async (_url, init) => { signal = init?.signal as AbortSignal; return new Promise<Response>(() => {}); });
  const pending = productionWorkbookRuntimeGet(request(secret, workbookRuntimePath, { signal: controller.signal }), env, send);
  controller.abort();
  expect((await pending).status).toBe(503); expect(signal?.aborted).toBe(true); expect(send).toHaveBeenCalledTimes(1);
  vi.useFakeTimers();
  const expiresAt = new Date(Date.now() + 50).toISOString().replace(/(\.\d{3})Z$/, "$1000Z");
  const late = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({ ...auth, expires_at: expiresAt }))
    .mockImplementationOnce(async () => { await new Promise(resolve => setTimeout(resolve, 100)); return Response.json(payload); });
  const response = productionWorkbookRuntimeGet(request(), env, late);
  await vi.advanceTimersByTimeAsync(100);
  expect((await response).status).toBe(503);
});
it("keeps private rows, columns, helpers and inherited grants owner-only", async () => {
  await db.exec("select lean_private.workbook_runtime_acl_check()");
  const rows = await db.query(`select rol,
    has_any_column_privilege(rol,'lean_private.workbook_runtime_authorization','SELECT,INSERT,UPDATE,REFERENCES') private_columns,
    has_function_privilege(rol,'public.lean_workbook_runtime_auth(text)','EXECUTE') auth,
    has_function_privilege(rol,'public.lean_workbook_runtime_read(text,text,text)','EXECUTE') read,
    has_function_privilege(rol,'lean_private.workbook_runtime_snapshot(text)','EXECUTE') helper
    from unnest(array['anon','authenticated','service_role','lean_posthog_reader']) rol`);
  expect(rows.rows).toEqual(["anon", "authenticated", "service_role", "lean_posthog_reader"].map(rol =>
    ({ rol, private_columns: false, auth: rol === "service_role", read: rol === "service_role", helper: false })));
  await db.exec("create role runtime_inherited;grant runtime_inherited to service_role");
  try {
    for (const grant of [
      "grant select(token_sha256) on lean_private.workbook_runtime_authorization to runtime_inherited",
      "grant select on lean_private.workbook_runtime_authorization to runtime_inherited",
      "grant execute on function lean_private.workbook_runtime_snapshot(text) to runtime_inherited",
    ]) {
      await db.exec("begin");
      try {
        await db.exec(grant);
        await expect(db.exec("select lean_private.workbook_runtime_acl_check()")).rejects.toThrow(/unexpected workbook runtime/);
      } finally { await db.exec("rollback"); }
    }
  } finally { await db.exec("revoke runtime_inherited from service_role;drop role runtime_inherited"); }
  await db.exec("set role service_role");
  try {
    await expect(db.exec("select token_sha256 from lean_private.workbook_runtime_authorization")).rejects.toThrow(/permission denied/);
    await expect(db.exec("select public.lean_workbook_read_before_customer_generation('x')")).rejects.toThrow(/permission denied/);
    expect(await rpc("lean_workbook_runtime_auth", { p_project_ref: project })).toEqual(auth);
    expect(await rpc("lean_workbook_runtime_read", readArgs())).toEqual(payload);
  } finally { await db.exec("reset role"); }
});

/**
 * Actual source seal/full job/release fixture reused from the released integration
 * contract. This does not replace the reader with a mock or mint live authority.
 */
async function stageCustomer() {
  await db.exec(`truncate lean_private.publications,lean_private.full_builds,lean_private.report_builds cascade;
    insert into lean_private.production_workbook_delivery(singleton) values(true);`);
  const refresh = refreshFixture(), asOf = refresh.intake.asOf;
  refresh.intake.scope.projectRef = project;
  const expiry = new Date(Date.now() + 3600000).toISOString(), cutoff = "2026-03-01T00:00:00Z";
  const reporting = { definition: refresh.policy.definition, fromDate: f.fromDate, throughDate: f.throughDate,
    cohorts: refresh.policy.cohorts, cohortCoverage: f.evidence.cohortCoverage };
  const money = (amount: string) => ({ shopMoney: { amount, currencyCode: "USD" } });
  const sourceData = { commerce: { shop: fullShop, apiVersion: "2026-07", projection: "financial_customer_id", order: {
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
    [JSON.stringify({ id: "gid://shopify/Order/1", createdAt: sourceData.commerce.order.createdAt, updatedAt: sourceData.commerce.order.updatedAt })]);
  await db.query(`insert into lean_private.history_report_sources(run_id,order_id,source,captured_at,source_hash,outcome,result_hash)
    values('source-history','gid://shopify/Order/1',$1,$2,encode(sha256(convert_to($1::jsonb::text,'UTF8')),'hex'),'financial_observed','fixture')`,
  [JSON.stringify(sourceData), asOf]);
  await db.query(`insert into lean_private.history_customer_members(run_id,member_id,customer_id,evidence)
    values('customer-source','one','customer-fixture',$1)`, [JSON.stringify(evidence)]);
  await db.query(`insert into lean_private.history_customer_inventory
    select 'customer-source','one',order_id,$1,source_hash,$2 from lean_private.history_report_sources`,
  [sourceData.commerce.order.updatedAt, JSON.stringify(refresh.commercePolicy.decision)]);
  await rpc("lean_history_customer_seal", { p_run: "customer-source" });
  await db.exec("update lean_private.history_customer_runs set enabled=true");
  expect(await runHistoryCustomerStep({ approved: true, client, runId: "customer-source", projectRef: project }))
    .toEqual({ state: "member_written" });
  const sourceRun = (await db.query<{ generation_hash: string; result_hash: string }>(
    "select generation_hash,result_hash from lean_private.history_customer_runs")).rows[0];
  refresh.policy.customerGeneration = { runId: "customer-source", generationHash: sourceRun.generation_hash,
    resultHash: sourceRun.result_hash, authorityId: "authority", authorityRevision: "1", authorityFingerprint: fingerprint };
  const bundle = prepareRefresh(refresh); runId = bundle.runId;
  expect(await rpc("lean_refresh_register", { p_bundle: bundle })).toBe(runId);
  await db.query(`insert into lean_private.refresh_limits(project_ref,enabled,max_daily_steps,approval_ref,actor_ref)
    values($1,true,5,'fixture:enable','fixture:owner')`, [project]);
  await db.exec(`update lean_private.full_builds set enabled=true;update lean_private.report_builds set enabled=true;
    update lean_private.refresh_queue set enabled=true;update lean_private.history_jobs set enabled=true,complete=true;
    update lean_private.spend_jobs set enabled=true;`);
  await rpc("lean_refresh_claim", { p_project_ref: project, p_token: randomUUID() });
  await db.query("insert into lean_private.publications(publication_id,contract_version) values($1,'lean-v1-draft.1')",
    [`observed:${bundle.base.runId}`]);
  await insertBase(bundle.base.runId);
  await db.exec("update lean_private.report_builds set completed_at=clock_timestamp(),result_hash='fixture:completed-base'");
  await buildAndSelect(); await authorize();
}
it("delegates customer privacy to the actual installed wrapper, including expiry without UPDATE", async () => {
  await stageCustomer();
  const before = await productionWorkbookRuntimeGet(request(), env, transport());
  expect(before.status).toBe(200);
  const retained = await before.json() as Payload;
  expect(retained.store_daily[0].new_customers).toBe("1");
  // Shorten validity without revocation first; scope expiry would withhold immediately,
  // so instead use a short freshness interval and then wait without any UPDATE.
  await db.exec("update lean_private.history_customer_authority set max_age_seconds=1,captured_at=clock_timestamp()");
  const stillCurrent = await productionWorkbookRuntimeGet(request(), env, transport());
  expect(stillCurrent.status).toBe(200);
  expect((await stillCurrent.json() as Payload).store_daily.length).toBe(1);
  await new Promise(resolve => setTimeout(resolve, 1050));
  const res = await productionWorkbookRuntimeGet(request(), env, transport());
  expect(res.status).toBe(200);
  const p = await res.json() as Payload;
  for (const name of ["store_daily", "acquisition_daily", "customer_cohorts"]) {
    expect(p[name]).toEqual([]);
    expect(p.report_status.find(s => s.resource_name === name)).toMatchObject({ state: "not_selected", row_count: null, is_stale: null });
  }
  expect(p.product_daily).toEqual(retained.product_daily); expect(p.funnel_daily).toEqual(retained.funnel_daily);
  expect(validProductionWorkbookPayload(p)).toBe(true);
  await db.exec("update lean_private.history_customer_authority set revision=2,available=false");
  expect((await (await productionWorkbookRuntimeGet(request(), env, transport())).json()).store_daily).toEqual([]);
});
