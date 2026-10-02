/** Actual disposable SQL + HTTP/consumer; synthetic data, no hosted IO. */
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { productionObservedDeliveryGet, observedDeliveryPath, observedDeliveryManifestHash } from "@/lib/analytics/productionObservedDelivery";
import { observedDeliveryView, validObservedDeliveryPayload, type ObservedImports } from "@/lib/analytics/observedDeliveryConsumer";
import { composeRetainedOrderReports } from "@/lib/analytics/shopifyRetainedOrder";
import { projectPilotRetention } from "@/lib/analytics/shopifyRetention";
import { runtimePolicy, runtimeSource } from "../fixtures/analyticsRetainedRuntime";

const project = "xnfjdbpjuaezxjgargto", shop = "mullybox-store.myshopify.com";
const token = "fixture-standing-only-not-a-real-credential";
const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const sql = (name: string) => readFileSync(`sql/analytics/${name}.sql`, "utf8");
const approval = "Jessica Singh approved ongoing sales activation 2026-09-30T19:00:00Z; installed-baseline amendment approved 2026-09-30T19:14:00Z; session 9e554880-77db-414c-9f03-6574efa210d7";
const policy = {
  decision: { approvalRef: approval, eligibility: "eligible", commerceSource: "other", acquisitionEligible: false },
  orderSize: { policyRef: "Jessica-Singh-approved-order-size-20260930T201000Z",
    productSemantics: { "8501257044160": "requested_box_top_size" } },
  saleClock: "paid_at", refundClock: "refund_created_at", productClasses: { "8501257044160": "merchandise" },
  retainedReports: "product-v1", sourceRetention: "financial_allowlist_v1",
  sourceProjection: "financial_no_geo_order_size", financialApprovalRef: approval,
};
const env = { LEAN_PRODUCTION_REPORTS_ENABLED: "true", VERCEL_ENV: "production", VERCEL_GIT_COMMIT_REF: "main",
  LEAN_PRODUCTION_REPORTS_SECRET: "fixture-old-observed-not-a-real-credential",
  LEAN_ANALYTICS_PIPELINE_PROJECT_REF: project, LEAN_ANALYTICS_SUPABASE_URL: `https://${project}.supabase.co`,
  LEAN_ANALYTICS_SUPABASE_SERVICE_ROLE_KEY: "fixture-service-only" };
let db: PGlite;
type Payload = Record<string, Record<string, unknown>[]>;
async function q<T = unknown>(text: string, params: unknown[] = []) {
  return (await db.query<{ r: T }>(text, params)).rows[0].r;
}
async function rpc(name: string, args: Record<string, string>) {
  await db.exec("set role service_role");
  try { return await q(`select public.${name}(${Object.keys(args).map((k, i) => `${k}=>$${i + 1}`).join(",")}) r`, Object.values(args)); }
  finally { await db.exec("reset role"); }
}
function transport(afterAuth?: () => Promise<void>, changeAuth?: (a: Record<string, unknown>) => unknown) {
  return vi.fn<typeof fetch>(async (url, init) => {
    expect(String(url)).toMatch(new RegExp(`^https://${project}[.]supabase[.]co/rest/v1/rpc/lean_observed_delivery_(auth|read)$`));
    expect(init?.redirect).toBe("error");
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    const name = String(url).split("/").at(-1)!;
    let data = await rpc(name, JSON.parse(String(init?.body)));
    if (name.endsWith("_auth")) {
      await afterAuth?.();
      if (changeAuth) data = changeAuth(data as Record<string, unknown>);
    }
    return Response.json(data);
  });
}
const request = (bearer = token) => new Request(`https://www.mymully.com${observedDeliveryPath}`,
  { headers: { authorization: `Bearer ${bearer}` } });
