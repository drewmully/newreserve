import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { pullTrafficPosthog, trafficPosthogDiagnostic, trafficPosthogQuery, trafficWindow } from "@/lib/analytics/trafficSourcePull";
import { GET } from "@/app/api/admin/cron/traffic-pull/route";

const port = vi.hoisted(() => ({ writes: [] as unknown[], meta: {} as Record<string, unknown>, status: "", rows: 0 }));
vi.mock("@/lib/analytics/journeyNativeFilterConfig", () => ({
  nativeEntryFilterSha256: "61504f7e32de2ff2d4197a26e25ba57f412891b9c03e6d27b3ef7568e3829819",
  nativeFilterRules: (env: NodeJS.ProcessEnv) => env.LEAN_POSTHOG_TEST_ACCOUNT_FILTERS === "synthetic-fixed-config"
    ? { hostRegex: "^(localhost|127\\.0\\.0\\.1)($|:)",
      negativeEmailValues: ["one.invalid", "two.invalid", "three.invalid", "four.invalid", "five.invalid"] } : null,
}));
vi.mock("@/app/api/_lib/supabaseService", () => ({
  getSupabaseService: () => ({ from: (table: string) => ({ upsert: async (rows: unknown, options: unknown) => {
    port.writes.push({ table, rows, options }); return { error: null };
  } }) }),
  withJobRun: async (_name: string, fn: (ctx: { setMeta: (v: Record<string, unknown>) => void;
    bumpRows: (a: number, b: number) => void }) => unknown) => {
    try {
      const result = await fn({ setMeta: v => { port.meta = v; }, bumpRows: (_a, b) => { port.rows = b; } });
      port.status = "ok"; return { ok: true, runId: 1, result };
    } catch { port.status = "error"; return { ok: false, runId: 1, error: "traffic_pull_source_unavailable" }; }
  },
}));
const now = Date.parse("2026-10-08T17:00:00Z"), columns = ["day", "visitors", "accounts_created", "purchases"];
const env = () => ({ NODE_ENV: "test" as const, LEAN_POSTHOG_PROJECT_ID: "353503",
  LEAN_POSTHOG_QUERY_READ_KEY: "synthetic-read-secret", LEAN_POSTHOG_TEST_ACCOUNT_FILTERS: "synthetic-fixed-config" });
const response = (results: unknown[] = [["2026-10-07", 12, 0, 2]]) => Response.json({ columns, results });
const read = (request: typeof fetch) => pullTrafficPosthog("2026-10-07", "2026-10-08", env(), request, () => now);
beforeEach(() => { port.writes = []; port.meta = {}; port.status = ""; port.rows = 0; });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

it("uses the manual page_view event, fixed six predicates and half-open UTC bounds", () => {
  const query = trafficPosthogQuery("2026-10-07", "2026-10-08", env());
  expect(query).toContain("event = 'page_view'"); expect(query).not.toContain("$pageview");
  expect(query).toContain("SELECT toString(toDate(toTimeZone(timestamp, 'UTC'))) AS day");
  expect(query).not.toContain("toDate(timestamp, 'UTC')");
  expect(query).toContain("timestamp >= toDateTime('2026-10-07 00:00:00', 'UTC')");
  expect(query).toContain("timestamp < toDateTime('2026-10-08 00:00:00', 'UTC')");
  expect(query.match(/positionCaseInsensitive/g)).toHaveLength(5);
  expect(query).toContain("JSONType(properties, '$host')");
  expect(query).not.toMatch(/SELECT.*email|SELECT.*distinct_id/);
});
it("makes one bounded request and stores aggregates with hashes, not private filters or IDs", async () => {
  const request = vi.fn(async () => response()), rows = await read(request);
  expect(request).toHaveBeenCalledTimes(1);
  expect(request.mock.calls[0]?.length).toBe(2);
  expect(rows.map(r => [r.metric, r.value])).toEqual([["visitors", 12], ["accounts_created", 0], ["purchases", 2]]);
  const json = JSON.stringify(rows);
  expect(json).toContain("recorded_purchase_events_not_paid_orders");
  expect(json).not.toMatch(/one\.invalid|synthetic-read-secret|person\.properties/);
});
it("fills zero only for a complete empty provider response", async () => {
  const rows = await read(async () => response([]));
  expect(rows).toHaveLength(3); expect(rows.every(r => r.value === 0)).toBe(true);
});
it.each([
  { columns, results: [], error: "private error" }, { columns, results: [], is_cached: true },
  { columns, results: [], hasMore: true }, { columns, results: [], query_status: { complete: false } },
  { columns: ["wrong"], results: [] }, { columns },
  { columns, results: [["2026-10-07", "12", 0, 1]] },
  { columns, results: [["2026-10-08", 12, 0, 1]] },
  { columns, results: [["2026-10-07", -1, 0, 1]] },
  { columns, results: [["2026-10-07", 1, 0, 1], ["2026-10-07", 1, 0, 1]] },
])("refuses incomplete, stale or malformed response without zero-writing: %j", body =>
  expect(read(async () => Response.json(body))).rejects.toThrow("traffic_posthog_unavailable"));
