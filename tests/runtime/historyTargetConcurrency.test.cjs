"use strict";
/* eslint-disable @typescript-eslint/no-require-imports */
// Optional real PostgreSQL multi-session proof. Never accepts a hosted URL.
const { test, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { randomUUID } = require("node:crypto");
const { Client } = require("pg");
const C = require("../../scripts/analytics/history-target-contract.cjs");
const legacy = require("../../scripts/analytics/history-import-contract.cjs");
const url = new URL(process.env.HISTORY_TARGET_TEST_URL);
assert.equal(url.hostname, "127.0.0.1"); assert.equal(url.port, "55439");
assert.equal(url.username, "fixture_shopify_install"); assert.equal(url.pathname, "/postgres");
const name = "analytics_test_history_target_concurrency";
const boundary = readFileSync("sql/analytics/proposed_history_target_boundary.sql", "utf8");
let control, admin, runtime, peer, manifest, args;
async function rpc(db, fn, params) {
  assert.match(fn, /^lean_history_[a-z_]+$/);
  return (await db.query(`select public.${fn}(${Object.keys(params).map((k, i) => `${k}=>$${i + 1}`).join(",")}) v`,
    Object.values(params).map(v => v && typeof v === "object" ? JSON.stringify(v) : v))).rows[0].v;
}
before(async () => {
  control = new Client({ connectionString: url.href }); await control.connect();
  await control.query(`drop database if exists ${name}`); await control.query(`create database ${name}`);
  url.pathname = `/${name}`;
  admin = new Client({ connectionString: url.href }); runtime = new Client({ connectionString: url.href });
  peer = new Client({ connectionString: url.href });
  await admin.connect(); await runtime.connect(); await peer.connect();
  await admin.query(`do $$ declare r text; begin foreach r in array array['anon','authenticated','service_role','inherited_runtime'] loop
    if not exists(select 1 from pg_roles where rolname=r) then execute format('create role %I',r);end if;end loop;
    execute format('grant service_role to %I with inherit false, set true',current_user);end $$;
    grant inherited_runtime to service_role;set statement_timeout='5s'`);
  for (const f of ["001_staging", "013_release", "014_reporting_views", "019_spend_jobs", "040_shopify_history_import", "041_history_report_bridge"])
    await admin.query(readFileSync(`sql/analytics/${f}.sql`, "utf8"));
  // Pre-warm actual old caller plans before alias installation.
  const scope = { jobId: "legacy-warm", projectRef: legacy.PROJECT, shop: legacy.SHOP, appId: legacy.APP,
    installationId: legacy.INSTALLATION, apiVersion: legacy.VERSION, untilTime: legacy.CUTOFF,
    queryText: legacy.QUERY, queryHash: legacy.HASH, expectedOrders: 0,
    expiresAt: new Date(Date.now() + 3600000).toISOString(), purgeAfter: new Date(Date.now() + 7200000).toISOString(),
    approvalRef: "synthetic-old", actorRef: "synthetic-old" };
  await rpc(admin, "lean_history_import_register", { p_scope: scope });
  await admin.query("update lean_private.history_import_jobs set enabled=true");
  await rpc(admin, "lean_history_import_claim", { p_job: scope.jobId, p_project: legacy.PROJECT, p_shop: legacy.SHOP,
    p_token: randomUUID(), p_mode: "start" });
  const oldBodies = (await admin.query(`select proname,prosrc from pg_proc where
    proname in ('history_import_lock','history_report_lock','lean_history_import_batch') order by proname`)).rows;
  // Inherited original-batch EXECUTE must fail installation, never silently leak
  // into its new private alias. Rollback leaves all originals installed.
  await admin.query("grant execute on function public.lean_history_import_batch(text,text,text,uuid,jsonb) to inherited_runtime");
  await assert.rejects(admin.query(boundary), /inherited target bypass/);
  await admin.query("rollback");
  assert.equal((await admin.query("select to_regclass('lean_private.history_target_approvals') n")).rows[0].n, null);
  await admin.query("revoke execute on function public.lean_history_import_batch(text,text,text,uuid,jsonb) from inherited_runtime");
  await admin.query(boundary);
  for (const old of oldBodies) {
    const alias = { history_import_lock: "history_target_legacy_import_lock", history_report_lock: "history_target_legacy_report_lock",
      lean_history_import_batch: "history_target_legacy_import_batch" }[old.proname];
    assert.equal((await admin.query("select prosrc from pg_proc where proname=$1", [alias])).rows[0].prosrc, old.prosrc);
  }
  await runtime.query("set role service_role;set statement_timeout='5s'");
  await peer.query("set statement_timeout='5s'");
});
after(async () => {
  await runtime?.query("rollback"); await peer?.query("rollback"); await admin?.query("rollback");
  await runtime?.end(); await peer?.end(); await admin?.end();
  if (control) { await control.query(`drop database if exists ${name}`); await control.end(); }
});
beforeEach(async () => {
  await runtime.query("rollback"); await peer.query("rollback"); await admin.query("rollback");
  await admin.query("truncate lean_private.history_target_approvals,lean_private.history_import_jobs,lean_private.publications cascade");
  const q = C.compile("2026-09-30T00:00:00Z");
  manifest = { approvalId: "race-approval", projection: C.PROJECTION, inventoryRef: "synthetic-independent",
    operatorRef: "synthetic-owner", scope: { jobId: "race-job", projectRef: C.PROJECT, shop: C.SHOP,
      appId: "gid://shopify/App/99", installationId: "gid://shopify/AppInstallation/99", apiVersion: C.VERSION,
      untilTime: "2026-09-30T00:00:00Z", queryText: q.QUERY, queryHash: q.HASH, expectedOrders: 0,
      expiresAt: new Date(Date.now() + 3600000).toISOString(), purgeAfter: new Date(Date.now() + 7200000).toISOString(),
      approvalRef: "race-approval", actorRef: "synthetic-owner" },
    report: { runId: "race-report", expiresAt: new Date(Date.now() + 7200000).toISOString(),
      fromDate: "2026-09-28", throughDate: "2026-09-28", includeCustomerId: false, policy: null, spendRuns: [],
      queries: (await admin.query("select lean_private.history_target_report_queries(false) q")).rows[0].q } };
  args = { p_job: "race-job", p_project: C.PROJECT, p_shop: C.SHOP, p_token: randomUUID() };
});
async function stage() {
  await rpc(admin, "lean_history_target_stage", { p_manifest: manifest });
  await rpc(admin, "lean_history_target_import_register", { p_approval: manifest.approvalId });
  await admin.query("update lean_private.history_import_jobs set enabled=true");
}
async function blocked(pid) {
  for (let i = 0; i < 100; i++) {
    const rows = (await admin.query("select wait_event_type from pg_stat_activity where pid=$1", [pid])).rows;
    if (rows[0]?.wait_event_type === "Lock") return;
    await new Promise(r => setTimeout(r, 10));
  }
  assert.fail("expected real lock wait");
}
test("catalog aliases retain old bodies; installed default-empty boundary denies effective bypasses", async () => {
  assert.equal((await admin.query("select count(*)::int n from lean_private.history_target_approvals")).rows[0].n, 0);
  assert.equal((await admin.query(`select count(*)::int n from pg_proc where proname like 'history_target_%'
    and has_function_privilege('service_role',oid,'EXECUTE')`)).rows[0].n, 0);
  const role = (await admin.query("select rolsuper from pg_roles where rolname=current_user")).rows[0];
  assert.equal(role.rolsuper, false);
});
test("first revocation waits for already-authorized write transaction, then blocks bind", async () => {
  await stage();
  await runtime.query("begin");
  await rpc(runtime, "lean_history_import_claim", { ...args, p_mode: "start" });
  const pid = (await peer.query("select pg_backend_pid() p")).rows[0].p;
  const revoking = rpc(peer, "lean_history_target_revoke", { p_approval: manifest.approvalId, p_reason: "synthetic stop" });
  await blocked(pid);
  await rpc(runtime, "lean_history_import_bind", { ...args, p_operation: "gid://shopify/BulkOperation/1" });
  await runtime.query("commit"); assert.equal(await revoking, true);
  await assert.rejects(rpc(runtime, "lean_history_import_claim", { ...args, p_mode: "check" }), /no current target approval/);
});
test("first revocation wins race; waiting claim sees revocation after lock acquisition", async () => {
  await stage(); await peer.query("begin");
  await rpc(peer, "lean_history_target_revoke", { p_approval: manifest.approvalId, p_reason: "synthetic stop" });
  const pid = (await runtime.query("select pg_backend_pid() p")).rows[0].p;
  const claiming = rpc(runtime, "lean_history_import_claim", { ...args, p_mode: "start" });
  const rejected = assert.rejects(claiming, /no current target approval/);
  await blocked(pid); await peer.query("commit"); await rejected;
  assert.equal((await admin.query("select provider_requests from lean_private.history_import_jobs")).rows[0].provider_requests, 0);
});
test("deadline is sampled after waiting for manifest lock, with no clock rewrite", async () => {
  manifest.scope.expiresAt = new Date(Date.now() + 500).toISOString();
  await stage(); await peer.query("begin");
  await peer.query("select * from lean_private.history_target_approvals for update");
  const pid = (await runtime.query("select pg_backend_pid() p")).rows[0].p;
  const claiming = rpc(runtime, "lean_history_import_claim", { ...args, p_mode: "start" });
  const rejected = assert.rejects(claiming, /target approval expired/);
  await blocked(pid); await new Promise(r => setTimeout(r, 550)); await peer.query("commit"); await rejected;
  assert.equal((await admin.query("select provider_requests from lean_private.history_import_jobs")).rows[0].provider_requests, 0);
});
test("prewarmed old caller does not bypass the new manifest check after rename", async () => {
  await stage();
  await rpc(admin, "lean_history_target_revoke", { p_approval: manifest.approvalId, p_reason: "cache test" });
  await assert.rejects(rpc(admin, "lean_history_import_claim", { ...args, p_mode: "start" }), /no current target approval/);
});
for (const isolation of ["repeatable read", "serializable"]) {
  test(`rejects ${isolation} snapshot established before committed revocation`, async () => {
    await stage();
    await runtime.query(`begin isolation level ${isolation}`);
    // Take a snapshot without locking authority, then commit a stop elsewhere.
    await runtime.query("select count(*) from pg_class");
    await rpc(peer, "lean_history_target_revoke", { p_approval: manifest.approvalId, p_reason: "committed before claim" });
    await assert.rejects(rpc(runtime, "lean_history_import_claim", { ...args, p_mode: "start" }),
      /unsupported target transaction isolation; requires read committed/);
    await runtime.query("rollback");
    assert.equal((await admin.query("select provider_requests from lean_private.history_import_jobs")).rows[0].provider_requests, 0);
  });
}
test("unsupported isolation also rejects marked authority, batch, completed replay and report retain", async () => {
  await stage();
  await rpc(runtime, "lean_history_import_claim", { ...args, p_mode: "start" });
  const operationId = "gid://shopify/BulkOperation/1";
  await rpc(runtime, "lean_history_import_bind", { ...args, p_operation: operationId });
  await rpc(runtime, "lean_history_import_claim", { ...args, p_mode: "check" });
  await rpc(runtime, "lean_history_import_observe", { ...args, p_operation: {
    id: operationId, status: "COMPLETED", queryHash: manifest.scope.queryHash, rootObjectCount: "0",
    objectCount: "0", fileSize: "0", createdAt: "2026-09-30T00:00:00Z", completedAt: "2026-09-30T00:01:00Z",
  } });
  await rpc(runtime, "lean_history_import_claim", { ...args, p_mode: "import" });
  const evidence = { orders: 0, lines: 0, bytes: 0, sha256: C.hash(""), beforeCount: 0, afterCount: 0,
    eof: true, operationId, queryHash: manifest.scope.queryHash };
  await rpc(runtime, "lean_history_import_finish", { ...args, p_evidence: evidence });
  assert.equal((await rpc(runtime, "lean_history_import_claim", { ...args, p_mode: "import" })).state, "complete");
  const sourceHash = (await admin.query("select encode(sha256(convert_to(completion::text,'UTF8')),'hex') h from lean_private.history_import_jobs")).rows[0].h;
  await rpc(admin, "lean_history_target_report_register", { p_approval: manifest.approvalId, p_source_hash: sourceHash });
  await admin.query("update lean_private.history_report_jobs set enabled=true");
  const report = { p_run: manifest.report.runId, p_project: C.PROJECT, p_token: randomUUID() };
  for (const [name, params] of [
    ["lean_history_target_authority", { p_kind: "import", p_id: args.p_job, p_project: C.PROJECT, p_operator: manifest.operatorRef }],
    ["lean_history_target_authority", { p_kind: "report", p_id: report.p_run, p_project: C.PROJECT, p_operator: manifest.operatorRef }],
    ["lean_history_import_claim", { ...args, p_mode: "import" }],
    ["lean_history_import_batch", { ...args, p_rows: [] }],
    ["lean_history_import_finish", { ...args, p_evidence: evidence }],
    ["lean_history_report_claim", report],
    ["lean_history_report_retain", { ...report, p_order: "gid://shopify/Order/1", p_source: {}, p_captured_at: new Date().toISOString() }],
  ]) {
    await runtime.query("begin isolation level repeatable read");
    await assert.rejects(rpc(runtime, name, params), /unsupported target transaction isolation; requires read committed/);
    await runtime.query("rollback");
  }
  assert.equal((await admin.query("select count(*)::int n from lean_private.history_report_sources")).rows[0].n, 0);
});