async function grant(mode = "standing", start = "clock_timestamp()-interval '30 days'", end = "null") {
  await db.query(`insert into lean_private.observed_delivery_authorization
    (enabled,revision,project_ref,shop,source_id,audience,path,manifest_sha256,scope_sha256,token_sha256,
      approval_ref,delivery_approval_ref,not_before,expires_at,authorization_mode)
    values(true,1,$1,$2,'01a0f3c6-8758-0000-378b-d15c40a96f3a',
      'posthog:353503:source:01a0f3c6-8758-0000-378b-d15c40a96f3a',$3,$4,
      lean_private.observed_delivery_scope_hash(),$5,'fixture:standing','fixture:delivery',${start},${end},$6)`,
    [project, shop, observedDeliveryPath, observedDeliveryManifestHash, sha(token), mode]);
}
async function annual(mode = "standing", end = "null") {
  await db.exec(`insert into lean_private.pipeline_annual_access_rules
    (rule_id,project_ref,shop,scope_sha256,excluded_product_id,approval_ref,actor_ref,enabled,not_before,expires_at,authorization_mode)
    values('fixture:annual','${project}','${shop}',
      '799209cbd0913f5257afaabefc478ec7e402640b4ac5c30e5f9ee81eeee30689','8501257175232',
      'fixture:annual-standing','fixture:owner',true,clock_timestamp()-interval '1 minute',${end},'${mode}')`);
}
async function retained(id = "1", annualProduct = false) {
  const s = runtimeSource();
  s.commerce.shop = shop; s.commerce.projection = "financial_no_geo_order_size";
  s.commerce.order.id = `gid://shopify/Order/${id}`; s.financial.id = s.commerce.order.id;
  s.commerce.order.createdAt = "2026-10-01T12:00:00Z"; s.commerce.order.updatedAt = "2026-10-01T13:00:00Z";
  s.financial.updatedAt = s.commerce.order.updatedAt;
  const lines = s.commerce.order.lineItems as { nodes: Record<string, unknown>[] };
  lines.nodes[0].id = `gid://shopify/LineItem/${id}2`;
  lines.nodes[0].product = { id: `gid://shopify/Product/${annualProduct ? "8501257175232" : "8501257044160"}` };
  lines.nodes[0].orderSize = { topSize: { status: "known", value: "L" }, variantTitle: { status: "missing", value: null } };
  const tx = (s.commerce.order.transactions as Record<string, unknown>[])[0];
  tx.id = `gid://shopify/OrderTransaction/${id}4`; tx.createdAt = "2026-10-01T12:00:00Z"; tx.processedAt = "2026-10-01T12:01:00Z";
  const source = projectPilotRetention(s);
  await db.query("select public.lean_accept_receipt('shopify',$1,$2,'orders/updated',$3,$4::jsonb)",
    [randomUUID(), JSON.stringify([shop, source.commerce.order.id]), "a".repeat(64),
      JSON.stringify({ admin_graphql_api_id: source.commerce.order.id, updated_at: source.commerce.order.updatedAt })]);
  const lease = randomUUID();
  const c = await q<{ workId: string; publication: string }>("select public.lean_pipeline_claim($1::uuid,$2,$3) r", [lease, project, shop]);
  expect(await q("select public.lean_pipeline_retain($1::bigint,$2::uuid,$3::jsonb) r",
    [c.workId, lease, JSON.stringify(source)])).toBe(true);
  return { ...c, lease, source };
}
async function materialize() {
  const c = await retained();
  const out = composeRetainedOrderReports(c.source,
    { ...runtimePolicy, lineClasses: { "12": "merchandise" },
      orderSize: { policyRef: policy.orderSize.policyRef, productSemantics: { "8501257044160": "requested_box_top_size" } } },
    c.publication, "fixture", "shopify-observed-v1", { orderSizeSidecar: true });
  expect(await q("select public.lean_pipeline_finish_extended($1::bigint,$2::uuid,$3::jsonb,$4::jsonb,$5::jsonb,$6::jsonb) r",
    [c.workId, c.lease, JSON.stringify(out.facts), JSON.stringify(out.reports), JSON.stringify(out.productReports),
      JSON.stringify(out.order_item_sizes ?? null)])).toBe(true);
}
async function payload() {
  const response = await productionObservedDeliveryGet(request(), env, transport());
  expect(response.status).toBe(200);
  const text = await response.text();
  for (const secret of [token, sha(token), env.LEAN_ANALYTICS_SUPABASE_SERVICE_ROLE_KEY, "authorization_mode", "approval_ref"]) {
    expect(text).not.toContain(secret);
  }
  const result = JSON.parse(text) as Payload;
  expect(validObservedDeliveryPayload(result)).toBe(true);
  return result;
}
function imports(p: Payload): ObservedImports {
  return Object.fromEntries(["store_daily", "product_daily", "report_status"].map(k => [k, {
    rows: p[k], rowCount: p[k].length, complete: true, unfiltered: true, importedAt: null,
    capturedAt: new Date().toISOString().replace(/(\.\d{3})Z$/, "$1000Z"),
  }])) as ObservedImports;
}
beforeEach(async () => {
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("hosted_io_forbidden"); }));
  db = new PGlite();
  await db.exec("create role service_role;create role anon;create role authenticated;create role lean_posthog_reader;");
  for (const name of ["001_staging", "003_receipts", "004_worker", "013_release", "014_reporting_views",
    "017_shopify_pipeline", "046_order_item_sizes", "047_pipeline_extended", "050_production_report_delivery",
    "052_pipeline_before_window_exclusion", "pipeline_throughput.review", "pipeline_annual_access_exclusion.review",
    "observed_delivery_runtime.review"]) await db.exec(sql(name));
  await db.query(`insert into lean_private.pipeline_scope(shop,project_ref,enabled,from_time,until_time,policy,approval_ref,actor_ref)
    values($1,$2,true,'2026-09-30T19:19:02.220236Z','9999-12-31T00:00:00Z',$3::jsonb,'fixture:scope','fixture:owner')`,
    [shop, project, JSON.stringify(policy)]);
  await db.exec("update lean_private.production_report_delivery set enabled=true,approval_ref='fixture:delivery'");
}, 30000);
afterEach(async () => { await db.close(); expect(fetch).not.toHaveBeenCalled(); vi.unstubAllGlobals(); });

