import { createHash } from "node:crypto";
import { nativeEntryFilterSha256, nativeFilterRules } from "./journeyNativeFilterConfig";

export type TrafficRow = { pull_date: string; source: string; metric: string; value: number; raw?: unknown };
const dayMs = 86400000, columns = ["day", "visitors", "accounts_created", "purchases"];
const hash = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
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
  if (!valid(from) || !valid(until)) throw new Error("traffic_window_invalid");
  const n = (Date.parse(`${until}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / dayMs;
  if (!Number.isInteger(n) || n < 1 || n > 14) throw new Error("traffic_window_invalid");
  return Array.from({ length: n }, (_, i) => new Date(Date.parse(`${from}T00:00:00Z`) + i * dayMs).toISOString().slice(0, 10));
}
/** Same fixed six-rule configuration and conservative unknown-value semantics
 * as the native reader. No filter values or person properties leave the query. */
export function trafficPosthogQuery(from: string, until: string, env: NodeJS.ProcessEnv) {
  dates(from, until);
  const rules = nativeFilterRules(env);
  if (!rules) throw new Error("traffic_posthog_configuration");
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
    throw new Error("traffic_posthog_configuration");
  const days = dates(from, until), started = now(), key = env.LEAN_POSTHOG_QUERY_READ_KEY;
  if (Date.parse(`${until}T00:00:00Z`) > started) throw new Error("traffic_window_open");
  const query = trafficPosthogQuery(from, until, env), controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const raw = await Promise.race([(async () => {
      const response = await request("https://us.posthog.com/api/projects/353503/query/", {
        method: "POST", redirect: "error", signal: controller.signal,
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({ query: { kind: "HogQLQuery", query }, name: "traffic-filtered-utc-v1" }),
      });
      if (!response.ok || !response.body) throw new Error("response");
      const reader = response.body.getReader(), parts: Uint8Array[] = []; let bytes = 0;
      try {
        for (;;) {
          const part = await reader.read(); if (part.done) break;
          bytes += part.value.length;
          if (bytes > 65536) { await reader.cancel(); throw new Error("budget"); }
          parts.push(part.value);
        }
      } finally { reader.releaseLock(); }
      return Buffer.concat(parts);
    })(), new Promise<never>((_, reject) => {
      timer = setTimeout(() => { controller.abort(); reject(new Error("timeout")); }, 10000);
    })]);
    const parsed = JSON.parse(raw.toString("utf8"));
    if (!parsed || parsed.error || parsed.is_cached === true ||
      parsed.hasMore !== undefined && parsed.hasMore !== false ||
      parsed.query_status && (parsed.query_status.complete !== true || parsed.query_status.error) ||
      JSON.stringify(parsed.columns) !== JSON.stringify(columns) || !Array.isArray(parsed.results) ||
      parsed.results.length > days.length || now() - started >= 10000 ||
      env.LEAN_POSTHOG_QUERY_READ_KEY !== key || env.LEAN_POSTHOG_PROJECT_ID !== "353503" ||
      trafficPosthogQuery(from, until, env) !== query) throw new Error("incomplete");
    const rows = new Map<string, number[]>();
    for (const row of parsed.results) {
      if (!Array.isArray(row) || row.length !== 4 || !days.includes(row[0]) || rows.has(row[0]) ||
        row.slice(1).some(v => typeof v !== "number" || !Number.isSafeInteger(v) || v < 0)) throw new Error("shape");
      rows.set(row[0], row.slice(1));
    }
    const provenance = { version: "traffic-filtered-utc-v1", timezone: "UTC", from, until,
      capturedAt: new Date(now()).toISOString(), querySha256: hash(query), responseSha256: hash(raw),
      filterSha256: nativeEntryFilterSha256, filterAdmission: "six_known_true", outcome: "observed_unverified",
      visitorsBasis: "distinct_ids_on_page_view", purchasesBasis: "recorded_purchase_events_not_paid_orders" };
    return days.flatMap(date => columns.slice(1).map((metric, i) => ({ pull_date: date, source: "posthog",
      metric, value: rows.get(date)?.[i] ?? 0, raw: provenance })));
  } catch { throw new Error("traffic_posthog_unavailable"); }
  finally { clearTimeout(timer); controller.abort(); }
}
