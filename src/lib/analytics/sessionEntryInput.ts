import { createHash } from "node:crypto";
import { checked, key, nyDate, type Row } from "./primitives";
import { normalizeIdentity, resolveTemporalIdentity, type IdentityEvidence } from "./identity";
import { sessionConversionWindowDays } from "./calculationPolicy";
import type { CheckoutEvidence, ObservedEvent, SessionCoverage } from "./sessions";

/** Opt-in read-side binding. A version identifies one exact source namespace.
 * These fields are reviewed configuration, not browser request parameters. */
export type SessionEntryPolicy = {
  sourceNamespace: string; actionNamespace: string; actionSessionVersion: string;
  sessionVersion: string; filterVersion: string; filterSha256: string; filterCount: number;
  maxReadAgeSeconds: number; approvalRef: string;
};
export type SourceSessionEntry = {
  sourceSessionId: string; startedAt: string; endedAt: string; clock: "source_session_start";
  sourceRecordRef: string;
  /** Exact, evidenced entry-to-authority subject binding. Not a login guess. */
  identityNamespace: string; identifier: string; subjectEvidenceRef: string;
  /** Provider-evaluated predicates on the actual entry record. No email export.
   * true = predicate satisfied, false = excluded, null = cannot establish. */
  filterResults: (boolean | null)[];
};
export type SessionEntryRelation = {
  actionNamespace: string; actionSessionId: string; sourceSessionId: string;
  identityNamespace: string; identifier: string; evidenceRef: string;
};
export type SourceSessionEntryInput = {
  project: string; sourceNamespace: string; sessionVersion: string;
  from: string; until: string; capturedAt: string; complete: boolean;
  sourceRef: string; permissionSnapshotRef: string;
  filterVersion: string; filterSha256: string; filterEvaluationRef: string;
  entries: SourceSessionEntry[]; relations: SessionEntryRelation[];
};
type Entry = SourceSessionEntry & { sessionKey: string; customerId: string | null };
export type PreparedSessionEntries = {
  project: string; publication: string; policy: SessionEntryPolicy;
  from: string; until: string; capturedAt: string; asOf: string; ready: boolean;
  entries: Map<string, Entry>; relations: Map<string, SessionEntryRelation>;
  /** Counts/digest only. Native identifiers and subjects stay out of manifests. */
  lineage: { project: string; sourceNamespace: string; sessionVersion: string; actionNamespace: string;
    sourceRef: string; permissionSnapshotRef: string; filterEvaluationRef: string;
    filterVersion: string; filterSha256: string; digest: string;
    sourceEntries: number; admittedEntries: number; excludedEntries: number; unknownEntries: number };
};
const text = (v: unknown): v is string => typeof v === "string" && v.length > 0 && v.length <= 512 && v.trim() === v;
const digest = (v: string) => createHash("sha256").update(v).digest("hex");
// Preserve the existing authority's microsecond interval semantics.
function instant(v: string) {
  nyDate(v);
  return v.replace(/(?:\.(\d+))?Z$/, (_, digits: string | undefined) => `.${(digits ?? "").padEnd(6, "0")}Z`);
}
export function prepareSessionEntries(input: SourceSessionEntryInput, context: {
  policy: SessionEntryPolicy; project: string; sessionVersion: string; mappingVersion: string;
  publication: string; asOf: string; identity: IdentityEvidence[];
  currentlyPermitted: string[]; removedCustomers: string[];
}): PreparedSessionEntries {
  const p = context.policy;
  if (![p.sourceNamespace, p.actionNamespace, p.actionSessionVersion, p.sessionVersion,
    p.filterVersion, p.approvalRef, context.mappingVersion, context.publication].every(text) ||
    !/^[a-f0-9]{64}$/.test(p.filterSha256) || !Number.isSafeInteger(p.filterCount) ||
    p.filterCount < 1 || p.filterCount > 50 || !Number.isSafeInteger(p.maxReadAgeSeconds) ||
    p.maxReadAgeSeconds < 1 || p.maxReadAgeSeconds > 86400 ||
    p.sessionVersion !== context.sessionVersion) throw new Error("entry_policy_invalid");
  if (input.project !== context.project || input.sourceNamespace !== p.sourceNamespace ||
    input.sessionVersion !== p.sessionVersion || input.filterVersion !== p.filterVersion ||
    input.filterSha256 !== p.filterSha256 ||
    ![input.sourceRef, input.permissionSnapshotRef, input.filterEvaluationRef].every(text) ||
    typeof input.complete !== "boolean") throw new Error("entry_source_binding");
  for (const at of [input.from, input.until, input.capturedAt, context.asOf]) nyDate(at);
  if (instant(input.until) <= instant(input.from) || instant(input.capturedAt) < instant(input.until) ||
    instant(input.capturedAt) > instant(context.asOf) ||
    Date.parse(input.until) - Date.parse(input.from) > 31 * 86400000 ||
    Date.parse(context.asOf) - Date.parse(input.capturedAt) > p.maxReadAgeSeconds * 1000)
    throw new Error("entry_source_clock");
  if (!Array.isArray(input.entries) || input.entries.length > 10000 ||
    !Array.isArray(input.relations) || input.relations.length > 10000 || context.identity.length > 10000 ||
    Buffer.byteLength(JSON.stringify(input)) > 8000000) throw new Error("entry_source_budget");
  const mappings = context.identity.map(row => normalizeIdentity(row, context.publication));
  const permitted = new Set(context.currentlyPermitted), removed = new Set(context.removedCustomers);
  const all = new Map<string, SourceSessionEntry>(), entries = new Map<string, Entry>();
  const records = new Set<string>();
  let excluded = 0, unknown = 0;
  for (const row of input.entries) {
    if (![row.sourceSessionId, row.sourceRecordRef, row.identityNamespace, row.identifier,
      row.subjectEvidenceRef].every(text) || row.clock !== "source_session_start" ||
      !Array.isArray(row.filterResults) || row.filterResults.length !== p.filterCount ||
      row.filterResults.some(v => v !== null && typeof v !== "boolean")) throw new Error("entry_record_shape");
    const at = instant(row.startedAt);
    if (at < instant(input.from) || at >= instant(input.until)) throw new Error("entry_outside_window");
    if (instant(row.endedAt) < at || instant(row.endedAt) > instant(input.capturedAt))
      throw new Error("entry_end_clock");
    // Even identical duplicate entries are rejected: source completeness must
    // be reconciled by exact entry keys, not repaired by arbitrary row ordering.
    if (all.has(row.sourceSessionId) || records.has(row.sourceRecordRef)) throw new Error("entry_duplicate_lineage");
    all.set(row.sourceSessionId, row); records.add(row.sourceRecordRef);
    if (row.filterResults.includes(false)) { excluded++; continue; }
    if (row.filterResults.includes(null)) { unknown++; continue; }
    const authorities = context.identity.filter(m => m.namespace === row.identityNamespace &&
      m.identifier === row.identifier && m.mappingVersion === context.mappingVersion &&
      instant(m.from) <= at && (m.to === null || at < instant(m.to)));
    if (!authorities.length || authorities.some(m => !text(m.evidenceRef) || m.consent === "unknown")) {
      unknown++; continue;
    }
    const resolution = resolveTemporalIdentity({ namespace: row.identityNamespace, identifier: row.identifier,
      occurredAt: row.startedAt, version: context.mappingVersion, publication: context.publication,
      mappings, currentlyPermitted: permitted, removedCustomers: removed });
    if (authorities.some(m => m.consent !== "permitted" || m.removal !== "active") ||
      ["not_permitted", "removed"].includes(resolution.status)) { excluded++; continue; }
    if (resolution.status === "conflicting") { unknown++; continue; }
    entries.set(row.sourceSessionId, { ...row,
      sessionKey: key(context.project, context.sessionVersion, row.sourceSessionId),
      customerId: resolution.customerId });
  }
  const relations = new Map<string, SessionEntryRelation>();
  for (const r of input.relations) {
    const entry = all.get(r.sourceSessionId);
    if (r.actionNamespace !== p.actionNamespace ||
      ![r.actionSessionId, r.sourceSessionId, r.identityNamespace, r.identifier, r.evidenceRef].every(text) ||
      !entry || r.identityNamespace !== entry.identityNamespace || r.identifier !== entry.identifier)
      throw new Error("entry_relation_scope");
    // A grant can span visits. Without an exact unique source relation, do not
    // guess which visit owns its actions or checkout receipt.
    if (relations.has(r.actionSessionId)) throw new Error("entry_ambiguous_relation");
    relations.set(r.actionSessionId, r);
  }
  return { project: context.project, publication: context.publication, policy: { ...p },
    from: input.from, until: input.until, capturedAt: input.capturedAt, asOf: context.asOf,
    ready: input.complete && unknown === 0, entries, relations,
    lineage: { project: context.project, sourceNamespace: p.sourceNamespace,
      sessionVersion: p.sessionVersion, actionNamespace: p.actionNamespace,
      sourceRef: input.sourceRef, permissionSnapshotRef: input.permissionSnapshotRef,
      filterEvaluationRef: input.filterEvaluationRef, filterVersion: input.filterVersion,
      filterSha256: input.filterSha256, digest: digest(JSON.stringify(input)),
      sourceEntries: all.size, admittedEntries: entries.size, excludedEntries: excluded, unknownEntries: unknown } };
}