it("amends only standing opt-in, preserves finite rows/ACLs/functions and old finite revocation", async () => {
  // Insert under the old schema; install must not promote or renew either row.
  await db.query(`insert into lean_private.observed_delivery_authorization
    (enabled,revision,project_ref,shop,source_id,audience,path,manifest_sha256,scope_sha256,token_sha256,
      approval_ref,delivery_approval_ref,not_before,expires_at)
    values(true,1,$1,$2,'01a0f3c6-8758-0000-378b-d15c40a96f3a',
      'posthog:353503:source:01a0f3c6-8758-0000-378b-d15c40a96f3a',$3,$4,
      lean_private.observed_delivery_scope_hash(),$5,'fixture:old','fixture:delivery',
      clock_timestamp()-interval '1 minute',clock_timestamp()+interval '1 hour')`,
    [project, shop, observedDeliveryPath, observedDeliveryManifestHash, sha(token)]);
  await db.exec(`insert into lean_private.pipeline_annual_access_rules
    (rule_id,project_ref,shop,scope_sha256,excluded_product_id,approval_ref,actor_ref,enabled,not_before,expires_at)
    values('old','${project}','${shop}','799209cbd0913f5257afaabefc478ec7e402640b4ac5c30e5f9ee81eeee30689',
      '8501257175232','fixture:old','fixture:owner',true,clock_timestamp()-interval '1 hour',clock_timestamp()+interval '1 hour')`);
  const protectedFunctions = `select jsonb_agg(jsonb_build_array(oid,prosrc,proowner,proacl,proconfig) order by oid) r
    from pg_proc where oid in ('public.lean_pipeline_health(text,text)'::regprocedure,
      'public.lean_pipeline_claim(uuid,text,text)'::regprocedure,
      'public.lean_pipeline_throughput_step(text,text,uuid,text,jsonb)'::regprocedure,
      'public.lean_production_reports_read()'::regprocedure,
      'public.lean_observed_delivery_read(text,text,text)'::regprocedure)`;
  const before = await q(protectedFunctions);
  const targets = `select jsonb_agg(jsonb_build_array(oid,proowner,proacl,proconfig,prosecdef) order by oid) r from pg_proc where oid in
    ('lean_private.observed_delivery_snapshot(text)'::regprocedure,'lean_private.observed_delivery_revision_guard()'::regprocedure,
     'public.lean_pipeline_exclude_annual_access(bigint,uuid)'::regprocedure)`;
  const targetIdentity = await q(targets);
  const row = await q("select to_jsonb(r) r from lean_private.pipeline_annual_access_rules r");
  const authRow = await q("select to_jsonb(r) r from lean_private.observed_delivery_authorization r");
  await db.exec(sql("pipeline_standing_authority.review"));
  expect(await q(protectedFunctions)).toEqual(before);
  expect(await q(targets)).toEqual(targetIdentity);
  expect(await q("select to_jsonb(r)-'authorization_mode' r from lean_private.pipeline_annual_access_rules r")).toEqual(row);
  expect(await q("select to_jsonb(r)-'authorization_mode' r from lean_private.observed_delivery_authorization r")).toEqual(authRow);
  expect(await q("select authorization_mode r from lean_private.pipeline_annual_access_rules")).toBe("finite");
  const a = await q<Record<string, unknown>>("select public.lean_observed_delivery_auth($1) r", [project]);
  expect(a).not.toHaveProperty("authorization_mode");
  await db.exec("update lean_private.observed_delivery_authorization set enabled=false,revision=2");
  expect(await q("select public.lean_observed_delivery_auth($1) r", [project])).toBeNull();
  expect(await q("select count(*)::int r from lean_private.pipeline_operator_audit")).toBe(0);
  for (const role of ["anon", "authenticated", "service_role", "lean_posthog_reader"]) {
    expect(await q("select has_any_column_privilege($1,'lean_private.observed_delivery_authorization','SELECT,UPDATE') r", [role])).toBe(false);
    expect(await q("select has_any_column_privilege($1,'lean_private.pipeline_annual_access_rules','SELECT,UPDATE') r", [role])).toBe(false);
  }
});

