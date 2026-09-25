/** Focused installation check. All provider transport is synthetic; PG/HTTP loopback only.
 * Run after locally building the exact two-route runtime; never use hosted credentials.
 */
const { test, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { createRequire } = require("node:module");
const { readFileSync } = require("node:fs");
const { resolve, join } = require("node:path");
const { createHmac, createHash, randomUUID } = require("node:crypto");
const { createServer } = require("node:http");
const repo = resolve(__dirname, "../..");
const { Client } = createRequire(join(repo, "package.json"))("pg");
const pkg = process.env.SHOPIFY_PACKAGE_ROOT;
assert(pkg, "explicit local package required");
const url = new URL(process.env.SHOPIFY_INSTALL_TEST_URL);
assert.equal(url.hostname, "127.0.0.1");
assert.equal(url.port, "55439", "dedicated disposable cluster required");
assert.equal(url.pathname, "/postgres");
assert.equal(url.username, "fixture_shopify_install");
const dbName = "analytics_test_shopify_install";
const nativeFetch = global.fetch;
const shop = "mullybox-store.myshopify.com", project = "xeqlgxvrhgwwudyqtnun";
const gid = (kind, id) => `gid://shopify/${kind}/${id}`;
const money = amount => ({ shopMoney: { amount, currencyCode: "USD" } });
const conn = nodes => ({ nodes, pageInfo: { hasNextPage: false, endCursor: null } });
const created = "2026-01-01T12:00:00Z", revision = "2026-01-02T15:00:00Z";
const policy = { decision: { eligibility: "eligible", commerceSource: "other", acquisitionEligible: false,
  approvalRef: "fixture:catalog" }, productClasses: { "3": "merchandise" },
  saleClock: "paid_at", refundClock: "refund_created_at", financialApprovalRef: "fixture:finance" };
function source(refunded = false) {
  const order = { id: gid("Order", "1"), createdAt: created, updatedAt: revision, currencyCode: "USD",
    edited: false, taxesIncluded: false, test: false, cancelledAt: null, shippingAddress: null,
    originalTotalPriceSet: money("10"), subtotalPriceSet: money("10"), transactionsCount: { count: refunded ? 2 : 1, precision: "EXACT" },
    transactions: [{ id: gid("OrderTransaction", "4"), kind: "SALE", status: "SUCCESS", gateway: "fixture",
      test: false, createdAt: created, processedAt: created, amountSet: money("10"), parentTransaction: null },
      ...(refunded ? [{ id: gid("OrderTransaction", "5"), kind: "REFUND", status: "SUCCESS", gateway: "fixture",
        test: false, createdAt: "2026-01-02T12:00:00Z", processedAt: "2026-01-02T12:01:00Z", amountSet: money("4"),
        parentTransaction: { id: gid("OrderTransaction", "4"), gateway: "fixture" } }] : [])],
    lineItems: conn([{ id: gid("LineItem", "2"), sku: "FIXTURE", quantity: 1, isGiftCard: false,
      product: { id: gid("Product", "3") }, originalUnitPriceSet: money("10"), originalTotalSet: money("10"), discountAllocations: [] }]) };
  return { commerce: { shop, apiVersion: "2026-07", order }, financial: {
    id: order.id, updatedAt: revision, currencyCode: "USD", originalTotalPriceSet: money("10"), totalTaxSet: money("0"),
    originalTotalDutiesSet: null, originalTotalAdditionalFeesSet: null, totalTipReceivedSet: money("0"),
    shippingLines: conn([]), refunds: refunded ? [{ id: gid("Refund", "7"), updatedAt: "2026-01-02T12:02:00Z" }] : [] },
  refunds: refunded ? [{ id: gid("Refund", "7"), order: { id: order.id }, createdAt: "2026-01-02T12:00:00Z",
    updatedAt: "2026-01-02T12:02:00Z", totalRefundedSet: money("4"), duties: null, orderAdjustments: conn([]),
    refundLineItems: conn([{ id: gid("RefundLineItem", "8"), quantity: 1, lineItem: { id: gid("LineItem", "2") },
      subtotalSet: money("4"), totalTaxSet: money("0") }]), refundShippingLines: conn([]),
    transactions: conn([{ id: gid("OrderTransaction", "5"), kind: "REFUND", status: "SUCCESS",
      processedAt: "2026-01-02T12:01:00Z", amountSet: money("4") }]) }] : [] };
}
const baseline = { VERCEL_ENV: "preview", VERCEL_GIT_COMMIT_REF: "review/analytics-initial-validation",
  LEAN_ANALYTICS_PIPELINE_PROJECT_REF: project, LEAN_ANALYTICS_SUPABASE_URL: `https://${project}.supabase.co`,
  LEAN_ANALYTICS_SUPABASE_SERVICE_ROLE_KEY: "fixture:db", LEAN_SHOPIFY_SHOP_DOMAIN: shop,
  LEAN_SHOPIFY_ANALYTICS_READ_TOKEN: "fixture:source", LEAN_SHOPIFY_WEBHOOK_SECRET: "fixture:hmac",
  LEAN_ANALYTICS_SHOPIFY_PILOT_PROCESS_SECRET: "fixture:pilot".padEnd(40, "x"),
  LEAN_ANALYTICS_SHOPIFY_PILOT_ID: "fixture:shopify",
  LEAN_ANALYTICS_SHOPIFY_PILOT_ENABLED: "true", LEAN_ANALYTICS_RECEIPTS_ENABLED: "true", LEAN_ANALYTICS_PIPELINE_ENABLED: "true" };
let control, admin, runtime, peer, server, origin, currentSource, requests, rpcErrors, hook, calls, googleBefore;
const rows = async (sql, args = []) => (await admin.query(sql, args)).rows;
async function rpc(pg, name, args) {
  assert.match(name, /^lean_[a-z_]+$/);
  const entries = Object.entries(args);
  for (const [key] of entries) assert.match(key, /^p_[a-z_]+$/);
  const result = await pg.query(`select public.${name}(${entries.map(([k], i) => `${k}=>$${i + 1}`).join(",")}) result`,
    entries.map(([, v]) => typeof v === "object" && v !== null ? JSON.stringify(v) : v));
  return result.rows[0].result;
}
const target = () => ({ p_pilot: "fixture:shopify", p_project_ref: project, p_shop: shop });
const scope = (overrides = {}) => ({ pilotId: "fixture:shopify", projectRef: project, shop,
  fromTime: "2026-01-01T00:00:00Z", untilTime: "2026-02-01T00:00:00Z",
  expiresAt: new Date(Date.now() + 3600000).toISOString(), policy, approvalRef: "fixture:scope", actorRef: "fixture:actor",
  maxReceipts: 1000, maxAttempts: 100, maxDailyAttempts: 20, ...overrides });
async function register(overrides, enabled = true) {
  await rpc(admin, "lean_shopify_pilot_register", { p_scope: scope(overrides) });
  if (enabled) await admin.query("update lean_private.shopify_pilots set enabled=true; update lean_private.pipeline_scope set enabled=true");
}
const envelope = (changes = {}) => ({ id: "1", admin_graphql_api_id: gid("Order", "1"), created_at: created,
  updated_at: revision, test: false, cancelled_at: null, line_items: [{ product_id: "3" }],
  customer: { email: "discard-me@example.invalid" }, note: "discard PII", ...changes });
async function receipt(payload = envelope(), topic = "orders/updated", delivery = randomUUID(), signature) {
  const body = JSON.stringify(payload);
  return nativeFetch(`${origin}/shopify`, { method: "POST", body, headers: {
    "x-shopify-hmac-sha256": signature ?? createHmac("sha256", baseline.LEAN_SHOPIFY_WEBHOOK_SECRET).update(body).digest("base64"),
    "x-shopify-shop-domain": shop, "x-shopify-topic": topic, "x-shopify-webhook-id": delivery } });
}
const post = (suffix = "", options = {}) => nativeFetch(`${origin}/process${suffix}`, { method: "POST",
  headers: { authorization: `Bearer ${baseline.LEAN_ANALYTICS_SHOPIFY_PILOT_PROCESS_SECRET}` }, ...options });
async function good() {
  assert.equal((await receipt()).status, 202);
  const result = await post();
  assert.equal(result.status, 200, JSON.stringify(rpcErrors));
  assert.deepEqual(await result.json(), { state: "done" }, JSON.stringify(rpcErrors));
}
async function transport(input, init) {
  const url = String(input);
  if (url.startsWith(baseline.LEAN_ANALYTICS_SUPABASE_URL + "/rest/v1/rpc/")) {
    const name = new URL(url).pathname.split("/").at(-1), args = JSON.parse(init.body);
    calls.push({ name, args });
    if (hook) await hook(name, args);
    try { return Response.json(await rpc(runtime, name, args)); }
    catch (e) { rpcErrors.push({ name, message: e.message, code: e.code }); return Response.json({ message: e.message, code: e.code }, { status: 400 }); }
  }
  assert.equal(url, `https://${shop}/admin/api/2026-07/graphql.json`, "no nonfixture destination allowed");
  assert.equal(init.redirect, "error"); assert.equal(init.method, "POST");
  init.signal.throwIfAborted(); requests++;
  const { query, variables } = JSON.parse(init.body);
  let data;
  if (query.trim().startsWith("query AnalyticsOrder(")) data = { order: currentSource.commerce.order };
  else if (query.trim().startsWith("query AnalyticsFinancial(")) data = { order: currentSource.financial };
  else { assert.ok(query.trim().startsWith("query AnalyticsRefund(")); data = { refund: currentSource.refunds.find(r => r.id === variables.id) }; }
  return Response.json({ data }, { headers: { "X-Shopify-API-Version": "2026-07" } });
}
before(async () => {
  control = new Client({ connectionString: url.href }); await control.connect();
  await control.query(`drop database if exists ${dbName}`);
  await control.query(`drop role if exists lean_pilot_reader; drop role if exists lean_observed_reader;
    drop role if exists lean_posthog_reader;
    do $$ begin
      if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role; end if;
      if not exists(select 1 from pg_roles where rolname='anon') then create role anon; end if;
      if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated; end if;
    end $$`);
  await control.query(`create database ${dbName}`);
  url.pathname = `/${dbName}`;
  admin = new Client({ connectionString: url.href }); runtime = new Client({ connectionString: url.href }); peer = new Client({ connectionString: url.href });
  await admin.connect(); await runtime.connect(); await peer.connect();
  await admin.query("alter default privileges in schema public grant execute on functions to anon,authenticated,service_role");
  for (const name of ["001_staging", "003_receipts", "004_worker", "013_release", "014_reporting_views",
    "015_backfill", "016_shopify_pilot", "017_shopify_pipeline", "018_history_jobs", "019_spend_jobs",
    "020_observed_report_jobs", "021_full_report_jobs", "022_full_release", "023_posthog_export", "024_full_orchestration",
    "038_google_spend_pilot"])
    await admin.query(readFileSync(join(repo, "sql/analytics", `${name}.sql`), "utf8"));
  await rpc(admin, "lean_spend_pilot_register", { p_scope: { pilotId: "fixture:google", projectRef: project,
    accountId: "1234567890", loginCustomerId: "9876543210", maxPages: 5,
    expiresAt: new Date(Date.now() + 86400000).toISOString(), approvalRef: "fixture:approval", actorRef: "fixture:actor",
    days: [{ runId: "fixture:google-day", date: new Date(Date.now() - 86400000).toISOString().slice(0, 10),
      dueAt: new Date(Date.now() - 3600000).toISOString() }] } });
  await admin.query("update lean_private.spend_pilots set enabled=true; update lean_private.spend_jobs set enabled=true");
  googleBefore = JSON.stringify(await rows("select to_jsonb(p) p from lean_private.spend_pilots p"));
  const googleFunctions = await rows("select oid::regprocedure::text name,pg_get_functiondef(oid) def from pg_proc where pronamespace='public'::regnamespace and proname like 'lean_spend_%' order by 1");
  await admin.query(readFileSync(join(repo, "sql/analytics/039_shopify_bounded_pilot.sql"), "utf8"));
  assert.deepEqual(await rows("select oid::regprocedure::text name,pg_get_functiondef(oid) def from pg_proc where pronamespace='public'::regnamespace and proname like 'lean_spend_%' order by 1"), googleFunctions);
  await runtime.query("set role service_role; set statement_timeout='5s'"); await peer.query("set statement_timeout='5s'");
  Object.assign(process.env, baseline); global.fetch = transport;
  const handlers = Object.fromEntries(["shopify", "process"].map(route =>
    [route, require(join(pkg, `.vercel/output/functions/api/analytics/ingest/${route}.func/index.js`))]));
  server = createServer((req, res) => handlers[req.url.split("?")[0].split("/").at(-1)](req, res));
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  origin = `http://127.0.0.1:${server.address().port}/api/analytics/ingest`;
});
beforeEach(async () => {
  Object.assign(process.env, baseline); hook = null; currentSource = source(); requests = 0; calls = []; rpcErrors = [];
  await admin.query(`truncate lean_private.pipeline_scope cascade; truncate lean_private.receipts cascade;
    truncate lean_private.publications cascade`);
});
after(async () => {
  global.fetch = nativeFetch;
  if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
  if (admin && googleBefore) assert.equal(JSON.stringify(await rows("select to_jsonb(p) p from lean_private.spend_pilots p")), googleBefore);
  await runtime?.end(); await peer?.end(); await admin?.end();
  if (control) { await control.query(`drop database if exists ${dbName}`); await control.end(); }
});
test("001–024+038+039 install; disabled registration, immutable scope, enabled Google unchanged", async () => {
  await register({}, false);
  assert.deepEqual(await rows("select enabled,blocked,receipts_used,attempts_used from lean_private.shopify_pilots"),
    [{ enabled: false, blocked: false, receipts_used: 0, attempts_used: 0 }]);
  assert.equal((await rpc(runtime, "lean_shopify_pilot_status", target())).state, "disabled");
  assert.equal((await receipt()).status, 200); assert.equal((await post()).status, 503);
  assert.equal(requests, 0);
  await assert.rejects(admin.query("update lean_private.shopify_pilots set expires_at=expires_at+interval '1 day'"), /immutable/);
});
test("actual packaged HTTP default-off, wrong destination, bad auth/HMAC and scope input denied", async () => {
  await register();
  process.env.LEAN_ANALYTICS_SHOPIFY_PILOT_ENABLED = "false";
  assert.equal((await receipt()).status, 404); assert.equal((await post()).status, 404);
  process.env.LEAN_ANALYTICS_SHOPIFY_PILOT_ENABLED = "true"; process.env.VERCEL_ENV = "production";
  assert.equal((await receipt()).status, 404); assert.equal((await post()).status, 404);
  process.env.VERCEL_ENV = "preview";
  assert.equal((await post("", { headers: { authorization: "Bearer wrong" } })).status, 401);
  assert.equal((await post("?scope=other")).status, 400);
  assert.equal((await post("", { body: "{}" })).status, 400);
  assert.equal((await receipt(envelope(), "orders/updated", randomUUID(), "bad")).status, 400);
  assert.equal(calls.length, 0); assert.equal(requests, 0);
});
test("minimal HMAC receipt→actual reader/mapper→real service-role SQL; equal replay, raw hash collision", async () => {
  await register(); const delivery = randomUUID(), payload = envelope();
  assert.equal((await receipt(payload, "orders/updated", delivery)).status, 202);
  assert.equal((await receipt(payload, "orders/updated", delivery)).status, 202);
  const result = await post(); assert.equal(result.status, 200, JSON.stringify(rpcErrors));
  assert.deepEqual(await result.json(), { state: "done" }, JSON.stringify(rpcErrors));
  assert.equal(requests, 4); assert.deepEqual(await (await post()).json(), { state: "idle" }); assert.equal(requests, 4);
  const [r] = await rows("select payload,payload_hash from lean_private.receipts");
  assert.deepEqual(Object.keys(r.payload).sort(), ["admin_graphql_api_id", "created_at", "product_ids", "unsupported", "updated_at"]);
  assert.ok(!JSON.stringify(r.payload).includes("discard"));
  assert.equal(r.payload_hash, createHash("sha256").update(JSON.stringify(payload)).digest("hex"));
  assert.deepEqual(await rows("select receipts_used,attempts_used from lean_private.shopify_pilots"), [{ receipts_used: 1, attempts_used: 1 }]);
  assert.deepEqual(await rows("select total_sales_usd::text,certification,pipeline_stale,collected_cash_usd,new_customers,spend_usd from lean_analytics.observed_order_daily"),
    [{ total_sales_usd: "10.000000", certification: "unverified", pipeline_stale: false, collected_cash_usd: null, new_customers: null, spend_usd: null }]);
  assert.equal((await rows("select * from lean_private.selected_publications")).length, 0);
  assert.equal((await receipt({ ...payload, note: "changed" }, "orders/updated", delivery)).status, 503);
  assert.match(rpcErrors.at(-1).message, /collision/);
});
for (const [name, changes, topic] of [
  ["missing order.updated_at", { updated_at: undefined }, "orders/updated"],
  ["catalog exit", { line_items: [{ product_id: "9" }] }, "orders/updated"],
  ["cancel", { cancelled_at: revision }, "orders/cancelled"],
]) test(`${name} withholds previously good output without source hydration`, async () => {
  await register(); await good(); const before = requests;
  const res = await receipt(envelope(changes), topic);
  assert.equal(res.status, 202); assert.equal((await res.json()).state, "withheld");
  assert.deepEqual(await (await post()).json(), { state: "idle" }); assert.equal(requests, before);
  assert.equal((await rows("select pipeline_stale from lean_analytics.observed_order_daily"))[0].pipeline_stale, true);
  assert.equal((await rows("select count(*)::int n from lean_private.work where state='dead'"))[0].n, 1);
});
test("unapproved mixed product and creation window rejected before retention/hydration", async () => {
  await register();
  for (const payload of [envelope({ line_items: [{ product_id: "3" }, { product_id: "9" }] }),
    envelope({ created_at: "2025-12-01T00:00:00Z" }), envelope({ updated_at: undefined })])
    assert.equal((await (await receipt(payload)).json()).state, "ignored");
  assert.deepEqual(await (await post()).json(), { state: "idle" }); assert.equal(requests, 0);
  assert.equal((await rows("select count(*)::int n from lean_private.receipts"))[0].n, 0);
});
test("unknown refund uses no lookup; verified membership permits actual refund read and creation-time fallback", async () => {
  await register();
  const refund = { id: "7", order_id: "1", created_at: "2026-01-02T12:00:00Z" };
  assert.equal((await (await receipt(refund, "refunds/create")).json()).state, "ignored"); assert.equal(requests, 0);
  // Initial event precedes refund; source revision also precedes refund.
  currentSource.commerce.order.updatedAt = "2026-01-01T15:00:00Z";
  currentSource.financial.updatedAt = "2026-01-01T15:00:00Z";
  assert.equal((await receipt(envelope({ updated_at: "2026-01-01T15:00:00Z" }))).status, 202);
  assert.equal((await (await receipt(refund, "refunds/create")).json()).state, "ignored");
  assert.equal(requests, 0);
  assert.deepEqual(await (await post()).json(), { state: "done" });
  currentSource = source(true);
  assert.equal((await receipt(refund, "refunds/create")).status, 202);
  assert.equal((await rows("select pipeline_stale from lean_analytics.observed_order_daily"))[0].pipeline_stale, true);
  const response = await post(); assert.deepEqual(await response.json(), { state: "done" }, JSON.stringify(rpcErrors));
  assert.equal(requests, 9);
  assert.equal((await rows("select sum(total_sales_usd)::text sales from lean_analytics.observed_order_daily"))[0].sales, "6.000000");
});
test("edited source stays withheld/stale with one attempt and no automatic retry", async () => {
  await register(); await good();
  currentSource.commerce.order.updatedAt = "2026-01-03T00:00:00Z"; currentSource.financial.updatedAt = currentSource.commerce.order.updatedAt;
  currentSource.commerce.order.edited = true;
  await receipt(envelope({ updated_at: currentSource.commerce.order.updatedAt }));
  const result = await post(); assert.deepEqual(await result.json(), { state: "failed" });
  const before = requests; assert.deepEqual(await (await post()).json(), { state: "idle" }); assert.equal(requests, before);
  assert.equal((await rows("select pipeline_stale from lean_analytics.observed_order_daily"))[0].pipeline_stale, true);
});
test("owner registration and renamed bypasses denied to actual service_role; old generic paths reject pilot", async () => {
  await register(); await good();
  assert.deepEqual(await rows(`select proname from pg_proc where pronamespace='public'::regnamespace and
    (proname like '%\\_017' or proname like '%\\_003' or proname like '%\\_039_ordinary' or proname='lean_shopify_pilot_register')
    and (has_function_privilege('service_role',oid,'execute') or has_function_privilege('anon',oid,'execute')
      or has_function_privilege('authenticated',oid,'execute'))`), []);
  for (const query of ["select public.lean_shopify_pilot_register('{}')",
    "select public.lean_accept_receipt_003('shopify','x','[]','orders/paid','x','{}')",
    "select public.lean_pipeline_claim_017(gen_random_uuid(),'x','x')",
    "select public.lean_claim_work_039_ordinary('x',1,30)",
    "select public.lean_pipeline_retain_017(1,gen_random_uuid(),'{}')",
    "select public.lean_pipeline_finish_017(1,gen_random_uuid(),'{}','[]')",
    "select public.lean_pipeline_fail_017(1,gen_random_uuid(),'source_unavailable')",
    "update lean_private.shopify_pilots set enabled=true"])
    await assert.rejects(runtime.query(query), /permission denied/);
  await assert.rejects(rpc(runtime, "lean_pipeline_claim", { p_token: randomUUID(), p_project_ref: project, p_shop: shop }), /bounded pilot/);
  await assert.rejects(rpc(runtime, "lean_accept_receipt", { p_source: "shopify", p_delivery_id: "old",
    p_business_key: JSON.stringify([shop, gid("Order", "1")]), p_topic: "orders/updated", p_payload_hash: "a".repeat(64), p_payload: {} }), /bounded pilot/);
  await assert.rejects(rpc(runtime, "lean_claim_work", { p_token: "x", p_limit: 1, p_lease_seconds: 30 }), /bounded pilot/);
  const [{ work_id }] = await rows("select work_id from lean_private.work limit 1");
  await assert.rejects(rpc(runtime, "lean_finish_work", { p_work_id: work_id, p_token: "x", p_version: "v", p_facts: {} }), /bounded pilot/);
});
test("ordinary unregistered pipeline path remains compatible after039", async () => {
  process.env.LEAN_ANALYTICS_SHOPIFY_PILOT_ENABLED = "false";
  process.env.LEAN_ANALYTICS_SHOPIFY_PILOT_ID = "";
  process.env.LEAN_ANALYTICS_PIPELINE_SECRET = baseline.LEAN_ANALYTICS_SHOPIFY_PILOT_PROCESS_SECRET;
  await admin.query(`insert into lean_private.pipeline_scope(shop,project_ref,enabled,from_time,until_time,policy,approval_ref,actor_ref)
    values($1,$2,true,'2026-01-01','2026-02-01',$3,'fixture:scope','fixture:actor')`, [shop, project, JSON.stringify(policy)]);
  await good(); assert.equal(requests, 4);
  assert.deepEqual(await (await post()).json(), { state: "idle" });
  assert.equal((await rows("select count(*)::int n from lean_private.shopify_pilots"))[0].n, 0);
});
test("parent/scope kill fences claim, retain and finish; whole report stays stale", async () => {
  await register(); await good(); await admin.query("update lean_private.shopify_pilots set enabled=false");
  assert.equal((await (await receipt()).json()).state, "disabled"); assert.equal((await post()).status, 503);
  assert.equal((await rows("select pipeline_stale from lean_analytics.observed_order_daily"))[0].pipeline_stale, true);
  await admin.query("update lean_private.shopify_pilots set enabled=true"); await receipt();
  hook = async name => { if (name === "lean_pipeline_retain") await admin.query("update lean_private.pipeline_scope set enabled=false"); };
  assert.deepEqual(await (await post()).json(), { state: "lost_lease" });
  assert.equal((await rows("select count(*)::int n from lean_private.pipeline_snapshots where source is not null"))[0].n, 1);
  await admin.query("update lean_private.pipeline_scope set enabled=true"); await receipt();
  hook = async name => { if (name === "lean_pipeline_finish") await admin.query("update lean_private.shopify_pilots set enabled=false"); };
  assert.deepEqual(await (await post()).json(), { state: "lost_lease" });
  assert.equal((await rows("select count(*)::int n from lean_private.work where state='done'"))[0].n, 1);
});
test("newer withheld receipt fences older in-flight retain and finish", async () => {
  await register(); await receipt();
  let blocked;
  hook = async name => { if (name === "lean_pipeline_retain") {
    hook = null; blocked = await receipt(envelope({ updated_at: "2026-01-03T00:00:00Z", cancelled_at: revision }), "orders/cancelled");
  } };
  assert.equal((await post()).status, 503); assert.equal(blocked.status, 202);
  assert.match(rpcErrors.at(-1).message, /withheld membership/);
  assert.equal((await rows("select count(*)::int n from lean_private.pipeline_snapshots where source is not null"))[0].n, 0);
  // A fresh admitted event permits hydration but newer cancellation still fences finish.
  currentSource.commerce.order.updatedAt = "2026-01-04T00:00:00Z"; currentSource.financial.updatedAt = currentSource.commerce.order.updatedAt;
  await receipt(envelope({ updated_at: currentSource.commerce.order.updatedAt }));
  hook = async name => { if (name === "lean_pipeline_finish") {
    hook = null; await receipt(envelope({ updated_at: "2026-01-05T00:00:00Z", cancelled_at: revision }), "orders/cancelled");
  } };
  assert.deepEqual(await (await post()).json(), { state: "lost_lease" });
  assert.equal((await rows("select count(*)::int n from lean_private.orders"))[0].n, 0);
});
for (const limit of ["maxReceipts", "maxAttempts", "maxDailyAttempts"]) test(`${limit} hard cap cannot retry or acquire more source`, async () => {
  await register({ [limit]: 1 }); await good(); const before = requests;
  const next = await receipt(envelope({ id: "2", admin_graphql_api_id: gid("Order", "2") }));
  if (limit === "maxReceipts") assert.equal((await next.json()).state, "blocked"); else assert.equal(next.status, 202);
  const response = await post(); const result = await response.json();
  assert.ok(["disabled", "unavailable"].includes(result.state)); assert.equal(requests, before);
  assert.equal((await rows("select attempts_used from lean_private.shopify_pilots"))[0].attempts_used, 1);
});
test("absolute expiry rejects receipt/replay and source claim without reads", async () => {
  await register({ expiresAt: new Date(Date.now() + 600).toISOString() }); await receipt();
  await admin.query("select pg_sleep(0.65)");
  assert.equal((await (await receipt()).json()).state, "expired"); assert.equal((await post()).status, 503); assert.equal(requests, 0);
});
test("separate-connection parent lock prevents concurrent kill; rollback leaves no extra attempt", async () => {
  await register(); await receipt();
  await admin.query("begin");
  try {
    const claimed = await rpc(admin, "lean_shopify_pilot_claim", { ...target(), p_token: randomUUID() });
    assert.equal(claimed.state, "claimed"); await peer.query("set lock_timeout='100ms'");
    await assert.rejects(peer.query("update lean_private.shopify_pilots set enabled=false"), { code: "55P03" });
  } finally { await admin.query("rollback"); await peer.query("set lock_timeout=0"); }
  assert.equal((await rows("select attempts_used from lean_private.shopify_pilots"))[0].attempts_used, 0);
  assert.equal((await rows("select count(*)::int n from lean_private.pipeline_snapshots"))[0].n, 0);
});
test("accept and retain hold BOTH parent and scope kill locks through commit", async () => {
  await register(); await receipt();
  const acceptArgs = calls.find(c => c.name === "lean_shopify_pilot_accept").args;
  const token = randomUUID();
  const claimed = await rpc(runtime, "lean_shopify_pilot_claim", { ...target(), p_token: token });
  await peer.query("set lock_timeout='100ms'");
  try {
    for (const [name, args] of [
      ["lean_shopify_pilot_accept", { ...acceptArgs, p_delivery_id: randomUUID() }],
      ["lean_pipeline_retain", { p_work_id: claimed.workId, p_token: token, p_source: currentSource }],
    ]) {
      await admin.query("begin");
      try {
        await rpc(admin, name, args);
        await assert.rejects(peer.query("update lean_private.shopify_pilots set enabled=false"), { code: "55P03" });
        await assert.rejects(peer.query("update lean_private.pipeline_scope set enabled=false"), { code: "55P03" });
      } finally { await admin.query("rollback"); }
    }
  } finally { await peer.query("set lock_timeout=0"); }
});
for (const [phase, table] of [["retain", "pipeline_snapshots"], ["finish", "orders"]]) test(`${phase} expiry DURING write rolls back all late output`, async () => {
  await register(); await receipt();
  hook = async name => {
    if (name !== `lean_pipeline_${phase}`) return;
    await admin.query("update lean_private.work set lease_until=clock_timestamp()+interval '100 milliseconds' where state='leased'");
    await admin.query(`create or replace function public.fixture_slow() returns trigger language plpgsql as
      $$ begin perform pg_sleep(0.2); return new; end $$;
      create trigger fixture_slow before ${phase === "retain" ? "update" : "insert"} on lean_private.${table}
      for each row execute function public.fixture_slow()`);
  };
  try {
    assert.equal((await post()).status, 503); assert.match(rpcErrors.at(-1).message, /expired during/);
    assert.equal((await rows("select count(*)::int n from lean_private.orders"))[0].n, 0);
    if (phase === "retain") assert.equal((await rows("select count(*)::int n from lean_private.pipeline_snapshots where source is not null"))[0].n, 0);
  } finally { await admin.query(`drop trigger if exists fixture_slow on lean_private.${table}`); }
});
for (const [phase, table] of [["accept", "receipts"], ["retain", "pipeline_snapshots"], ["finish", "orders"]])
  test(`${phase} absolute pilot expiry DURING write rolls back late output`, async () => {
    await register({ expiresAt: new Date(Date.now() + 600).toISOString() });
    if (phase !== "accept") await receipt();
    const event = phase === "retain" ? "update" : "insert";
    const setup = async () => admin.query(`create or replace function public.fixture_wait_expiry() returns trigger language plpgsql as
      $$ declare until_time timestamptz; begin
        select expires_at into until_time from lean_private.shopify_pilots;
        perform pg_sleep(greatest(0,extract(epoch from until_time-clock_timestamp()))+0.025);
        return new;
      end $$;
      create trigger fixture_wait_expiry before ${event} on lean_private.${table}
      for each row execute function public.fixture_wait_expiry()`);
    if (phase === "accept") await setup();
    else hook = async name => { if (name === `lean_pipeline_${phase}`) await setup(); };
    try {
      const response = phase === "accept" ? await receipt() : await post();
      assert.equal(response.status, 503); assert.match(rpcErrors.at(-1).message, /expired during/);
      assert.equal((await rows("select count(*)::int n from lean_private.orders"))[0].n, 0);
      if (phase === "accept") assert.equal((await rows("select count(*)::int n from lean_private.receipts"))[0].n, 0);
      if (phase === "retain") assert.equal((await rows("select count(*)::int n from lean_private.pipeline_snapshots where source is not null"))[0].n, 0);
    } finally { await admin.query(`drop trigger if exists fixture_wait_expiry on lean_private.${table}`); }
  });
