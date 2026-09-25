/** Focused new-import installation/transport tests. Dedicated loopback PG only. */
/* eslint-disable @typescript-eslint/no-require-imports -- tests the actual CommonJS build operator */
const { test, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join, resolve } = require("node:path");
const { randomUUID } = require("node:crypto");
const { Client } = require("pg");
const C = require("../../scripts/analytics/history-import-contract.cjs");
const O = require("../../scripts/analytics/history-import-operator.cjs");
const repo = resolve(__dirname, "../..");
const base = new URL(process.env.HISTORY_IMPORT_TEST_URL);
assert.equal(base.hostname, "127.0.0.1"); assert.equal(base.port, "55439");
assert.equal(base.username, "fixture_shopify_install"); assert.equal(base.pathname, "/postgres");
const dbName = "analytics_test_history_import";
const env = { VERCEL_ENV: "preview", VERCEL_GIT_COMMIT_REF: C.BRANCH, LEAN_ANALYTICS_PIPELINE_PROJECT_REF: C.PROJECT,
  LEAN_ANALYTICS_SUPABASE_URL: `https://${C.PROJECT}.supabase.co`, LEAN_SHOPIFY_SHOP_DOMAIN: C.SHOP,
  LEAN_SHOPIFY_ANALYTICS_READ_TOKEN: "synthetic:source", LEAN_ANALYTICS_SUPABASE_SERVICE_ROLE_KEY: "synthetic:db" };
const money = amount => ({ shopMoney: { amount, currencyCode: "USD" } });
const gid = (kind, id) => `gid://shopify/${kind}/${id}`;
function order(id = "1") {
  return { __typename: "Order", id: gid("Order", id), createdAt: "2021-05-01T00:00:00Z", updatedAt: "2026-09-24T00:00:00Z",
    processedAt: null, cancelledAt: null, test: false, edited: true, taxesIncluded: false, currencyCode: "USD",
    displayFinancialStatus: null, totalPriceSet: money("10.123456"), currentTotalPriceSet: money("7"),
    subtotalPriceSet: null, totalTaxSet: null, totalDiscountsSet: null, totalRefundedSet: money("3"),
    refunds: [{ id: gid("Refund", id), createdAt: null, updatedAt: "2026-09-24T00:00:00Z", totalRefundedSet: money("3") }] };
}
function line(id = "2", parent = "1") {
  return { __typename: "LineItem", __parentId: gid("Order", parent), id: gid("LineItem", id), quantity: 0, currentQuantity: 0,
    isGiftCard: false, requiresShipping: true, taxable: false, product: null, variant: null,
    originalTotalSet: money("10.123456"), originalUnitPriceSet: money("10.123456"), totalDiscountSet: money("0") };
}
const bytesFor = rows => Buffer.from(rows.map(r => JSON.stringify(r)).join("\n") + (rows.length ? "\n" : ""));
function stream(bytes) { return new ReadableStream({ start(c) { for (let i = 0; i < bytes.length; i += 31) c.enqueue(bytes.subarray(i, i + 31)); c.close(); } }); }
async function parse(rows, overrides = {}) {
  const bytes = bytesFor(rows), batches = [];
  return { evidence: await C.parseStream(stream(bytes), { fileSize: bytes.length, expectedOrders: 1, objectCount: rows.length,
    batch: async b => batches.push(b), ...overrides }), batches };
}
let admin, runtime, control, peer, body, requests, rpcFailures, badVersion, changedCount, changedOperation, beforeFunctions;
const target = () => ({ p_job: "fixture-history", p_project: C.PROJECT, p_shop: C.SHOP });
async function rpc(db, name, args) {
  const entries = Object.entries(args);
  assert.match(name, /^lean_[a-z_]+$/);
  const sql = `select public.${name}(${entries.map(([key], i) => `${key}=>$${i + 1}`).join(",")}) result`;
  const result = await db.query(sql, entries.map(([, v]) => v && typeof v === "object" ? JSON.stringify(v) : v));
  return result.rows[0].result;
}
const scope = overrides => ({ jobId: "fixture-history", projectRef: C.PROJECT, shop: C.SHOP, appId: C.APP,
  installationId: C.INSTALLATION, apiVersion: C.VERSION, untilTime: C.CUTOFF, queryText: C.QUERY, queryHash: C.HASH,
  expectedOrders: 1, expiresAt: new Date(Date.now() + 3600000).toISOString(), purgeAfter: new Date(Date.now() + 7200000).toISOString(),
  approvalRef: "fixture:approved-source-only", actorRef: "fixture:owner", ...overrides });
