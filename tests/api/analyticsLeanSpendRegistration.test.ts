import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { prepareFreshGoogleSpend, inspectFreshGoogleSpend, advanceFreshGoogleSpend,
  type FreshGoogleSpendManifest } from "@/lib/analytics/googleSpendRegistration";
import type { SpendBase } from "@/lib/analytics/spend";
import type { AnalyticsRpcClient } from "@/lib/analytics/rpcStore";
import { prepareGoogleSpendFile } from "../../scripts/analytics/prepare-google-spend.mjs";

// Synthetic January fixtures only. No real account, approved scope or credentials.
const now = "2026-01-15T12:00:00.000Z";
const manifest = (): FreshGoogleSpendManifest => ({
  version: 1, projectRef: "a".repeat(20), accountId: "1234567890", loginCustomerId: null,
  approvalRef: "fixture:approval", actorRef: "fixture:actor", revisionRef: "fixture:revision:1",
  credentialBindingRef: "fixture:binding-reference-only", coverage: "whole_account_campaign_day",
  sourceCurrency: "USD", sourceTimezone: "America/New_York",
  preparedAt: "2026-01-15T09:00:00Z", freshnessCutoffAt: "2026-01-15T10:00:00Z",
  expiresAt: "2026-01-17T12:00:00Z", maxPages: 2, maxRequestsPerDay: 4, deadlineSeconds: 10,
  days: [{ date: "2026-01-14", dueAt: "2026-01-15T10:00:00Z" },
    { date: "2026-01-15", dueAt: "2026-01-16T10:00:00Z" }],
});
const base = (m = manifest()): SpendBase => {
  const day = prepareFreshGoogleSpend(m).registration.args.p_scope.days[0];
  return { provider: "google_ads", accountId: m.accountId, date: day.date, baseReportId: day.runId,
    sourceTimezone: m.sourceTimezone, sourceCurrency: m.sourceCurrency, completedAt: now,
    paginationComplete: true, verifiedEmpty: false, evidenceRef: `lean_private.spend_jobs/${day.runId}`,
    rows: [{ campaignId: "1", costMicros: "1234567" }] };
};
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(now);
  vi.stubGlobal("fetch", () => { throw new Error("external_network_forbidden"); });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

it("prepares canonical disabled 038 inputs; policy/revision changes get new identities", () => {
  const m = manifest(), prepared = prepareFreshGoogleSpend(m);
  const reordered = Object.fromEntries(Object.entries(m).reverse());
  reordered.preparedAt = "2026-01-15T09:00:00.000Z";
  expect(prepareFreshGoogleSpend(reordered)).toEqual(prepared);
  expect(prepared).toMatchObject({ state: "prepared", enabled: false, registered: false, publication: false,
    bounds: { days: 2, sourceRequests: 8, attemptsPerDay: 1, deadlineSecondsPerAdvance: 10 } });
  expect(prepared.registration.rpc).toBe("lean_spend_pilot_register");
  expect(prepared.registration.args.p_scope.days[0].runId.length).toBeLessThanOrEqual(128);
  for (const change of [{ revisionRef: "fixture:revision:2" }, { sourceCurrency: "EUR" },
    { maxRequestsPerDay: 5 }, { credentialBindingRef: "fixture:other-binding" }])
    expect(prepareFreshGoogleSpend({ ...m, ...change }).manifestSha256).not.toBe(prepared.manifestSha256);
  expect(m.days[0]).not.toHaveProperty("runId");
});

it.each([
  { enabled: true }, { accountId: "123" }, { loginCustomerId: "wrong" }, { sourceTimezone: "invalid/zone" },
  { sourceCurrency: "usd" }, { coverage: "sampled_campaigns" }, { approvalRef: "" },
  { credentialBindingRef: "" }, { maxPages: 6 }, { maxRequestsPerDay: 3 }, { deadlineSeconds: 91 },
  { days: [] }, { days: Array(8).fill(manifest().days[0]) }, { days: [...manifest().days].reverse() },
  { days: [manifest().days[0], manifest().days[0]] }, { expiresAt: "2026-02-01T12:00:00Z" },
  { expiresAt: "2026-01-15T09:00:00Z" }, { freshnessCutoffAt: "2026-01-15T08:00:00Z" },
  { preparedAt: "2026-01-15T09:00:00" }, { preparedAt: "2026-02-30T09:00:00Z" },
  { freshnessCutoffAt: "2026-01-15T10:00:00.000001Z" },
  { days: [{ date: "2026-01-14", dueAt: "2026-01-15T10:00:00Z", runId: "old-job" }] },
])("rejects malformed, widened, reused-ID or over-budget manifest %j", change => {
  expect(() => prepareFreshGoogleSpend({ ...manifest(), ...change })).toThrow();
});

