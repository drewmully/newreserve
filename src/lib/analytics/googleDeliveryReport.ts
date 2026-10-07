import { acceptGoogleSpend } from "./googleSpendAcceptance";
import { prepareFreshGoogleSpend } from "./googleSpendRegistration";
import type { FreshGoogleSpendReportInput } from "./googleSpendReportInput";
import { normalizeSpendBase } from "./spend";
import { deliveryMetrics } from "./reporting";
import { decimal, nyDate, type Row } from "./primitives";

export const googleDeliveryDefinition = "google-account-daily-v1";
export const googleDeliveryPath = "/api/analytics/reports/google-delivery";
export const googleDeliveryMetrics = ["spend_usd", "clicks", "impressions", "ctr", "cpc_usd", "cpm_usd"] as const;
export const googleDeliveryKey = ["shop_id", "account_id", "report_date", "definition_version", "publication_id"] as const;
export type GoogleDeliveryBinding = {
  version: 1; accountId: string; date: string; approvalRef: string;
  definitionVersion: typeof googleDeliveryDefinition;
  control: {
    evidenceRef: string; capturedAt: string; complete: boolean; independentlyExtracted: boolean;
    clickDefinition: "google_ads.metrics.clicks";
    clicks: string | null; impressions: string | null;
    campaigns: { id: string; clicks: string | null; impressions: string | null }[];
  };
};
const object = (v: unknown): v is Row => !!v && typeof v === "object" && !Array.isArray(v);
const exact = (v: Row, fields: readonly string[]) =>
  Object.keys(v).sort().join(",") === [...fields].sort().join(",");
const ref = (s: unknown): s is string =>
  typeof s === "string" && s === s.trim() && s.length > 0 && s.length <= 512 && !/[\u0000-\u001f]/.test(s);
function count(value: unknown): bigint | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string" || !/^(0|[1-9]\d{0,15})$/.test(value) ||
    BigInt(value) > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("google_delivery_count");
  return BigInt(value);
}
function instant(value: unknown): number {
  if (typeof value !== "string" || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/.test(value))
    throw new Error("google_delivery_time");
  nyDate(value);
  const n = Date.parse(value);
  if (new Date(n).toISOString().slice(0, 19) !== value.slice(0, 19)) throw new Error("google_delivery_time");
  return n;
}
export function validateGoogleDeliveryBinding(value: unknown): GoogleDeliveryBinding {
  if (!object(value) || !exact(value, ["version", "accountId", "date", "approvalRef", "definitionVersion", "control"]) ||
    value.version !== 1 || value.definitionVersion !== googleDeliveryDefinition ||
    typeof value.accountId !== "string" || !/^\d{10}$/.test(value.accountId) ||
    typeof value.date !== "string" || !/^\d{4}-\d\d-\d\d$/.test(value.date) ||
    !Number.isFinite(Date.parse(`${value.date}T00:00:00Z`)) ||
    new Date(`${value.date}T00:00:00Z`).toISOString().slice(0, 10) !== value.date || !ref(value.approvalRef))
    throw new Error("google_delivery_binding");
  const c = value.control;
  if (!object(c) || !exact(c, ["evidenceRef", "capturedAt", "complete", "independentlyExtracted",
    "clickDefinition", "clicks", "impressions", "campaigns"]) || !ref(c.evidenceRef) ||
    typeof c.complete !== "boolean" || typeof c.independentlyExtracted !== "boolean" ||
    c.clickDefinition !== "google_ads.metrics.clicks" || !Array.isArray(c.campaigns) || c.campaigns.length > 10000)
    throw new Error("google_delivery_control");
  instant(c.capturedAt); count(c.clicks); count(c.impressions);
  const ids = new Set<string>();
  for (const row of c.campaigns) {
    if (!object(row) || !exact(row, ["id", "clicks", "impressions"]) ||
      typeof row.id !== "string" || !/^[1-9]\d*$/.test(row.id) || ids.has(row.id))
      throw new Error("google_delivery_campaign");
    ids.add(row.id); count(row.clicks); count(row.impressions);
  }
  return value as unknown as GoogleDeliveryBinding;
}

