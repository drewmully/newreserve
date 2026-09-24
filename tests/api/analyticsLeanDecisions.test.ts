import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { decideJourney } from "@/lib/analytics/journeyDecision";
import { journeyGrant, type JourneyRuntime } from "@/lib/analytics/journeyRuntime";

let db: PGlite;
const project = "a".repeat(20), shop = "fixture.myshopify.com";
const req = (token?: string, extra: Record<string, string> = {}) => new Request("https://fixture.invalid", {
  headers: { ...(token ? { cookie: `__Host-mully_analytics=${token}` } : {}), ...extra },
});
function runtime(): JourneyRuntime {
  return { env: {
    LEAN_ANALYTICS_JOURNEYS_ENABLED: "true", LEAN_ANALYTICS_PIPELINE_PROJECT_REF: project,
    LEAN_ANALYTICS_SUPABASE_URL: `https://${project}.supabase.co`, LEAN_SHOPIFY_SHOP_DOMAIN: shop,
    LEAN_POSTHOG_PROJECT_ID: "123", LEAN_ANALYTICS_PERMISSION_POLICY: "fixture:v1",
  }, now: Date.now, request: vi.fn(async () => { throw new Error("network_forbidden"); }),
  rpc: async (name, args) => {
    if (!["lean_journey_issue", "lean_journey_grant", "lean_journey_withdraw"].includes(name)) throw new Error("unexpected_rpc");
    const entries = Object.entries(args);
    try {
      const r = await db.query<{ value: unknown }>(`select public.${name}(${
        entries.map(([k], i) => `${k}=>$${i + 1}`).join(",")}) value`, entries.map(([, v]) => v));
      return { data: r.rows[0].value, error: null };
    } catch (error) { return { data: null, error }; }
  } };
}
beforeAll(async () => {
  db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role;
    alter default privileges in schema public grant execute on functions to anon,authenticated,service_role;`);
  for (const file of ["001_staging", "013_release", "014_reporting_views", "018_history_jobs",
    "019_spend_jobs", "020_observed_report_jobs", "021_full_report_jobs", "022_full_release",
    "023_posthog_export", "026_journey_authority", "029_journey_decisions", "030_scoped_release"])
    await db.exec(readFileSync(`sql/analytics/${file}.sql`, "utf8"));
}, 30000);
beforeEach(async () => {
  await db.exec("truncate lean_private.journey_grants cascade; truncate lean_private.journey_policies;");
  await db.query(`insert into lean_private.journey_policies
    (project_ref,shop,posthog_project,policy_version,approval_ref,ttl_seconds,enabled)
    values($1,$2,'123','fixture:v1','fixture:review',3600,false)`, [project, shop]);
});
afterAll(async () => db?.close());
it("issues nothing until the exact operator policy is enabled", async () => {
  await expect(decideJourney(req(), "allow", undefined, runtime())).rejects.toThrow("permission_unconfirmed");
  expect((await db.query("select * from lean_private.journey_grants")).rows).toHaveLength(0);
  await db.exec("update lean_private.journey_policies set enabled=true");
  const r = runtime(); r.env.LEAN_ANALYTICS_PERMISSION_POLICY = "wrong";
  await expect(decideJourney(req(), "allow", undefined, r)).rejects.toThrow("permission_unconfirmed");
});
it("issues opaque random consent, hashes the bearer, and reuses without extending it", async () => {
  await db.exec("update lean_private.journey_policies set enabled=true");
  const r = runtime(), first = await decideJourney(req(), "allow", undefined, r);
  expect(first.token).toMatch(/^[a-f0-9]{64}$/);
  expect(first.maxAge).toBeGreaterThan(3500);
  const rows = (await db.query<{ token_hash: string; subject_id: string }>("select * from lean_private.journey_grants")).rows;
  expect(rows[0].token_hash).toBe(createHash("sha256").update(first.token).digest("hex"));
  expect(JSON.stringify(rows)).not.toContain(first.token);
  expect(rows[0].subject_id).not.toBe(first.token);
  const repeated = await decideJourney(req(first.token), "allow", undefined, r);
  expect(repeated.token).toBe(first.token);
  expect(repeated.maxAge).toBeLessThanOrEqual(first.maxAge);
  expect((await db.query("select * from lean_private.journey_grants")).rows).toHaveLength(1);
});
it("never treats marketing, user supplied IDs, or privacy signals as permission", async () => {
  await db.exec("update lean_private.journey_policies set enabled=true");
  for (const signal of [{ "sec-gpc": "1" }, { dnt: "1" }] as Record<string, string>[])
    await expect(decideJourney(req(undefined, signal), "allow", undefined, runtime())).rejects.toThrow("permission_declined");
  const r = runtime(); r.env.LEAN_ANALYTICS_JOURNEYS_ENABLED = "false";
  await expect(decideJourney(req(), "allow", undefined, r)).rejects.toThrow("permission_unavailable");
  expect((await db.query("select * from lean_private.journey_grants")).rows).toHaveLength(0);
});
it("withdraws idempotently even with GPC, enqueues removal and immediately denies capture", async () => {
  await db.exec("update lean_private.journey_policies set enabled=true");
  const r = runtime(), first = await decideJourney(req(), "allow", "verified-uid", r);
  expect(await journeyGrant(req(first.token), "wrong", r)).toBeNull();
  expect(await journeyGrant(req(first.token), "verified-uid", r)).not.toBeNull();
  r.env.LEAN_ANALYTICS_JOURNEYS_ENABLED = "false";
  expect(await decideJourney(req(first.token, { "sec-gpc": "1" }), "withdraw", undefined, r)).toEqual({ token: "", maxAge: 0 });
  expect(await journeyGrant(req(first.token), "verified-uid", r)).toBeNull();
  await decideJourney(req(first.token), "withdraw", undefined, r);
  expect((await db.query("select * from lean_private.journey_removals")).rows).toHaveLength(1);
  expect((await db.query("select downstream_verified_at from lean_private.journey_removals")).rows[0])
    .toEqual({ downstream_verified_at: null });
});
it("does not discard the cookie on an unconfirmed withdrawal or retry an ambiguous write", async () => {
  const r = runtime(); r.rpc = vi.fn(async () => { throw new Error("ambiguous"); });
  await expect(decideJourney(req("b".repeat(64)), "withdraw", undefined, r)).rejects.toThrow();
  expect(r.rpc).toHaveBeenCalledTimes(1);
});
it("runtime can decide but cannot enable policies, verify deletion or release reports", async () => {
  const r = await db.query(`select
    has_table_privilege('service_role','lean_private.journey_policies','update') config,
    has_table_privilege('service_role','lean_private.journey_removals','update') verify,
    has_function_privilege('service_role','public.lean_journey_issue(text,text,text,text,text,text,uuid,text)','execute') issue,
    has_function_privilege('anon','public.lean_journey_issue(text,text,text,text,text,text,uuid,text)','execute') anon,
    has_function_privilege('service_role','public.lean_scoped_release(text,text,text[],jsonb,text,text,text)','execute') release`);
  expect(r.rows).toEqual([{ config: false, verify: false, issue: true, anon: false, release: false }]);
});
