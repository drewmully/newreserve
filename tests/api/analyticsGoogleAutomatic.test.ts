import { generateKeyPairSync } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { captureGoogleAutomatic, googleAutomaticDigest, type GoogleCaptureClaim } from "@/lib/analytics/googleAutomaticCapture";
import { googleAutomaticPost, googleAutomaticSetupCredentials } from "@/lib/analytics/googleAutomaticRuntime";
import { googleAutomaticColumns, googleAtomicTableQuery, googleAtomicQueryResult, observeGoogleAutomatic } from "@/lib/analytics/googleAutomaticObserver";
import { googleDeliveryFixture } from "../fixtures/analyticsGoogleDelivery";
import { prepareGoogleDeliveryReport } from "@/lib/analytics/googleDeliveryReport";
import type { AnalyticsRpcClient } from "@/lib/analytics/rpcStore";
import { catalogQuery, renderGoogleAutomaticInstaller } from "../../scripts/analytics/google-automatic-install.mjs";
import { posthogRead, runGoogleAutomaticTurn, captureMetaClaim } from "../../scripts/analytics/google-automatic-operator.mjs";
import { prepareAutomaticMeta } from "@/lib/analytics/googleAutomaticMeta";
import { metaHourlyWindow } from "@/lib/analytics/metaHourlySpendInput";
import { preparePausedGoogleSource } from "../../scripts/analytics/google-dedicated-source.mjs";

const project = "xnfjdbpjuaezxjgargto", cycle = "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa";
const source = "11111111-1111-4111-8111-111111111111", schema = "33333333-3333-4333-8333-333333333333";
const table = "22222222-2222-4222-8222-222222222222";
const producer = "fixture-producer-".repeat(3), observer = "fixture-observer-".repeat(3);
const privateKey = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey.export({ type: "pkcs8", format: "pem" });
const serviceAccount = Buffer.from(JSON.stringify({ type: "service_account", client_email: "fixture@example.invalid",
  private_key: privateKey, token_uri: "https://oauth2.googleapis.com/token" })).toString("base64");
const auth = { mode: "service_account" as const, serviceAccountJsonBase64: serviceAccount, subject: "fixture@example.invalid" };
const dev = "fixture-developer";
const credentials = { GOOGLE_ADS_SERVICE_ACCOUNT_JSON_BASE64: serviceAccount,
  GOOGLE_ADS_IMPERSONATE_EMAIL: auth.subject, GOOGLE_ADS_DEVELOPER_TOKEN: dev };
const claim = (): GoogleCaptureClaim => ({ state: "capture", cycleId: cycle, grantId: "fixture-auto", revision: "1",
  projectRef: project, shop: "mullybox-store.myshopify.com", accountId: "1234567890", loginCustomerId: "9876543210",
  date: "2026-01-01", startedAt: new Date(Date.now() - 1).toISOString(), deadline: new Date(Date.now() + 60000).toISOString(),
  expiresAt: new Date(Date.now() + 1800000).toISOString(), maxPages: 1, maxRequests: 7, maxBytes: 100000,
  sourceDeadlineSeconds: 30, approvalRef: "fixture:approval", actorRef: "fixture:owner", credentialBindingRef: "fixture:auth",
  credentialSha256: googleAutomaticDigest({ auth, developerToken: dev }) });
function native(amount = "12000000", mismatch = false) {
  const queries: string[] = [];
  const request: typeof fetch = async (url, init) => {
    expect(init?.redirect).toBe("error");
    if (String(url) === "https://oauth2.googleapis.com/token") return Response.json({ access_token: "fixture", token_type: "Bearer" });
    expect(String(url)).toBe("https://googleads.googleapis.com/v25/customers/1234567890/googleAds:search");
    const q = JSON.parse(String(init?.body)).query; queries.push(q);
    if (q.startsWith("SELECT customer.id")) return Response.json({ results: [{ customer: {
      id: "1234567890", currencyCode: "USD", timeZone: "America/New_York" } }] });
    if (q.includes("FROM customer")) return Response.json({ fieldMask: "segments.date,metrics.costMicros,metrics.clicks,metrics.impressions",
      results: [{ segments: { date: "2026-01-01" }, metrics: { costMicros: mismatch ? "1" : amount, clicks: "4", impressions: "20" } }] });
    return Response.json({ fieldMask: "campaign.id,segments.date,metrics.costMicros,metrics.clicks,metrics.impressions",
      results: [{ campaign: { id: "7" }, segments: { date: "2026-01-01" }, metrics: { costMicros: amount, clicks: "4", impressions: "20" } }] });
  };
  return { request, queries };
}

