import { createHash } from "node:crypto";
import { nativeEntryFilterSha256, nativeFilterRules } from "./journeyNativeFilterConfig";

export type TrafficRow = { pull_date: string; source: string; metric: string; value: number; raw?: unknown };
const dayMs = 86400000, columns = ["day", "visitors", "accounts_created", "purchases"];
const hash = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
export type TrafficPosthogDiagnostic = {
  reason: "configuration" | "window_invalid" | "window_open" | "transport" | "timeout" |
    "http_error" | "body_missing" | "body_read" | "response_bytes" | "invalid_json" |
    "provider_error" | "cached_response" | "pagination" | "query_incomplete" |
    "columns" | "results_shape" | "row_shape" | "configuration_changed" | "unclassified";
  httpStatus: number | null;
  providerType: "validation_error" | "authentication_error" | "permission_denied" |
    "not_found" | "throttled" | "server_error" | "query_error" | "other" | null;
  providerCode: "invalid_input" | "parse_error" | "query_error" | "authentication_failed" |
    "not_authenticated" | "permission_denied" | "not_found" | "throttled" | "other" | null;
};
// Only locally constructed errors carry diagnostics. Never inspect exception
// messages, arbitrary fields, provider detail, query text or response headers.
const failures = new WeakMap<Error, TrafficPosthogDiagnostic>();
function failure(reason: TrafficPosthogDiagnostic["reason"], httpStatus: number | null = null,
  providerType: TrafficPosthogDiagnostic["providerType"] = null,
  providerCode: TrafficPosthogDiagnostic["providerCode"] = null) {
  const message = reason === "configuration" ? "traffic_posthog_configuration" :
    reason === "window_invalid" ? "traffic_window_invalid" : reason === "window_open" ? "traffic_window_open" :
      "traffic_posthog_unavailable";
  const error = new Error(message);
  failures.set(error, { reason, httpStatus: Number.isInteger(httpStatus) && httpStatus! >= 100 && httpStatus! <= 599
    ? httpStatus : null, providerType, providerCode });
  return error;
}
export function trafficPosthogDiagnostic(error: unknown): TrafficPosthogDiagnostic {
  return { ...(error instanceof Error && failures.get(error) ||
    { reason: "unclassified", httpStatus: null, providerType: null, providerCode: null }) };
}
function providerClassification(parsed: unknown) {
  const value = parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : {};
  const types = ["validation_error", "authentication_error", "permission_denied", "not_found",
    "throttled", "server_error", "query_error"] as const;
  const codes = ["invalid_input", "parse_error", "query_error", "authentication_failed",
    "not_authenticated", "permission_denied", "not_found", "throttled"] as const;
  return { type: types.find(v => value.type === v) ?? (value.type === undefined ? null : "other"),
    code: codes.find(v => value.code === v) ?? (value.code === undefined ? null : "other") } as const;
}
export function trafficWindow(now: number, requested: string | null) {
  if (!Number.isFinite(now) || requested !== null && !/^(?:[1-9]|1[0-4])$/.test(requested))
    throw new Error("traffic_window_invalid");
  const days = Number(requested ?? "14"), until = new Date(now).toISOString().slice(0, 10);
  const end = Date.parse(`${until}T00:00:00Z`);
  return { from: new Date(end - days * dayMs).toISOString().slice(0, 10), until,
    through: new Date(end - dayMs).toISOString().slice(0, 10), days };
}
function dates(from: string, until: string) {
  const valid = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v) &&
    Number.isFinite(Date.parse(`${v}T00:00:00Z`)) && new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v;
  if (!valid(from) || !valid(until)) throw failure("window_invalid");
  const n = (Date.parse(`${until}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / dayMs;
  if (!Number.isInteger(n) || n < 1 || n > 14) throw failure("window_invalid");
  return Array.from({ length: n }, (_, i) => new Date(Date.parse(`${from}T00:00:00Z`) + i * dayMs).toISOString().slice(0, 10));
}
/** Same fixed six-rule configuration and conservative unknown-value semantics
 * as the native reader. No filter values or person properties leave the query. */
export function trafficPosthogQuery(from: string, until: string, env: NodeJS.ProcessEnv) {
  dates(from, until);
  const rules = nativeFilterRules(env);
  if (!rules) throw failure("configuration");
  const filters = [`if(isNull(properties.$host) OR JSONType(properties, '$host') != 'String', NULL,
    NOT match(toString(properties.$host), '${rules.hostRegex.replace(/\\/g, "\\\\")}'))`,
  ...rules.negativeEmailValues.map(value => `if(isNull(person.properties.email), true,
    if(JSONType(person.properties, 'email') = 'String',
      positionCaseInsensitive(toString(person.properties.email), '${value}') = 0, NULL))`)];
  return `SELECT toString(toDate(timestamp, 'UTC')) AS day,
    uniqExactIf(distinct_id, event = 'page_view') AS visitors,
    countIf(event = 'account_created') AS accounts_created,
    countIf(event = 'purchase') AS purchases
    FROM events
    WHERE timestamp >= toDateTime('${from} 00:00:00', 'UTC')
      AND timestamp < toDateTime('${until} 00:00:00', 'UTC')
      AND event IN ('page_view', 'account_created', 'purchase')
      AND ${filters.map(f => `(${f}) = true`).join("\n      AND ")}
    GROUP BY day ORDER BY day LIMIT 15`;
}

/** One bounded provider request. An absent day becomes observed zero only after
 * a complete, correctly shaped response, never on missing credentials or errors. */
export async function pullTrafficPosthog(from: string, until: string, env: NodeJS.ProcessEnv,
  request: typeof fetch = fetch, now: () => number = Date.now): Promise<TrafficRow[]> {
  if (typeof window !== "undefined" || env.LEAN_POSTHOG_PROJECT_ID !== "353503" || !env.LEAN_POSTHOG_QUERY_READ_KEY?.trim())
    throw failure("configuration");
  const days = dates(from, until), started = now(), key = env.LEAN_POSTHOG_QUERY_READ_KEY;
  if (Date.parse(`${until}T00:00:00Z`) > started) throw failure("window_open");
  const query = trafficPosthogQuery(from, until, env), controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let httpStatus: number | null = null, timedOut = false;
  let stage: "transport" | "body_read" | "unclassified" = "transport";
  try {
    const raw = await Promise.race([(async () => {
      const response = await request("https://us.posthog.com/api/projects/353503/query/", {
        method: "POST", redirect: "error", signal: controller.signal,
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({ query: { kind: "HogQLQuery", query }, name: "traffic-filtered-utc-v1" }),
      });
      httpStatus = response.status;
      if (!response.body) throw failure(response.ok ? "body_missing" : "http_error", httpStatus);
      stage = "body_read";
      const reader = response.body.getReader(), parts: Uint8Array[] = []; let bytes = 0;
      try {
        for (;;) {
          const part = await reader.read(); if (part.done) break;
          bytes += part.value.length;
          if (bytes > 65536) { await reader.cancel(); throw failure("response_bytes", httpStatus); }
          parts.push(part.value);
        }
      } finally { reader.releaseLock(); }
      const raw = Buffer.concat(parts);
      if (!response.ok) {
        // Error bodies share the original time/byte bounds. Only exact known
        // type/code values survive; free-form detail and unknown codes do not.
        let parsed: unknown;
        try { parsed = JSON.parse(raw.toString("utf8")); } catch { /* HTTP status is sufficient. */ }
        const safe = providerClassification(parsed);
        throw failure("http_error", httpStatus, safe.type, safe.code);
      }
      return raw;
    })(), new Promise<never>((_, reject) => {
      timer = setTimeout(() => { timedOut = true; controller.abort(); reject(failure("timeout", httpStatus)); }, 10000);
    })]);
    stage = "unclassified";
    let parsed;
    try { parsed = JSON.parse(raw.toString("utf8")); } catch { throw failure("invalid_json", httpStatus); }
    if (!parsed) throw failure("results_shape", httpStatus);
    if (parsed.error || parsed.query_status?.error) {
      const safe = providerClassification(parsed);
      throw failure("provider_error", httpStatus, safe.type, safe.code);
    }
    if (parsed.is_cached === true) throw failure("cached_response", httpStatus);
    if (parsed.hasMore !== undefined && parsed.hasMore !== false) throw failure("pagination", httpStatus);
    if (parsed.query_status && parsed.query_status.complete !== true) throw failure("query_incomplete", httpStatus);
    if (JSON.stringify(parsed.columns) !== JSON.stringify(columns)) throw failure("columns", httpStatus);
    if (!Array.isArray(parsed.results) || parsed.results.length > days.length) throw failure("results_shape", httpStatus);
    if (now() - started >= 10000) throw failure("timeout", httpStatus);
    if (env.LEAN_POSTHOG_QUERY_READ_KEY !== key || env.LEAN_POSTHOG_PROJECT_ID !== "353503" ||
      trafficPosthogQuery(from, until, env) !== query) throw failure("configuration_changed", httpStatus);
    const rows = new Map<string, number[]>();
    for (const row of parsed.results) {
      if (!Array.isArray(row) || row.length !== 4 || !days.includes(row[0]) || rows.has(row[0]) ||
        row.slice(1).some((v: unknown) => typeof v !== "number" || !Number.isSafeInteger(v) || v < 0)) throw failure("row_shape", httpStatus);
      rows.set(row[0], row.slice(1));
    }
    const provenance = { version: "traffic-filtered-utc-v1", timezone: "UTC", from, until,
      capturedAt: new Date(now()).toISOString(), querySha256: hash(query), responseSha256: hash(raw),
      filterSha256: nativeEntryFilterSha256, filterAdmission: "six_known_true", outcome: "observed_unverified",
      visitorsBasis: "distinct_ids_on_page_view", purchasesBasis: "recorded_purchase_events_not_paid_orders" };
    return days.flatMap(date => columns.slice(1).map((metric, i) => ({ pull_date: date, source: "posthog",
      metric, value: rows.get(date)?.[i] ?? 0, raw: provenance })));
  } catch (error) {
    if (timedOut) throw failure("timeout", httpStatus);
    if (error instanceof Error && failures.has(error)) throw error;
    throw failure(stage, httpStatus);
  }
  finally { clearTimeout(timer); controller.abort(); }
}
