import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
vi.mock("@/lib/firebase-admin", () => ({ adminAuth: { verifyIdToken: vi.fn(async () => ({ uid: "verified" })) } }));
vi.mock("@/lib/rateLimit", () => ({ checkRateLimit: () => ({ allowed: true }) }));
import { decideJourney } from "@/lib/analytics/journeyDecision";
import { captureJourney, journeyGrant, attachJourneyDraft, type JourneyRuntime } from "@/lib/analytics/journeyRuntime";
import { resolveJourneyRuntime, reserveRuntime as target } from "@/lib/analytics/journeyPolicyRuntime";
import { journeyRequest } from "@/lib/analytics/journeyRoute";
import PreferencesClient from "@/app/analytics-preferences/PreferencesClient";

const sql = readFileSync("sql/analytics/proposed_journey_runtime_policy.sql", "utf8");
const key = "fixture-capture-key-not-a-provider-credential";
const digest = createHash("sha256").update(key).digest("hex");
let db: PGlite;
let oldBodies: unknown;
const bodies = `select oid::regprocedure::text signature,md5(prosrc) body from pg_proc
  where proname in ('lean_journey_issue','lean_journey_grant','lean_journey_action','lean_journey_withdraw') order by 1`;
async function baseline() {
  const d = new PGlite();
  await d.exec(`create role anon; create role authenticated; create role service_role;
    alter default privileges in schema public grant execute on functions to anon,authenticated,service_role;`);
  for (const file of ["001_staging", "013_release", "014_reporting_views", "018_history_jobs",
    "019_spend_jobs", "020_observed_report_jobs", "021_full_report_jobs", "022_full_release",
    "023_posthog_export", "026_journey_authority", "029_journey_decisions", "030_scoped_release",
    "031_draft_receipts", "037_canonical_journey_timestamps"])
    await d.exec(readFileSync(`sql/analytics/${file}.sql`, "utf8"));
  return d;
}
function runtime(): JourneyRuntime {
  return { env: { NODE_ENV: "test", VERCEL_ENV: "production", VERCEL_GIT_COMMIT_REF: "main",
    LEAN_ANALYTICS_JOURNEYS_ENABLED: "false", LEAN_ANALYTICS_PIPELINE_PROJECT_REF: target.project,
    LEAN_ANALYTICS_SUPABASE_URL: `https://${target.project}.supabase.co`,
    LEAN_ANALYTICS_SUPABASE_SERVICE_ROLE_KEY: "fixture-service-key" },
  now: Date.now, captureKeyCandidates: [key],
  request: vi.fn(async () => new Response(null, { status: 204 })),
  rpc: async (name, args) => {
    if (!/^lean_journey_(runtime_(config|issue|grant|action)|issue|grant|action|withdraw)$/.test(name))
      throw new Error("unexpected_rpc");
    const entries = Object.entries(args);
    try {
      await db.exec("set role service_role");
      const r = await db.query<{ value: unknown }>(`select public.${name}(${
        entries.map(([k], i) => `${k}=>$${i + 1}`).join(",")}) value`, entries.map(([, v]) => v));
      // Match the JSON transport, including timestamp scalars returned by SQL.
      return { data: JSON.parse(JSON.stringify(r.rows[0].value)), error: null };
    } catch (error) { return { data: null, error }; }
    finally { await db.exec("reset role"); }
  } };
}
async function enable() {
  await db.query(`insert into lean_private.journey_policies
    (project_ref,shop,posthog_project,policy_version,approval_ref,ttl_seconds,enabled,
     runtime_capture_key_sha256,runtime_valid_until)
    values($1,$2,$3,$4,'fixture:explicit-review',3600,true,$5,clock_timestamp()+interval '2 hours')`,
  [target.project, target.shop, target.posthog, target.policy, digest]);
}
const request = (token?: string, headers: Record<string, string> = {}) =>
  new Request(`${target.origin}/api/analytics/track`, {
    headers: { origin: target.origin, ...(token ? { cookie: `__Host-mully_analytics=${token}` } : {}), ...headers },
  });
async function allowed(r = runtime()) {
  const decision = await decideJourney(request(), "allow", undefined, r);
  return { r, token: decision.token, req: request(decision.token) };
}
beforeAll(async () => {
  db = await baseline(); oldBodies = (await db.query(bodies)).rows; await db.exec(sql);
}, 30000);
beforeEach(async () => {
  await db.exec("truncate lean_private.journey_grants cascade; delete from lean_private.journey_policies;");
});
afterEach(() => vi.unstubAllEnvs());
afterAll(async () => db?.close());