it("captures separate real parsed candidate, campaign control and customer totals; changed inputs change evidence", async () => {
  const a = native(), first = await captureGoogleAutomatic(claim(), auth, dev, a.request);
  const b = native("13000000"), second = await captureGoogleAutomatic(claim(), auth, dev, b.request);
  expect(first.receipt.requests).toBe(7); expect(a.queries).toHaveLength(5);
  expect(a.queries.filter(q => q.includes("FROM campaign"))).toHaveLength(2);
  expect(first.costControl.totalCostMicros).toBe("12000000");
  expect(second.costControl.totalCostMicros).toBe("13000000");
  expect(first.receipt.controlHash).not.toBe(second.receipt.controlHash);
  expect(first.delivery.control.clicks).toBe("4");
});
it("refuses mismatch, changed credentials, exhausted bytes and stale claim without fabricating controls", async () => {
  await expect(captureGoogleAutomatic(claim(), auth, dev, native("12000000", true).request)).rejects.toThrow();
  let calls = 0;
  const never: typeof fetch = async () => { calls++; throw new Error("forbidden"); };
  await expect(captureGoogleAutomatic({ ...claim(), credentialSha256: "0".repeat(64) }, auth, dev, never)).rejects.toThrow();
  await expect(captureGoogleAutomatic({ ...claim(), deadline: "2020-01-01T00:00:00Z" }, auth, dev, never)).rejects.toThrow();
  expect(calls).toBe(0);
  await expect(captureGoogleAutomatic({ ...claim(), maxBytes: 1 }, auth, dev, native().request)).rejects.toThrow();
  let aggregate = 0;
  await expect(captureGoogleAutomatic(claim(), auth, dev, async (url, init) => {
    if (String(url).includes("oauth2")) return Response.json({ access_token: "fixture", token_type: "Bearer" });
    if (JSON.parse(String(init?.body)).query.includes("SELECT customer.id"))
      return Response.json({ results: [{ customer: { id: "1234567890", currencyCode: "EUR", timeZone: "Europe/Paris" } }] });
    aggregate++; throw Error("must_not_aggregate");
  })).rejects.toThrow();
  expect(aggregate).toBe(0);
});
it("metadata setup uses only exact existing generic service-account names, never dedicated copies or aliases", () => {
  const x = googleAutomaticSetupCredentials(credentials);
  expect(x.credentialSha256).toBe(claim().credentialSha256);
  expect(() => googleAutomaticSetupCredentials({ GOOGLE_SERVICE_ACCOUNT_JSON_BASE64: serviceAccount,
    LEAN_GOOGLE_ADS_SERVICE_ACCOUNT_JSON_BASE64: serviceAccount, LEAN_GOOGLE_ADS_DEVELOPER_TOKEN: dev })).toThrow();
});

function observations() {
  const f = googleDeliveryFixture(), report = prepareGoogleDeliveryReport(f.input);
  const row = { ...report, is_stale: false, readiness: Object.fromEntries(Object.entries(report.readiness)
    .map(([k, v]) => [k, v === "observed_unverified" ? "ready" : v])) };
  const now = Date.now(), at = (offset: number) => new Date(now + offset).toISOString();
  const manifest = '{"resources":["synthetic"]}';
  // Raw manifest hashing differs deliberately from structured evidence hashing.
  const destination = { projectId: "353503", sourceId: source, schemaId: schema, tableId: table,
    tableName: "fixture_google_account_daily", manifestSha256: "", contractSha256: "b".repeat(64), maxAgeSeconds: 60 };
  const body = { google_account_daily: [row], google_delivery_status: { state: "selected", report_scope: "single_google_account",
    run_id: "google-fixture", result_hash: "a".repeat(32), row_hash: "b".repeat(32), selection_revision: "1", row_count: "1",
    atomic_resource_refresh: false, not_before: at(-5000), expires_at: at(60000) } };
  const sourceRow = { id: source, source_type: "Custom", job_inputs: { manifest_json: manifest },
    schemas: [{ id: schema, name: "google_account_daily", status: "Completed", should_sync: true, sync_type: "full_refresh",
      last_synced_at: at(-1000), table: { id: table, name: destination.tableName } }] };
  const jobs = [{ id: "fixture:job", created_at: at(-4000), finished_at: at(-1000), status: "Completed",
    schema: { id: schema, name: "google_account_daily", should_sync: true, sync_type: "full_refresh" } }];
  const result = { columns: ["total_rows", "row_json"], results: [[1, JSON.stringify(googleAutomaticColumns.map(k => row[k]))]] };
  return { claim: { state: "observe", selectionRevision: "1", body, destination, deadline: at(60000) }, sourceRow, jobs, result, manifest };
}
import { createHash } from "node:crypto";
const observed = () => {
  const x = observations();
  x.claim.destination.manifestSha256 = createHash("sha256").update(x.manifest).digest("hex");
  return x;
};
it("derives bounded stable content acceptance without claiming exhaustive job history", async () => {
  const x = observed();
  const evidence = await observeGoogleAutomatic(x.claim, { source: async () => x.sourceRow,
    jobs: async () => x.jobs, query: async () => x.result });
  expect(evidence.import).toMatchObject({ complete: true, unfiltered: true, jobId: "fixture:job", nextCursor: null });
  expect(evidence.beforeSha256).toBe(evidence.afterSha256);
});
it("parses exact echoed formatted SQL losslessly; rejects extra rows, races, truncation and query mismatch", async () => {
  const x = observed(), sql = googleAtomicTableQuery(x.claim.destination as never);
  const formatted = { query: { kind: "HogQLQuery", query: sql }, results: `total_rows|row_json\n1|${x.result.results[0][1]}` };
  const base = { source: async () => x.sourceRow, jobs: async () => x.jobs, query: async () => formatted };
  expect((await observeGoogleAutomatic(x.claim, base)).import.rows).toEqual(x.claim.body.google_account_daily);
  for (const table of [{ ...formatted, results: `${formatted.results}\n2|[]` }, { ...formatted, is_truncated: true },
    { ...formatted, query: { kind: "HogQLQuery", query: "SELECT 1" } }, { ...x.result, results: [[2, x.result.results[0][1]]] }])
    await expect(observeGoogleAutomatic(x.claim, { ...base, query: async () => table })).rejects.toThrow();
  let n = 0;
  await expect(observeGoogleAutomatic(x.claim, { ...base, source: async () => {
    if (n++ === 0) return x.sourceRow;
    return { ...x.sourceRow, schemas: [{ ...x.sourceRow.schemas[0], last_synced_at: new Date().toISOString() }] };
  } })).rejects.toThrow("refresh_changed");
});

