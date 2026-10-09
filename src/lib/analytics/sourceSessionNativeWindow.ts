import { createHash } from "node:crypto";
import { nativeFilterRules, nativeEntryFilterSha256 } from "./journeyNativeFilterConfig";
import { nativeSourceSessionId } from "./journeySourceSessionContract";
import { nyDate } from "./primitives";
import type { NativeSourceEntry } from "./journeySourceSessionEvidence";
import type { JourneyRuntime } from "./journeyRuntime";

export const SOURCE_SESSION_REPORT_PLAN = Object.freeze({ version: "native-entry-day-v1",
  nativeQueries: 1, authorityReads: 2, maxNativeRows: 1000, maxGrantRows: 1000,
  maxReceiptRows: 1000, nativeBytes: 1048576, authorityBytes: 2097152,
  packetBytes: 8388608, requestMs: 5000, totalMs: 15000,
  filterSha256: nativeEntryFilterSha256 } as const);
export const sourceReportHash = (v: string | Uint8Array) => createHash("sha256").update(v).digest("hex");
/** Deliberately separate from PostgreSQL's partition digest. */
export function sourceReportCanonical(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number" && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(sourceReportCanonical).join(",")}]`;
  if (value && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype)
    return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${sourceReportCanonical((value as Record<string, unknown>)[k])}`).join(",")}}`;
  throw new Error("source_report_json_shape");
}
export const sourceReportDigest = (v: unknown) => sourceReportHash(sourceReportCanonical(v));
export function sourceReportInstant(v: string) {
  nyDate(v);
  return v.replace(/(?:\.(\d+))?Z$/, (_, digits: string | undefined) => `.${(digits ?? "").padEnd(6, "0")}Z`);
}
export function sourceReportDay(date: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || new Date(`${date}T12:00:00Z`).toISOString().slice(0,10) !== date)
    throw new Error("source_report_date");
  const midnight = (day: string) => {
    for (const h of [4,5]) {
      const at = `${day}T0${h}:00:00.000Z`;
      if (nyDate(at) === day && new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York",
        hour: "2-digit", hourCycle: "h23" }).format(new Date(at)) === "00") return at;
    }
    throw new Error("source_report_ny_midnight");
  };
  const next = new Date(Date.parse(`${date}T12:00:00Z`)+86400000).toISOString().slice(0,10);
  return { from: midnight(date), until: midnight(next) };
}
const columns = ["native_session_id","started_at","ended_at","entry_matches","entry_uuid",
  "filter_0","filter_1","filter_2","filter_3","filter_4","filter_5"];
