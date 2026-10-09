import { describe, expect, it, vi } from "vitest";
import { runMetaSourceIngestion, type MetaSourceRuntime } from "@/lib/analytics/metaSourceIngestion";

const ACCOUNT = "2796962933960445", TOKEN = "synthetic-meta-token";
function setup(options: { empty?: boolean; failAt?: number; paging?: boolean; overflow?: boolean } = {}) {
  let clock = Date.parse("2026-10-08T17:00:00Z"), count = 0, registered = 0;
  const consumed = new Set<string>(), meta: Record<string, unknown> = {}, requests: { url: string; init: RequestInit }[] = [];
  const r: MetaSourceRuntime = {
    env: { NODE_ENV: "test", CRON_SECRET: "synthetic-cron-secret", META_MARKETING_API_TOKEN: TOKEN,
      META_AD_ACCOUNT_ID: `act_${ACCOUNT}\n`, VERCEL_ENV: "production", VERCEL_GIT_COMMIT_REF: "main" },
    now: () => clock,
    request: vi.fn(async (input, init) => {
      const url = String(input); requests.push({ url, init: init! }); count++; clock += 10;
      if (options.failAt === count) throw new Error(`private ${TOKEN}`);
      if (options.overflow) return new Response("x".repeat(1000001));
      const query = new URL(url).searchParams, level = query.get("level");
      if (!level) return Response.json({ id: `act_${ACCOUNT}`, account_id: ACCOUNT, currency: "USD",
        timezone_name: "America/Los_Angeles", account_status: 1, business: { name: `discard ${TOKEN}` } });
      return Response.json({ data: options.empty ? [] : [{ account_id: ACCOUNT, account_currency: "USD",
        date_start: "2026-10-07", date_stop: "2026-10-07",
        hourly_stats_aggregated_by_advertiser_time_zone: "12:00:00 - 12:59:59", spend: "3.04",
        ...(level === "campaign" ? { campaign_id: "123" } : {}) }],
        ...(options.paging ? { paging: { next: `https://bad.invalid/?secret=${TOKEN}` } } : {}) });
    }),
    runJob: vi.fn(async (name, fn) => {
      if (consumed.has(name)) throw new Error("duplicate"); consumed.add(name);
      try { return { ok: true, result: await fn({ runId: 12,
        setMeta: (value: Record<string, unknown>) => Object.assign(meta, value),
        bumpRows: (input: number, output: number) => Object.assign(meta, { input, output }) }) }; }
      catch (e) { return { ok: false, error: (e as Error).message }; }
    }),
    readJob: vi.fn(async () => ({ id: 12, job_name: "meta-source:2026-10-07", status: "running",
      started_at: "2026-10-08T16:59:59.000000+00:00" })),
    register: vi.fn(async args => {
      registered++;
      return { state: "source_registered", generationId: "meta_ingest_daily_2026-10-07",
        enabled: false, packetHash: "a".repeat(64), packetHashValid: true, packet: args.p_packet };
    }),
  };
  const request = (auth = "Bearer synthetic-cron-secret", suffix = "?source_only=1") =>
    new Request("https://www.mullybox.com/api/admin/cron/meta-ads-spend" + suffix,
      { headers: { authorization: auth, "user-agent": "vercel-cron" } });
  return { r, request, meta, requests, consumed, calls: () => count, writes: () => registered };
}
describe("Meta daily source-only ingestion", () => {
  it("registers source/control through the fixed RPC, retaining safe receipts without legacy/PostHog calls", async () => {
    const f = setup(), result = await runMetaSourceIngestion(f.request(), f.r);
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ ok: true, result: { state: "source_registered",
      reportDate: "2026-10-07", enabled: false, sourceRows: 1, controlRows: 1 } });
    expect(f.calls()).toBe(3); expect(f.writes()).toBe(1);
    expect(f.r.register).toHaveBeenCalledWith(expect.objectContaining({
      p_job: 12, p_packet: expect.objectContaining({ accountId: `act_${ACCOUNT}`,
        source: expect.objectContaining({ rows: [expect.objectContaining({ spend: "3.04" })] }) }),
    }));
    expect(f.meta.output).toBe(1);
    expect(JSON.stringify(result) + JSON.stringify(f.meta)).not.toContain(TOKEN);
    for (const r of f.requests) {
      expect(r.url).toMatch(/^https:\/\/graph.facebook.com\/v25.0\/act_2796962933960445/);
      expect(r.url).not.toContain(TOKEN); expect(r.init.redirect).toBe("error");
      expect(r.init.headers).toEqual({ Authorization: `Bearer ${TOKEN}` });
    }
  });
  it("persists a genuine complete-empty source packet instead of suppressing zero-spend days", async () => {
    const f = setup({ empty: true }), result = await runMetaSourceIngestion(f.request(), f.r);
    expect(result.body).toMatchObject({ ok: true, result: { verifiedEmpty: true, sourceRows: 0, controlRows: 0 } });
    expect(f.meta.output).toBe(1);
  });
  it("consumes a job/date before HTTP, including an ambiguous failure, with no retry", async () => {
    const f = setup({ failAt: 3 });
    const failed = await runMetaSourceIngestion(f.request(), f.r);
    expect(failed.status).toBe(503);
    expect(failed.body).toEqual({ ok: false, error: "meta_source_refused" });
    expect((await runMetaSourceIngestion(f.request(), f.r)).status).toBe(409);
    expect(f.calls()).toBe(3); expect(f.writes()).toBe(0);
  });
  it("does not accept the old cron user-agent authentication fallback", async () => {
    const f = setup();
    expect((await runMetaSourceIngestion(f.request(""), f.r)).status).toBe(401);
    expect(f.consumed.size).toBe(0); expect(f.calls()).toBe(0);
  });
  it.each(["?source_only=1&date=2026-09-29", "?source_only=1&source_only=1", "?source_only=0"])(
    "refuses request scope %s before claiming", async suffix => {
      const f = setup(); expect((await runMetaSourceIngestion(f.request(undefined, suffix), f.r)).status).toBe(400);
      expect(f.consumed.size).toBe(0);
    });
  it.each(["preview", "account", "token"])("refuses configuration %s without source calls", async bad => {
    const f = setup();
    if (bad === "preview") f.r.env.VERCEL_ENV = "preview";
    if (bad === "account") f.r.env.META_AD_ACCOUNT_ID = "999";
    if (bad === "token") f.r.env.META_MARKETING_API_TOKEN = TOKEN + "\n";
    expect((await runMetaSourceIngestion(f.request(), f.r)).status).toBe(503);
    expect(f.calls()).toBe(0);
  });
  it.each(["paging", "overflow"] as const)("refuses %s without persistence or retry", async bad => {
    const f = setup({ [bad]: true }), result = await runMetaSourceIngestion(f.request(), f.r);
    expect(result.body).toEqual({ ok: false, error: "meta_source_refused" });
    expect(f.writes()).toBe(0); expect(f.calls()).toBe(bad === "paging" ? 2 : 1);
    expect(f.requests.at(-1)?.init.signal?.aborted).toBe(true);
  });
  it("requires own running job and exact packet readback", async () => {
    const f = setup();
    f.r.readJob = vi.fn(async () => ({ id: 12, job_name: "other", status: "running",
      started_at: "2026-10-08T16:59:59Z" }));
    expect((await runMetaSourceIngestion(f.request(), f.r)).body).toEqual({ ok: false, error: "meta_source_refused" });
    expect(f.calls()).toBe(0);
    const next = setup();
    next.r.register = vi.fn(async () => ({ state: "source_registered", generationId: "meta_ingest_daily_2026-10-07",
      enabled: false, packetHash: "a".repeat(64), packetHashValid: true, packet: {} }));
    expect((await runMetaSourceIngestion(next.request(), next.r)).body).toEqual({ ok: false, error: "meta_source_refused" });
  });
  it("bounds a fetch that never resolves and does not emit its secret", async () => {
    vi.useFakeTimers();
    try {
      const f = setup(); f.r.request = vi.fn(() => new Promise<Response>(() => {}));
      const pending = runMetaSourceIngestion(f.request(), f.r);
      await vi.advanceTimersByTimeAsync(15000);
      expect((await pending).body).toEqual({ ok: false, error: "meta_source_refused" });
      expect(f.r.request).toHaveBeenCalledTimes(1); expect(f.writes()).toBe(0);
    } finally { vi.useRealTimers(); }
  });
  it("dispatches the real existing route to the source RPC, without legacy tables or PostHog", async () => {
    const f = setup({ empty: true }), legacy = vi.fn(() => { throw new Error("legacy branch called"); });
    vi.doMock("@/app/api/admin/cron/_lib/postAdSpendToPostHog", () => ({ postAdSpendToPostHog: legacy }));
    vi.doMock("@/app/api/_lib/supabaseService", () => ({
      withJobRun: f.r.runJob, getSupabaseService: () => ({
        from: (table: string) => {
          expect(table).toBe("job_runs");
          return { select: () => ({ eq: (_key: string, id: number) => ({
            single: async () => ({ data: await f.r.readJob(id), error: null }),
          }) }) };
        },
        rpc: async (name: string, args: Parameters<MetaSourceRuntime["register"]>[0]) => {
          expect(name).toBe("lean_meta_source_register");
          return { data: await f.r.register(args), error: null };
        },
      }),
    }));
    for (const [key, value] of Object.entries(f.r.env)) vi.stubEnv(key, value);
    vi.stubGlobal("fetch", f.r.request);
    const clock = vi.spyOn(Date, "now").mockImplementation(f.r.now);
    try {
      const { NextRequest } = await import("next/server");
      const { GET } = await import("@/app/api/admin/cron/meta-ads-spend/route");
      const result = await GET(new NextRequest(f.request()));
      expect(result.status).toBe(200);
      expect(await result.json()).toMatchObject({ ok: true, result: { state: "source_registered", verifiedEmpty: true } });
      expect(f.writes()).toBe(1); expect(legacy).not.toHaveBeenCalled();
    } finally {
      clock.mockRestore(); vi.unstubAllGlobals(); vi.unstubAllEnvs();
      vi.doUnmock("@/app/api/_lib/supabaseService");
      vi.doUnmock("@/app/api/admin/cron/_lib/postAdSpendToPostHog");
    }
  });
});