it("is default-empty, preserves old bodies, and grants no runtime policy-write capability", async () => {
  expect((await db.query(bodies)).rows).toEqual(oldBodies);
  expect((await resolveJourneyRuntime(runtime())).policy).toBeUndefined();
  await expect(decideJourney(request(), "allow", undefined, runtime())).rejects.toThrow("permission_unavailable");
  expect((await db.query(`select has_table_privilege('service_role','lean_private.journey_policies','update') edit,
    has_function_privilege('anon','public.lean_journey_runtime_config()','execute') anon,
    has_function_privilege('authenticated','public.lean_journey_runtime_issue(text,text,text,uuid,text)','execute') auth,
    has_function_privilege('service_role','lean_private.journey_runtime_policy(text)','execute') helper,
    has_function_privilege('lean_posthog_reader','public.lean_journey_runtime_config()','execute') reader`)).rows)
    .toEqual([{ edit: false, anon: false, auth: false, helper: false, reader: false }]);
});
it("refuses duplicate installation without changing installed objects", async () => {
  await expect(db.exec(sql)).rejects.toThrow("footprint");
  await db.exec("rollback");
  expect((await db.query(bodies)).rows).toEqual(oldBodies);
});
it("refuses a committed partial footprint and leaves it unchanged", async () => {
  const d = await baseline();
  try {
    await d.exec("alter table lean_private.journey_policies add column runtime_valid_until timestamptz");
    await expect(d.exec(sql)).rejects.toThrow("footprint"); await d.exec("rollback");
    expect((await d.query("select to_regprocedure('public.lean_journey_runtime_config()') value")).rows[0])
      .toEqual({ value: null });
  } finally { await d.close(); }
}, 30000);
it("rolls back all new DDL when effective inherited execute permissions are unsafe", async () => {
  const d = await baseline();
  try {
    await d.exec("grant service_role to anon");
    await expect(d.exec(sql)).rejects.toThrow("unsafe effective execute"); await d.exec("rollback");
    expect((await d.query(`select count(*)::int n from information_schema.columns
      where table_schema='lean_private' and table_name='journey_policies' and column_name like 'runtime_%'`)).rows[0])
      .toEqual({ n: 0 });
    expect((await d.query("select to_regprocedure('public.lean_journey_runtime_config()') value")).rows[0])
      .toEqual({ value: null });
  } finally { await d.close(); }
}, 30000);
it.each(["direct column update", "inherited column update", "column insert", "table trigger"])(
  "refuses installation with unsafe policy authority: %s", async mode => {
    const d = await baseline();
    try {
      await d.exec("alter role service_role bypassrls; grant usage on schema lean_private to service_role");
      if (mode === "inherited column update") {
        await d.exec(`create role policy_writer;
          grant update(enabled) on lean_private.journey_policies to policy_writer;
          grant policy_writer to service_role`);
      } else await d.exec(`grant ${mode === "column insert" ? "insert(enabled)" :
        mode === "table trigger" ? "trigger" : "update(enabled)"}
        on lean_private.journey_policies to service_role`);
      if (mode.includes("column update")) {
        expect((await d.query(`select
          has_table_privilege('service_role','lean_private.journey_policies','UPDATE') whole_table,
          has_any_column_privilege('service_role','lean_private.journey_policies','UPDATE') any_column`)).rows)
          .toEqual([{ whole_table: false, any_column: true }]);
      }
      await expect(d.exec(sql)).rejects.toThrow("unsafe effective role"); await d.exec("rollback");
      expect((await d.query("select to_regprocedure('public.lean_journey_runtime_config()') value")).rows[0])
        .toEqual({ value: null });
      expect((await d.query(`select count(*)::int n from information_schema.columns
        where table_schema='lean_private' and table_name='journey_policies'
        and column_name like 'runtime_%'`)).rows[0]).toEqual({ n: 0 });
    } finally { await d.close(); }
  }, 30000);