it("does not reflect provider errors and enforces bytes", async () => {
  await expect(read(async () => new Response("sensitive-provider-value", { status: 503 }))).rejects.toThrow(/^traffic_posthog_unavailable$/);
  await expect(read(async () => new Response(" ".repeat(65537)))).rejects.toThrow("traffic_posthog_unavailable");
});
it("refuses missing or changed configuration without a generic key fallback", async () => {
  const request = vi.fn(async () => response()), e = env(); e.LEAN_POSTHOG_TEST_ACCOUNT_FILTERS = "bad";
  await expect(pullTrafficPosthog("2026-10-07", "2026-10-08", e, request, () => now)).rejects.toThrow();
  expect(request).not.toHaveBeenCalled();
  const changed = env();
  await expect(pullTrafficPosthog("2026-10-07", "2026-10-08", changed, async () => {
    changed.LEAN_POSTHOG_QUERY_READ_KEY = "changed"; return response();
  }, () => now)).rejects.toThrow("traffic_posthog_unavailable");
});
it("bounds the provider and body wait to ten seconds without retry", async () => {
  vi.useFakeTimers(); const request = vi.fn(() => new Promise<Response>(() => {}));
  const pending = expect(read(request)).rejects.toThrow("traffic_posthog_unavailable");
  await vi.advanceTimersByTimeAsync(10000); await pending; expect(request).toHaveBeenCalledTimes(1);
});
it("uses only closed UTC days and rejects expanded or malformed windows", () => {
  expect(trafficWindow(now, null)).toEqual({ from: "2026-09-24", until: "2026-10-08", through: "2026-10-07", days: 14 });
  for (const value of ["0", "15", "-1", "1.5", "1';SELECT", "01", ""]) expect(() => trafficWindow(now, value)).toThrow();
});
function request(query = "?days=1", headers: Record<string, string> = { authorization: "Bearer operator-secret" }) {
  return new NextRequest(`https://www.mymully.com/api/admin/cron/traffic-pull${query}`, { headers });
}
function routeEnv() { Object.assign(process.env, env(), { CRON_SECRET: "operator-secret" }); vi.spyOn(Date, "now").mockReturnValue(now); }
it("writes through the existing table and reports successful source rows", async () => {
  routeEnv(); vi.stubGlobal("fetch", vi.fn(async () => response()));
  const result = await GET(request());
  expect(result.status).toBe(200); expect(port.status).toBe("ok"); expect(port.rows).toBe(3);
  expect(port.writes[0]).toMatchObject({ table: "traffic_pulls", options: { onConflict: "pull_date,source,metric" } });
  expect(port.meta).toMatchObject({ range: ["2026-10-07", "2026-10-07"], timezone: "UTC", ga4_rows: 0, posthog_rows: 3 });
});
it("records provider failure as error/503, not an ok empty source", async () => {
  routeEnv(); vi.stubGlobal("fetch", vi.fn(async () => new Response("sensitive", { status: 503 })));
  const result = await GET(request());
  expect(result.status).toBe(503); expect(port.status).toBe("error"); expect(port.writes).toEqual([]);
  expect(port.meta.posthog_error).toBe("source_unavailable"); expect(await result.text()).not.toContain("sensitive");
});
it.each([
  [400, "validation_error", "invalid_input"],
  [403, "permission_denied", "permission_denied"],
  [429, "throttled", "throttled"],
] as const)("propagates only known provider classification for HTTP %i to job and response", async (status, type, code) => {
  routeEnv(); const sensitive = "synthetic-private-detail-one.invalid-synthetic-read-secret";
  const fetcher = vi.fn(async () => Response.json({ type, code, detail: sensitive,
    error: sensitive, query: sensitive, headers: { authorization: sensitive } }, { status }));
  vi.stubGlobal("fetch", fetcher);
  const result = await GET(request()), body = await result.json();
  const diagnostic = { reason: "http_error", httpStatus: status, providerType: type, providerCode: code };
  expect(result.status).toBe(503); expect(body.posthog_diagnostic).toEqual(diagnostic);
  expect(port.meta.posthog_diagnostic).toEqual(diagnostic); expect(port.status).toBe("error");
  expect(port.writes).toEqual([]); expect(port.rows).toBe(0); expect(fetcher).toHaveBeenCalledTimes(1);
  expect(JSON.stringify([body, port.meta])).not.toMatch(/synthetic-private|one\.invalid|synthetic-read-secret|authorization|query/);
});
it("does not reflect unknown provider type/code, exception messages or forged diagnostics", async () => {
  const error = await read(async () => Response.json({ type: "private-type", code: "private-code", detail: "private-detail" },
    { status: 400 })).catch(e => e);
  expect(trafficPosthogDiagnostic(error)).toEqual({ reason: "http_error", httpStatus: 400,
    providerType: "other", providerCode: "other" });
  const network = await read(async () => { throw Object.assign(new Error("private-network"),
    { reason: "private-reason", status: 403, providerCode: "private-code" }); }).catch(e => e);
  expect(trafficPosthogDiagnostic(network)).toEqual({ reason: "transport", httpStatus: null,
    providerType: null, providerCode: null });
  expect(trafficPosthogDiagnostic(Object.assign(new Error("private"), { reason: "http_error", httpStatus: 400 })))
    .toEqual({ reason: "unclassified", httpStatus: null, providerType: null, providerCode: null });
});
it.each([
  [{ columns, results: [], is_cached: true }, "cached_response"],
  [{ columns, results: [], hasMore: true }, "pagination"],
  [{ columns, results: [], query_status: { complete: false } }, "query_incomplete"],
  [{ columns, results: [], error: "private" }, "provider_error"],
  [{ columns, results: [], query_status: { complete: true, error: "private" } }, "provider_error"],
  [{ columns: ["private"], results: [] }, "columns"],
  [{ columns, results: "private" }, "results_shape"],
  [{ columns, results: [["2026-10-07", "private", 0, 0]] }, "row_shape"],
])("distinguishes refused 200 response without reflecting payload: %j", async (body, reason) => {
  const error = await read(async () => Response.json(body)).catch(e => e);
  expect(trafficPosthogDiagnostic(error)).toEqual({ reason, httpStatus: 200, providerType: null, providerCode: null });
});
it("keeps malformed and oversized error bodies bounded and retains numeric status", async () => {
  for (const [status, text, reason] of [[400, "private non-json", "http_error"],
    [200, "private non-json", "invalid_json"], [403, "x".repeat(65537), "response_bytes"]] as const) {
    const error = await read(async () => new Response(text, { status })).catch(e => e);
    expect(trafficPosthogDiagnostic(error)).toEqual({ reason, httpStatus: status, providerType: null, providerCode: null });
  }
});
it("reports configuration failure without dispatching and changed key after a response", async () => {
  const e = env(); e.LEAN_POSTHOG_TEST_ACCOUNT_FILTERS = "invalid";
  const fetcher = vi.fn(async () => response());
  const error = await pullTrafficPosthog("2026-10-07", "2026-10-08", e, fetcher, () => now).catch(e => e);
  expect(trafficPosthogDiagnostic(error).reason).toBe("configuration"); expect(fetcher).not.toHaveBeenCalled();
  const changed = env();
  const drift = await pullTrafficPosthog("2026-10-07", "2026-10-08", changed, async () => {
    changed.LEAN_POSTHOG_QUERY_READ_KEY = "private-changed-key"; return response();
  }, () => now).catch(e => e);
  expect(trafficPosthogDiagnostic(drift)).toEqual({ reason: "configuration_changed", httpStatus: 200,
    providerType: null, providerCode: null });
});
it("keeps the ten-second bound on a stalled HTTP error body, no retry", async () => {
  vi.useFakeTimers(); const fetcher = vi.fn(async () => new Response(new ReadableStream({ start() {} }), { status: 403 }));
  const pending = read(fetcher).catch(e => e);
  await vi.advanceTimersByTimeAsync(10000);
  expect(trafficPosthogDiagnostic(await pending)).toEqual({ reason: "timeout", httpStatus: 403,
    providerType: null, providerCode: null });
  expect(fetcher).toHaveBeenCalledTimes(1);
});
it("preserves valid PostHog ingestion while reporting a GA4 failure", async () => {
  routeEnv(); process.env.GA_PROPERTY_ID = "synthetic"; process.env.GOOGLE_SERVICE_ACCOUNT_JSON_BASE64 = "invalid";
  vi.stubGlobal("fetch", vi.fn(async () => response()));
  const result = await GET(request());
  expect(result.status).toBe(503); expect(port.rows).toBe(3); expect(port.writes).toHaveLength(1);
  expect(port.meta.ga4_error).toBe("source_unavailable"); expect(port.meta.posthog_rows).toBe(3);
});
it("rejects user-agent spoofing and unbounded request parameters before source calls", async () => {
  routeEnv(); const fetcher = vi.fn(async () => response()); vi.stubGlobal("fetch", fetcher);
  expect((await GET(request("", { "user-agent": "vercel-cron" }))).status).toBe(401);
  expect((await GET(request("?days=15"))).status).toBe(400);
  expect((await GET(request("?days=1&days=2"))).status).toBe(400);
  expect((await GET(request("?sql=anything"))).status).toBe(400);
  expect(fetcher).not.toHaveBeenCalled();
});
