import { normalizeSpendBase, type SpendBase } from "./spend";
import { reportDates } from "./commerceCandidate";
import { nyDate } from "./primitives";
import { evidenceDigest } from "./evidenceIntake";

export type MetaSpendDay = {
  version: 1; projectRef: string; shop: string; generationId: string;
  accountId: string; date: string; sourceCurrency: string; sourceTimezone: string;
  approvalRef: string; actorRef: string;
  source: {
    evidenceRef: string; accountMetadataRef: string; capturedAt: string;
    complete: boolean; paginationComplete: boolean; verifiedEmpty: boolean;
    rows: { snapshot_date: string; ad_account_id: string; campaign_id: string;
      adset_id: string; spend_cents: string | number }[];
  };
  control: {
    evidenceRef: string; approvalRef: string; capturedAt: string;
    independentlyExtracted: boolean; complete: boolean; verifiedEmpty: boolean;
    totalCostMicros: string; campaigns: { id: string; costMicros: string }[];
  };
};
export const spendRef = (s: unknown): s is string => typeof s === "string" && s === s.trim() &&
  s.length > 0 && s.length <= 512 && !/[\u0000-\u001f]/.test(s);
export function spendInstant(s: string): number {
  if (!spendRef(s) || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/.test(s))
    throw new Error("marketing_timestamp");
  nyDate(s);
  return Date.parse(s);
}
function exact(value: unknown, keys: string[]) {
  return value !== null && typeof value === "object" && !Array.isArray(value) &&
    Object.keys(value).sort().join(",") === [...keys].sort().join(",");
}
function unsigned(value: unknown): bigint {
  if (!spendRef(value) || !/^(0|[1-9]\d{0,19})$/.test(value))
    throw new Error("meta_spend_integer");
  return BigInt(value);
}

/** Converts retained ad-set/day rows into the existing campaign/day spend facts.
 * No live read, key cleanup, missing-day fill, control invention or certification.
 */
export function prepareMetaSpendDay(packet: MetaSpendDay, input: {
  projectRef: string; shop: string; publication: string; freshnessCutoffAt: string; asOf: string;
}) {
  if (!exact(packet, ["version", "projectRef", "shop", "generationId", "accountId", "date",
    "sourceCurrency", "sourceTimezone", "approvalRef", "actorRef", "source", "control"]) ||
    packet.version !== 1 || packet.projectRef !== input.projectRef || packet.shop !== input.shop ||
    ![packet.generationId, packet.accountId].every(spendRef) ||
    !/^[A-Za-z0-9:_-]{1,128}$/.test(packet.generationId) || !/^act_[1-9]\d+$/.test(packet.accountId) ||
    ![packet.approvalRef, packet.actorRef].every(spendRef) ||
    packet.sourceCurrency !== "USD" || packet.sourceTimezone !== "America/New_York")
    throw new Error("meta_spend_scope");
  reportDates(packet.date, packet.date);
  if (packet.date >= nyDate(input.asOf)) throw new Error("meta_spend_open_day");
  const source = packet.source, control = packet.control;
  if (!exact(source, ["evidenceRef", "accountMetadataRef", "capturedAt", "complete",
    "paginationComplete", "verifiedEmpty", "rows"]) ||
    !exact(control, ["evidenceRef", "approvalRef", "capturedAt", "independentlyExtracted",
      "complete", "verifiedEmpty", "totalCostMicros", "campaigns"]) ||
    ![source.evidenceRef, source.accountMetadataRef, control.evidenceRef, control.approvalRef].every(spendRef) ||
    control.evidenceRef === source.evidenceRef || control.evidenceRef === source.accountMetadataRef ||
    control.complete !== true || control.independentlyExtracted !== true ||
    source.complete !== true || source.paginationComplete !== true ||
    !Array.isArray(source.rows) || source.rows.length > 1000 ||
    !Array.isArray(control.campaigns) || control.campaigns.length > 1000 ||
    source.verifiedEmpty !== (source.rows.length === 0) ||
    control.verifiedEmpty !== (control.campaigns.length === 0) ||
    source.verifiedEmpty !== control.verifiedEmpty)
    throw new Error("meta_spend_coverage_or_control");
  const cutoff = spendInstant(input.freshnessCutoffAt), asOf = spendInstant(input.asOf);
  if (cutoff > asOf || [source.capturedAt, control.capturedAt].some(s => {
    const captured = spendInstant(s);
    return captured < cutoff || captured > asOf || packet.date >= nyDate(s);
  })) throw new Error("meta_spend_stale_or_future");
  const adsets = new Set<string>(), campaigns = new Map<string, bigint>();
  for (const row of source.rows) {
    if (!exact(row, ["snapshot_date", "ad_account_id", "campaign_id", "adset_id", "spend_cents"]) ||
      row.snapshot_date !== packet.date || row.ad_account_id !== packet.accountId ||
      ![row.campaign_id, row.adset_id].every(spendRef) ||
      !/^[1-9]\d*$/.test(row.campaign_id) || !/^[1-9]\d*$/.test(row.adset_id) || adsets.has(row.adset_id))
      throw new Error("meta_spend_row_scope_or_duplicate");
    adsets.add(row.adset_id);
    if (typeof row.spend_cents === "number" && (!Number.isSafeInteger(row.spend_cents) || row.spend_cents < 0))
      throw new Error("meta_spend_unsafe_cents");
    const micros = unsigned(String(row.spend_cents)) * BigInt(10000);
    campaigns.set(row.campaign_id, (campaigns.get(row.campaign_id) ?? BigInt(0)) + micros);
  }
  const expected = new Map<string, bigint>();
  for (const row of control.campaigns) {
    if (!exact(row, ["id", "costMicros"]) || !spendRef(row.id) || !/^[1-9]\d*$/.test(row.id) || expected.has(row.id))
      throw new Error("meta_spend_control_campaign");
    expected.set(row.id, unsigned(row.costMicros));
  }
  const total = unsigned(control.totalCostMicros);
  if (expected.size !== campaigns.size || [...expected].some(([id, amount]) => campaigns.get(id) !== amount) ||
    [...expected.values()].reduce((n, amount) => n + amount, BigInt(0)) !== total)
    throw new Error("meta_spend_control_mismatch");
  const base: SpendBase = {
    provider: "meta_ads", accountId: packet.accountId, date: packet.date, baseReportId: packet.generationId,
    sourceTimezone: packet.sourceTimezone, sourceCurrency: packet.sourceCurrency,
    completedAt: source.capturedAt, paginationComplete: true, verifiedEmpty: source.verifiedEmpty,
    evidenceRef: source.evidenceRef,
    rows: [...campaigns].sort(([a], [b]) => a.localeCompare(b)).map(([campaignId, amount]) =>
      ({ campaignId, costMicros: String(amount) })),
  };
  // No Meta count fields enter Google's click-definition normalizer. Optional
  // cross-provider delivery semantics are intentionally not accepted by P6.
  return { base, facts: normalizeSpendBase(base, input.publication), packetDigest: evidenceDigest(packet) };
}