it.each([
  ["2026-03-08", "2026-03-09T03:59:59Z", "2026-03-09T04:00:00Z"],
  ["2026-11-01", "2026-11-02T04:59:59Z", "2026-11-02T05:00:00Z"],
])("uses exact closed-day DST boundary for %s", (date, openAt, closedAt) => {
  const m = { ...manifest(), preparedAt: `${date}T06:00:00Z`,
    freshnessCutoffAt: `${date}T06:00:00Z`, expiresAt: `${closedAt.slice(0, 10)}T12:00:00Z`,
    days: [{ date, dueAt: openAt }] };
  expect(() => prepareFreshGoogleSpend(m)).toThrow("manifest_day");
  expect(prepareFreshGoogleSpend({ ...m, days: [{ date, dueAt: closedAt }] }).state).toBe("prepared");
});

it("also waits for the source timezone day to close, without guessing a USD conversion", () => {
  const m = { ...manifest(), sourceTimezone: "America/Los_Angeles", sourceCurrency: "EUR",
    preparedAt: "2026-01-15T04:00:00Z", freshnessCutoffAt: "2026-01-15T05:00:00Z",
    days: [{ date: "2026-01-14", dueAt: "2026-01-15T07:59:59Z" }] };
  expect(() => prepareFreshGoogleSpend(m)).toThrow("manifest_day");
  m.days[0].dueAt = "2026-01-15T08:00:00Z";
  expect(inspectFreshGoogleSpend(m, [base(m)], now)[0]).toMatchObject({
    state: "complete", sourceMicros: "1234567", usdEligible: false, salesCompatibility: "unverified" });
});

it("distinguishes missing, not due, incomplete, stale and complete zero without certifying them", () => {
  expect(inspectFreshGoogleSpend(manifest(), [], now).map(r => r.state)).toEqual(["missing", "not_due"]);
  const zero = { ...base(), rows: [], verifiedEmpty: true };
  expect(inspectFreshGoogleSpend(manifest(), [zero], now)[0]).toMatchObject({
    state: "complete_zero", sourceMicros: "0", independentReconciliation: "unverified",
    certification: "unverified", delivery: "unverified" });
  for (const b of [{ ...zero, verifiedEmpty: false }, { ...zero, paginationComplete: false }])
    expect(inspectFreshGoogleSpend(manifest(), [b], now)[0]).toMatchObject({ state: "incomplete", sourceMicros: null });
  expect(inspectFreshGoogleSpend(manifest(), [{ ...base(), completedAt: "2026-01-15T09:59:59Z" }], now)[0])
    .toMatchObject({ state: "stale", sourceMicros: null });
  expect(inspectFreshGoogleSpend(manifest(), [{ ...base(), completedAt: "2026-01-15T10:00:00Z" }], now)[0].state)
    .toBe("complete");
  expect(inspectFreshGoogleSpend(manifest(), [base()], "2026-01-17T12:00:00Z")[0])
    .toMatchObject({ state: "stale", sourceMicros: null });
});

it("deduplicates identical retained inputs and rejects conflicting/out-of-scope/future evidence", () => {
  const b = base();
  expect(inspectFreshGoogleSpend(manifest(), [b, structuredClone(b)], now)[0].sourceMicros).toBe("1234567");
  expect(() => inspectFreshGoogleSpend(manifest(), [b, { ...b, rows: [] }], now)).toThrow("conflicting");
  for (const change of [{ accountId: "9876543210" }, { sourceCurrency: "EUR" }, { sourceTimezone: "UTC" },
    { baseReportId: "historical-job" }, { date: "2026-01-13" }, { evidenceRef: "operator-assertion" },
    { completedAt: "2026-01-15T12:00:01Z" }, { rows: [{ campaignId: "1", costMicros: "-1" }] }])
    expect(() => inspectFreshGoogleSpend(manifest(), [{ ...b, ...change }], now)).toThrow();
});

