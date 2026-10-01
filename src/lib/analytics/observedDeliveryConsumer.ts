import { validProductionReportPayload } from "./productionReportDelivery";

type Row = Record<string, unknown>;
export const observedResources = ["store_daily", "product_daily"] as const;
const shop = "mullybox-store.myshopify.com";
const definition = "shopify-observed-v1";
const object = (v: unknown): v is Row => !!v && typeof v === "object" && !Array.isArray(v);
const exact = (v: Row, fields: readonly string[]) => Object.keys(v).sort().join() === [...fields].sort().join();
const instant = (v: unknown): v is string => typeof v === "string" &&
  /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{6}Z$/.test(v) && Number.isFinite(Date.parse(v)) &&
  new Date(v).toISOString().slice(0, 19) === v.slice(0, 19);
const count = (v: unknown): v is string => typeof v === "string" && /^(0|[1-9]\d{0,18})$/.test(v) &&
  BigInt(v) <= BigInt("9223372036854775807");
const generation = (v: unknown): v is string => typeof v === "string" && /^observed:[a-f0-9]{64}$/.test(v);
const counters = ["head_count", "pending_work", "leased_work", "expired_work", "dead_work",
  "head_scope_mismatches", "missing_product_heads"] as const;
const commonStatus = ["shop_id", "publication_id", "definition_version", "report_scope", "certified",
  "complete_window", "freshness_scope", "producer_liveness", "checked_at", "valid_until", "last_processed_at", "source_observed_revision_at",
  "scope_from", "scope_until", "scope_enabled", "operational_state", ...counters];
const statusFields = [...commonStatus, "resource_name", "row_count"];

export function validObservedDeliveryStatus(value: unknown): value is Row[] {
  if (!Array.isArray(value) || value.length !== 2) return false;
  const names = new Set<unknown>();
  for (const s of value) {
    if (!object(s) || !exact(s, statusFields) ||
      !observedResources.includes(s.resource_name as typeof observedResources[number]) || names.has(s.resource_name) ||
      s.shop_id !== shop || s.definition_version !== definition || !generation(s.publication_id) ||
      s.report_scope !== "webhook_observed_only" || s.certified !== false || s.complete_window !== false ||
      s.freshness_scope !== "matched_observed_snapshot" || s.producer_liveness !== "not_proven" ||
      !instant(s.checked_at) || !instant(s.valid_until) || !instant(s.scope_from) || !instant(s.scope_until) ||
      Date.parse(s.scope_from) >= Date.parse(s.scope_until) ||
      Date.parse(s.valid_until) <= Date.parse(s.checked_at) ||
      Date.parse(s.valid_until) - Date.parse(s.checked_at) > 1800000 ||
      s.last_processed_at !== null && !instant(s.last_processed_at) ||
      s.source_observed_revision_at !== null && !instant(s.source_observed_revision_at) ||
      typeof s.scope_enabled !== "boolean" || !count(s.row_count) || counters.some(k => !count(s[k]))) return false;
    // Missing fields were rejected by exact(). Null is allowed only with no heads.
    if (BigInt(s.head_count as string) === BigInt(0) ?
      s.last_processed_at !== null || s.source_observed_revision_at !== null :
      !instant(s.last_processed_at) || !instant(s.source_observed_revision_at)) return false;
    const state = !s.scope_enabled ? "disabled" :
      s.head_scope_mismatches !== "0" || s.missing_product_heads !== "0" || s.dead_work !== "0" ? "failed" :
      s.pending_work !== "0" || s.leased_work !== "0" || s.expired_work !== "0" ? "pending" : "idle";
    if (s.operational_state !== state || BigInt(s.expired_work as string) > BigInt(s.leased_work as string) ||
      BigInt(s.head_scope_mismatches as string) > BigInt(s.head_count as string) ||
      BigInt(s.missing_product_heads as string) > BigInt(s.head_count as string) ||
      instant(s.last_processed_at) && Date.parse(s.last_processed_at) > Date.parse(s.checked_at)) return false;
    names.add(s.resource_name);
  }
  return commonStatus.every(k => value[0][k] === value[1][k]);
}

function legacyRows(rows: unknown, publication: unknown) {
  if (!Array.isArray(rows)) return null;
  const result: Row[] = [];
  for (const row of rows) {
    if (!object(row) || row.shop_id !== shop || row.publication_id !== publication || !instant(row.snapshot_checked_at) ||
      row.definition_version !== definition) return null;
    const { shop_id: _shop, publication_id: _publication, snapshot_checked_at: _checked, ...legacy } = row;
    void _shop; void _publication; void _checked;
    result.push(legacy);
  }
  return result;
}

