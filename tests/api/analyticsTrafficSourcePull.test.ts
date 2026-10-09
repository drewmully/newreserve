import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { pullTrafficNativeSessions, pullTrafficPosthog, trafficNativeSessionsQuery, trafficPosthogDiagnostic,
  trafficPosthogQuery, trafficWindow } from "@/lib/analytics/trafficSourcePull";
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
const now = Date.parse("2026-10-08T17:00:00Z"), columns = ["day", "visitors", "accounts_created", "purchases", "page_views", "add_to_cart_events"];
const env = () => ({ NODE_ENV: "test" as const, LEAN_POSTHOG_PROJECT_ID: "353503",
  LEAN_POSTHOG_QUERY_READ_KEY: "synthetic-read-secret", LEAN_POSTHOG_TEST_ACCOUNT_FILTERS: "synthetic-fixed-config" });
const response = (results: unknown[] = [["2026-10-07", 12, 0, 2, 30, 4]]) => Response.json({ columns, results });
const nativeColumns = ["day", "native_sessions", "excluded_native_sessions", "unknown_native_sessions"];
const nativeResponse = (results: unknown[] = [["2026-10-07", 9, 2, 1]]) => Response.json({ columns: nativeColumns, results });
const sourceResponse: typeof fetch = async (_url, options) =>
  JSON.parse(options?.body as string).name === "traffic-native-sessions-utc-v1" ? nativeResponse() : response();
const read = (request: typeof fetch) => pullTrafficPosthog("2026-10-07", "2026-10-08", env(), request, () => now);
const readNative = (request: typeof fetch) => pullTrafficNativeSessions("2026-10-07", "2026-10-08", env(), request, () => now);
beforeEach(() => { port.writes = []; port.meta = {}; port.status = ""; port.rows = 0; });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