/** Pure optional extension. Uses retained native bases and independent controls;
 * never adds an all-marketing gate, source read, approval, or database write.
 * The five existing report families and formulas are unchanged.
 */
export function prepareGoogleDeliveryReport(input: {
  binding: unknown; fresh: FreshGoogleSpendReportInput; projectRef: string;
  publication: string; shop: string; fromDate: string; throughDate: string; asOf: string;
}) {
  const b = validateGoogleDeliveryBinding(input.binding), c = b.control;
  const { manifest: m } = prepareFreshGoogleSpend(input.fresh.manifest);
  if (!ref(input.shop) || !ref(input.publication) || m.projectRef !== input.projectRef ||
    m.accountId !== b.accountId || m.days.length !== 1 || m.days[0].date !== b.date ||
    input.fromDate !== b.date || input.throughDate !== b.date || input.fresh.bases.length !== 1 ||
    input.fresh.controls.length !== 1 || instant(input.asOf) < instant(m.days[0].dueAt))
    throw new Error("google_delivery_scope");
  const base = input.fresh.bases[0];
  const accepted = acceptGoogleSpend({ version: 1, manifest: input.fresh.manifest,
    bases: input.fresh.bases, controls: input.fresh.controls,
    shop: input.shop, publication: input.publication, asOf: input.asOf, sales: null });
  const spendReady = accepted.checks.length === 1 && accepted.checks[0].spendIssues.length === 0;
  const countScope = spendReady && c.complete && c.independentlyExtracted &&
    c.evidenceRef !== base.evidenceRef && instant(c.capturedAt) >= instant(m.days[0].dueAt) &&
    instant(c.capturedAt) <= instant(input.asOf) && c.campaigns.length === base.rows.length &&
    c.campaigns.every(row => base.rows.some(actual => actual.campaignId === row.id));
  const normalized = spendReady ? normalizeSpendBase(base, input.publication) : [];
  const matched = (field: "clicks" | "impressions") => {
    // Empty monetary rows never manufacture zero delivery counts.
    if (!countScope || base.rows.length === 0 || count(c[field]) === null) return null;
    let total = BigInt(0);
    for (const row of base.rows) {
      const observed = count(row[field]), control = count(c.campaigns.find(r => r.id === row.campaignId)![field]);
      if (observed === null || control === null || observed !== control) return null;
      total += observed;
    }
    if (total > BigInt(Number.MAX_SAFE_INTEGER) || total !== count(c[field])) return null;
    return total;
  };
  const clicks = matched("clicks"), impressions = matched("impressions");
  const spend = spendReady ? decimal(base.rows.reduce((n, row) => n + BigInt(row.costMicros), BigInt(0))) : null;
  // Reuse the existing ratio-of-sums implementation, independently narrowing
  // each count. Unknown clicks may withhold CTR/CPC while preserving CPM.
  const rates = deliveryMetrics(normalized.map(row => ({ ...row,
    clicks: clicks === null ? null : row.clicks,
    impressions: impressions === null ? null : row.impressions,
  })), spendReady);
  const values = { spend_usd: spend, clicks: clicks?.toString() ?? null,
    impressions: impressions?.toString() ?? null, ...rates };
  return {
    shop_id: input.shop, publication_id: input.publication, definition_version: googleDeliveryDefinition,
    report_scope: "single_google_account", provider: "google_ads", account_id: b.accountId,
    report_date: b.date, source_currency: "USD", source_timezone: "America/New_York",
    click_definition: "google_ads.metrics.clicks", as_of_at: input.asOf, is_stale: true,
    ...values, readiness: Object.fromEntries(Object.entries(values)
      .map(([field, value]) => [field, value === null ? "withheld" : "observed_unverified"])),
  };
}
