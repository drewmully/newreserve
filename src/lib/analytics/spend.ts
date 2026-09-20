import { checked, collectPages, decimal, key, nyDate, type Page, type Row } from "./primitives";
export type GoogleCampaignRow = {
  campaign: { id: string };
  segments: { date: string };
  metrics: { costMicros: string; clicks?: string; impressions?: string };
};
export type SpendBase = {
  provider: string; accountId: string; date: string; baseReportId: string;
  sourceTimezone: string; sourceCurrency: string; completedAt: string;
  paginationComplete: boolean; verifiedEmpty: boolean; evidenceRef: string;
  rows: { campaignId: string; costMicros: string; clicks?: string; impressions?: string }[];
};
function unsignedInteger(s: string): bigint {
  if (!/^(0|[1-9]\d*)$/.test(s)) throw new Error("invalid_provider_integer");
  return BigInt(s);
}
function optionalCount(s: string | undefined): number | null {
  if (s === undefined) return null;
  const value = unsignedInteger(s);
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("unsafe_provider_count");
  return Number(value);
}
export async function fetchGoogleCampaignPages(
  search: (cursor: string | null) => Promise<{ results?: GoogleCampaignRow[]; nextPageToken?: string }>,
  maxPages: number,
): Promise<GoogleCampaignRow[]> {
  return collectPages(async cursor => {
    const response = await search(cursor);
    // A missing results property is not silently certified as zero.
    if (!Array.isArray(response.results)) throw new Error("schema_drift");
    const next = response.nextPageToken;
    if (next !== undefined && typeof next !== "string") throw new Error("schema_drift");
    return { rows: response.results, hasNextPage: !!next, endCursor: next || null } as Page<GoogleCampaignRow>;
  }, maxPages);
}
export function googleSpendBase(rows: GoogleCampaignRow[], context: Omit<SpendBase, "rows">): SpendBase {
  if (context.provider !== "google_ads") throw new Error("wrong_provider");
  return { ...context, rows: rows.map(row => {
    if (row.segments?.date !== context.date || !row.campaign?.id || typeof row.metrics?.costMicros !== "string") throw new Error("schema_drift");
    return { campaignId: row.campaign.id, costMicros: row.metrics.costMicros,
      clicks: row.metrics.clicks, impressions: row.metrics.impressions };
  }) };
}
export function normalizeSpendBase(base: SpendBase, publication: string): Row[] {
  nyDate(base.completedAt);
  if (!base.paginationComplete || !base.evidenceRef ||
      (base.rows.length === 0) !== base.verifiedEmpty) throw new Error("incomplete_spend_base");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(base.date)) throw new Error("invalid_date");
  const campaigns = new Set<string>();
  const rows = base.rows.length ? base.rows : [{ campaignId: "", costMicros: "0" }];
  return rows.map(row => {
    if (campaigns.has(row.campaignId)) throw new Error("duplicate_base_campaign");
    campaigns.add(row.campaignId);
    const amount = decimal(unsignedInteger(row.costMicros));
    const eligible = base.sourceCurrency === "USD" && base.sourceTimezone === "America/New_York";
    return checked("marketing_spend_daily", {
      provider: base.provider, account_id: base.accountId,
      campaign_key: key(base.provider, base.accountId, row.campaignId || "__verified_empty_account_day__"),
      source_campaign_id: row.campaignId || null, report_date: base.date, base_report_id: base.baseReportId,
      source_timezone: base.sourceTimezone, source_currency: base.sourceCurrency, source_amount: amount,
      report_currency: "USD", spend_usd: eligible ? amount : null,
      impressions: optionalCount(row.impressions), clicks: optionalCount(row.clicks),
      click_definition: row.clicks === undefined ? null : "google_ads.metrics.clicks",
      channel: base.provider, source_updated_at: base.completedAt, publication_id: publication,
    });
  });
}
export type ExpectedSpendScope = { provider: string; accountId: string; date: string };
/** Expectations are an independent approved inventory, never discovered from returned rows. */
export function selectSpendBases(bases: SpendBase[], expected: ExpectedSpendScope[], approvalRef: string) {
  if (!approvalRef || !expected.length) throw new Error("missing_expected_spend_scope");
  const scope = (b: ExpectedSpendScope) => key(b.provider, b.accountId, b.date);
  const expectedKeys = new Set(expected.map(scope));
  if (expectedKeys.size !== expected.length || bases.some(b => !expectedKeys.has(scope(b)))) throw new Error("unexpected_spend_scope");
  return expected.map(e => {
    const candidates = bases.filter(b => scope(b) === scope(e)).sort((a, b) => Date.parse(b.completedAt) - Date.parse(a.completedAt));
    for (const b of candidates) nyDate(b.completedAt);
    const selected = candidates.find(b => b.paginationComplete && !!b.evidenceRef && ((b.rows.length === 0) === b.verifiedEmpty));
    if (!selected) return { scope: e, base: null, status: "missing" as const };
    const ties = candidates.filter(b => b.completedAt === selected.completedAt && b.baseReportId !== selected.baseReportId);
    if (ties.length) throw new Error("ambiguous_base_revision");
    return { scope: e, base: selected, status: candidates[0] === selected ? "complete" as const : "stale" as const };
  });
}