it("uses the manual page_view event, fixed six predicates and half-open UTC bounds", () => {
  const query = trafficPosthogQuery("2026-10-07", "2026-10-08", env());
  expect(query).toContain("event = 'page_view'"); expect(query).not.toContain("$pageview");
  expect(query).toContain("countIf(event = 'page_view') AS page_views");
  expect(query).toContain("countIf(event = 'add_to_cart') AS add_to_cart_events");
  expect(query).toContain("event IN ('page_view', 'account_created', 'purchase', 'add_to_cart')");
  expect(query).toContain("uniqExactIf(distinct_id, event = 'page_view') AS visitors");
  expect(query).toContain("SELECT toString(toDate(toTimeZone(timestamp, 'UTC'))) AS day");
  expect(query).not.toContain("toDate(timestamp, 'UTC')");
  expect(query).toContain("timestamp >= toDateTime('2026-10-07 00:00:00', 'UTC')");
  expect(query).toContain("timestamp < toDateTime('2026-10-08 00:00:00', 'UTC')");
  expect(query.match(/positionCaseInsensitive/g)).toHaveLength(5);
  expect(query).toContain("JSONType(properties, '$host')");
  expect(query).not.toMatch(/SELECT.*email|SELECT.*distinct_id/);
});
it("makes one bounded request and stores aggregates with hashes, not private filters or IDs", async () => {
  const request = vi.fn<typeof fetch>(async () => response()), rows = await read(request);
  expect(request).toHaveBeenCalledTimes(1);
  expect(request.mock.calls[0]?.length).toBe(2);
  expect(JSON.parse(request.mock.calls[0][1]?.body as string)).toEqual({
    query: { kind: "HogQLQuery", query: trafficPosthogQuery("2026-10-07", "2026-10-08", env()) },
    name: "traffic-filtered-utc-v2", refresh: "force_blocking",
  });
  expect(rows.map(r => [r.metric, r.value])).toEqual([["visitors", 12], ["accounts_created", 0],
    ["purchases", 2], ["page_views", 30], ["add_to_cart_events", 4]]);
  expect(rows.every(r => (r.raw as Record<string, unknown>).version === "traffic-filtered-utc-v2")).toBe(true);
  const json = JSON.stringify(rows);
  expect(json).toContain("recorded_purchase_events_not_paid_orders");
  expect(json).toContain("recorded_page_view_events_not_unique_pages");
  expect(json).toContain("recorded_add_to_cart_events_not_carts_or_units");
  expect(json).not.toMatch(/one\.invalid|synthetic-read-secret|person\.properties/);
});
it("fills zero only for a complete empty provider response", async () => {
  const rows = await read(async () => response([]));
  expect(rows).toHaveLength(5); expect(rows.every(r => r.value === 0)).toBe(true);
});
it("admits nullable pagination metadata only with a valid uncached complete-shaped result", async () => {
  const rows = await read(async () => Response.json({ columns, results: [["2026-10-07", 12, 0, 2, 30, 4]],
    is_cached: false, hasMore: null, query_status: null }));
  expect(rows.map(r => r.value)).toEqual([12, 0, 2, 30, 4]);
});
it.each([true, 0, "false", {}, []])("still refuses true or invalid hasMore metadata: %j", async hasMore => {
  const error = await read(async () => Response.json({ columns, results: [], is_cached: false, hasMore })).catch(e => e);
  expect(trafficPosthogDiagnostic(error).reason).toBe("pagination");
});
it.each([
  [{ columns, results: [], is_cached: true, query_status: null }, "cached_response"],
  [{ columns, results: [], is_cached: false, query_status: { complete: false } }, "query_incomplete"],
  [{ columns: ["wrong"], results: [], is_cached: false, query_status: null }, "columns"],
  [{ columns, results: [["2026-10-08", 1, 0, 0, 1, 0]], is_cached: false, query_status: null }, "row_shape"],
])("nullable hasMore does not relax cache, completion, columns or date checks: %j", async (body, reason) => {
  const error = await read(async () => Response.json({ ...body, hasMore: null })).catch(e => e);
  expect(trafficPosthogDiagnostic(error).reason).toBe(reason);
});
it.each([
  { columns, results: [], error: "private error" }, { columns, results: [], is_cached: true },
  { columns, results: [], hasMore: true }, { columns, results: [], query_status: { complete: false } },
  { columns: ["wrong"], results: [] }, { columns },
  { columns, results: [["2026-10-07", "12", 0, 1, 30, 4]] },
  { columns, results: [["2026-10-08", 12, 0, 1, 30, 4]] },
  { columns, results: [["2026-10-07", -1, 0, 1, 30, 4]] },
  { columns, results: [["2026-10-07", 1, 0, 1, 30, 4], ["2026-10-07", 1, 0, 1, 30, 4]] },
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
  routeEnv(); const fetcher = vi.fn(sourceResponse); vi.stubGlobal("fetch", fetcher);
  const result = await GET(request());
  expect(result.status).toBe(200); expect(port.status).toBe("ok"); expect(port.rows).toBe(6);
  expect(port.writes[0]).toMatchObject({ table: "traffic_pulls", options: { onConflict: "pull_date,source,metric" } });
  expect(port.meta).toMatchObject({ range: ["2026-10-07", "2026-10-07"], timezone: "UTC", ga4_rows: 0,
    posthog_rows: 5, posthog_native_rows: 1, posthog_definition: "traffic-filtered-utc-v2",
    native_sessions_definition: "traffic-native-sessions-utc-v1" });
  expect((port.writes[0] as { rows: { metric: string; value: number }[] }).rows.map(r => [r.metric, r.value]))
    .toEqual([["visitors", 12], ["accounts_created", 0], ["purchases", 2], ["page_views", 30],
      ["add_to_cart_events", 4], ["native_sessions", 9]]);
  expect(fetcher).toHaveBeenCalledTimes(2);
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
  expect(port.writes).toEqual([]); expect(port.rows).toBe(0); expect(fetcher).toHaveBeenCalledTimes(2);
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
  [{ columns, results: [["2026-10-07", "private", 0, 0, 30, 4]] }, "row_shape"],
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
  vi.stubGlobal("fetch", vi.fn(sourceResponse));
  const result = await GET(request());
  expect(result.status).toBe(503); expect(port.rows).toBe(6); expect(port.writes).toHaveLength(1);
  expect(port.meta.ga4_error).toBe("source_unavailable"); expect(port.meta.posthog_rows).toBe(5);
  expect(port.meta.posthog_native_rows).toBe(1);
});
it("rejects user-agent spoofing and unbounded request parameters before source calls", async () => {
  routeEnv(); const fetcher = vi.fn(async () => response()); vi.stubGlobal("fetch", fetcher);
  expect((await GET(request("", { "user-agent": "vercel-cron" }))).status).toBe(401);
  expect((await GET(request("?days=15"))).status).toBe(400);
  expect((await GET(request("?days=1&days=2"))).status).toBe(400);
  expect((await GET(request("?sql=anything"))).status).toBe(400);
  expect(fetcher).not.toHaveBeenCalled();
});