it("finite expiry and seven-day ceiling remain; null/infinity are never implicit standing authority", async () => {
  await db.exec(sql("pipeline_standing_authority.review"));
  await expect(grant("finite")).rejects.toThrow();
  await expect(grant("finite", "clock_timestamp()", "clock_timestamp()+interval '8 days'")).rejects.toThrow();
  await expect(grant("standing", "clock_timestamp()", "'infinity'::timestamptz")).rejects.toThrow();
  await grant("finite", "clock_timestamp()-interval '1 hour'", "clock_timestamp()-interval '1 second'");
  const fetcher = transport();
  expect((await productionObservedDeliveryGet(request(), env, fetcher)).status).toBe(503);
  expect(fetcher).toHaveBeenCalledTimes(1);
  await annual("finite", "clock_timestamp()-interval '1 second'");
  const c = await retained("2", true);
  expect(await q("select public.lean_pipeline_exclude_annual_access($1::bigint,$2::uuid) r", [c.workId, c.lease])).toBe(false);
});

it("standing grant serves qualified rows after seven days with a 30-minute TTL, no credentials or authority fields", async () => {
  await db.exec(sql("pipeline_standing_authority.review"));
  await grant(); await materialize();
  const p = await payload(), status = p.report_status[0];
  expect(Date.parse(String(status.valid_until)) - Date.parse(String(status.checked_at))).toBe(1800000);
  expect(p.store_daily[0]).toMatchObject({ is_stale: true, certified: false, complete_window: false, report_scope: "webhook_observed_only" });
  expect(status).toMatchObject({ producer_liveness: "not_proven", operational_state: "idle" });
  expect(await q("select count(*)::int r from lean_private.pipeline_operator_audit where event='observed_delivery_standing_change'")).toBe(1);
  expect(await q("select previous_state->'after'->>'token_sha256' r from lean_private.pipeline_operator_audit")).toBe(sha(token));
});

it("standing rotation/revocation keeps next-revision/new-secret rules, audits and denies a between-RPC change", async () => {
  await db.exec(sql("pipeline_standing_authority.review")); await grant();
  await expect(db.exec("update lean_private.observed_delivery_authorization set revision=2,approval_ref='fixture:new'")).rejects.toThrow("new token");
  await expect(db.exec("update lean_private.observed_delivery_authorization set enabled=false,revision=3")).rejects.toThrow("exact next");
  const fetcher = transport(async () => {
    await db.exec("update lean_private.observed_delivery_authorization set enabled=false,revision=2");
  });
  const denied = await productionObservedDeliveryGet(request(), env, fetcher);
  expect(denied.status).toBe(503); expect(await denied.text()).toBe("");
  expect(fetcher).toHaveBeenCalledTimes(2);
  const next = `${token}-rotated`;
  await db.query("update lean_private.observed_delivery_authorization set enabled=true,revision=3,token_sha256=$1,approval_ref='fixture:new'", [sha(next)]);
  expect((await productionObservedDeliveryGet(request(), env, transport())).status).toBe(401);
  expect((await productionObservedDeliveryGet(request(next), env, transport())).status).toBe(200);
  expect(await q("select count(*)::int r from lean_private.pipeline_operator_audit where event='observed_delivery_standing_change'")).toBe(3);
});

it("strict auth parser rejects missing/unknown modes, stray keys, dates and targets before data RPC", async () => {
  await db.exec(sql("pipeline_standing_authority.review")); await grant();
  const mutations = [
    (a: Record<string, unknown>) => { const b = { ...a }; delete b.authorization_mode; return b; },
    (a: Record<string, unknown>) => ({ ...a, authorization_mode: "finite" }),
    (a: Record<string, unknown>) => ({ ...a, authorization_mode: "forever" }),
    (a: Record<string, unknown>) => ({ ...a, expires_at: "infinity" }),
    (a: Record<string, unknown>) => ({ ...a, unexpected: true }),
    (a: Record<string, unknown>) => ({ ...a, not_before: "2026-01-01" }),
    (a: Record<string, unknown>) => ({ ...a, not_before: "2999-01-01T00:00:00.000000Z" }),
    (a: Record<string, unknown>) => ({ ...a, source_id: randomUUID() }),
  ];
  for (const change of mutations) {
    const fetcher = transport(undefined, change);
    const denied = await productionObservedDeliveryGet(request(), env, fetcher);
    expect(denied.status).toBe(503); expect(await denied.text()).toBe("");
    expect(fetcher).toHaveBeenCalledTimes(1);
  }
});