describe("new automatic SQL and runtime, actual migrations in local PGlite only", () => {
  let db: PGlite;
  const rpc = async (name: string, args: Record<string, unknown>) => {
    const entries = Object.entries(args);
    return (await db.query<{ result: unknown }>(`select public.${name}(${entries.map(([k], i) => `${k}=>$${i + 1}`).join(",")}) result`,
      entries.map(([, value]) => value !== null && typeof value === "object" ? JSON.stringify(value) : value))).rows[0].result;
  };
  const args = { p_grant: "fixture-auto", p_revision: "1", p_capability: producer };
  beforeAll(async () => {
    db = new PGlite();
    await db.exec("create role service_role; create role anon; create role authenticated;");
    for (const name of ["001_staging", "013_release", "014_reporting_views", "018_history_jobs", "019_spend_jobs",
      "020_observed_report_jobs", "021_full_report_jobs", "022_full_release", "023_posthog_export", "024_full_orchestration",
      "026_journey_authority", "029_journey_decisions", "030_scoped_release", "038_google_spend_pilot",
      "053_production_workbook_delivery", "google_workbook_registration.review", "google_delivery_output.review",
      "google_standing_operation.review"])
      await db.exec(readFileSync(`sql/analytics/${name}.sql`, "utf8"));
    const pins = async (meta: boolean) => (await db.query<{ pins: unknown }>(`select jsonb_agg(jsonb_build_object(
      'signature',n.nspname||'.'||p.proname||'('||replace(oidvectortypes(p.proargtypes),', ',',')||')',
      'oid',p.oid::text,'ownerOid',p.proowner::text,
      'definitionSha256',encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex'),
      'aclSha256',encode(sha256(convert_to(coalesce(p.proacl::text,'null'),'UTF8')),'hex'))) pins
      from pg_proc p join pg_namespace n on n.oid=p.pronamespace where
      (n.nspname='public' and (p.proname like 'lean_full_inputs%' or p.proname like 'lean_full_finish%' or
       p.proname='lean_google_delivery_finish' ${meta ? "or p.proname in ('lean_marketing_spend_day_register','lean_marketing_spend_bind')" : ""}))
      ${meta ? "or (n.nspname='lean_private' and p.proname='marketing_spend_immutable')" : ""}`)).rows[0].pins;
    await db.query("select set_config('lean.marketing_install_contract',$1,false)", [JSON.stringify(await pins(false))]);
    await db.exec(readFileSync("sql/analytics/multi_provider_spend_input.review.sql","utf8"));
    await db.query("select set_config('lean.meta_hourly_install_contract',$1,false)", [JSON.stringify(await pins(true))]);
    await db.exec(readFileSync("sql/analytics/meta_hourly_spend_registration.review.sql","utf8"));
    const catalog = (await db.query<{ catalog_sha256: string }>(catalogQuery)).rows[0].catalog_sha256;
    const raw = readFileSync("sql/analytics/google_automatic_operation.review.sql", "utf8");
    const installation = { owner: "postgres", sessionUser: "postgres", approvalRef: "fixture:$auto_install$",
      actorRef: "fixture:owner", capturedAt: new Date().toISOString(), deadline: new Date(Date.now() + 60000).toISOString(),
      catalogSha256: catalog, rawSha256: createHash("sha256").update(raw).digest("hex") };
    expect(() => renderGoogleAutomaticInstaller(null, raw)).toThrow();
    await expect(db.exec(renderGoogleAutomaticInstaller({ ...installation, catalogSha256: "0".repeat(64) }, raw))).rejects.toThrow("binding refused");
    await db.exec("rollback");
    await db.exec(renderGoogleAutomaticInstaller(installation, raw));
    const setupTemplate = readFileSync("sql/analytics/google_native_setup.template.sql","utf8");
    await expect(db.exec(setupTemplate)).rejects.toThrow("unbound");
    await db.exec("rollback");
    await db.query("select set_config('lean.google_native_setup_contract',$1,false)", [JSON.stringify({
      owner: "postgres", sessionUser: "postgres", approvalRef: "fixture:setup", actorRef: "fixture:owner",
      deadline: new Date(Date.now() + 60000).toISOString(), action: "register", metadataSetupApproved: true,
      setup: { setup_id: "fixture-setup", revision: 1, account_id: "1234567890", login_customer_id: "9876543210",
        not_before: new Date(Date.now() - 60000).toISOString(), expires_at: new Date(Date.now() + 1800000).toISOString(),
        producer_sha256: createHash("sha256").update(producer).digest("hex"), credential_binding_ref: "fixture:auth",
        approval_ref: "fixture:setup", actor_ref: "fixture:owner" } })]);
    await db.exec(setupTemplate);
    expect((await db.query("select count(*)::integer n from lean_private.google_standing_policy")).rows).toEqual([{ n: 0 }]);
    expect((await db.query("select count(*)::integer n from lean_private.google_auto_grants")).rows).toEqual([{ n: 0 }]);
    await db.exec(`insert into lean_private.google_standing_policy(
      policy_id,revision,project_ref,shop,account_id,login_customer_id,from_date,through_date,not_before,expires_at,
      max_generations,max_steps_per_run,min_interval_seconds,step_timeout_seconds,selection_seconds,max_source_age_seconds,
      max_import_age_seconds,destination_project,destination_source,destination_table,approval_ref,actor_ref,selection_revision)
      values('fixture-policy',1,'${project}','mullybox-store.myshopify.com','1234567890','9876543210',
      '2026-01-01','2026-01-01',clock_timestamp()-interval '1 hour',clock_timestamp()+interval '1 hour',
      2,3,1,80,1800,3600,60,'353503','${source}','${table}','fixture:approval','fixture:owner',0);`);
    const f = googleDeliveryFixture(), policy = Object.fromEntries(Object.entries(f.packet.fullPolicy).filter(([key]) => key !== "asOf"));
    const evidence = JSON.parse(JSON.stringify(f.packet.evidence));
    for (const day of evidence.dateCoverage) for (const k of Object.keys(day.gates)) day.gates[k] = false;
    await db.exec(`insert into lean_private.history_jobs(run_id,project_ref,shop,from_time,until_time,
      page_size,max_pages,approval_ref,actor_ref,enabled,page_count,row_count,complete)
      values('fixture-history','${project}','mullybox-store.myshopify.com','2026-01-01','2026-01-02',
      1,1,'fixture:history','fixture:owner',true,1,1,true);
      insert into lean_private.history_pages(run_id,page_number,expected_cursor,next_cursor,complete,rows)
      values('fixture-history',0,null,null,true,'[{"source":{"fixture":true},"evidenceRef":"fixture:retained"}]');`);
    const history = (await db.query<{ binding: unknown }>(`select jsonb_build_object('fixture-history',jsonb_build_object(
      'row',encode(sha256(convert_to(to_jsonb(h)::text,'UTF8')),'hex'),
      'pages',(select encode(sha256(convert_to(jsonb_agg(to_jsonb(hp) order by page_number)::text,'UTF8')),'hex')
        from lean_private.history_pages hp where run_id=h.run_id))) binding from lean_private.history_jobs h`)).rows[0].binding;
    await db.query(`insert into lean_private.google_auto_grants(grant_id,revision,policy_id,policy_revision,
      not_before,expires_at,capture_slots,cadence_seconds,capture_seconds,source_deadline_seconds,max_pages,max_requests,max_bytes,
      max_observations,observation_seconds,producer_sha256,observer_sha256,credential_binding_ref,approval_ref,actor_ref,
      registration_template,history_bindings,destination,meta_policy,setup_id)
      values('fixture-auto',1,'fixture-policy',1,clock_timestamp()-interval '1 minute',
      date_trunc('milliseconds',clock_timestamp()+interval '30 minutes'),$6,
      1,80,30,1,7,100000,3,60,$1,$2,'fixture:auth','fixture:approval','fixture:owner',$3,$5,$4,
      '{"maxBytes":100000,"captureSeconds":55,"controlApprovalRef":"fixture:meta-control"}','fixture-setup')`,
    [createHash("sha256").update(producer).digest("hex"), createHash("sha256").update(observer).digest("hex"),
      JSON.stringify({ historyRuns: ["fixture-history"], reportPolicy: {}, fullPolicy: policy, evidence, behavior: {} }),
      JSON.stringify(observed().claim.destination), JSON.stringify(history),
      JSON.stringify([{ date: "2026-01-01", notBeforeUTC: new Date(Date.now() - 30000).toISOString() },
        { date: "2026-01-01", notBeforeUTC: new Date(Date.now() + 600000).toISOString() }])]);
  }, 30000);
  afterAll(async () => db?.close());
  it("default-off and isolated roles; metadata setup succeeds using generic names only and captures no aggregates", async () => {
    expect(await rpc("lean_google_auto_claim", { ...args, p_cycle: cycle })).toEqual({ state: "disabled" });
    await expect(rpc("lean_google_auto_setup", { ...args, p_grant: "fixture-setup", p_capability: observer })).rejects.toThrow("authority");
    const calls: string[] = [], request = native();
    const client: AnalyticsRpcClient = { rpc(name, parameters) {
      const pending = { abortSignal: () => pending, then: (resolve: (value: unknown) => unknown, reject: (e: unknown) => unknown) =>
        rpc(name, parameters).then(data => { calls.push(name); return { data, error: null }; }).then(resolve, reject) };
      return pending as ReturnType<AnalyticsRpcClient["rpc"]>;
    } };
    const env = { ...credentials, LEAN_GOOGLE_AUTOMATIC_ENABLED: "true", VERCEL_ENV: "production", VERCEL_GIT_COMMIT_REF: "main",
      LEAN_GOOGLE_AUTOMATIC_PRODUCER_SECRET: producer, LEAN_GOOGLE_AUTOMATIC_OBSERVER_SECRET: observer,
      LEAN_GOOGLE_AUTOMATIC_SETUP_ID: "fixture-setup", LEAN_GOOGLE_AUTOMATIC_SETUP_REVISION: "1",
      LEAN_ANALYTICS_PIPELINE_PROJECT_REF: project, LEAN_ANALYTICS_SUPABASE_URL: `https://${project}.supabase.co` };
    const req = () => new Request("https://fixture.invalid/api/analytics/ingest/google-automatic", {
      method: "POST", headers: { authorization: `Bearer ${producer}` }, body: JSON.stringify({ action: "setup" }) });
    expect((await googleAutomaticPost(req(), { ...env, LEAN_GOOGLE_AUTOMATIC_ENABLED: undefined }, client, request.request)).status).toBe(404);
    expect(calls).toEqual([]);
    expect(await (await googleAutomaticPost(req(), env, client, request.request)).json()).toEqual({ state: "metadata_verified", aggregateReads: 0 });
    expect(calls).toEqual(["lean_google_auto_setup", "lean_google_auto_setup"]);
    expect(request.queries).toHaveLength(1); expect(request.queries[0]).toContain("SELECT customer.id");
    expect((await googleAutomaticPost(req(), env, client, request.request)).status).toBe(503);
    const acl = (await db.query(`select has_function_privilege('service_role','public.lean_google_workbook_register(jsonb)','execute') owner,
      has_function_privilege('anon','public.lean_google_auto_claim(text,bigint,text,uuid)','execute') anon,
      has_table_privilege('service_role','lean_private.google_auto_cycles','select,insert,update,delete') raw`)).rows[0];
    expect(acl).toEqual({ owner: false, anon: false, raw: false });
  });
  it("reserves before acquisition, rejects overlap/duplicate/wrong scope and latches revocation", async () => {
    await db.exec("update lean_private.google_standing_policy set enabled=true;");
    const hashes = (await db.query<{ p: string; g: string; s: string }>(`select
      encode(sha256(convert_to(to_jsonb(p)::text,'UTF8')),'hex') p,
      encode(sha256(convert_to(to_jsonb(g)::text,'UTF8')),'hex') g,
      encode(sha256(convert_to(to_jsonb(s)::text,'UTF8')),'hex') s from lean_private.google_standing_policy p,
      lean_private.google_auto_grants g,lean_private.google_auto_setups s`)).rows[0];
    const control = readFileSync("sql/analytics/google_automatic_control.template.sql","utf8");
    await expect(db.exec(control)).rejects.toThrow("unbound");
    await db.exec("rollback");
    await db.query("select set_config('lean.google_auto_control_contract',$1,false)", [JSON.stringify({
      owner: "postgres", sessionUser: "postgres", approvalRef: "fixture:enable", actorRef: "fixture:owner",
      deadline: new Date(Date.now() + 60000).toISOString(), policyId: "fixture-policy", policyRevision: "1",
      policyRowSha256: hashes.p, grantId: "fixture-auto", grantRevision: "1", grantRowSha256: hashes.g,
      setupRowSha256: hashes.s, action: "enable" })]);
    await db.exec(control);
    const c = await rpc("lean_google_auto_claim", { ...args, p_cycle: cycle }) as GoogleCaptureClaim;
    expect(c).toMatchObject({ state: "capture", cycleId: cycle, credentialSha256: claim().credentialSha256 });
    await expect(rpc("lean_google_auto_claim", { ...args, p_cycle: cycle })).rejects.toThrow("duplicate");
    expect(await rpc("lean_google_auto_claim", { ...args, p_cycle: "bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb" })).toEqual({ state: "held" });
    await expect(rpc("lean_google_auto_claim", { ...args, p_revision: "2", p_cycle: cycle })).rejects.toThrow("authority");
    const capture = await captureGoogleAutomatic(c, auth, dev, native().request);
    // Missing/malformed receipts refuse before touching history or registration.
    await expect(rpc("lean_google_auto_commit", { ...args, p_cycle: cycle, p_capture: { ...capture, receipt: {} } })).rejects.toThrow("fields");
    await expect(rpc("lean_google_auto_commit", { ...args, p_cycle: cycle, p_capture: { ...capture,
      manifest: { ...capture.manifest, days: [{ date: "2026-01-02", dueAt: c.startedAt }] } } })).rejects.toThrow("fields");
    expect(await rpc("lean_google_auto_commit", { ...args, p_cycle: cycle, p_capture: capture }))
      .toEqual({ state: "registered", runId: `auto_${cycle}` });
    const binding = await rpc("lean_google_auto_cycle_binding", { p_cycle: cycle });
    expect(binding).toMatchObject({ cycleId: cycle, grantId: "fixture-auto", packet: {
      base: { rows: [{ costMicros: "12000000" }] } } });
    await expect(rpc("lean_google_auto_commit", { ...args, p_cycle: cycle, p_capture: capture })).rejects.toThrow("lease");
    expect((await db.query("select state from lean_private.google_standing_runs")).rows).toEqual([{ state: "pending" }]);
    await expect(db.exec("update lean_private.google_auto_cycles set capture_packet='{}'")).rejects.toThrow("immutable");
    const metaArgs = { ...args, p_cycle: cycle, p_token: "cccccccc-cccc-4ccc-accc-cccccccccccc" };
    const metaClaim = await rpc("lean_google_auto_meta", { ...metaArgs, p_action: "claim" }) as { binding: Record<string, unknown> };
    expect(metaClaim.binding).toMatchObject({ maxRequests: 3, accountId: "2796962933960445" });
    expect(metaClaim.binding.notBefore).toBe(metaClaim.binding.freshnessCutoffAt);
    await expect(rpc("lean_google_auto_meta", { ...metaArgs, p_action: "claim" })).rejects.toThrow("consumed");
    const now = new Date().toISOString(), window = metaHourlyWindow("2026-01-01");
    const common = { startedAt: now, finishedAt: now, method: "GET", status: 200,
      bodyBytes: 20, bodySha256: "a".repeat(64), pagingCredentialQueryParametersRemoved: true };
    const metadata = { ...common, url: "https://graph.facebook.com/v25.0/act_2796962933960445",
      params: { fields: "id,account_id,currency,timezone_name,account_status,business" },
      response: { id: "act_2796962933960445", account_id: "2796962933960445", currency: "USD",
        timezone_name: "America/Los_Angeles", account_status: 1 } };
    const hour = (campaign: boolean) => ({ ...common, url: `${metadata.url}/insights`,
      params: { time_range: JSON.stringify({ since: window.since, until: window.until }), time_increment: "1",
        breakdowns: "hourly_stats_aggregated_by_advertiser_time_zone", level: campaign ? "campaign" : "account",
        fields: "account_id,account_currency,date_start,date_stop,spend" + (campaign ? ",campaign_id" : ""),
        limit: campaign ? "1001" : "49" }, response: { data: [] } });
    const captures = { metadata, accountHours: hour(false), campaignHours: hour(true) };
    expect(() => prepareAutomaticMeta(metaClaim, { ...captures,
      metadata: { ...metadata, startedAt: "2020-01-01T00:00:00Z" } })).toThrow("window");
    const packet = prepareAutomaticMeta(metaClaim, captures);
    expect(await rpc("lean_google_auto_meta", { ...metaArgs, p_action: "commit", p_packet: packet, p_receipts: captures }))
      .toMatchObject({ state: "meta_registered_disabled", generationId: `auto_meta_${cycle}` });
    expect((await db.query("select enabled from lean_private.marketing_spend_days")).rows).toEqual([{ enabled: false }]);
    expect(await rpc("lean_google_auto_cycle_binding", { p_cycle: cycle }))
      .toMatchObject({ metaPacket: { generationId: `auto_meta_${cycle}` } });
    await expect(rpc("lean_google_auto_meta", { ...metaArgs, p_action: "commit", p_packet: packet, p_receipts: captures })).rejects.toThrow("lease");
    await db.exec("update lean_private.google_auto_grants set enabled=false");
    await expect(db.exec("update lean_private.google_auto_grants set enabled=true")).rejects.toThrow();
    expect((await db.query("select enabled from lean_private.google_standing_policy")).rows).toEqual([{ enabled: false }]);
  });
  async function slotFixture(slots: { date: string; notBeforeUTC: string }[], id: string) {
    const original = (await db.query<{ p: Record<string, unknown>; g: Record<string, unknown> }>(`select to_jsonb(p) p,to_jsonb(g) g
      from lean_private.google_standing_policy p,lean_private.google_auto_grants g
      where p.policy_id='fixture-policy' and g.grant_id='fixture-auto'`)).rows[0];
    const now = Date.now();
    await db.query(`insert into lean_private.google_standing_policy
      select * from jsonb_populate_record(null::lean_private.google_standing_policy,$1)`, [JSON.stringify({
      ...original.p, policy_id: id, enabled: true, revoked: false, max_generations: 10,
      from_date: "2026-01-01", through_date: "2026-12-31", not_before: new Date(now - 86400000).toISOString(),
      expires_at: new Date(now + 3600000).toISOString() })]);
    await db.query(`insert into lean_private.google_auto_grants
      select * from jsonb_populate_record(null::lean_private.google_auto_grants,$1)`, [JSON.stringify({
      ...original.g, grant_id: id, policy_id: id, enabled: true, revoked: false, capture_slots: slots,
      not_before: new Date(now - 86400000).toISOString(), expires_at: new Date(now + 3600000).toISOString(),
      cycles: 0, last_claimed_at: null, slot_log: [], setup_receipt: { credentialSha256: claim().credentialSha256 } })]);
    return { ...args, p_grant: id };
  }
  it("wall-clock slots select the newest eligible day and record missed work without catching up or accepting it", async () => {
    await db.exec("begin");
    try {
      const now = Date.now(), slots = [
        { date: "2026-01-01", notBeforeUTC: new Date(now - 120000).toISOString() },
        { date: "2026-01-01", notBeforeUTC: new Date(now - 60000).toISOString() },
        { date: "2026-01-02", notBeforeUTC: new Date(now - 30000).toISOString() },
        { date: "2026-01-02", notBeforeUTC: new Date(now + 600000).toISOString() },
      ];
      const bound = await slotFixture(slots, "slot-current");
      const result = await rpc("lean_google_auto_claim", { ...bound, p_cycle: "eeeeeeee-eeee-4eee-aeee-eeeeeeeeeeee" });
      expect(result).toMatchObject({ state: "capture", date: "2026-01-02", slotOrdinal: 3,
        slotNotBeforeUTC: slots[2].notBeforeUTC });
      const g = (await db.query<{ cycles: number; slot_log: { ordinal: number; state: string }[] }>(
        "select cycles,slot_log from lean_private.google_auto_grants where grant_id='slot-current'")).rows[0];
      expect(g.cycles).toBe(1);
      expect(g.slot_log.map(({ ordinal, state }) => ({ ordinal, state }))).toEqual([
        { ordinal: 1, state: "skipped_unprocessed" }, { ordinal: 2, state: "skipped_unprocessed" }]);
      expect((await db.query("select count(*)::integer n from lean_private.google_standing_imports")).rows).toEqual([{ n: 0 }]);
      await expect(db.exec("update lean_private.google_auto_grants set slot_log='[]' where grant_id='slot-current'"))
        .rejects.toThrow("immutable");
    } finally { await db.exec("rollback"); }
  });
  it("wall-clock slots preserve one active consumed cycle while logging missed slots rather than retrying it", async () => {
    await db.exec("begin");
    try {
      const now = Date.now(), slots = [
        { date: "2026-01-01", notBeforeUTC: new Date(now - 120000).toISOString() },
        { date: "2026-01-01", notBeforeUTC: new Date(now - 60000).toISOString() },
        { date: "2026-01-02", notBeforeUTC: new Date(now - 30000).toISOString() },
      ];
      const bound = await slotFixture(slots, "slot-held"), heldCycle = "ffffffff-ffff-4fff-afff-ffffffffffff";
      await db.query(`insert into lean_private.google_auto_cycles(cycle_id,grant_id,grant_revision,ordinal,report_date,
        started_at,deadline,state,run_id,base_run) values($1,'slot-held',1,1,'2026-01-01',
        clock_timestamp()-interval '2 minutes',clock_timestamp()-interval '1 minute','capture','held-run','held-base')`, [heldCycle]);
      expect(await rpc("lean_google_auto_claim", { ...bound, p_cycle: "dddddddd-dddd-4ddd-addd-dddddddddddd" }))
        .toEqual({ state: "held" });
      expect((await db.query("select cycle_id,state from lean_private.google_auto_cycles where grant_id='slot-held'")).rows)
        .toEqual([{ cycle_id: heldCycle, state: "capture" }]);
      expect((await db.query<{ slot_log: { ordinal: number }[] }>(
        "select slot_log from lean_private.google_auto_grants where grant_id='slot-held'")).rows[0].slot_log.map(x => x.ordinal))
        .toEqual([2]);
    } finally { await db.exec("rollback"); }
  });
  it("wall-clock eligibility matches the frozen full-LA query close, including exact boundaries and DST refusal", async () => {
    const day = "2026-10-06", w = metaHourlyWindow(day);
    const expected = new Date(Math.max(...w.providerHours.values()) + 3600000).toISOString();
    const result = (await db.query<{ at: string }>(
      "select lean_private.google_auto_provider_close($1)::text at", [day])).rows[0].at;
    expect(new Date(result).toISOString()).toBe(expected);
    expect(expected).toBe("2026-10-07T07:00:00.000Z");
    await db.exec("begin");
    try {
      const bound = await slotFixture([{ date: day, notBeforeUTC: "2026-10-07T06:59:59.999999Z" }], "slot-too-early");
      await expect(rpc("lean_google_auto_claim", { ...bound, p_cycle: "88888888-8888-4888-a888-888888888888" })).rejects.toThrow("provider close");
    } finally { await db.exec("rollback"); }
    for (const bad of ["2026-03-08","2026-03-09","2026-11-01","2026-11-02"])
      await expect(db.query("select lean_private.google_auto_provider_close($1)", [bad])).rejects.toThrow("DST");
  });
  it("wall-clock future slots dispatch nothing and the explicit slot inventory remains immutable", async () => {
    await db.exec("begin");
    try {
      const bound = await slotFixture([
        { date: "2026-01-01", notBeforeUTC: new Date(Date.now() + 600000).toISOString() },
      ], "slot-future");
      expect(await rpc("lean_google_auto_claim", { ...bound, p_cycle: "77777777-7777-4777-a777-777777777777" })).toEqual({ state: "not_due" });
      expect((await db.query("select cycles,slot_log from lean_private.google_auto_grants where grant_id='slot-future'")).rows)
        .toEqual([{ cycles: 0, slot_log: [] }]);
      expect((await db.query("select count(*)::integer n from lean_private.google_auto_cycles where grant_id='slot-future'")).rows)
        .toEqual([{ n: 0 }]);
      await expect(db.exec(`update lean_private.google_auto_grants set capture_slots=
        '[{"date":"2026-01-02","notBeforeUTC":"2026-10-07T07:00:00Z"}]' where grant_id='slot-future'`))
        .rejects.toThrow("immutable");
    } finally { await db.exec("rollback"); }
  });
});