export type NativeSessionWindowSnapshot = {
  project: "353503"; from: string; until: string; capturedAt: string;
  querySha256: string; responseSha256: string; responseBytes: number;
  planVersion: typeof SOURCE_SESSION_REPORT_PLAN.version;
  rows: NativeSourceEntry[]; digest: string;
};
/** Fixed inventory, not a query over known successful receipt IDs. */
export function sourceSessionWindowQuery(date: string, env: NodeJS.ProcessEnv) {
  const rules = nativeFilterRules(env); if (!rules) throw new Error("source_report_filter_config");
  const { from, until } = sourceReportDay(date);
  const f = from.replace(/\.000Z$/, "Z"), u = until.replace(/\.000Z$/, "Z");
  return `SELECT s.session_id AS native_session_id, s.$start_timestamp AS started_at,
    s.$end_timestamp AS ended_at, countIf(e.$session_id = s.session_id AND e.timestamp = s.$start_timestamp) AS entry_matches,
    min(toString(e.uuid)) AS entry_uuid,
    ${[0,1,2,3,4,5].map(i=>`min(e.f${i}) AS filter_${i}`).join(",")}
    FROM sessions s LEFT JOIN (SELECT $session_id, timestamp, uuid,
      if(isNull(properties.$host) OR JSONType(properties, '$host') != 'String', NULL,
        NOT match(toString(properties.$host), '${rules.hostRegex.replace(/\\/g,"\\\\")}')) AS f0,
      ${rules.negativeEmailValues.map((v,i)=>`if(isNull(person.properties.email), true,
        if(JSONType(person.properties, 'email') = 'String',
          positionCaseInsensitive(toString(person.properties.email), '${v}') = 0, NULL)) AS f${i+1}`).join(",")}
      FROM events WHERE timestamp >= toDateTime('${f}') AND timestamp < toDateTime('${u}')) e
      ON e.$session_id = s.session_id AND e.timestamp = s.$start_timestamp
    WHERE s.$start_timestamp >= toDateTime('${f}') AND s.$start_timestamp < toDateTime('${u}')
    GROUP BY s.session_id, s.$start_timestamp, s.$end_timestamp
    ORDER BY s.$start_timestamp, s.session_id LIMIT 1001`;
}
export function validateNativeSessionWindow(s: NativeSessionWindowSnapshot, date: string, asOf: string) {
  const bounds = sourceReportDay(date), { digest, ...body } = s;
  if (s.project !== "353503" || s.from !== bounds.from || s.until !== bounds.until ||
    s.planVersion !== SOURCE_SESSION_REPORT_PLAN.version || digest !== sourceReportDigest(body) ||
    !/^[a-f0-9]{64}$/.test(s.querySha256) || !/^[a-f0-9]{64}$/.test(s.responseSha256) ||
    !Number.isSafeInteger(s.responseBytes) || s.responseBytes < 1 || s.responseBytes > SOURCE_SESSION_REPORT_PLAN.nativeBytes ||
    !Array.isArray(s.rows) || s.rows.length > SOURCE_SESSION_REPORT_PLAN.maxNativeRows ||
    sourceReportInstant(s.capturedAt) < sourceReportInstant(s.until) ||
    sourceReportInstant(s.capturedAt) > sourceReportInstant(asOf)) throw new Error("source_report_native_scope");
  const ids = new Set<string>();
  for (const row of s.rows) {
    if (row.project !== s.project || !nativeSourceSessionId.test(row.nativeSessionId) || ids.has(row.nativeSessionId) ||
      row.entryNativeSessionId !== row.nativeSessionId || row.entryTimestamp !== row.startedAt ||
      !Number.isSafeInteger(row.entryMatches) || row.entryMatches < 0 ||
      (row.entryMatches > 0 && !nativeSourceSessionId.test(row.entryUuid)) ||
      (row.entryMatches === 0 && row.entryUuid !== "") || row.filterSha256 !== nativeEntryFilterSha256 ||
      !Array.isArray(row.filterResults) || row.filterResults.length !== 6 ||
      row.filterResults.some(v=>v !== null && typeof v !== "boolean") ||
      sourceReportInstant(row.startedAt) < sourceReportInstant(s.from) ||
      sourceReportInstant(row.startedAt) >= sourceReportInstant(s.until) ||
      sourceReportInstant(row.endedAt) < sourceReportInstant(row.startedAt) ||
      sourceReportInstant(row.endedAt) > sourceReportInstant(s.capturedAt)) throw new Error("source_report_native_row");
    ids.add(row.nativeSessionId);
  }
}
export async function readSourceSessionNativeWindow(date: string, expectedKeySha256: string, r: JourneyRuntime,
  deadlineMs = r.now()+SOURCE_SESSION_REPORT_PLAN.requestMs) {
  if (typeof window !== "undefined" || r.env.LEAN_POSTHOG_PROJECT_ID !== "353503" ||
    !r.env.LEAN_POSTHOG_QUERY_READ_KEY || sourceReportHash(r.env.LEAN_POSTHOG_QUERY_READ_KEY) !== expectedKeySha256)
    throw new Error("source_report_native_config");
  const query = sourceSessionWindowQuery(date, r.env), { from, until } = sourceReportDay(date);
  if (Date.parse(until) > r.now()) throw new Error("source_report_open_day");
  const started = r.now();
  const remaining = Math.min(SOURCE_SESSION_REPORT_PLAN.requestMs,Math.floor(deadlineMs-started));
  if (!Number.isSafeInteger(remaining) || remaining<1) throw new Error("source_report_native_deadline");
  const response = await r.request("https://us.posthog.com/api/projects/353503/query/", {
    method: "POST", redirect: "error", signal: AbortSignal.timeout(remaining),
    headers: { Authorization: `Bearer ${r.env.LEAN_POSTHOG_QUERY_READ_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: { kind: "HogQLQuery", query }, name: "lean-source-entry-day-v1", refresh: "force_blocking" }) })
    .catch(()=>{ throw new Error("source_report_native_transport"); });
  if (!response.ok || !response.body) throw new Error("source_report_native_response");
  const reader = response.body.getReader(), parts: Uint8Array[] = []; let bytes = 0;
  try {
    for (;;) {
      const chunk = await reader.read().catch(()=>{throw new Error("source_report_native_body");}); if (chunk.done) break;
      bytes += chunk.value.length;
      if (bytes > SOURCE_SESSION_REPORT_PLAN.nativeBytes || r.now()-started >= remaining) {
        await reader.cancel(); throw new Error("source_report_native_budget");
      }
      parts.push(chunk.value);
    }
  } finally { reader.releaseLock(); }
  const raw = Buffer.concat(parts);
  let result;
  try { result = JSON.parse(raw.toString("utf8")); } catch { throw new Error("source_report_native_json"); }
  if (!result || result.error || result.is_cached === true ||
    result.hasMore !== undefined && result.hasMore !== null && result.hasMore !== false || result.query_status &&
    (result.query_status.complete !== true || result.query_status.error) ||
    JSON.stringify(result.columns) !== JSON.stringify(columns) || !Array.isArray(result.results) ||
    result.results.length > SOURCE_SESSION_REPORT_PLAN.maxNativeRows || r.now()-started >= remaining)
    throw new Error("source_report_native_incomplete");
  const utc = (v: unknown) => { if (typeof v !== "string") throw new Error("source_report_native_clock");
    const out = v.replace(" ","T").replace(/\+00:00$/, "Z"); nyDate(out); return out; };
  const rows: NativeSourceEntry[] = result.results.map((row: unknown) => {
    if (!Array.isArray(row) || row.length !== 11 || typeof row[0] !== "string" ||
      typeof row[3] !== "number" || typeof row[4] !== "string") throw new Error("source_report_native_shape");
    const startedAt = utc(row[1]);
    return { project: "353503", nativeSessionId: row[0], startedAt, endedAt: utc(row[2]),
      entryMatches: row[3], entryUuid: row[3] === 0 ? "" : row[4], entryTimestamp: startedAt,
      entryNativeSessionId: row[0], filterSha256: nativeEntryFilterSha256,
      filterResults: row.slice(5).map(v=> { if (v === true || v === 1) return true;
        if (v === false || v === 0) return false; if (v === null) return null;
        throw new Error("source_report_native_filter"); }) };
  });
  if (!r.env.LEAN_POSTHOG_QUERY_READ_KEY || sourceReportHash(r.env.LEAN_POSTHOG_QUERY_READ_KEY) !== expectedKeySha256 ||
    r.env.LEAN_POSTHOG_PROJECT_ID !== "353503" || sourceSessionWindowQuery(date,r.env) !== query)
    throw new Error("source_report_native_config_changed");
  const body = { project: "353503" as const, from, until, capturedAt: new Date(r.now()).toISOString(),
    querySha256: sourceReportHash(query), responseSha256: sourceReportHash(raw), responseBytes: bytes,
    planVersion: SOURCE_SESSION_REPORT_PLAN.version, rows };
  const snapshot = { ...body, digest: sourceReportDigest(body) };
  validateNativeSessionWindow(snapshot,date,snapshot.capturedAt); return snapshot;
}