it("standing mode does not bypass mixed/stale/pending consumer gates or relabel qualification", async () => {
  await db.exec(sql("pipeline_standing_authority.review")); await grant(); await materialize();
  const p = await payload();
  expect(observedDeliveryView(imports(p), Date.now()).state).toBe("current");
  const mixed = structuredClone(p); mixed.product_daily[0].publication_id = `observed:${"a".repeat(64)}`;
  expect(observedDeliveryView(imports(mixed), Date.now()).state).toBe("mixed");
  const stale = structuredClone(p);
  stale.store_daily[0].snapshot_checked_at = new Date(Date.now() - 1801000).toISOString().replace(/(\.\d{3})Z$/, "$1000Z");
  expect(observedDeliveryView(imports(stale), Date.now()).state).toBe("stale");
  await db.query("select public.lean_accept_receipt('shopify',$1,$2,'orders/updated',$3,'{\"id\":\"2\"}'::jsonb)",
    [randomUUID(), JSON.stringify([shop, "2"]), "a".repeat(64)]);
  const pending = await payload();
  expect(pending.report_status[0].pending_work).toBe("1");
  expect(pending.store_daily).toHaveLength(1);
  expect(pending.product_daily).toHaveLength(1);
  expect(pending.store_daily[0].gross_merchandise_sales_usd).toBe(p.store_daily[0].gross_merchandise_sales_usd);
  expect(observedDeliveryView(imports(pending), Date.now()).state).toBe("pending");
});

it("standing annual rule uses the same ordinary lease/source audit and revokes without touching EXTRA", async () => {
  await db.exec(sql("pipeline_standing_authority.review")); await annual();
  const c = await retained("2", true);
  await db.exec("set role service_role");
  expect(await q("select public.lean_pipeline_exclude_annual_access($1::bigint,$2::uuid) r", [c.workId, c.lease])).toBe(true);
  await db.exec("reset role");
  expect(await q("select previous_state->'rule'->>'authorization_mode' r from lean_private.pipeline_operator_audit")).toBe("standing");
  expect(await q("select count(*)::int r from lean_private.pipeline_heads")).toBe(0);
  expect(await q("select count(*)::int r from lean_private.pipeline_throughput_grants")).toBe(0);
  await expect(db.exec("update lean_private.pipeline_annual_access_rules set authorization_mode='finite',expires_at=clock_timestamp()+interval '1 hour'"))
    .rejects.toThrow("immutable");
  await db.exec("update lean_private.pipeline_annual_access_rules set enabled=false");
  const next = await retained("3", true);
  expect(await q("select public.lean_pipeline_exclude_annual_access($1::bigint,$2::uuid) r", [next.workId, next.lease])).toBe(false);
  await expect(db.exec("update lean_private.pipeline_annual_access_rules set enabled=true")).rejects.toThrow("immutable");
});

it("rejects changed baseline or inherited privilege before any schema amendment", async () => {
  await db.exec("create role inherited_reader;grant inherited_reader to service_role;grant select(expires_at) on lean_private.observed_delivery_authorization to inherited_reader");
  await expect(db.exec(sql("pipeline_standing_authority.review"))).rejects.toThrow("authorization table or column grant");
  await db.exec("rollback; revoke select(expires_at) on lean_private.observed_delivery_authorization from inherited_reader");
  expect(await q("select count(*)::int r from pg_attribute where attrelid='lean_private.observed_delivery_authorization'::regclass and attname='authorization_mode'")).toBe(0);
  await db.exec("create or replace function lean_private.observed_delivery_snapshot(p_project_ref text) returns jsonb language plpgsql set search_path=pg_catalog as $$begin return null;end$$");
  await expect(db.exec(sql("pipeline_standing_authority.review"))).rejects.toThrow("baseline");
  await db.exec("rollback");
  expect(await q("select count(*)::int r from pg_attribute where attrelid='lean_private.pipeline_annual_access_rules'::regclass and attname='authorization_mode'")).toBe(0);
});