/** Existing observations remain real actions. No synthetic entry event is made. */
export function mapEntryObservations(events: ObservedEvent[], prepared: PreparedSessionEntries) {
  if (events.length > 10000) throw new Error("entry_action_budget");
  let unmappedActions = 0;
  const mapped = events.map(event => {
    if (event.project !== prepared.project) throw new Error("entry_action_project");
    if (!event.analyticsPermitted) return { ...event, sourceSessionId: null };
    const r = event.sourceSessionId ? prepared.relations.get(event.sourceSessionId) : undefined;
    const entry = r ? prepared.entries.get(r.sourceSessionId) : undefined;
    if (!entry) { unmappedActions++; return { ...event, sourceSessionId: null }; }
    if (event.identityNamespace !== r!.identityNamespace || event.distinctId !== r!.identifier ||
      instant(event.occurredAt) < instant(entry.startedAt) ||
      instant(event.occurredAt) > instant(entry.endedAt)) throw new Error("entry_action_relation");
    // A tag on a later action is not source-entry campaign evidence.
    return { ...event, sourceSessionId: entry.sourceSessionId, campaignContext: undefined };
  });
  return { events: mapped, unmappedActions };
}

/** Translate already evidenced order links only. This creates no order/cart or
 * paid attribution evidence and cannot rescue an ambiguous receipt namespace. */
