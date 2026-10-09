import { acceptGoogleSpend, type SpendDayControl } from "./googleSpendAcceptance";
import { prepareGoogleDeliveryReport } from "./googleDeliveryReport";
import { prepareMetaHourlySpendDay, type MetaHourlySpendDay } from "./metaHourlySpendInput";
import { validProductionReportPayload } from "./productionReportDelivery";
import { decimal, micros, nyDate, type Row } from "./primitives";
import type { SpendBase } from "./spend";
import { prepareFreshGoogleSpend } from "./googleSpendRegistration";

export const savedMarketingPath = "/api/analytics/reports/marketing";
export const savedMarketingProject = "xnfjdbpjuaezxjgargto";
export const savedMarketingShop = "mullybox-store.myshopify.com";
const object = (v: unknown): v is Row => !!v && typeof v === "object" && !Array.isArray(v);
const exact = (v: Row, fields: string[]) =>
  Object.keys(v).sort().join(",") === fields.sort().join(",");
function time(value: unknown): string {
  if (typeof value !== "string") throw new Error("saved_marketing_time");
  nyDate(value);
  if (new Date(value).toISOString().slice(0, 19) !== value.slice(0, 19))
    throw new Error("saved_marketing_time");
  return value;
}
const hash = (v: unknown): v is string => typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
const orderedClocks = (values: string[]) => [...values].sort((a, b) => {
  const key = (s: string) => s.slice(0, 19) + (/\.(\d+)Z$/.exec(s)?.[1] ?? "").padEnd(6, "0");
  return key(a).localeCompare(key(b));
});
const day = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d\d-\d\d$/.test(v) &&
  Number.isFinite(Date.parse(`${v}T00:00:00Z`)) && new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v;

/** Application source jobs are not automatic cycles or registered spend jobs.
 * Adapt only a local validation copy to the existing closed-day validators.
 * Persisted evidence continues to name the actual application job. */
export function prepareApplicationGoogleReport(p: Row, publication: string) {
  if (p.kind !== "app_google_v1" || typeof p.jobId !== "string" || !/^[1-9]\d{0,18}$/.test(p.jobId) ||
    !object(p.base) || !object(p.manifest) || !object(p.costControl) || !object(p.delivery))
    throw new Error("app_google_shape");
  const ref = `app-marketing-job:${p.jobId}`, m = p.manifest;
  if (m.projectRef !== savedMarketingProject || m.accountId !== "4335795219" ||
    m.loginCustomerId !== "9552995078" || m.actorRef !== ref || m.revisionRef !== ref ||
    m.approvalRef !== "app-owned-marketing-v1" ||
    p.base.evidenceRef !== `lean_private.marketing_source_jobs/${p.jobId}` ||
    p.base.accountId !== "4335795219" || p.base.sourceCurrency !== "USD" ||
    p.base.sourceTimezone !== "America/New_York")
    throw new Error("app_google_scope");
  const run = prepareFreshGoogleSpend(m).registration.args.p_scope.days[0]?.runId;
  if (!run || p.base.baseReportId !== run) throw new Error("app_google_identity");
  const b = { ...p.base, evidenceRef: `lean_private.spend_jobs/${run}` } as unknown as SpendBase;
  const c = p.costControl as unknown as SpendDayControl, asOf = time(p.asOf);
  const accepted = acceptGoogleSpend({ version: 1, manifest: m, bases: [b], controls: [c],
    shop: savedMarketingShop, publication, asOf, sales: null });
  if (accepted.checks.length !== 1 || accepted.checks[0].date !== b.date ||
    accepted.checks[0].spendIssues.length) throw new Error("app_google_control");
  const result = prepareGoogleDeliveryReport({ binding: p.delivery, fresh: {
    manifest: m, bases: [b], controls: [c], marketingInventory: {
      shop: savedMarketingShop, dates: [b.date], accounts: [{ provider: "google_ads", accountId: b.accountId }],
      complete: false, independentlyExtracted: false, evidenceRef: "not-claimed", approvalRef: "not-claimed",
      capturedAt: asOf, salesScope: "unverified", salesCoverageRef: null,
      customerScope: "unverified", customerCoverageRef: null,
    },
  }, projectRef: savedMarketingProject, shop: savedMarketingShop, publication,
  fromDate: b.date, throughDate: b.date, asOf });
  if (typeof result.spend_usd !== "string") throw new Error("app_google_spend");
  return result;
}

