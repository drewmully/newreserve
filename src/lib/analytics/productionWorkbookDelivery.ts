/** Selected full-build reporting contract. No source facts, formulas or readiness promotion. */
type Row = Record<string, unknown>;
type Kind = "text" | "date" | "instant" | "boolean" | "integer" | "decimal";
const common = { shop_id: "text", publication_id: "text", definition_version: "text", is_stale: "boolean" } as const;
export const workbookResources = {
  store_daily: {
    dimensions: { ...common, report_date: "date" },
    integers: ["eligible_orders", "new_customers"],
    decimals: ["gross_merchandise_sales_usd", "discounts_usd", "refunds_usd", "net_merchandise_sales_usd",
      "shipping_net_usd", "tax_net_usd", "duty_net_usd", "other_sales_adjustments_usd", "total_sales_usd",
      "collected_cash_usd", "purchase_merchandise_net_usd", "spend_usd", "ncac_usd", "mer", "aov_usd"],
    key: ["shop_id", "report_date", "definition_version", "publication_id"], limit: 31,
  },
  product_daily: {
    dimensions: { ...common, report_date: "date", sku_bucket: "text" },
    integers: [],
    decimals: ["units", "gross_merchandise_sales_usd", "discounts_usd", "refunds_usd", "net_merchandise_sales_usd"],
    key: ["shop_id", "report_date", "sku_bucket", "definition_version", "publication_id"], limit: 20000,
  },
  acquisition_daily: {
    dimensions: { ...common, report_date: "date", channel: "text", campaign_bucket: "text", model_version: "text" },
    integers: [],
    decimals: ["attributed_purchase_merchandise_net_usd", "credited_orders", "weighted_new_customers",
      "spend_usd", "first_party_roas", "ncac_usd"],
    key: ["shop_id", "report_date", "channel", "campaign_bucket", "model_version", "definition_version", "publication_id"],
    limit: 20000,
  },
  customer_cohorts: {
    dimensions: { ...common, cohort_month: "date", observation_age_days: "integer",
      acquisition_definition_version: "text", as_of_at: "instant", mature: "boolean" },
    integers: ["cohort_customers", "repeat_customers"],
    decimals: ["observed_net_merchandise_sales_usd", "repeat_purchase_rate", "revenue_ltv_usd"],
    key: ["shop_id", "cohort_month", "observation_age_days", "acquisition_definition_version",
      "as_of_at", "definition_version", "publication_id"], limit: 100,
  },
  funnel_daily: {
    dimensions: { ...common, report_date: "date", stage_id: "text", funnel_version: "text" },
    integers: ["measured_sessions", "stage_reached_sessions", "mature_sessions", "converted_sessions"],
    decimals: ["session_conversion_rate"],
    key: ["shop_id", "report_date", "stage_id", "funnel_version", "definition_version", "publication_id"], limit: 20000,
  },
} as const;
const object = (v: unknown): v is Row => v !== null && typeof v === "object" && !Array.isArray(v);
const exact = (v: Row, fields: readonly string[]) =>
  JSON.stringify(Object.keys(v).sort()) === JSON.stringify([...fields].sort());