/** Fixed aggregate contract; never upgrades candidate staleness or metric readiness. */
function validPayload(value: unknown, sameRead: boolean): boolean {
  if (!object(value) || !exact(value, [...observedResources, "report_status",
    "acquisition_daily", "customer_cohorts", "funnel_daily"]) ||
    !["acquisition_daily", "customer_cohorts", "funnel_daily"].every(k =>
      Array.isArray(value[k]) && value[k].length === 0) || !validObservedDeliveryStatus(value.report_status)) return false;
  const statuses = value.report_status;
  const publication = statuses[0].publication_id;
  const store = legacyRows(value.store_daily, publication), product = legacyRows(value.product_daily, publication);
  return validProductionReportPayload({ store_daily: store, product_daily: product }) &&
    (!sameRead || observedResources.every(name => (value[name] as Row[]).every(row =>
      row.snapshot_checked_at === statuses[0].checked_at))) &&
    statuses.every(s => Array.isArray(value[s.resource_name as string]) &&
      s.row_count === String((value[s.resource_name as string] as unknown[]).length));
}
export const validObservedDeliveryPayload = (value: unknown) => validPayload(value, true);

export type ObservedConsumerState = "current" | "mixed" | "stale" | "pending" | "failed" | "disabled" | "invalid";
type CompleteImport = { complete: true; unfiltered: true; rowCount: number; capturedAt: string;
  importedAt: string | null; rows: unknown[] };
export type ObservedImports = Record<"store_daily" | "product_daily" | "report_status", CompleteImport>;

/**
 * Run at every consumer read with the current clock. Inputs must be complete,
 * unfiltered warehouse rows with independently captured count/completeness
 * evidence, not a successful import-job flag or a sampled first page.
 */
export function observedDeliveryView(imports: ObservedImports, now: number) {
  const hidden = (state: ObservedConsumerState, checkedAt: string | null = null) => ({
    state, checked_at: checkedAt, publication_id: null, store_daily: [], product_daily: [],
    certified: false, complete_window: false, report_scope: "webhook_observed_only",
    freshness_scope: "matched_observed_snapshot", producer_liveness: "not_proven",
    import_completed_at: null as Record<string, string | null> | null,
    last_processed_at: null as string | null, source_observed_revision_at: null as string | null,
  });
  if (!Number.isFinite(now) || !object(imports)) return hidden("invalid");
  for (const name of [...observedResources, "report_status"] as const) {
    const r = imports[name];
    if (!r || r.complete !== true || r.unfiltered !== true || !Array.isArray(r.rows) ||
      !Number.isSafeInteger(r.rowCount) || r.rowCount < 0 || r.rowCount !== r.rows.length ||
      !instant(r.capturedAt) || Date.parse(r.capturedAt) > now ||
      r.importedAt !== null && (!instant(r.importedAt) || Date.parse(r.importedAt) > Date.parse(r.capturedAt))) return hidden("invalid");
  }
  const statuses = imports.report_status.rows;
  if (!validObservedDeliveryStatus(statuses)) return hidden("invalid");
  const s = statuses[0], checkedAt = s.checked_at as string;
  if (Date.parse(checkedAt) > now || now >= Date.parse(s.valid_until as string)) return hidden("stale", checkedAt);
  if (s.operational_state !== "idle") return hidden(s.operational_state as "pending" | "failed" | "disabled", checkedAt);
  // An unchanged generation does not excuse a missed metric-table refresh.
  // snapshot_checked_at is the producer's read clock, never an import timestamp.
  if (observedResources.some(name => imports[name].rows.some(r => !object(r) ||
    !instant(r.snapshot_checked_at) || Date.parse(r.snapshot_checked_at) > now ||
    now - Date.parse(r.snapshot_checked_at) >= 1800000) ||
    imports[name].rows.length === 0 && (imports[name].importedAt === null ||
      now - Date.parse(imports[name].importedAt!) >= 1800000))) return hidden("stale", checkedAt);
  const publication = s.publication_id;
  if (observedResources.some(name => imports[name].rows.some(r => !object(r) ||
    r.publication_id !== publication)) ||
    statuses.some(s => s.row_count !== String(imports[s.resource_name as typeof observedResources[number]].rowCount))) {
    return hidden("mixed", checkedAt);
  }
  const value = { store_daily: imports.store_daily.rows, product_daily: imports.product_daily.rows,
    report_status: statuses, acquisition_daily: [], customer_cohorts: [], funnel_daily: [] };
  if (!validPayload(value, false)) return hidden("invalid", checkedAt);
  return { ...hidden("current", checkedAt), publication_id: publication as string,
    store_daily: imports.store_daily.rows, product_daily: imports.product_daily.rows,
    last_processed_at: s.last_processed_at as string | null,
    source_observed_revision_at: s.source_observed_revision_at as string | null,
    import_completed_at: Object.fromEntries([...observedResources, "report_status"].map(k => [k, imports[k as keyof ObservedImports].importedAt])) };
}