it("requires the exact production target and approved destination fingerprint", async () => {
  await enable();
  for (const change of [{ VERCEL_ENV: "preview" }, { VERCEL_GIT_COMMIT_REF: "branch" },
    { LEAN_ANALYTICS_PIPELINE_PROJECT_REF: "a".repeat(20) }, { LEAN_ANALYTICS_SUPABASE_SERVICE_ROLE_KEY: "" }]) {
    const r = runtime(); Object.assign(r.env, change);
    expect((await resolveJourneyRuntime(r)).policy).toBeUndefined();
  }
  const r = runtime(); r.captureKeyCandidates = ["wrong-key"];
  expect((await resolveJourneyRuntime(r)).policy).toBeUndefined();
  r.captureKeyCandidates = [key];
  expect((await resolveJourneyRuntime(r)).policy?.policyVersion).toBe(target.policy);
});
it("requires real allow, respects both privacy signals and does not create grants on a read", async () => {
  await enable();
  await resolveJourneyRuntime(runtime());
  expect(await captureJourney(request(), "quiz_started", randomUUID(), undefined, runtime())).toBe(false);
  for (const h of [{ "sec-gpc": "1" }, { dnt: "1" }] as Record<string, string>[])
    await expect(decideJourney(request(undefined, h), "allow", undefined, runtime())).rejects.toThrow("permission_declined");
  expect((await db.query("select count(*)::int n from lean_private.journey_grants")).rows[0]).toEqual({ n: 0 });
});
it("keeps strict origin on the generic track capture path, not only the decision route", async () => {
  await enable(); const { r, token } = await allowed();
  for (const origin of ["https://attacker.invalid", "https://mymully.com", ""]) {
    expect(await captureJourney(request(token, { origin }), "quiz_started", randomUUID(), undefined, r)).toBe(false);
    await expect(decideJourney(request(undefined, { origin }), "allow", undefined, r)).rejects.toThrow("permission_unavailable");
  }
  expect(r.request).not.toHaveBeenCalled();
});
it("drives actual issue/grant/action SQL then exact profileless raw capture, with stable retry timestamp", async () => {
  await enable(); const { r, req, token } = await allowed();
  expect((await decideJourney(req, "allow", undefined, r)).token).toBe(token);
  const id = randomUUID();
  expect(await captureJourney(req, "quiz_started", id, undefined, r)).toBe(true);
  expect(await captureJourney(req, "quiz_started", id, undefined, r)).toBe(true);
  const calls = vi.mocked(r.request).mock.calls;
  expect(calls[0][0]).toBe("https://us.i.posthog.com/capture/");
  const payload = JSON.parse(String(calls[0][1]?.body));
  expect(Object.keys(payload).sort()).toEqual(["api_key", "event", "properties", "timestamp"]);
  expect(payload.event).toBe("lean_reserve_started");
  expect(payload.properties).toMatchObject({ analytics_permitted: true, $process_person_profile: false,
    collection_version: "lean-v1", journey: "reserve", step: "started" });
  expect(Object.keys(payload.properties).sort()).toEqual(
    ["$insert_id", "$process_person_profile", "$session_id", "analytics_permitted", "collection_version", "distinct_id", "journey", "step"]);
  expect(payload.properties.distinct_id).toMatch(/^[a-f0-9]{64}$/);
  expect(payload.properties.distinct_id).not.toBe(token);
  expect(JSON.parse(String(calls[1][1]?.body))).toEqual(payload);
  expect((await db.query("select count(*)::int n from lean_private.journey_actions")).rows[0]).toEqual({ n: 1 });
});
it("does not enable other families, cart/draft capabilities or legacy capture with a marked grant", async () => {
  await enable(); const { r, req } = await allowed();
  expect(await captureJourney(req, "sg_begin", randomUUID(), undefined, r)).toBe(false);
  expect(await captureJourney(req, "lp_text_mully_view", randomUUID(), undefined, r)).toBe(false);
  r.env.LEAN_CHECKOUT_CONTEXT_SECRET = "x".repeat(32);
  expect(await attachJourneyDraft(req, "123", target.shop, "uid", r)).toBe(false);
  r.env.LEAN_ANALYTICS_JOURNEYS_ENABLED = "true";
  Object.assign(r.env, { LEAN_SHOPIFY_SHOP_DOMAIN: target.shop, LEAN_POSTHOG_PROJECT_ID: target.posthog });
  expect(await journeyGrant(req, undefined, r)).toBeNull();
  expect(r.request).not.toHaveBeenCalled();
});
it("rejects stale configuration at the SQL write and prevents capture after policy withdrawal", async () => {
  await enable(); const { r, req } = await allowed();
  const resolved = await resolveJourneyRuntime(r);
  await db.exec("update lean_private.journey_policies set approval_ref='fixture:changed'");
  expect(await captureJourney(req, "quiz_started", randomUUID(), undefined, resolved)).toBe(false);
  await db.exec("update lean_private.journey_policies set enabled=false");
  expect(await captureJourney(req, "quiz_started", randomUUID(), undefined, r)).toBe(false);
  expect(r.request).not.toHaveBeenCalled();
});
it("rechecks configuration on actual issue and never substitutes a caller-supplied fingerprint", async () => {
  await enable(); const r = await resolveJourneyRuntime(runtime());
  await db.exec("update lean_private.journey_policies set ttl_seconds=1800");
  await expect(decideJourney(request(), "allow", undefined, r)).rejects.toThrow("permission_unconfirmed");
  expect((await db.query("select count(*)::int n from lean_private.journey_grants")).rows[0]).toEqual({ n: 0 });
});
it("does not claim to recall an already accepted in-flight capture after withdrawal", async () => {
  await enable(); const { r, req } = await allowed();
  let resume!: () => void;
  let entered!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; });
  r.request = vi.fn(async () => {
    entered(); await new Promise<void>(resolve => { resume = resolve; });
    return new Response(null, { status: 204 });
  });
  const pending = captureJourney(req, "quiz_started", randomUUID(), undefined, r);
  await started; await decideJourney(req, "withdraw", undefined, r); resume();
  expect(await pending).toBe(true);
  expect(await captureJourney(req, "quiz_started", randomUUID(), undefined, r)).toBe(false);
  expect(r.request).toHaveBeenCalledTimes(1);
});
it("does not initiate provider capture when the grant expires during actual SQL action acceptance", async () => {
  await enable(); const { r, req } = await allowed();
  await db.exec(`update lean_private.journey_grants set expires_at=clock_timestamp()+interval '200 milliseconds';
    create function public.fixture_action_delay() returns trigger language plpgsql as $$
      begin perform pg_sleep(0.35);return new;end $$;
    create trigger fixture_action_delay after insert on lean_private.journey_actions
      for each row execute function public.fixture_action_delay()`);
  try {
    expect(await captureJourney(req, "quiz_started", randomUUID(), undefined, r)).toBe(false);
    expect(r.request).not.toHaveBeenCalled();
    expect((await db.query(`select expires_at<=clock_timestamp() expired,
      (select count(*)::int from lean_private.journey_actions) accepted
      from lean_private.journey_grants`)).rows).toEqual([{ expired: true, accepted: 1 }]);
  } finally {
    await db.exec("drop trigger fixture_action_delay on lean_private.journey_actions; drop function public.fixture_action_delay()");
  }
});
it("old RPCs cannot issue or replay marked actions after DB policy disable or outside family scope", async () => {
  await enable(); const { token } = await allowed(); const hash = createHash("sha256").update(token).digest("hex");
  for (const name of ["lean_checkout_receipt", "lean_draft_receipt"])
    await expect(db.query(`select public.${name}($1,$2,$3,'123',$4)`,
      [target.project, target.shop, hash, "x".repeat(60)])).rejects.toThrow("checkout bridge not approved");
  const id = randomUUID();
  await db.query("select public.lean_journey_action($1,$2,$3,$4,'lean_reserve_started')",
    [target.project, target.shop, hash, id]);
  await expect(db.query("select public.lean_journey_action($1,$2,$3,$4,'lean_style_game_started')",
    [target.project, target.shop, hash, randomUUID()])).rejects.toThrow("family not approved");
  await db.exec("update lean_private.journey_policies set enabled=false");
  await expect(db.query("select public.lean_journey_action($1,$2,$3,$4,'lean_reserve_started')",
    [target.project, target.shop, hash, id])).rejects.toThrow("unavailable");
});
it("expiry stops issue/capture but does not stop genuine withdrawal or claim downstream erasure", async () => {
  await enable(); const { r, req } = await allowed();
  await db.exec("update lean_private.journey_policies set runtime_valid_until=clock_timestamp()-interval '1 second'");
  expect(await captureJourney(req, "quiz_started", randomUUID(), undefined, r)).toBe(false);
  await expect(decideJourney(request(), "allow", undefined, r)).rejects.toThrow("permission_unavailable");
  r.captureKeyCandidates = [];
  expect(await decideJourney(req, "withdraw", undefined, r)).toEqual({ token: "", maxAge: 0 });
  expect((await db.query("select downstream_verified_at from lean_private.journey_removals")).rows)
    .toEqual([{ downstream_verified_at: null }]);
});
it("live grant revocation denies capture with a still-enabled policy", async () => {
  await enable(); const { r, req } = await allowed();
  await decideJourney(req, "withdraw", undefined, r);
  expect(await captureJourney(req, "quiz_started", randomUUID(), undefined, r)).toBe(false);
  expect(r.request).not.toHaveBeenCalled();
});
it("rejects unsupported isolation on marked writes without changing unmarked old behavior", async () => {
  await enable(); const { token } = await allowed(); const hash = createHash("sha256").update(token).digest("hex");
  for (const isolation of ["repeatable read", "serializable"]) {
    await db.exec(`begin isolation level ${isolation}`);
    await expect(db.query("select public.lean_journey_action($1,$2,$3,$4,'lean_reserve_started')",
      [target.project, target.shop, hash, randomUUID()])).rejects.toThrow("requires read committed");
    await db.exec("rollback");
  }
});
it("keeps legacy env-only issue/capture independent of absent DB policy", async () => {
  await db.query(`insert into lean_private.journey_policies
    (project_ref,shop,posthog_project,policy_version,approval_ref,ttl_seconds,enabled)
    values($1,$2,'123','legacy:v1','fixture:legacy',3600,true)`, ["a".repeat(20), "fixture.myshopify.com"]);
  const r = runtime();
  Object.assign(r.env, { VERCEL_ENV: "preview", LEAN_ANALYTICS_JOURNEYS_ENABLED: "true",
    LEAN_ANALYTICS_PIPELINE_PROJECT_REF: "a".repeat(20), LEAN_ANALYTICS_SUPABASE_URL: `https://${"a".repeat(20)}.supabase.co`,
    LEAN_SHOPIFY_SHOP_DOMAIN: "fixture.myshopify.com", LEAN_POSTHOG_PROJECT_ID: "123",
    LEAN_ANALYTICS_PERMISSION_POLICY: "legacy:v1", LEAN_POSTHOG_CAPTURE_ORIGIN: "https://eu.i.posthog.com",
    LEAN_POSTHOG_CAPTURE_KEY: "fixture-legacy-key" });
  await db.exec("begin isolation level repeatable read");
  try {
    const { req } = await allowed(r);
    expect(await captureJourney(req, "sg_begin", randomUUID(), undefined, r)).toBe(true);
    expect(vi.mocked(r.request).mock.calls[0][0]).toBe("https://eu.i.posthog.com/capture/");
  } finally { await db.exec("rollback"); }
});
it("keeps strict canonical origin, rejects forged consent and admits only decision parsing without issuing", async () => {
  Object.entries(runtime().env).forEach(([k, v]) => { if (v !== undefined) vi.stubEnv(k, v); });
  const req = (origin: string, body: object) => new NextRequest(`${target.origin}/api/analytics/journey/decision`,
    { method: "POST", headers: { origin }, body: JSON.stringify(body) });
  expect((await journeyRequest(req("https://attacker.invalid", { decision: "allow" }), ["decision"], true)).response?.status).toBe(403);
  expect((await journeyRequest(req(target.origin, { decision: "allow", analytics_permitted: true }), ["decision"], true)).response?.status).toBe(400);
  expect((await journeyRequest(req(target.origin, { decision: "allow" }), ["decision"], true)).body).toEqual({ decision: "allow" });
  expect((await db.query("select count(*)::int n from lean_private.journey_grants")).rows[0]).toEqual({ n: 0 });
});
it("keeps the existing opt-in wording and an available withdrawal control when allowing is off", () => {
  const off = renderToStaticMarkup(createElement(PreferencesClient, { allowEnabled: false }));
  const on = renderToStaticMarkup(createElement(PreferencesClient, { allowEnabled: true }));
  expect(off).toContain("Permission lasts no longer than 24 hours.");
  expect(off).toContain("It does not change existing advertising or SMS preferences.");
  expect(off).toMatch(/disabled=""[^>]*>Allow for this visit/);
  expect(off).toMatch(/<button class="border px-4 py-2">Withdraw for this visit/);
  expect(on).not.toContain('disabled=""');
  for (const text of [off, on]) {
    expect(text).not.toContain(digest);
    expect(text).not.toContain(key);
    expect(text).not.toContain(target.project);
  }
});
