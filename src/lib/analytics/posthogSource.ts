import { nyDate } from "./primitives";
import type { ObservedEvent } from "./sessions";
import { sourceArray, sourceObject, sourceString } from "./shopifySource";
import type { CampaignContext } from "./attribution";

export type BehaviorSource = {
  host: "https://us.posthog.com" | "https://eu.posthog.com"; project: string;
  from: string; until: string; maxEvents: number; approvalRef: string;
  /** Exact reviewed token-to-campaign registry. Missing tokens are not direct. */
  campaignMapping?: {
    property: "campaign_id" | "utm_id" | "utm_campaign"; approvalRef: string;
    entries: Record<string, Omit<CampaignContext, "evidenceRef">>;
  };
  families: Record<string, {
    producer: string; schemaVersion: string; identityNamespace: string;
    actionProperty: "event_id" | "$insert_id";
    sessionProperty: "session_id" | "$session_id";
    identityProperty: "anonymous_id" | "distinct_id" | "reserve_user_id" | "shopify_customer_id" | "mully_anon_id";
    consentProperty: "analytics_permitted" | "analytics_consent";
  }>;
};
const columns = ["uuid", "event", "timestamp", "distinct_id", "event_id", "insert_id",
  "session_id", "ph_session_id", "anonymous_id", "analytics_permitted", "analytics_consent"];
const token = (s: string) => /^[a-zA-Z0-9_$:.-]{1,128}$/.test(s);
export function validateBehaviorSource(c: BehaviorSource) {
  if (!["https://us.posthog.com", "https://eu.posthog.com"].includes(c.host) ||
      !/^[1-9]\d{0,9}$/.test(c.project) || !c.approvalRef?.trim() ||
      !Number.isSafeInteger(c.maxEvents) || c.maxEvents < 1 || c.maxEvents > 10000)
    throw new Error("invalid_behavior_scope");
  nyDate(c.from); nyDate(c.until);
  if (Date.parse(c.until) <= Date.parse(c.from) ||
      Date.parse(c.until) - Date.parse(c.from) > 93 * 86400000) throw new Error("behavior_window_budget");
  const entries = Object.entries(c.families);
  if (!entries.length || entries.length > 50) throw new Error("behavior_family_budget");
  for (const [family, f] of entries) {
    if (![family, f.producer, f.schemaVersion, f.identityNamespace].every(token) ||
        !["event_id", "$insert_id"].includes(f.actionProperty) ||
        !["session_id", "$session_id"].includes(f.sessionProperty) ||
        !["anonymous_id", "distinct_id", "reserve_user_id", "shopify_customer_id", "mully_anon_id"].includes(f.identityProperty) ||
        !["analytics_permitted", "analytics_consent"].includes(f.consentProperty))
      throw new Error("invalid_behavior_mapping");
  }
  if (c.campaignMapping) {
    const m = c.campaignMapping, entries = Object.entries(m.entries);
    if (!["campaign_id", "utm_id", "utm_campaign"].includes(m.property) ||
        !m.approvalRef?.trim() || entries.length < 1 || entries.length > 1000 ||
        entries.some(([source, value]) => !/^[a-zA-Z0-9_-]{1,128}$/.test(source) ||
          !token(value.channel) || typeof value.direct !== "boolean" ||
          value.campaignKey !== null && (typeof value.campaignKey !== "string" ||
            value.campaignKey.length > 300 || !value.campaignKey.trim()) ||
          value.direct && (value.channel !== "direct" || value.campaignKey !== null) ||
          !value.direct && value.channel === "direct"))
      throw new Error("invalid_campaign_mapping");
  }
}
/** Bounded, synchronous, read-only query. LIMIT+1 fails closed rather than silently
 * truncating. No person profiles, URLs, IPs, email, or unbounded properties blobs.
 * Pagination completeness alone NEVER certifies behavioral coverage or consent.
 * API contract: https://posthog.com/docs/api/query
 */