/** Retain only the RPC state seam here. Production code still uses 038's own
 * atomic claims/leases; this test does not simulate or prove database locking.
 */
function runtime(m = manifest()) {
  const scope = prepareFreshGoogleSpend(m).registration.args.p_scope;
  let retained: SpendBase | undefined;
  const rpc = vi.fn<AnalyticsRpcClient["rpc"]>(async (name, args) => {
    if (name === "lean_spend_pilot_next") return { error: null, data: retained
      ? { state: "complete" } : { state: "ready", runId: scope.days[0].runId, accountId: m.accountId } };
    if (name === "lean_spend_claim") return { error: null, data: { state: "claimed",
      accountId: m.accountId, loginCustomerId: m.loginCustomerId, date: scope.days[0].date,
      maxPages: m.maxPages, approvalRef: m.approvalRef } };
    if (name === "lean_spend_finish") retained = args.p_base as SpendBase;
    return { error: null, data: true };
  });
  const fetcher = vi.fn<typeof fetch>(async (url, init) => {
    if (url === "https://oauth2.googleapis.com/token")
      return Response.json({ access_token: "fixture", token_type: "Bearer" });
    const query = JSON.parse(String(init?.body)).query;
    return query.includes("FROM customer")
      ? Response.json({ results: [{ customer: { id: m.accountId, currencyCode: m.sourceCurrency, timeZone: m.sourceTimezone } }] })
      : Response.json({ fieldMask: "campaign.id,segments.date,metrics.costMicros,metrics.clicks,metrics.impressions", results: [] });
  });
  return { rpc, fetcher, options: { manifest: m, client: { rpc }, fetcher,
    databaseUrl: `https://${m.projectRef}.supabase.co`,
    auth: { mode: "oauth_refresh" as const, clientId: "fixture", clientSecret: "fixture", refreshToken: "fixture" } } };
}

it("is default-off with no RPC/source calls; expired, aborted and wrong-target fail before calls", async () => {
  const r = runtime();
  expect(await advanceFreshGoogleSpend(r.options)).toEqual({ state: "disabled" });
  await expect(advanceFreshGoogleSpend({ ...r.options, enabled: true, signal: AbortSignal.abort() })).rejects.toThrow();
  await expect(advanceFreshGoogleSpend({ ...r.options, enabled: true, databaseUrl: "https://wrong.invalid" })).rejects.toThrow();
  vi.setSystemTime("2026-01-17T12:00:00Z");
  expect(await advanceFreshGoogleSpend({ ...r.options, enabled: true })).toEqual({ state: "expired" });
  expect(r.rpc).not.toHaveBeenCalled(); expect(r.fetcher).not.toHaveBeenCalled();
});

it("connects the real bounded reader and job runner, retaining a verified empty response once", async () => {
  const r = runtime();
  expect(await advanceFreshGoogleSpend({ ...r.options, enabled: true })).toEqual({ state: "complete", rows: 0 });
  expect(await advanceFreshGoogleSpend({ ...r.options, enabled: true })).toEqual({ state: "complete" });
  expect(r.fetcher).toHaveBeenCalledTimes(3);
  const finish = r.rpc.mock.calls.find(([name]) => name === "lean_spend_finish")![1].p_base as SpendBase;
  expect(inspectFreshGoogleSpend(manifest(), [finish], now)[0].state).toBe("complete_zero");
});

it("rejects a database next/claim that differs from the approved manifest before source calls", async () => {
  for (const name of ["lean_spend_pilot_next", "lean_spend_claim"]) {
    const r = runtime(), original = r.rpc.getMockImplementation()!;
    r.rpc.mockImplementation(async (n, args) => {
      const result = await original(n, args);
      return n === name ? { ...result, data: { ...result.data as object, accountId: "9876543210" } } : result;
    });
    await expect(advanceFreshGoogleSpend({ ...r.options, enabled: true })).rejects.toThrow();
    expect(r.fetcher).not.toHaveBeenCalled();
  }
});