function date(v: unknown): v is string {
  return typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) &&
    Number.isFinite(Date.parse(`${v}T00:00:00Z`)) &&
    new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v;
}
function scalar(v: unknown, kind: Kind) {
  if (kind === "boolean") return typeof v === "boolean";
  if (typeof v !== "string") return false;
  if (kind === "text") return !!v.trim() && v.length <= 512;
  if (kind === "date") return date(v);
  if (kind === "instant") return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z$/.test(v) &&
    date(v.slice(0, 10)) && Number.isFinite(Date.parse(v)) &&
    new Date(v).toISOString().slice(0, 19) === v.slice(0, 19);
  if (kind === "integer") return /^(0|[1-9]\d{0,18})$/.test(v) && BigInt(v) <= BigInt("9223372036854775807");
  return /^-?(0|[1-9]\d{0,13})\.\d{6}$/.test(v);
}
const instantKey = (v: unknown) => {
  const s = String(v);
  return `${s.slice(0, 19)}.${(s.slice(19, -1).replace(/^\./, "")).padEnd(6, "0")}Z`;
};
/** SQL emits numeric and integer strings before JavaScript can round them. */
export function validProductionWorkbookPayload(value: unknown): boolean {
  if (!object(value) || !exact(value, [...Object.keys(workbookResources), "report_status"]) ||
      !Array.isArray(value.report_status) || value.report_status.length !== 5) return false;
  const metadata = ["report_scope", "shop_id", "publication_id", "definition_version", "model_version", "funnel_version",
    "as_of_at", "report_from_date", "report_through_date", "atomic_resource_refresh"];
  const statuses = new Map<string, Row>();
  for (const row of value.report_status) {
    if (!object(row) || !exact(row, [...metadata, "resource_name", "state", "row_count", "is_stale", "readiness"]) ||
        typeof row.resource_name !== "string" || !Object.hasOwn(workbookResources, row.resource_name) ||
        statuses.has(row.resource_name) || !["selected", "not_selected"].includes(String(row.state)) ||
        row.atomic_resource_refresh !== false) return false;
    statuses.set(row.resource_name, row);
  }
  const c = value.report_status[0] as Row;
  if (c.report_scope !== "selected_full_build" ||
    !["shop_id", "publication_id", "definition_version", "model_version", "funnel_version"].every(k => scalar(c[k], "text")) ||
    !scalar(c.as_of_at, "instant") || !date(c.report_from_date) || !date(c.report_through_date)) return false;
  if ([...statuses.values()].some(r => metadata.some(k => r[k] !== c[k]))) return false;
  const selected = new Set([...statuses.entries()].filter(([, r]) => r.state === "selected").map(([name]) => name));
  if (!selected.size) return false;
  const fromDate = c.report_from_date, throughDate = c.report_through_date;
  const from = Date.parse(`${fromDate}T00:00:00Z`), through = Date.parse(`${throughDate}T00:00:00Z`);
  const days = (through - from) / 86400000 + 1;
  if (days < 1 || days > 31) return false;
  const scopes = new Set<string>(), models = new Set<unknown>(), funnels = new Set<unknown>();
  for (const [name, spec] of Object.entries(workbookResources)) {
    const rows = value[name], metrics = [...spec.integers, ...spec.decimals];
    if (!Array.isArray(rows) || rows.length > spec.limit ||
        !selected.has(name) && rows.length || selected.has(name) && name === "store_daily" && !rows.length) return false;
    const status = statuses.get(name)!;
    if (!object(status.readiness) || !exact(status.readiness, metrics) ||
        (selected.has(name) ? status.row_count !== String(rows.length) || typeof status.is_stale !== "boolean" :
          status.row_count !== null || status.is_stale !== null)) return false;
    const keys = new Set<string>();
    for (const row of rows) {
      if (!object(row) || !exact(row, [...Object.keys(spec.dimensions), "readiness", ...metrics]) ||
          !Object.entries(spec.dimensions).every(([field, type]) => scalar(row[field], type)) ||
          !object(row.readiness) || !exact(row.readiness, metrics)) return false;
      const readiness = row.readiness;
      if (metrics.some(field => row[field] === null ? readiness[field] !== "withheld" :
        readiness[field] !== "ready" || !scalar(row[field],
          (spec.integers as readonly string[]).includes(field) ? "integer" : "decimal"))) return false;
      if (name === "customer_cohorts" && (String(row.cohort_month).slice(8) !== "01" ||
          row.mature === false && metrics.some(field => row[field] !== null))) return false;
      const key = JSON.stringify(spec.key.map(k => row[k]));
      if (keys.has(key)) return false;
      keys.add(key);
      scopes.add(JSON.stringify([row.shop_id, row.publication_id, row.definition_version]));
      if (row.shop_id !== c.shop_id || row.publication_id !== c.publication_id || row.definition_version !== c.definition_version ||
          name === "customer_cohorts" && instantKey(row.as_of_at) !== instantKey(c.as_of_at)) return false;
      if (name === "acquisition_daily") {
        if (row.model_version !== c.model_version) return false;
        models.add(row.model_version);
      }
      if (name === "funnel_daily") {
        if (row.funnel_version !== c.funnel_version) return false;
        funnels.add(row.funnel_version);
      }
    }
    if (selected.has(name) && rows.length && status.is_stale !== rows.some(r => r.is_stale === true)) return false;
    for (const field of metrics) {
      const states = new Set(rows.map(r => r.readiness[field]));
      const expected = !selected.has(name) ? "unavailable" : !rows.length ? "no_rows" :
        states.size > 1 ? "mixed" : [...states][0];
      if (status.readiness[field] !== expected) return false;
    }
  }
  if (scopes.size !== 1 || models.size > 1 || funnels.size > 1) return false;
  const stores = value.store_daily as Row[];
  if (selected.has("store_daily") && stores.length !== days) return false;
  for (const name of ["store_daily", "product_daily", "acquisition_daily", "funnel_daily"]) {
    if ((value[name] as Row[]).some(r => String(r.report_date) < fromDate || String(r.report_date) > throughDate)) return false;
  }
  const allSessions = (value.funnel_daily as Row[]).filter(r => r.stage_id === "all_sessions");
  return !selected.has("funnel_daily") ||
    allSessions.length === days && new Set(allSessions.map(r => r.report_date)).size === days;
}