it("Computer transport emits only exact read commands and wraps no hidden source writes", () => {
  const calls: unknown[][] = [];
  const execute = ((...args: unknown[]) => {
    calls.push(args); return JSON.stringify({ is_error: false, result: [{ id: "fixture" }] });
  }) as NonNullable<Parameters<typeof posthogRead>[2]>;
  const out = posthogRead("external-data-sources-jobs", { id: source, schemas: ["google_account_daily"] }, execute);
  expect(out).toEqual([{ id: "fixture" }]);
  const command = calls[0][1] as string[], input = JSON.parse(command.at(-1)!);
  expect(command.slice(0, 6)).toEqual(["connector","call","posthog","exec","--input",command[5]]);
  expect(input.command).toBe(`call --json external-data-sources-jobs ${JSON.stringify({ id: source, schemas: ["google_account_daily"] })}`);
  expect(input.context).toBe("Read the approved dedicated Google import metadata and complete bounded table without changing source configuration or returning authentication values.");
  expect(input.context.split(/\s+/)).toHaveLength(19);
  expect(input.llm_model).toBe("unknown");
});
it("constructs the new paused source with exact P3 manifest and nested schema, never an inline secret or cadence", () => {
  const manifest = readFileSync("docs/analytics/google-delivery-posthog-manifest.json","utf8");
  const request = preparePausedGoogleSource({ prefix: "fixture_google", manifest, authToken: "fixture-bearer-".repeat(3) });
  expect(request).toMatchObject({ source_type: "Custom", payload: { manifest_json: manifest,
    schemas: [{ name: "google_account_daily", should_sync: false, sync_type: "full_refresh" }] } });
  expect(request).not.toHaveProperty("schemas");
  expect(request).not.toHaveProperty("sync_frequency");
  expect(request.payload.manifest_json).not.toContain("fixture-bearer");
});
it("installer refuses zone-less or invalid calendar timestamps and embeds canonical UTC plus original timing", () => {
  const raw = readFileSync("sql/analytics/google_automatic_operation.review.sql","utf8");
  const input = { owner: "postgres", sessionUser: "postgres", approvalRef: "fixture:approval", actorRef: "fixture:owner",
    catalogSha256: "a".repeat(64), rawSha256: createHash("sha256").update(raw).digest("hex"),
    capturedAt: new Date(Date.now() - 1000).toISOString(), deadline: new Date(Date.now() + 60000).toISOString() };
  for (const field of ["capturedAt","deadline"] as const) {
    expect(() => renderGoogleAutomaticInstaller({ ...input, [field]: input[field].slice(0, -1) }, raw)).toThrow("explicit_zone");
    expect(() => renderGoogleAutomaticInstaller({ ...input, [field]: "2026-02-30T12:00:00Z" }, raw)).toThrow("calendar");
    expect(() => renderGoogleAutomaticInstaller({ ...input, [field]: "2026-10-07T24:00:00Z" }, raw)).toThrow("calendar");
  }
  const offset = { ...input, capturedAt: input.capturedAt.replace("Z", "+00:00"),
    deadline: input.deadline.replace("Z", "+00:00") };
  const sql = renderGoogleAutomaticInstaller(offset, raw);
  const metadata = JSON.parse(Buffer.from(sql.match(/decode\('([a-f0-9]+)','hex'\)/)![1], "hex").toString("utf8"));
  expect(metadata.capturedAt).toBe(input.capturedAt); expect(metadata.deadline).toBe(input.deadline);
  expect(metadata.originalTiming).toEqual({ capturedAt: offset.capturedAt, deadline: offset.deadline });
  expect(metadata.originalBindingSha256).toBe(googleAutomaticDigest(offset));
});
it("rejects incomplete outer and nested connector envelopes before extraction and atomic-table projection", () => {
  for (const flags of [{ structured_content_metadata: { truncated: true } }, { truncated: true }, { success: false },
    { is_truncated: true }, { hasMore: true }, { content_metadata: { success: false } }]) {
    const execute = (() => JSON.stringify({ ...flags, result: [{ id: "fixture" }] })) as unknown as NonNullable<Parameters<typeof posthogRead>[2]>;
    expect(() => posthogRead("external-data-sources-jobs", {}, execute)).toThrow("incomplete");
    const nested = (() => JSON.stringify({ result: { ...flags, result: [{ id: "fixture" }] } })) as unknown as NonNullable<Parameters<typeof posthogRead>[2]>;
    expect(() => posthogRead("external-data-sources-jobs", {}, nested)).toThrow("incomplete");
    expect(() => googleAtomicQueryResult({ ...observed().result, ...flags }, "fixture")).toThrow("incomplete");
  }
});
it("stops after the first read crosses the outer turn deadline and never invokes Meta beyond that window", async () => {
  const start = Date.now(), originalNow = Date.now, reads: string[] = [];
  let now = start;
  Date.now = () => now;
  try {
    const x = observed();
    const binding = { enabled: true, version: 1, projectId: "353503", origin: "https://www.mymully.com",
      notBefore: new Date(start - 1000).toISOString(), expiresAt: new Date(start + 1000).toISOString(),
      destinationContractSha256: "b".repeat(64), grantId: "fixture-auto", grantRevision: "1",
      approvalRef: "fixture:approval", actorRef: "fixture:owner", attemptPath: "unused",
      maxApplicationCalls: 3, maxConnectorCalls: 5, allowObserve: true };
    await expect(runGoogleAutomaticTurn(binding, {
      LEAN_GOOGLE_AUTOMATIC_PRODUCER_SECRET: producer, LEAN_GOOGLE_AUTOMATIC_OBSERVER_SECRET: observer,
    }, { retain: () => {}, request: async (_url: string, init: RequestInit) => {
      const action = JSON.parse(String(init.body)).action;
      if (action === "state") return Response.json({ state: "observe", grantId: "fixture-auto", grantRevision: "1", cycleId: cycle });
      expect(action).toBe("observe_claim"); return Response.json(x.claim);
    }, read: async (name: string, _args: unknown, deadline: number) => {
      expect(deadline).toBe(start + 1000); reads.push(name); now = start + 1100; return x.sourceRow;
    } })).rejects.toThrow("observation_budget");
    expect(reads).toEqual(["external-data-sources-retrieve"]);
    const meta = { deadline: new Date(start + 60000).toISOString() };
    expect(() => captureMetaClaim({ state: "meta_capture", binding: meta, bindingSha256: googleAutomaticDigest(meta) },
      start + 1000)).toThrow("meta_outer_deadline");
  } finally { Date.now = originalNow; }
});
it("Computer turn is default-off, binds actual server grant, sends full advancement without a body and retains hashes only", async () => {
  const binding = { enabled: true, version: 1, projectId: "353503", origin: "https://www.mymully.com",
    notBefore: new Date(Date.now() - 1000).toISOString(), expiresAt: new Date(Date.now() + 60000).toISOString(),
    destinationContractSha256: "b".repeat(64), grantId: "fixture-auto", grantRevision: "1",
    approvalRef: "fixture:approval", actorRef: "fixture:owner", attemptPath: "fixture-only",
    maxApplicationCalls: 3, maxConnectorCalls: 5, allowAdvance: true, standingPolicy: "fixture-policy", standingRevision: "1" };
  const retained: unknown[] = [], calls: unknown[] = [];
  const adapters = { retain: (_path: string, value: unknown) => { retained.push(value); },
    request: async (url: string, init: RequestInit) => {
      calls.push({ url, body: init.body });
      if (url.endsWith("/full")) { expect(init.body).toBeUndefined(); return Response.json({ state: "partial" }); }
      return Response.json({ state: "advance", grantId: binding.grantId, grantRevision: "1",
        standingPolicy: "fixture-policy", standingRevision: "1" });
    } };
  const env = { LEAN_GOOGLE_AUTOMATIC_PRODUCER_SECRET: producer, LEAN_GOOGLE_AUTOMATIC_OBSERVER_SECRET: observer,
    LEAN_ANALYTICS_FULL_SECRET: "fixture-full-".repeat(3) };
  await expect(runGoogleAutomaticTurn({ ...binding, enabled: false }, env, adapters)).rejects.toThrow("binding");
  expect(calls).toEqual([]);
  expect(await runGoogleAutomaticTurn(binding, env, adapters)).toMatchObject({ state: "partial", applicationCalls: 2,
    connectorCalls: 0, metricAcceptance: "not_established" });
  expect(retained).toHaveLength(2);
  expect(JSON.stringify(retained)).not.toContain(producer);
});
it("Computer observer requests schema NAMES, verifies UUIDs separately, and sends only scrubbed ordered readbacks", async () => {
  const x = observed(), calls: string[] = [];
  const binding = { enabled: true, version: 1, projectId: "353503", origin: "https://www.mymully.com",
    notBefore: new Date(Date.now() - 1000).toISOString(), expiresAt: new Date(Date.now() + 60000).toISOString(),
    destinationContractSha256: "b".repeat(64), grantId: "fixture-auto", grantRevision: "1",
    approvalRef: "fixture:approval", actorRef: "fixture:owner", attemptPath: "fixture-observer",
    maxApplicationCalls: 3, maxConnectorCalls: 5, allowObserve: true };
  const env = { LEAN_GOOGLE_AUTOMATIC_PRODUCER_SECRET: producer, LEAN_GOOGLE_AUTOMATIC_OBSERVER_SECRET: observer };
  const result = await runGoogleAutomaticTurn(binding, env, { retain: () => {},
    request: async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      if (body.action === "state") return Response.json({ state: "observe", grantId: "fixture-auto",
        grantRevision: "1", cycleId: cycle });
      if (body.action === "observe_claim") return Response.json(x.claim);
      expect(body.action).toBe("observe_commit");
      expect(JSON.stringify(body)).not.toContain("fixture-secret-auth");
      return Response.json({ state: "accepted" });
    },
    read: async (name: string, args: Record<string, unknown>) => {
      calls.push(name);
      if (name === "external-data-sources-retrieve")
        return { ...x.sourceRow, job_inputs: { ...x.sourceRow.job_inputs, auth_token: "fixture-secret-auth" } };
      if (name === "external-data-sources-jobs") {
        expect(args.schemas).toEqual(["google_account_daily"]); expect(args.id).toBe(source); return x.jobs;
      }
      expect(args.query).toBe(googleAtomicTableQuery(x.claim.destination as never)); return x.result;
    } });
  expect(result).toMatchObject({ applicationCalls: 3, connectorCalls: 5, state: "accepted" });
  expect(calls).toEqual(["external-data-sources-retrieve","external-data-sources-jobs","execute-sql",
    "external-data-sources-retrieve","external-data-sources-jobs"]);
});