export function mapEntryCheckoutEvidence(rows: Omit<CheckoutEvidence, "publication">[], prepared: PreparedSessionEntries) {
  if (rows.length > 10000) throw new Error("entry_checkout_budget");
  const relations = new Map([...prepared.relations.values()].map(r =>
    [key(prepared.project, prepared.policy.actionSessionVersion, r.actionSessionId), r]));
  let unmappedCheckout = 0;
  const checkout = rows.flatMap(row => {
    const r = relations.get(row.sessionKey), entry = r ? prepared.entries.get(r.sourceSessionId) : undefined;
    if (!entry) { unmappedCheckout++; return []; }
    if (!text(row.evidenceRef) || !["corroborated_checkout_id", "verified_first_party_context"].includes(row.method))
      throw new Error("entry_checkout_evidence");
    return [{ ...row, sessionKey: entry.sessionKey,
      evidenceRef: `entry-relation:${digest(JSON.stringify([row.evidenceRef, r!.evidenceRef, prepared.lineage.digest]))}` }];
  });
  return { checkout, unmappedCheckout };
}

/** Real source entries, including no-action entries. No grant/quiz clock fallback. */
export function deriveEntrySessions(events: Row[], prepared: PreparedSessionEntries, config: {
  funnelVersion: string; publication: string; now: string; stages: ReadonlyMap<string, string>;
  coverage: SessionCoverage; conversionWindowDays?: number; relationsComplete: boolean;
}): Row[] {
  if (config.publication !== prepared.publication || config.now !== prepared.asOf || !text(config.coverage.approvalRef) ||
    !Number.isSafeInteger(config.coverage.graceSeconds) || config.coverage.graceSeconds < 0 ||
    typeof config.relationsComplete !== "boolean" || typeof config.coverage.behaviorComplete !== "boolean")
    throw new Error("entry_session_policy");
  nyDate(config.now); nyDate(config.coverage.completeThrough);
  const windowDays = sessionConversionWindowDays(config.conversionWindowDays);
  const known = new Set([...prepared.entries.values()].map(e => e.sessionKey));
  for (const e of events) if (e.publication_id !== config.publication ||
    e.session_key !== null && !known.has(String(e.session_key))) throw new Error("entry_logical_namespace");
  const behavior = prepared.ready && config.relationsComplete && config.coverage.behaviorComplete;
  return [...prepared.entries.values()].map(entry => {
    const rows = events.filter(e => e.session_key === entry.sessionKey && e.analytics_eligible === true);
    if (rows.some(e => e.customer_id !== null && e.customer_id !== entry.customerId ||
      instant(String(e.occurred_at)) < instant(entry.startedAt) ||
      instant(String(e.occurred_at)) > instant(entry.endedAt))) throw new Error("entry_logical_conflict");
    const end = Date.parse(entry.startedAt) + windowDays * 86400000;
    const mature = behavior && Date.parse(config.now) >= end + config.coverage.graceSeconds * 1000 &&
      Date.parse(config.coverage.completeThrough) >= end;
    return checked("sessions", {
      session_key: entry.sessionKey, source_session_id: entry.sourceSessionId,
      sessionization_version: prepared.policy.sessionVersion,
      started_at: entry.startedAt, ended_at: entry.endedAt, report_date: nyDate(entry.startedAt),
      entry_page: null, traffic_source: null, utm_source: null, utm_medium: null, utm_campaign: null,
      campaign_id: null, device_type: null, observed_geo: null, customer_id: entry.customerId,
      identity_status: entry.customerId ? "resolved" : "anonymous",
      eligible_event_count: behavior ? rows.length : null,
      funnel_flags: Object.fromEntries([...config.stages].map(([stage, family]) =>
        [stage, behavior ? rows.some(e => e.event_name === family) : null])),
      behavior_complete: behavior, conversion_window_complete: mature, analytics_eligible: true,
      converted_session: null, funnel_version: config.funnelVersion, publication_id: config.publication,
    });
  });
}

/** Count only a fully covered NY entry day. This does not require purchase maturity. */
export function sessionEntryDayCount(prepared: PreparedSessionEntries, date: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("entry_report_date");
  // Determine NY midnight from two possible UTC offsets, including DST days.
  const base = Date.parse(`${date}T00:00:00Z`);
  if (!Number.isFinite(base) || new Date(base).toISOString().slice(0, 10) !== date) throw new Error("entry_report_date");
  const midnight = (day: string, start: number) => [4, 5].map(h => start + h * 3600000)
    .find(t => nyDate(new Date(t).toISOString()) === day && nyDate(new Date(t - 1).toISOString()) !== day);
  const next = new Date(base + 86400000).toISOString().slice(0, 10);
  const from = midnight(date, base), until = midnight(next, base + 86400000);
  if (from === undefined || until === undefined) throw new Error("entry_report_date");
  if (!prepared.ready || instant(prepared.from) > instant(new Date(from).toISOString()) ||
    instant(prepared.until) < instant(new Date(until).toISOString())) return null;
  return [...prepared.entries.values()].filter(e => nyDate(e.startedAt) === date).length;
}
