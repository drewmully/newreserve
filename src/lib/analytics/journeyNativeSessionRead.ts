import { createHash } from "node:crypto";
import { nativeSourceSessionId } from "./journeySourceSessionContract";
import { nyDate } from "./primitives";
import type { JourneyGrant, JourneyRuntime } from "./journeyRuntime";
import { nativeFilterRules } from "./journeyNativeFilterConfig";
export { nativeEntryFilterSha256 } from "./journeyNativeFilterConfig";

/** Exact one-session projection from the independently stored native source.
 * The six fixed entry predicates execute at the provider; no person/property
 * values, distinct_id, URL or UTM columns leave it. UUID is validated before SQL. */
export async function readNativeSessionForBinding(id: string, grant: JourneyGrant, r: JourneyRuntime) {
  return readNativeSessionProjection(id, { from: grant.validFrom, until: grant.expiresAt },
    r.env.LEAN_POSTHOG_QUERY_READ_KEY ?? "", r);
}

/** Source-only projection. This does not issue or validate visitor permission.
 * Only the separate authenticated one-use setup operation may use a candidate
 * key; visitor binding always supplies its dedicated LEAN key above. */
export async function readNativeSessionProjection(id: string, bounds: { from: string; until: string },
  queryKey: string, r: JourneyRuntime) {
  if (!nativeSourceSessionId.test(id) || !queryKey.trim()) return null;
  const rules = nativeFilterRules(r.env);
  if (!rules) return null;
  try {
    nyDate(bounds.from); nyDate(bounds.until);
    if (Date.parse(bounds.until) <= Date.parse(bounds.from) || Date.parse(bounds.until)-Date.parse(bounds.from)>86400000) return null;
    // Query at second resolution; the exact microsecond permission boundary is
    // checked again by the receipt RPC, never rounded back for admission.
    const from = new Date(Date.parse(bounds.from)).toISOString().replace(/\.\d{3}Z$/, "Z");
    const until = new Date(Math.ceil(Date.parse(bounds.until)/1000)*1000).toISOString().replace(/\.\d{3}Z$/, "Z");
    const query = `SELECT s.session_id AS native_session_id, s.$start_timestamp AS started_at,
      s.$end_timestamp AS ended_at, countIf(e.$session_id = s.session_id AND e.timestamp = s.$start_timestamp) AS entry_matches,
      min(toString(e.uuid)) AS entry_uuid,
      ${[0,1,2,3,4,5].map(i=>`min(e.f${i}) AS filter_${i}`).join(",")}
      FROM sessions s LEFT JOIN (SELECT $session_id, timestamp, uuid,
        if(isNull(properties.$host) OR JSONType(properties, '$host') != 'String', NULL,
          NOT match(toString(properties.$host), '${rules.hostRegex.replace(/\\/g,"\\\\")}')) AS f0,
        ${rules.negativeEmailValues.map((v,i)=>`if(isNull(person.properties.email), true,
          if(JSONType(person.properties, 'email') = 'String',
            positionCaseInsensitive(toString(person.properties.email), '${v}') = 0, NULL)) AS f${i+1}`).join(",")}
        FROM events
        WHERE $session_id = '${id}' AND timestamp >= toDateTime('${from}') AND timestamp < toDateTime('${until}')) e
        ON e.$session_id = s.session_id AND e.timestamp = s.$start_timestamp
      WHERE s.session_id = '${id}' AND s.$start_timestamp >= toDateTime('${from}') AND s.$start_timestamp < toDateTime('${until}')
      GROUP BY s.session_id, s.$start_timestamp, s.$end_timestamp LIMIT 2`;
    const response = await r.request("https://us.posthog.com/api/projects/353503/query/", { method: "POST", redirect: "error",
      headers: { Authorization: `Bearer ${queryKey}`, "Content-Type": "application/json" },
      signal: AbortSignal.timeout(2500), body: JSON.stringify({ query: { kind: "HogQLQuery", query }, name: "lean-v3-one-native-entry" }) });
    if (!response.ok) return null;
    const reader = response.body?.getReader(); if (!reader) return null;
    const chunks: Uint8Array[] = []; let bytes = 0;
    try {
      for (;;) {
        const chunk = await reader.read(); if (chunk.done) break;
        bytes += chunk.value.length; if (bytes > 65536) { await reader.cancel(); return null; }
        chunks.push(chunk.value);
      }
    } finally { reader.releaseLock(); }
    const responseBytes = Buffer.concat(chunks), result = JSON.parse(responseBytes.toString("utf8"));
    if (result.error || result.hasMore === true || result.query_status &&
      (result.query_status.complete !== true || result.query_status.error) ||
      JSON.stringify(result.columns) !== JSON.stringify(["native_session_id","started_at","ended_at","entry_matches","entry_uuid",
        "filter_0","filter_1","filter_2","filter_3","filter_4","filter_5"]) ||
      !Array.isArray(result.results) || result.results.length !== 1) return null;
    const row = result.results[0];
    if (!Array.isArray(row) || row.length !== 11 || row[0] !== id || row[3] !== 1 || !nativeSourceSessionId.test(row[4])) return null;
    const filterResults = row.slice(5).map((v:unknown) => {
      if (v === null) return null;
      if (v === true || v === 1) return true;
      if (v === false || v === 0) return false;
      throw new Error("native_filter_shape");
    });
    const utc = (v: unknown) => { if (typeof v !== "string") throw new Error("native_clock");
      const out = v.replace(" ","T").replace(/\+00:00$/,"Z"); nyDate(out); return out; };
    const startedAt = utc(row[1]), endedAt = utc(row[2]);
    if (Date.parse(startedAt) < Date.parse(bounds.from) || Date.parse(startedAt) >= Date.parse(bounds.until) ||
      Date.parse(endedAt) < Date.parse(startedAt) || Date.parse(endedAt) > r.now()) return null;
    return { entryUuid: String(row[4]), startedAt, endedAt, filterResults,
      readDigest: createHash("sha256").update(responseBytes).digest("hex") };
  } catch { return null; }
}
