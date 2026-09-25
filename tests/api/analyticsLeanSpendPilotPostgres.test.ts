/** Disposable loopback database only; separate from the existing pipeline suite. */
import { Client } from "pg";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { advanceGoogleSpendPilot } from "@/lib/analytics/googleSpendPilot";
import { spendPilotScope, spendPilotProject as project, spendPilotBase, spendPilotClient, spendPilotFetch } from "../fixtures/analyticsSpendPilot";
const connectionString = process.env.LOCAL_POSTGRES_TEST_URL;
describe.skipIf(!connectionString)("real PostgreSQL bounded Google pilot", () => {
  let control: Client, admin: Client, a: Client, b: Client, scope: ReturnType<typeof spendPilotScope>;
  beforeAll(async () => {
    const url = new URL(connectionString!);
    if (!["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) ||
      url.pathname !== "/analytics_test_pipeline" || url.username !== "fixture_owner")
      throw new Error("local_disposable_postgres_only");
    control = new Client({ connectionString }); await control.connect();
    await control.query("drop database if exists analytics_test_spend_pilot");
    await control.query("create database analytics_test_spend_pilot");
    url.pathname = "/analytics_test_spend_pilot";
    admin = new Client({ connectionString: url.toString() }); a = new Client({ connectionString: url.toString() });
    b = new Client({ connectionString: url.toString() });
    await admin.connect(); await a.connect(); await b.connect();
    await admin.query(`create schema lean_private; do $$ begin
      if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role; end if;
      if not exists(select 1 from pg_roles where rolname='anon') then create role anon; end if;
      if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated; end if;
    end $$`);
    for (const name of ["019_spend_jobs", "038_google_spend_pilot"])
      await admin.query(readFileSync(`sql/analytics/${name}.sql`, "utf8"));
    await a.query("set statement_timeout='5s'"); await b.query("set statement_timeout='5s'");
  }, 30000);
  afterAll(async () => {
    await a?.end(); await b?.end(); await admin?.end();
    if (control) { await control.query("drop database if exists analytics_test_spend_pilot"); await control.end(); }
  });
  beforeEach(async () => {
    await a.query("rollback"); await b.query("rollback");
    await admin.query(`drop trigger if exists fixture_slow on lean_private.spend_jobs;
      truncate lean_private.spend_pilot_days,lean_private.spend_pilots,lean_private.spend_jobs`);
    scope = spendPilotScope(true);
  });
  const register = async () => {
    await admin.query("select public.lean_spend_pilot_register($1::jsonb)", [JSON.stringify(scope)]);
    await admin.query("update lean_private.spend_pilots set enabled=true; update lean_private.spend_jobs set enabled=true");
  };
  const claim = async (pg: Client, token: string) => (await pg.query(
    "select public.lean_spend_claim($1,$2,$3) result", [scope.days[0].runId, project, token])).rows[0].result;
  const finish = async (pg: Client, token: string) => (await pg.query(
    "select public.lean_spend_finish($1,$2,$3,$4::jsonb) result",
    [scope.days[0].runId, project, token, JSON.stringify(spendPilotBase(scope.days[0].runId, scope.days[0].date))])).rows[0].result;
  const remaining = async () => (await admin.query(
    "select attempts,base is not null as retained from lean_private.spend_jobs order by report_date")).rows;
  const next = async () => (await admin.query("select public.lean_spend_pilot_next($1,$2) result", [scope.pilotId, project])).rows[0].result;
  const rpc = (pg: Client) => spendPilotClient((sql, params) => pg.query(sql, params));

  it("concurrent actual consumers acquire one source attempt, retain once and then advance", async () => {
    await register();
    const fetcher = vi.fn(spendPilotFetch(scope.days[0].date));
    let readers = 0, unblock!: () => void;
    const both = new Promise<void>(resolve => { unblock = resolve; });
    const concurrent = (pg: Client) => ({ async rpc(name: string, args: Record<string, unknown>) {
      const result = await rpc(pg).rpc(name, args);
      if (name === "lean_spend_pilot_next") { if (++readers === 2) unblock(); await both; }
      return result;
    } });
    const input = { projectRef: project, databaseUrl: `https://${project}.supabase.co`, pilotId: scope.pilotId,
      auth: { mode: "oauth_refresh" as const, clientId: "fixture", clientSecret: "fixture", refreshToken: "fixture" },
      now: new Date().toISOString(), signal: AbortSignal.timeout(10000), fetcher };
    const results = await Promise.all([advanceGoogleSpendPilot({ ...input, client: concurrent(a) }),
      advanceGoogleSpendPilot({ ...input, client: concurrent(b) })]);
    expect(results.some(r => r.state === "complete")).toBe(true);
    expect(results.every(r => ["complete", "busy"].includes(r.state))).toBe(true);
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(await remaining()).toEqual([{ attempts: 1, retained: true }, { attempts: 0, retained: false }]);
    expect(await next()).toMatchObject({ state: "ready", runId: scope.days[1].runId });
    expect(await claim(a, randomUUID())).toEqual({ state: "complete" });
  });
  it("enforces due dates, immutable manifests and owner-only registration in real roles", async () => {
    scope = spendPilotScope(); await register();
    await expect(admin.query("update lean_private.spend_pilot_days set due_at=now()")).rejects.toThrow("immutable");
    await a.query("set role service_role");
    try {
      await expect(a.query("select public.lean_spend_pilot_register('{}')")).rejects.toThrow("permission denied");
      await expect(a.query("select public.lean_spend_claim_019('x',$1,$2)", [project, randomUUID()])).rejects.toThrow("permission denied");
      await expect(a.query("update lean_private.spend_pilots set enabled=true")).rejects.toThrow("permission denied");
    } finally { await a.query("reset role"); }
    const token = randomUUID(); await claim(a, token); expect(await finish(a, token)).toBe(true);
    expect(await next()).toEqual({ state: "not_due" });
  });
  it("blocks every later date after a failed or abandoned first attempt", async () => {
    await register(); const token = randomUUID(); await claim(a, token);
    await admin.query("update lean_private.spend_jobs set lease_until=clock_timestamp()-interval '1 second'");
    expect(await next()).toEqual({ state: "blocked" });
    expect(await claim(a, randomUUID())).toEqual({ state: "attempts_exhausted" });
    expect(await finish(a, token)).toBe(false);
    expect((await a.query("select public.lean_spend_claim($1,$2,$3) result",
      [scope.days[1].runId, project, randomUUID()])).rows[0].result).toEqual({ state: "disabled" });
    expect(await remaining()).toEqual([{ attempts: 1, retained: false }, { attempts: 0, retained: false }]);
  });
  it("locks parent and child through completion and rolls back all output with its transaction", async () => {
    await register(); const token = randomUUID(); await claim(a, token);
    await a.query("begin"); expect(await finish(a, token)).toBe(true);
    await b.query("set lock_timeout='100ms'");
    try {
      await expect(b.query("update lean_private.spend_pilots set enabled=false")).rejects.toMatchObject({ code: "55P03" });
      await expect(b.query("update lean_private.spend_jobs set enabled=false")).rejects.toMatchObject({ code: "55P03" });
    } finally { await b.query("set lock_timeout=0"); }
    await a.query("rollback");
    expect(await remaining()).toEqual([{ attempts: 1, retained: false }, { attempts: 0, retained: false }]);
    await admin.query("update lean_private.spend_pilots set enabled=false");
    expect(await finish(a, token)).toBe(false);
    expect(await claim(a, randomUUID())).toEqual({ state: "disabled" });
  });
  it("honors the child kill switch and rejects wrong destination before finish", async () => {
    await register(); const token = randomUUID(); await claim(a, token);
    await admin.query("update lean_private.spend_jobs set enabled=false");
    expect(await finish(a, token)).toBe(false);
    expect(await next()).toEqual({ state: "disabled" });
    expect((await a.query("select public.lean_spend_finish($1,$2,$3,$4) result",
      [scope.days[0].runId, "b".repeat(20), token, "{}"])).rows[0].result).toBe(false);
    expect(await remaining()).toEqual([{ attempts: 1, retained: false }, { attempts: 0, retained: false }]);
  });
  it("rejects replay and new claims after absolute expiry without source or output", async () => {
    scope.days = scope.days.slice(0, 1); scope.expiresAt = new Date(Date.now() + 1800).toISOString(); await register();
    const token = randomUUID(); await claim(a, token); expect(await finish(a, token)).toBe(true);
    await admin.query("select pg_sleep(greatest(0,extract(epoch from (expires_at-clock_timestamp())))+0.02) from lean_private.spend_pilots");
    expect(await next()).toEqual({ state: "expired" });
    expect(await claim(a, randomUUID())).toEqual({ state: "disabled" });
    expect(await finish(a, token)).toBe(false);
  });
  it.each(["expiry", "lease"])("rolls back a base if %s expires inside the write", async kind => {
    scope.days = scope.days.slice(0, 1);
    if (kind === "expiry") scope.expiresAt = new Date(Date.now() + 2000).toISOString();
    await register(); const token = randomUUID(); await claim(a, token);
    if (kind === "lease") await admin.query("update lean_private.spend_jobs set lease_until=clock_timestamp()+interval '1800 milliseconds'");
    await admin.query(`create or replace function lean_private.fixture_slow() returns trigger language plpgsql as $$
      declare deadline timestamptz; begin
        if new.base is not null and old.base is null then
          ${kind === "expiry" ? "select expires_at into deadline from lean_private.spend_pilots;" : "deadline:=old.lease_until;"}
          perform pg_sleep(greatest(0,extract(epoch from (deadline-clock_timestamp())))+0.02);
        end if; return new;
      end $$;
      create trigger fixture_slow after update on lean_private.spend_jobs for each row execute function lean_private.fixture_slow();`);
    await expect(finish(a, token)).rejects.toThrow("expired during finish");
    expect(await remaining()).toEqual([{ attempts: 1, retained: false }]);
  });
  it("rolls back an attempt when the parent expires during claim", async () => {
    scope.days = scope.days.slice(0, 1); scope.expiresAt = new Date(Date.now() + 2000).toISOString(); await register();
    await admin.query(`create or replace function lean_private.fixture_slow() returns trigger language plpgsql as $$
      declare deadline timestamptz; begin
        select expires_at into deadline from lean_private.spend_pilots;
        perform pg_sleep(greatest(0,extract(epoch from (deadline-clock_timestamp())))+0.02); return new;
      end $$;
      create trigger fixture_slow after update on lean_private.spend_jobs for each row execute function lean_private.fixture_slow();`);
    await expect(claim(a, randomUUID())).rejects.toThrow("expired during claim");
    expect(await remaining()).toEqual([{ attempts: 0, retained: false }]);
  });
});