export async function readPosthogBehavior(c: BehaviorSource, apiKey: string,
  request: typeof fetch = fetch): Promise<ObservedEvent[]> {
  validateBehaviorSource(c);
  if (!apiKey.trim()) throw new Error("missing_behavior_credential");
  const families = Object.keys(c.families).sort().map(f => `'${f}'`).join(",");
  // Select only explicitly configured identifiers. Existing configurations retain
  // their exact wire contract; never select the whole properties/PII object.
  const additional = [...new Set(Object.values(c.families).map(f => f.identityProperty))]
    .filter(name => !columns.includes(name)).sort();
  const selectedColumns = [...columns, ...additional, ...(c.campaignMapping ? ["campaign_token"] : [])];
  const query = `SELECT uuid AS uuid, event AS event, timestamp AS timestamp, distinct_id AS distinct_id,
    properties.event_id AS event_id, properties.$insert_id AS insert_id,
    properties.session_id AS session_id, properties.$session_id AS ph_session_id,
    properties.anonymous_id AS anonymous_id, properties.analytics_permitted AS analytics_permitted,
    properties.analytics_consent AS analytics_consent${additional.map(name => `,\n    properties.${name} AS ${name}`).join("")}${
      c.campaignMapping ? `,\n    properties.${c.campaignMapping.property} AS campaign_token` : ""}
    FROM events WHERE timestamp >= toDateTime('${c.from}') AND timestamp < toDateTime('${c.until}')
    AND event IN (${families}) ORDER BY timestamp, uuid LIMIT ${c.maxEvents + 1}`;
  let response: Response;
  try {
    response = await request(`${c.host}/api/projects/${c.project}/query/`, {
      method: "POST", headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ query: { kind: "HogQLQuery", query }, name: "lean-analytics-bounded-behavior" }),
      redirect: "error", signal: AbortSignal.timeout(45000),
    });
  } catch { throw new Error("behavior_source_unavailable"); }
  if (!response.ok) throw new Error("behavior_source_unavailable");
  // Read with a byte budget; Content-Length alone is not trustworthy.
  const reader = response.body?.getReader();
  if (!reader) throw new Error("behavior_empty_response");
  const chunks: Uint8Array[] = []; let bytes = 0;
  try {
    for (;;) {
      const chunk = await reader.read(); if (chunk.done) break;
      bytes += chunk.value.length;
      if (bytes > 8000000) { await reader.cancel(); throw new Error("behavior_response_budget"); }
      chunks.push(chunk.value);
    }
  } finally { reader.releaseLock(); }
  const result = sourceObject(JSON.parse(Buffer.concat(chunks).toString("utf8")));
  const status = result.query_status;
  if (result.error || (status && (typeof status !== "object" ||
      (status as Record<string, unknown>).complete !== true ||
      (status as Record<string, unknown>).error)) || result.hasMore === true ||
      JSON.stringify(result.columns) !== JSON.stringify(selectedColumns)) throw new Error("behavior_response_shape");
  const rows = sourceArray(result.results);
  if (rows.length > c.maxEvents) throw new Error("behavior_event_budget");
  const uuids = new Set<string>();
  return rows.map(value => {
    const row = sourceArray(value);
    if (row.length !== selectedColumns.length) throw new Error("behavior_row_shape");
    const r = Object.fromEntries(selectedColumns.map((name, i) => [name, row[i]]));
    const nativeUuid = sourceString(r.uuid), family = sourceString(r.event);
    if (!/^[a-f0-9-]{36}$/i.test(nativeUuid) || uuids.has(nativeUuid) || !Object.hasOwn(c.families, family))
      throw new Error("behavior_native_lineage");
    uuids.add(nativeUuid);
    const f = c.families[family], at = sourceString(r.timestamp);
    // PostHog may render its UTC timestamp with a space and numeric offset.
    const occurredAt = at.replace(" ", "T").replace(/\+00:00$/, "Z");
    nyDate(occurredAt);
    if (Date.parse(occurredAt) < Date.parse(c.from) || Date.parse(occurredAt) >= Date.parse(c.until))
      throw new Error("behavior_event_outside_scope");
    const optional = (v: unknown) => v === null || v === "" ? null : sourceString(v);
    const action = optional(r[f.actionProperty === "$insert_id" ? "insert_id" : "event_id"]);
    if (!action || action.length > 200) throw new Error("behavior_missing_dedup_key");
    // No implicit permission based on login or presence in the native event store.
    const permitted = r[f.consentProperty] === true;
    const session = optional(r[f.sessionProperty === "$session_id" ? "ph_session_id" : "session_id"]);
    const distinct = optional(r[f.identityProperty]);
    if ([session, distinct].some(s => s !== null && s.length > 200)) throw new Error("behavior_identifier_budget");
    const mapping = c.campaignMapping;
    const campaign = permitted && mapping && typeof r.campaign_token === "string" &&
      Object.hasOwn(mapping.entries, r.campaign_token) ? mapping.entries[r.campaign_token] : undefined;
    return { project: c.project, producer: f.producer, actionId: action, nativeUuid, family,
      schemaVersion: f.schemaVersion, occurredAt, receivedAt: null,
      sourceSessionId: permitted ? session : null, distinctId: permitted ? distinct : null,
      identityNamespace: f.identityNamespace, customerId: null, analyticsPermitted: permitted,
      ...(campaign ? { campaignContext: { ...campaign,
        evidenceRef: `posthog:${c.project}:${nativeUuid}:${mapping!.approvalRef}` } } : {}) };
  });
}
