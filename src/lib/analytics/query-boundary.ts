const views = {
  store_daily: ["report_date"],
  acquisition_daily: ["report_date", "channel", "campaign_bucket", "model_version"],
  product_daily: ["report_date", "sku_bucket"],
  customer_cohorts: ["cohort_month", "observation_age_days", "acquisition_definition_version"],
  funnel_daily: ["report_date", "stage_id", "funnel_version"],
} as const;
export type ReportView = keyof typeof views;
/** Parameterized read-only reporting access. No arbitrary SQL, joins or detail routes. */
export function reportQuery(input: {
  view: ReportView; shop: string; publication: string; definition: string; from: string; through: string;
  filters: Record<string, string | number>; limit: number;
}) {
  if (!Object.hasOwn(views, input.view) || !input.shop || !input.publication || !input.definition) throw new Error("invalid_query_scope");
  const validDate = (d: string) => /^\d{4}-\d{2}-\d{2}$/.test(d) &&
    Number.isFinite(Date.parse(d)) && new Date(d).toISOString().slice(0, 10) === d;
  if (!validDate(input.from) || !validDate(input.through)) throw new Error("invalid_date_range");
  const span = (Date.parse(input.through) - Date.parse(input.from)) / 86400000;
  if (span < 0 || span > 366 || !Number.isInteger(input.limit) || input.limit < 1 || input.limit > 1000) throw new Error("unbounded_query");
  const allowed = views[input.view] as readonly string[];
  if (Object.keys(input.filters).some(k => !allowed.includes(k) || k === "report_date" || k === "cohort_month")) throw new Error("unsupported_cut");
  if (input.view === "acquisition_daily" && !input.filters.model_version ||
      input.view === "funnel_daily" && !input.filters.funnel_version ||
      input.view === "customer_cohorts" && (input.filters.observation_age_days === undefined || !input.filters.acquisition_definition_version)) throw new Error("missing_view_version");
  const clock = input.view === "customer_cohorts" ? "cohort_month" : "report_date";
  const params: (string | number)[] = [input.shop, input.publication, input.definition, input.from, input.through];
  const predicates = ["shop_id=$1", "publication_id=$2", "definition_version=$3", `${clock} between $4::date and $5::date`];
  for (const [column, value] of Object.entries(input.filters)) {
    params.push(value); predicates.push(`"${column}"=$${params.length}`);
  }
  params.push(input.limit);
  return { sql: `select * from lean_analytics."${input.view}" where ${predicates.join(" and ")} order by "${clock}" limit $${params.length}`, params };
}
