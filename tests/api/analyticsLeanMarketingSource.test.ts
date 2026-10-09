import { afterEach, describe, expect, it, vi } from "vitest";
import { nativeMarketing, marketingEnv } from "../fixtures/marketing-source-native.mjs";
import { marketingAdmin, marketingCron, refreshMarketingSource, type MarketingRuntime } from "@/lib/analytics/marketingSourceRefresh";
import { captureMarketingSource, type MarketingProvider, type MarketingClaim } from "@/lib/analytics/marketingSourceCapture";
import { prepareApplicationGoogleReport } from "@/lib/analytics/savedMarketingReport";
import { captureGoogleIndependentControls } from "@/lib/analytics/googleSpendCheck";
import { googleAutomaticSetupCredentials } from "@/lib/analytics/googleAutomaticRuntime";
import { evidenceDigest } from "@/lib/analytics/evidenceIntake";
import type { Row } from "@/lib/analytics/primitives";
const at = "2026-10-08T17:00:00.000Z";
afterEach(() => vi.useRealTimers());
function fixture(provider: MarketingProvider = "google_ads", options: { empty?: boolean; fail?: number;
  retryAfter?: string; commit?: "lost" | "unknown"; state?: string } = {}) {
  vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date(at));
  const c: MarketingClaim = { state: "claimed", jobId: "123", token: "11111111-1111-4111-8111-111111111111",
    provider, date: "2026-10-07", startedAt: at, deadline: "2026-10-08T17:01:30.000Z", attempt: 1 };
  const native = nativeMarketing(options), calls: { name: string; args: Row }[] = [];
  let saved: Row | null = null, consumed = false;
  const r: MarketingRuntime = { env: marketingEnv, now: Date.now, request: native.request as typeof fetch,
    rpc: vi.fn(async (name, args) => {
      calls.push({ name, args });
      if (name === "lean_marketing_source_claim") {
        if (options.state) return { state: options.state };
        if (consumed) return { state: "not_due" }; consumed = true; return c;
      }
      if (name === "lean_marketing_source_commit") {
        saved = { state: "complete", jobId: c.jobId, digest: args.p_digest, packet: args.p_packet, packetHash: "a".repeat(64) };
        if (options.commit) throw new Error("private commit error"); return saved;
      }
      if (name === "lean_marketing_source_read") return options.commit === "unknown" ? null : saved;
      return { state: "failed" };
    }),
  };
  return { c, r, calls, native, saved: () => saved };
}
describe("application marketing source jobs", () => {
  it.each(["synthetic-meta-token", " \tsynthetic-meta-token\r\n"])(
    "accepts only outer Meta token whitespace without changing valid bytes %#", async token => {
      const f = fixture("meta_ads"), original = f.r.request;
      f.r.env = { ...marketingEnv, META_MARKETING_API_TOKEN: token };
      f.r.request = vi.fn(async (url, init) => {
        expect(new Headers(init?.headers).get("authorization")).toBe("Bearer synthetic-meta-token");
        return original(url, init);
      });
      expect((await refreshMarketingSource("meta_ads", "primary", f.r)).body.state).toBe("complete");
      expect(f.native.calls).toHaveLength(3);
      expect(f.calls.map(c => c.name)).toEqual(["lean_marketing_source_claim", "lean_marketing_source_commit"]);
      expect(JSON.stringify(f.calls)).not.toContain("synthetic-meta-token");
    });
  it.each(["", " \r\n\t", "synthetic meta-token", "synthetic\nmeta-token", "synthetic\u0000meta-token",
    " \t" + "x".repeat(4097) + "\r\n"])(
    "refuses invalid normalized Meta token %# before provider HTTP", async token => {
      const f = fixture("meta_ads");
      f.r.env = { ...marketingEnv, META_MARKETING_API_TOKEN: token };
      expect(await refreshMarketingSource("meta_ads", "primary", f.r)).toMatchObject({
        status: 503, body: { state: "failed", code: "configuration_missing" },
      });
      expect(f.native.calls).toHaveLength(0);
      expect(f.calls.map(c => c.name)).toEqual(["lean_marketing_source_claim", "lean_marketing_source_fail"]);
    });
  it.each(["google_ads", "meta_ads"] as const)("captures and registers %s once without old cycles or credentials in receipts", async provider => {
    const f = fixture(provider), result = await refreshMarketingSource(provider, "primary", f.r);
    expect(result).toMatchObject({ status: 200, body: { state: "complete", downstreamImport: "not_observed" } });
    expect(f.native.calls).toHaveLength(provider === "google_ads" ? 7 : 3);
    const commit = f.calls.find(c => c.name === "lean_marketing_source_commit")!.args;
    expect(commit.p_digest).toBe(evidenceDigest({ packet: commit.p_packet, receipts: commit.p_receipts }));
    expect(JSON.stringify(commit)).not.toMatch(/synthetic-(?:meta-token|access-token|developer-token)|PRIVATE KEY|assertion=/);
    expect(f.calls.map(c => c.name)).toEqual(["lean_marketing_source_claim", "lean_marketing_source_commit"]);
    expect((await refreshMarketingSource(provider, "primary", f.r)).body.state).toBe("not_due");
    expect(f.native.calls).toHaveLength(provider === "google_ads" ? 7 : 3);
  });
  it.each(["disabled", "busy", "not_due", "held", "rate_limited"])("%s does not issue provider HTTP", async state => {
    const f = fixture("google_ads", { state }); await refreshMarketingSource("google_ads", "primary", f.r);
    expect(f.native.calls).toHaveLength(0); expect(f.calls).toHaveLength(1);
  });
  it("stores empty Google cost evidence without inventing clicks or relaxing the old automatic adapter", async () => {
    const f = fixture("google_ads", { empty: true }), c = await captureMarketingSource(f.c, f.r);
    const p = c.packet as unknown as { google: Row };
    expect(prepareApplicationGoogleReport(p.google, "fixture")).toMatchObject({
      spend_usd: "0.000000", clicks: null, impressions: null,
    });
    const credentials = googleAutomaticSetupCredentials(marketingEnv);
    await expect(captureGoogleIndependentControls({ ...credentials, fetcher: f.r.request,
      scope: { accountId: "4335795219", loginCustomerId: "9552995078", fromDate: "2026-10-07",
        throughDate: "2026-10-07", includeDeliveryMetrics: true, maxPages: 1, maxRequests: 4,
        deadlineSeconds: 60, approvalRef: "fixture", actorRef: "fixture" },
    })).rejects.toThrow("unverified");
  });
  it("refuses an open NY day before source HTTP", async () => {
    const f = fixture(); f.c.date = "2026-10-08";
    await expect(captureMarketingSource(f.c, f.r)).rejects.toThrow("scope_invalid");
    expect(f.native.calls).toHaveLength(0);
  });
  it("retains safe rate limit deferral; independent Meta failure does not prevent Google success", async () => {
    const f = fixture("meta_ads", { fail: 429, retryAfter: "2400" });
    expect((await refreshMarketingSource("meta_ads", "primary", f.r)).status).toBe(503);
    expect(f.calls.at(-1)).toMatchObject({ name: "lean_marketing_source_fail",
      args: { p_code: "rate_limited", p_retry_seconds: 2400 } });
    expect(f.native.calls).toHaveLength(1);
    const g = fixture();
    expect((await refreshMarketingSource("google_ads", "primary", g.r)).body.state).toBe("complete");
  });
  it.each([
    { status: 503, header: "7200", body: { error: { message: "private" } }, code: "provider_unavailable", delay: 7200 },
    { status: 503, header: "Thu, 08 Oct 2026 19:00:00 GMT", body: {}, code: "provider_unavailable", delay: 7200 },
    { status: 429, header: "9".repeat(400), body: {}, code: "rate_limit_manual", delay: 0 },
    { status: 400, header: null, body: { error: { code: 4, message: "private" } }, code: "rate_limited", delay: 3600 },
    { status: 403, header: "7200", body: { error: { code: 17, message: "private" } }, code: "rate_limited", delay: 7200 },
    { status: 400, header: null, body: { error: { code: 341, message: "rate limit private" } }, code: "schema_changed", delay: 0 },
  ])("bounded transient/header/provider classification %#", async ({ status, header, body, code, delay }) => {
    const f = fixture("meta_ads");
    f.r.request = vi.fn(async () => Response.json(body, { status,
      headers: header === null ? {} : { "Retry-After": header } }));
    const result = await refreshMarketingSource("meta_ads", "primary", f.r);
    expect(result.status).toBe(503);
    expect(f.calls.at(-1)).toMatchObject({ name: "lean_marketing_source_fail",
      args: { p_code: code, p_retry_seconds: delay } });
    expect(f.r.request).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(result) + JSON.stringify(f.calls)).not.toContain("private");
  });
  it.each(["RESOURCE_EXHAUSTED", "RESOURCE_TEMPORARILY_EXHAUSTED", "UNKNOWN_RESOURCE_EXHAUSTED"])(
    "maps only exact documented Google quota enum %s on the Ads endpoint", async quotaError => {
      const f = fixture(), original = f.r.request;
      f.r.request = vi.fn(async (url, init) => String(url).includes("oauth2.googleapis.com") ?
        original(url, init) : Response.json({ error: { details: [{ errors: [
          { errorCode: { quotaError }, message: "private" },
        ] }] } }, { status: 400 }));
      await refreshMarketingSource("google_ads", "primary", f.r);
      expect(f.calls.at(-1)?.args).toMatchObject({ p_code: quotaError.startsWith("UNKNOWN") ? "schema_changed" : "rate_limited",
        p_retry_seconds: quotaError.startsWith("UNKNOWN") ? 0 : 3600 });
      expect(f.r.request).toHaveBeenCalledTimes(2);
      expect(JSON.stringify(f.calls)).not.toContain("private");
    });
  it("oversized error bodies remain unparsed and cannot inject a throttle code", async () => {
    const f = fixture("meta_ads");
    f.r.request = vi.fn(async () => Response.json({ error: { code: 4, message: "x".repeat(17000) } }, { status: 400 }));
    await refreshMarketingSource("meta_ads", "primary", f.r);
    expect(f.calls.at(-1)?.args.p_code).toBe("schema_changed");
    expect(f.r.request).toHaveBeenCalledTimes(1);
  });
  it("a body budget failure cannot shorten an already received Retry-After", async () => {
    const f = fixture("meta_ads");
    f.r.request = vi.fn(async () => new Response("x".repeat(1000001), {
      status: 503, headers: { "Retry-After": "7200" },
    }));
    await refreshMarketingSource("meta_ads", "primary", f.r);
    expect(f.calls.at(-1)?.args).toMatchObject({ p_code: "incomplete_pages", p_retry_seconds: 7200 });
    expect(f.r.request).toHaveBeenCalledTimes(1);
  });
  it.each(["lost", "unknown"] as const)("commit %s only reads the same job, with no recapture or second commit", async commit => {
    const f = fixture("meta_ads", { commit }), result = await refreshMarketingSource("meta_ads", "primary", f.r);
    expect(result.body.state).toBe(commit === "lost" ? "complete" : "held");
    expect(f.native.calls).toHaveLength(3);
    expect(f.calls.filter(c => c.name === "lean_marketing_source_commit")).toHaveLength(1);
    expect(f.calls.filter(c => c.name === "lean_marketing_source_read")).toHaveLength(1);
  });
  it("requires exact cron bearer and explicit primary/correction lane; no user-agent bypass", async () => {
    const f = fixture();
    const req = (auth: string, suffix = "?lane=primary") => new Request(`https://fixture.invalid/cron/google${suffix}`,
      { headers: { authorization: auth, "user-agent": "vercel-cron" } });
    expect((await marketingCron(req(""), "google", f.r)).status).toBe(401);
    expect((await marketingCron(req("Bearer synthetic-cron", "?lane=intraday"), "google", f.r)).status).toBe(400);
    expect(f.calls).toHaveLength(0);
    expect((await marketingCron(req("Bearer synthetic-cron", "?lane=correction"), "google", f.r)).status).toBe(200);
    expect(f.calls[0].args.p_lane).toBe("correction");
  });
  it("admin authentication precedes DB/config/body access and health refuses secret-bearing fields", async () => {
    const factory = vi.fn(() => { throw new Error("must not construct"); });
    expect((await marketingAdmin(new Request("https://fixture.invalid/admin"), async () => null, factory)).status).toBe(401);
    expect(factory).not.toHaveBeenCalled();
    const f = fixture(); f.r.rpc = vi.fn(async () => [
      { provider: "google_ads", downstreamImport: "not_observed", token: "secret" }, {},
    ]);
    const result = await marketingAdmin(new Request("https://fixture.invalid/admin"), async () => ({ uid: "fixture-admin" }), () => f.r);
    expect(result.status).toBe(503); expect(JSON.stringify(result)).not.toContain("secret");
    expect(f.native.calls).toHaveLength(0);
  });
  it("admin pause has no provider call and repair cannot supply credentials or arbitrary URLs", async () => {
    const f = fixture(), admin = async () => ({ uid: "fixture-admin" });
    const req = (body: Row) => new Request("https://fixture.invalid/admin", { method: "POST",
      headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    expect((await marketingAdmin(req({ action: "pause", provider: "meta", reason: "operator pause" }), admin, () => f.r)).status).toBe(200);
    expect(f.calls.at(-1)?.name).toBe("lean_marketing_source_pause"); expect(f.native.calls).toHaveLength(0);
    expect((await marketingAdmin(req({ action: "retry", provider: "meta", date: "2026-10-07",
      reason: "rotated credential", token: "secret" }), admin, () => f.r)).status).toBe(400);
  });
});