/** Historical, immutable source comparison. Capture clocks are not refreshed.
 * This is not a full-build registration, marketing inventory certification, or
 * authorization to capture. SQL authenticates and binds the stored source rows.
 */
export function prepareSavedMarketingReport(value: unknown, now = new Date().toISOString()) {
  time(now);
  if (!object(value) || !exact(value, ["scope", "days", "observed"]) || !object(value.scope))
    throw new Error("saved_marketing_envelope");
  const s = value.scope;
  if (!exact(s, ["source_id", "audience", "project_ref", "shop", "not_before", "expires_at",
    "lookback_days", "include_observed_sales"]) || s.project_ref !== savedMarketingProject ||
    s.shop !== savedMarketingShop || typeof s.source_id !== "string" ||
    !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(s.source_id) ||
    s.audience !== `posthog:353503:source:${s.source_id}` ||
    !Number.isInteger(s.lookback_days) || Number(s.lookback_days) < 1 || Number(s.lookback_days) > 7 ||
    typeof s.include_observed_sales !== "boolean" ||
    Date.parse(time(s.not_before)) > Date.parse(now) || Date.parse(time(s.expires_at)) <= Date.parse(now) ||
    Date.parse(String(s.expires_at)) - Date.parse(String(s.not_before)) > 14 * 86400000 ||
    !Array.isArray(value.days) || value.days.length !== s.lookback_days)
    throw new Error("saved_marketing_scope");
  const today = nyDate(now), expected = Array.from({ length: Number(s.lookback_days) }, (_, i) =>
    new Date(Date.parse(`${today}T00:00:00Z`) - (i + 1) * 86400000).toISOString().slice(0, 10)).sort();
  const marketing: Row[] = [], statuses: Row[] = [], totals: Row[] = [];
  for (let i = 0; i < value.days.length; i++) {
    const d = value.days[i];
    if (!object(d) || !exact(d, ["date", "google", "google_sha256", "meta", "meta_sha256"]) ||
      !day(d.date) || d.date !== expected[i]) throw new Error("saved_marketing_days");
    const date = d.date;
    const emit = (provider: string, account: string, spend: string, sourceAt: string, controlAt: string,
      sourceHash: string, empty: boolean, sourceTimezone: string, counts: Row = {}) => {
      for (const t of [sourceAt, controlAt])
        if (Date.parse(time(t)) > Date.parse(now)) throw new Error("saved_marketing_future");
      const oldest = orderedClocks([sourceAt, controlAt])[0];
      marketing.push({ report_date: date, provider, account_id: account, shop_id: savedMarketingShop,
        definition_version: "saved-marketing-v1", report_scope: "saved_account_day",
        source_currency: "USD", source_timezone: sourceTimezone, report_timezone: "America/New_York",
        source_captured_at: sourceAt, control_captured_at: controlAt, source_sha256: sourceHash,
        evaluated_at: now,
        source_age_seconds: String(Math.floor((Date.parse(now) - Date.parse(oldest)) / 1000)),
        snapshot_status: "historical_snapshot", is_stale: true, verified_empty: empty,
        spend_usd: spend, clicks: null, impressions: null, ...counts,
        spend_readiness: "source_controls_match", certified: false, complete_marketing_inventory: false,
        first_party_roas: null, ncac_usd: null, mer: null });
    };
    if (d.google === null ? d.google_sha256 !== null : !hash(d.google_sha256))
      throw new Error("saved_marketing_google_hash");
    if (d.google !== null) {
      if (!object(d.google) || !object(d.google.base) || !object(d.google.manifest) ||
        !object(d.google.costControl) || !object(d.google.delivery))
        throw new Error("saved_marketing_google");
      const p = d.google, b = p.base as unknown as SpendBase, c = p.costControl as unknown as SpendDayControl;
      if (b.accountId !== "4335795219" || b.date !== date || b.provider !== "google_ads" ||
        b.sourceCurrency !== "USD" || b.sourceTimezone !== "America/New_York" ||
        (p.manifest as Row).projectRef !== savedMarketingProject)
        throw new Error("saved_marketing_google_scope");
      // Use the genuine original asOf and manifest, not the delivery clock.
      const asOf = time(p.asOf), publication = `saved-marketing:${d.google_sha256}`;
      const accepted = p.kind === "app_google_v1" ? null : acceptGoogleSpend({ version: 1, manifest: p.manifest, bases: [b], controls: [c],
        shop: savedMarketingShop, publication, asOf, sales: null });
      if (accepted && (accepted.checks.length !== 1 || accepted.checks[0].date !== date ||
        accepted.checks[0].spendIssues.length)) throw new Error("saved_marketing_google_control");
      const delivery = p.kind === "app_google_v1" ? prepareApplicationGoogleReport(p, publication) :
        prepareGoogleDeliveryReport({ binding: p.delivery, fresh: {
        manifest: p.manifest, bases: [b], controls: [c], marketingInventory: {
          shop: savedMarketingShop, dates: [date], accounts: [{ provider: "google_ads", accountId: b.accountId }],
          complete: false, independentlyExtracted: false, evidenceRef: "not-claimed", approvalRef: "not-claimed",
          capturedAt: asOf, salesScope: "unverified", salesCoverageRef: null,
          customerScope: "unverified", customerCoverageRef: null,
        },
      }, projectRef: savedMarketingProject, shop: savedMarketingShop, publication,
      fromDate: date, throughDate: date, asOf });
      if (typeof delivery.spend_usd !== "string") throw new Error("saved_marketing_google_spend");
      emit("google_ads", b.accountId, delivery.spend_usd, b.completedAt, c.capturedAt,
        String(d.google_sha256), b.verifiedEmpty, b.sourceTimezone,
        { clicks: delivery.clicks, impressions: delivery.impressions });
    }
    if (d.meta === null ? d.meta_sha256 !== null : !hash(d.meta_sha256))
      throw new Error("saved_marketing_meta_hash");
    if (d.meta !== null) {
      if (!object(d.meta) || d.meta.accountId !== "act_2796962933960445" || d.meta.date !== date ||
        d.meta.version !== 2) throw new Error("saved_marketing_meta_scope");
      const p = d.meta as unknown as MetaHourlySpendDay;
      // A historical comparison interval, not a new source-freshness assertion.
      const clocks = orderedClocks([time(p.source.capturedAt), time(p.control.capturedAt)]);
      const prepared = prepareMetaHourlySpendDay(p, { projectRef: savedMarketingProject, shop: savedMarketingShop,
        publication: `saved-marketing:${d.meta_sha256}`, freshnessCutoffAt: clocks[0], asOf: clocks[1] });
      emit("meta_ads", p.accountId, decimal(prepared.facts.reduce((n, r) => n + micros(String(r.spend_usd)), BigInt(0))),
        p.source.capturedAt, p.control.capturedAt, String(d.meta_sha256), p.source.verifiedEmpty, p.sourceTimezone);
    }
    const rows = marketing.filter(r => r.report_date === date);
    const both = rows.length === 2;
    totals.push({ report_date: date, report_scope: "selected_google_meta_accounts",
      report_timezone: "America/New_York", report_currency: "USD",
      spend_usd: both ? decimal(rows.reduce((n, r) => n + micros(String(r.spend_usd)), BigInt(0))) : null,
      spend_readiness: both ? "source_controls_match" : "withheld_missing_provider",
      complete_marketing_inventory: false, certified: false, is_stale: true,
      total_sales_usd: null, collected_cash_usd: null, new_customers: null,
      first_party_roas: null, ncac_usd: null, mer: null });
    statuses.push({ report_date: date, google_state: d.google === null ? "unavailable" : "historical_snapshot",
      meta_state: d.meta === null ? "unavailable" : "historical_snapshot",
      sales_state: "unavailable", complete_sales_window: false, cross_source_ratios: "withheld" });
  }
  const observed = value.observed;
  if (!s.include_observed_sales && observed !== null) throw new Error("saved_marketing_unapproved_sales");
  if (observed !== null && !validProductionReportPayload(observed)) throw new Error("saved_marketing_sales");
  const input = observed as { store_daily: Row[]; product_daily: Row[] } | null;
  const stores = (input?.store_daily ?? []).filter(r => expected.includes(String(r.report_date)));
  const products = (input?.product_daily ?? []).filter(r => expected.includes(String(r.report_date)));
  for (const status of statuses)
    if (stores.some(r => r.report_date === status.report_date)) status.sales_state = "webhook_observed_only";
  return { marketing_daily: marketing, marketing_totals: totals, store_daily: stores,
    product_daily: products, report_status: statuses };
}