it("rejects changed account metadata before finish, and never retries an ambiguous finish", async () => {
  const r = runtime(), original = r.fetcher.getMockImplementation()!;
  r.fetcher.mockImplementation(async (url, init) => {
    const response = await original(url, init);
    const body = await response.json();
    if (body.results?.[0]?.customer) body.results[0].customer.currencyCode = "EUR";
    return Response.json(body);
  });
  await expect(advanceFreshGoogleSpend({ ...r.options, enabled: true })).rejects.toThrow();
  expect(r.rpc.mock.calls.some(([n]) => n === "lean_spend_finish")).toBe(false);
  const s = runtime(), originalRpc = s.rpc.getMockImplementation()!;
  s.rpc.mockImplementation(async (name, args) => {
    const result = await originalRpc(name, args);
    if (name === "lean_spend_finish") throw new Error("ambiguous");
    return result;
  });
  await expect(advanceFreshGoogleSpend({ ...s.options, enabled: true })).rejects.toThrow();
  expect(s.rpc.mock.calls.some(([n]) => n === "lean_spend_fail")).toBe(false);
  expect(await advanceFreshGoogleSpend({ ...s.options, enabled: true })).toEqual({ state: "complete" });
  expect(s.fetcher).toHaveBeenCalledTimes(3);
});

it("treats a malformed empty source response as failed, not zero", async () => {
  const r = runtime(), original = r.fetcher.getMockImplementation()!;
  r.fetcher.mockImplementation(async (url, init) =>
    String(init?.body).includes("FROM campaign") ? Response.json({}) : original(url, init));
  expect(await advanceFreshGoogleSpend({ ...r.options, enabled: true })).toEqual({ state: "failed" });
  expect(r.rpc.mock.calls.some(([n]) => n === "lean_spend_finish")).toBe(false);
});

it("stops at the approved page/request bound without retaining partial rows", async () => {
  const r = runtime(), original = r.fetcher.getMockImplementation()!;
  let pages = 0;
  r.fetcher.mockImplementation(async (url, init) =>
    String(init?.body).includes("FROM campaign") ? Response.json({
      fieldMask: "campaign.id,segments.date,metrics.costMicros,metrics.clicks,metrics.impressions",
      results: [{ campaign: { id: String(++pages) }, segments: { date: "2026-01-14" },
        metrics: { costMicros: "1" } }], nextPageToken: `fixture:${pages}`,
    }) : original(url, init));
  expect(await advanceFreshGoogleSpend({ ...r.options, enabled: true })).toEqual({ state: "failed" });
  expect(r.fetcher).toHaveBeenCalledTimes(4);
  expect(r.rpc.mock.calls.some(([n]) => n === "lean_spend_finish")).toBe(false);
});

it("makes no further source calls or finish after absolute expiry during collection", async () => {
  const r = runtime(), original = r.fetcher.getMockImplementation()!;
  r.fetcher.mockImplementation(async (url, init) => {
    const response = await original(url, init);
    vi.setSystemTime("2026-01-17T12:00:00Z");
    return response;
  });
  await expect(advanceFreshGoogleSpend({ ...r.options, enabled: true })).rejects.toThrow();
  expect(r.fetcher).toHaveBeenCalledTimes(1);
  expect(r.rpc.mock.calls.some(([n]) => n === "lean_spend_finish")).toBe(false);
});

it("compiles a local manifest with the offline CLI, without reading environment credentials or using fetch", () => {
  const dir = mkdtempSync(join(tmpdir(), "fresh-spend-fixture-"));
  try {
    const path = join(dir, "manifest.json");
    writeFileSync(path, JSON.stringify(manifest()));
    expect(prepareGoogleSpendFile(path)).toEqual(prepareFreshGoogleSpend(manifest()));
    writeFileSync(path, " ".repeat(16385));
    expect(() => prepareGoogleSpendFile(path)).toThrow("too_large");
  } finally { rmSync(dir, { recursive: true, force: true }); }
}, 30000);