it("counts existing SDK-native starts with exact entry relations, not custom IDs or customer joins", () => {
  const query = trafficNativeSessionsQuery("2026-10-07", "2026-10-08", env());
  expect(query).toContain("FROM sessions s LEFT JOIN");
  expect(query).toContain("ON e.$session_id = s.session_id AND e.timestamp = s.$start_timestamp");
  expect(query).toContain("native_id_valid AND entry_matches = 1 AND passed_entries = 1");
  expect(query).toContain("AS unknown_native_sessions");
  expect(query).toContain("toDate(toTimeZone(started_at, 'UTC'))");
  expect(query).toContain("s.$start_timestamp >= toDateTime('2026-10-07 00:00:00', 'UTC')");
  expect(query).toContain("s.$start_timestamp < toDateTime('2026-10-08 00:00:00', 'UTC')");
  expect(query).toContain("^[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}$");
  expect(query.match(/positionCaseInsensitive/g)).toHaveLength(5);
  expect(query).toContain("e.f0 = true AND e.f1 = true AND e.f2 = true AND e.f3 = true AND e.f4 = true AND e.f5 = true");
  expect(query).toContain("e.f0 = false OR e.f1 = false OR e.f2 = false OR e.f3 = false OR e.f4 = false OR e.f5 = false");
  expect(query).not.toMatch(/customer|permission|cart|paid_at|event =/);
  expect(query).toMatch(/GROUP BY day ORDER BY day LIMIT 15$/);
});
it("retains native filter unknowns separately, exports no identifiers and requests fresh data once", async () => {
  const fetcher = vi.fn<typeof fetch>(async () => nativeResponse());
  const rows = await readNative(fetcher);
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(JSON.parse(fetcher.mock.calls[0][1]?.body as string)).toEqual({
    query: { kind: "HogQLQuery", query: trafficNativeSessionsQuery("2026-10-07", "2026-10-08", env()) },
    name: "traffic-native-sessions-utc-v1", refresh: "force_blocking",
  });
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ pull_date: "2026-10-07", source: "posthog", metric: "native_sessions", value: 9,
    raw: { version: "traffic-native-sessions-utc-v1", classification: "partial_source_filter_classification",
      nativeInventory: 12, excludedNativeSessions: 2, unknownNativeSessions: 1, provesMeasuredSessions: false } });
  expect(JSON.stringify(rows)).not.toMatch(/one\.invalid|synthetic-read-secret|person\.properties|session_id/);
});
it("distinguishes an exhausted empty native inventory from zero included with unknown entries", async () => {
  const empty = await readNative(async () => nativeResponse([]));
  expect(empty[0]).toMatchObject({ value: 0, raw: { nativeInventory: 0, unknownNativeSessions: 0,
    classification: "complete_source_filter_classification" } });
  const unknown = await readNative(async () => nativeResponse([["2026-10-07", 0, 0, 4]]));
  expect(unknown[0]).toMatchObject({ value: 0, raw: { nativeInventory: 4, unknownNativeSessions: 4,
    classification: "partial_source_filter_classification" } });
});
it.each([
  { results: [["2026-10-07", 2, -1, 0]] }, { results: [["2026-10-07", 2, 0, "1"]] },
  { results: [["2026-10-07", Number.MAX_SAFE_INTEGER, 1, 0]] }, { results: [["2026-10-08", 2, 0, 0]] },
])("refuses malformed native count partitions instead of storing zero: %j", ({ results }) =>
  expect(readNative(async () => nativeResponse(results))).rejects.toThrow("traffic_posthog_unavailable"));