async function register(overrides = {}, enabled = true) {
  await rpc(admin, "lean_history_import_register", { p_scope: scope(overrides) });
  if (enabled) await admin.query("update lean_private.history_import_jobs set enabled=true");
}
const identity = () => ({ shop: { myshopifyDomain: C.SHOP }, currentAppInstallation: { id: C.INSTALLATION,
  app: { id: C.APP }, accessScopes: ["read_orders", "read_all_orders", "read_products"].map(handle => ({ handle })) },
  ordersCount: { count: changedCount ? 2 : 1, precision: "EXACT" } });
const op = () => ({ id: gid("BulkOperation", "123"), status: "COMPLETED", type: "QUERY", query: C.QUERY,
  rootObjectCount: "1", objectCount: "2", fileSize: String(body.length), url: "https://storage.googleapis.com/fixture-private/source.jsonl?secret=never-output",
  partialDataUrl: null, createdAt: "2026-09-25T08:20:00Z", completedAt: "2026-09-25T08:21:00Z", errorCode: null,
  ...(changedOperation ? { objectCount: "3" } : {}) });
async function transport(input, init) {
  const url = String(input);
  assert.equal(init.redirect, "error");
  if (url.startsWith(env.LEAN_ANALYTICS_SUPABASE_URL + "/rest/v1/rpc/")) {
    assert.equal(init.headers.apikey, env.LEAN_ANALYTICS_SUPABASE_SERVICE_ROLE_KEY);
    try { return Response.json(await rpc(runtime, url.split("/").at(-1), JSON.parse(init.body))); }
    catch (e) { rpcFailures.push(e.message); return Response.json({ error: "synthetic_rpc_failure" }, { status: 400 }); }
  }
  requests++;
  if (url.startsWith("https://storage.googleapis.com/")) {
    assert.equal(Object.keys(init.headers).join(","), "Accept-Encoding");
    return new Response(stream(body), { headers: { "content-length": String(body.length) } });
  }
  assert.equal(url, `https://${C.SHOP}/admin/api/2026-07/graphql.json`);
  const request = JSON.parse(init.body); let data;
  if (request.query === C.PREFLIGHT) data = { ...identity(), bulkOperations: { nodes: [], pageInfo: { hasNextPage: false } } };
  else if (request.query === C.START) {
    assert.equal(request.variables.query, C.QUERY);
    const state = (await admin.query("select state from lean_private.history_import_jobs")).rows[0].state;
    assert.equal(state, "submitting", "submission reserved before mutation");
    data = { bulkOperationRunQuery: { bulkOperation: { id: gid("BulkOperation", "123"), status: "CREATED" }, userErrors: [] } };
  } else { assert.equal(request.query, C.CHECK); data = { ...identity(), node: op() }; }
  return Response.json({ data }, { headers: { "X-Shopify-API-Version": badVersion ? "2026-01" : C.VERSION } });
}
const run = mode => O.check(env, { mode, jobId: "fixture-history" }, transport);
async function ready() { assert.equal((await run("start")).status, "source_operation_submitted", rpcFailures.join()); assert.equal((await run("check")).status, "source_download_ready", rpcFailures.join()); }
const claimImport = token => rpc(runtime, "lean_history_import_claim", { ...target(), p_mode: "import", p_token: token });
const batch = (token, rows) => rpc(runtime, "lean_history_import_batch", { ...target(), p_token: token, p_rows: rows.map(C.row) });
const completion = () => ({ orders: 1, lines: 1, bytes: body.length, sha256: C.hash(body), beforeCount: 1, afterCount: 1,
  eof: true, operationId: gid("BulkOperation", "123"), queryHash: C.HASH });