it("keeps native nullable pagination and freshness checks in the existing strict reader", async () => {
  const rows = await readNative(async () => Response.json({ columns: nativeColumns,
    results: [["2026-10-07", 3, 1, 0]], hasMore: null, query_status: null, is_cached: false }));
  expect(rows[0]).toMatchObject({ value: 3, raw: { classification: "complete_source_filter_classification" } });
  await expect(readNative(async () => Response.json({ columns: nativeColumns, results: [], is_cached: true })))
    .rejects.toThrow("traffic_posthog_unavailable");
});
it("persists all five event metrics when native source fails and exposes only safe native diagnostics", async () => {
  routeEnv(); vi.stubGlobal("fetch", vi.fn<typeof fetch>(async (_url, options) =>
    JSON.parse(options?.body as string).name === "traffic-native-sessions-utc-v1"
      ? Response.json({ type: "validation_error", code: "invalid_input", detail: "synthetic-private" }, { status: 400 })
      : response()));
  const result = await GET(request()), body = await result.json();
  expect(result.status).toBe(503); expect(port.rows).toBe(5);
  expect(port.meta).toMatchObject({ posthog_rows: 5, posthog_native_rows: 0, posthog_native_error: "source_unavailable" });
  expect(body.posthog_native_diagnostic).toEqual({ reason: "http_error", httpStatus: 400,
    providerType: "validation_error", providerCode: "invalid_input" });
  expect(JSON.stringify([port.writes, port.meta, body])).not.toContain("synthetic-private");
  expect((port.writes[0] as { rows: { metric: string }[] }).rows.map(r => r.metric))
    .toEqual(["visitors", "accounts_created", "purchases", "page_views", "add_to_cart_events"]);
});
it("persists a valid native aggregate even when the separate event query fails", async () => {
  routeEnv(); vi.stubGlobal("fetch", vi.fn<typeof fetch>(async (_url, options) =>
    JSON.parse(options?.body as string).name === "traffic-native-sessions-utc-v1"
      ? nativeResponse() : new Response(null, { status: 503 })));
  const result = await GET(request());
  expect(result.status).toBe(503); expect(port.rows).toBe(1);
  expect(port.meta).toMatchObject({ posthog_rows: 0, posthog_native_rows: 1 });
  expect((port.writes[0] as { rows: { metric: string }[] }).rows.map(r => r.metric)).toEqual(["native_sessions"]);
});

it("keeps a cart-only day's recorded events without inventing visitors, pages or purchases", async () => {
  const rows = await read(async () => response([["2026-10-07", 0, 0, 0, 0, 3]]));
  expect(rows.map(r => [r.metric, r.value])).toEqual([["visitors", 0], ["accounts_created", 0],
    ["purchases", 0], ["page_views", 0], ["add_to_cart_events", 3]]);
});
it.each([
  { results: [["2026-10-07", 12, 0, 2]] },
  { results: [["2026-10-07", 12, 0, 2, 30]] },
  { results: [["2026-10-07", 12, 0, 2, 30, 4, 9]] },
  { results: [["2026-10-07", 12, 0, 2, -1, 4]] },
  { results: [["2026-10-07", 12, 0, 2, "30", 4]] },
  { results: [["2026-10-07", 12, 0, 2, 30, 1.5]] },
  { results: [["2026-10-07", 12, 0, 2, 30, null]] },
  { results: [["2026-10-07", 12, 0, 2, 30, Number.MAX_SAFE_INTEGER + 1]] },
])("requires exactly five valid event counts, never defaulting absent new metrics: %j", async ({ results }) => {
  const error = await read(async () => response(results)).catch(e => e);
  expect(trafficPosthogDiagnostic(error).reason).toBe("row_shape");
});
it("rejects the old provider event columns while independently retaining a valid native row", async () => {
  routeEnv(); vi.stubGlobal("fetch", vi.fn<typeof fetch>(async (_url, options) =>
    JSON.parse(options?.body as string).name === "traffic-native-sessions-utc-v1" ? nativeResponse()
      : Response.json({ columns: ["day", "visitors", "accounts_created", "purchases"], results: [["2026-10-07", 12, 0, 2]] })));
  const result = await GET(request());
  expect(result.status).toBe(503); expect(port.rows).toBe(1);
  expect(port.meta.posthog_diagnostic).toMatchObject({ reason: "columns" });
  expect((port.writes[0] as { rows: { metric: string }[] }).rows.map(r => r.metric)).toEqual(["native_sessions"]);
});