const finish = (token, evidence = completion()) => rpc(runtime, "lean_history_import_finish", { ...target(), p_token: token, p_evidence: evidence });
before(async () => {
  control = new Client({ connectionString: base.href }); await control.connect();
  await control.query(`drop database if exists ${dbName}`);
  await control.query("drop role if exists lean_pilot_reader; drop role if exists lean_observed_reader; drop role if exists lean_posthog_reader");
  await control.query(`create database ${dbName}`); base.pathname = "/" + dbName;
  admin = new Client({ connectionString: base.href }); runtime = new Client({ connectionString: base.href }); peer = new Client({ connectionString: base.href });
  await admin.connect(); await runtime.connect(); await peer.connect();
  await admin.query("alter default privileges in schema public grant execute on functions to anon,authenticated,service_role");
  for (const name of ["001_staging", "003_receipts", "004_worker", "013_release", "014_reporting_views", "015_backfill",
    "016_shopify_pilot", "017_shopify_pipeline", "018_history_jobs", "019_spend_jobs", "020_observed_report_jobs",
    "021_full_report_jobs", "022_full_release", "023_posthog_export", "024_full_orchestration", "038_google_spend_pilot", "039_shopify_bounded_pilot"])
    await admin.query(readFileSync(join(repo, "sql/analytics", `${name}.sql`), "utf8"));
  beforeFunctions = (await admin.query("select oid::regprocedure::text name,pg_get_functiondef(oid) def from pg_proc where pronamespace='public'::regnamespace and (proname like 'lean_spend_%' or proname like 'lean_shopify_%') order by 1")).rows;
  await admin.query(readFileSync(join(repo, "sql/analytics/040_shopify_history_import.sql"), "utf8"));
  await runtime.query("set role service_role; set statement_timeout='10s'"); await peer.query("set statement_timeout='10s'");
});
beforeEach(async () => {
  await admin.query("truncate lean_private.history_import_jobs cascade");
  body = bytesFor([order(), line()]); requests = 0; rpcFailures = []; badVersion = false; changedCount = false; changedOperation = false;
});
after(async () => {
  if (admin && beforeFunctions) assert.deepEqual((await admin.query("select oid::regprocedure::text name,pg_get_functiondef(oid) def from pg_proc where pronamespace='public'::regnamespace and (proname like 'lean_spend_%' or proname like 'lean_shopify_%') order by 1")).rows, beforeFunctions);
  await runtime?.end(); await peer?.end(); await admin?.end();
  if (control) { await control.query(`drop database if exists ${dbName}`); await control.end(); }
});
test("040 installs over exact prerequisites; disabled registration, RLS/no table/owner RPC access, ordinary functions unchanged", async () => {
  await register({}, false);
  assert.equal((await run("start")).status, "failed"); assert.equal(requests, 0);
  for (const table of ["history_import_jobs", "history_import_orders", "history_import_lines"])
    await assert.rejects(runtime.query(`select * from lean_private.${table}`), /permission denied/);
  await assert.rejects(rpc(runtime, "lean_history_import_register", { p_scope: scope() }), /permission denied/);
  await assert.rejects(rpc(runtime, "lean_history_import_purge", { p_job: "fixture-history" }), /permission denied/);
  await assert.rejects(admin.query("update lean_private.history_import_jobs set scope=jsonb_set(scope,'{expectedOrders}','2')"), /immutable/);
  assert.equal((await admin.query("select bool_and(relrowsecurity) ok from pg_class where relname like 'history_import_%' and relkind='r'")).rows[0].ok, true);
});
test("actual build operator start→check→stream→private SQL complete; nullable/zero/decimal source retained, equal completion replay", async () => {
  await register(); await ready();
  const result = await run("import"); assert.equal(result.status, "source_history_imported", JSON.stringify({ result, rpcFailures }));
  assert.equal(requests, 6);
  const saved = (await admin.query("select state,orders,lines,completion from lean_private.history_import_jobs")).rows[0];
  assert.equal(saved.state, "complete"); assert.equal(saved.orders, 1); assert.equal(saved.lines, 1);
  assert.equal(saved.completion.sha256, C.hash(body));
  assert.deepEqual((await admin.query("select source from lean_private.history_import_orders")).rows[0].source, order());
  assert.equal((await run("import")).status, "source_import_already_complete"); assert.equal(requests, 6);
  assert.ok(!JSON.stringify(result).includes("secret=")); assert.ok(!JSON.stringify(result).includes("10.123456"));
  assert.equal((await admin.query("select count(*) n from lean_private.history_jobs")).rows[0].n, "0");
});
test("wrong destination and unsupported mode make zero requests; API mismatch reserves once and cannot resubmit", async () => {
  assert.equal((await O.check({ ...env, VERCEL_ENV: "production" }, { mode: "start", jobId: "fixture-history" }, transport)).reason, "wrong_destination");
  assert.equal((await O.check(env, { mode: "retry", jobId: "fixture-history" }, transport)).reason, "invalid_operator_config");
  await register(); badVersion = true; assert.equal((await run("start")).reason, "source_api_version_mismatch");
  badVersion = false; assert.equal((await run("start")).reason, "private_rpc_rejected"); assert.equal(requests, 1);
});
test("equal batch replay resumes; conflict fails atomically; missing/orphan/extra rows never complete", async () => {
  await register(); await ready(); const token = randomUUID(); await claimImport(token);
  await batch(token, [order()]); await batch(token, [order()]);
  await assert.rejects(batch(token, [line(), { ...order(), edited: false }]), /conflicting/);
  assert.equal((await admin.query("select count(*) n from lean_private.history_import_lines")).rows[0].n, "0");
  await assert.rejects(finish(token), /incomplete/);
  await batch(token, [line("2", "99")]); await assert.rejects(finish(token), /incomplete/);
  await assert.rejects(rpc(runtime, "lean_history_import_batch", { ...target(), p_token: token,
    p_rows: [{ kind: "line", source: { ...line("3"), note: "forbidden" } }] }), /unapproved source projection/);
  assert.equal((await admin.query("select state from lean_private.history_import_jobs")).rows[0].state, "importing");
});
test("source count changed, completed operation mismatch and missing EOF/hash each block completion", async () => {
  await register(); await ready(); changedCount = true;
  assert.equal((await run("import")).reason, "independent_order_count_changed");
  await admin.query("update lean_private.history_import_jobs set lease_until=clock_timestamp()-interval '1 second'");
  changedCount = false; changedOperation = true; assert.equal((await run("import")).reason, "completed_operation_changed");
  await admin.query("update lean_private.history_import_jobs set lease_until=clock_timestamp()-interval '1 second'");
  changedOperation = false; const token = randomUUID(); await claimImport(token); await batch(token, [order(), line()]);
  await assert.rejects(finish(token, { ...completion(), eof: false }), /incomplete/);
  await assert.rejects(finish(token, { ...completion(), sha256: "wrong" }), /incomplete/);
  await finish(token);
});
test("lease/kill fences; separate connection cannot disable while a batch transaction holds job lock", async () => {
  await register(); await ready(); const token = randomUUID(); await claimImport(token);
  await runtime.query("begin"); await batch(token, [order()]);
  await peer.query("set lock_timeout='100ms'");
  await assert.rejects(peer.query("update lean_private.history_import_jobs set enabled=false"), /lock timeout/);
  await runtime.query("commit"); await peer.query("set lock_timeout='0'");
  await admin.query("update lean_private.history_import_jobs set lease_until=clock_timestamp()-interval '1 second'");
  await assert.rejects(batch(token, [line()]), /expired/);
  await admin.query("update lean_private.history_import_jobs set enabled=false"); await assert.rejects(finish(token), /unavailable/);
});
test("expiry DURING batch rolls back inserted rows (post-write clock fence)", async () => {
  await register({ expiresAt: new Date(Date.now() + 1200).toISOString(), purgeAfter: new Date(Date.now() + 7200000).toISOString() });
  await ready(); const token = randomUUID(); await claimImport(token);
  await admin.query(`create function lean_private.history_fixture_delay() returns trigger language plpgsql as $$ begin perform pg_sleep(1.3); return new; end $$;
    create trigger history_fixture_delay after insert on lean_private.history_import_orders for each statement execute function lean_private.history_fixture_delay()`);
  await assert.rejects(batch(token, [order()]), /expired/);
  assert.equal((await admin.query("select count(*) n from lean_private.history_import_orders")).rows[0].n, "0");
  await admin.query("drop trigger history_fixture_delay on lean_private.history_import_orders; drop function lean_private.history_fixture_delay()");
});
test("checks/import/download reservation caps fail closed and no unregistered expansion", async () => {
  await register(); await ready();
  await admin.query("update lean_private.history_import_jobs set checks=30");
  await assert.rejects(rpc(runtime, "lean_history_import_claim", { ...target(), p_mode: "check", p_token: randomUUID() }), /unavailable/);
  await admin.query("update lean_private.history_import_jobs set imports=3");
  await assert.rejects(claimImport(randomUUID()), /not ready/);
  await admin.query("update lean_private.history_import_jobs set imports=0,reserved_download_bytes=268435456");
  await assert.rejects(claimImport(randomUUID()), /download budget/);
  await assert.rejects(rpc(runtime, "lean_history_import_claim", { ...target(), p_shop: "other.myshopify.com", p_mode: "start", p_token: randomUUID() }), /unapproved/);
});
test("expiry DURING final completion rolls back complete state; data stays private and uncompleted", async () => {
  await register({ expiresAt: new Date(Date.now() + 1200).toISOString(), purgeAfter: new Date(Date.now() + 7200000).toISOString() });
  await ready(); const token = randomUUID(); await claimImport(token); await batch(token, [order(), line()]);
  await admin.query(`create function lean_private.history_fixture_delay() returns trigger language plpgsql as $$
    begin if new.state='complete' then perform pg_sleep(1.3); end if; return new; end $$;
    create trigger history_fixture_delay after update on lean_private.history_import_jobs for each row execute function lean_private.history_fixture_delay()`);
  await assert.rejects(finish(token), /expired/);
  assert.equal((await admin.query("select state from lean_private.history_import_jobs")).rows[0].state, "importing");
  await admin.query("drop trigger history_fixture_delay on lean_private.history_import_jobs; drop function lean_private.history_fixture_delay()");
});
test("parser supports out-of-order line/root, null fields, integer zero and exact decimal strings", async () => {
  const result = await parse([line(), order()]);
  assert.equal(result.evidence.orders, 1); assert.equal(result.evidence.lines, 1);
  assert.equal(result.batches[0][1].source.totalPriceSet.shopMoney.amount, "10.123456");
});
test("parser rejects duplicate/missing/rootless rows, extra PII, bad JSON, unsupported rows and write failures", async () => {
  await assert.rejects(parse([order(), order()]), /duplicate_source_row/);
  await assert.rejects(parse([order()], { objectCount: 2 }), /download_count_mismatch/);
});
test("parser negative details fail closed without partial-completion evidence", async () => {
  await assert.rejects(parse([line()], { expectedOrders: 0 }), /orphan_line/);
  await assert.rejects(parse([{ ...order(), email: "no@example.invalid" }]), /invalid_source_shape/);
  await assert.rejects(parse([order()], { objectCount: 2 }), /download_count_mismatch/);
  await assert.rejects(parse([order()], { batch: async () => { throw new Error("write failed"); } }), /write failed/);
  await assert.rejects(C.parseStream(stream(Buffer.from("{bad}\n")), { fileSize: 6, batch: async () => {} }), /invalid_jsonl/);
  await assert.rejects(parse([order()], { fileSize: 2 }), /download_byte_budget/);
  await assert.rejects(C.parseStream(stream(Buffer.alloc(C.MAX_LINE + 1, 65)), { fileSize: C.MAX_LINE + 1, batch: async () => {} }), /jsonl_line_budget/);
  assert.throws(() => O.downloadUrl("https://127.0.0.1/file"), /invalid_download/);
  assert.throws(() => O.downloadUrl("https://storage.googleapis.com@evil.example/file"), /invalid_download/);
});
