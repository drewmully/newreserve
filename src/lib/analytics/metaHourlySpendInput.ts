import { checked, decimal, key, micros, nyDate } from "./primitives";
import { reportDates } from "./commerceCandidate";
import { evidenceDigest } from "./evidenceIntake";
import type { SpendBase } from "./spend";

type HourRow = {
  account_id: string; date_start: string; date_stop: string;
  hourly_stats_aggregated_by_advertiser_time_zone: string; spend: string;
};
type HourQuery = {
  since: string; until: string; timeIncrement: 1;
  breakdown: "hourly_stats_aggregated_by_advertiser_time_zone";
  level: "account" | "campaign"; unfiltered: true;
};
export type MetaHourlySpendDay = {
  version: 2; projectRef: string; shop: string; generationId: string;
  accountId: string; date: string; sourceCurrency: string; sourceTimezone: string;
  approvalRef: string; actorRef: string;
  window: { reportTimezone: "America/New_York"; fromAt: string; untilAt: string };
  source: {
    evidenceRef: string; accountMetadataRef: string; capturedAt: string;
    complete: boolean; paginationComplete: boolean; verifiedEmpty: boolean;
    query: HourQuery; rows: (HourRow & { campaign_id: string })[];
  };
  control: {
    evidenceRef: string; approvalRef: string; capturedAt: string;
    independentlyExtracted: boolean; complete: boolean; paginationComplete: boolean;
    verifiedEmpty: boolean; query: HourQuery; rows: HourRow[];
  };
};
const HOUR = 3600000;
const ref = (s: unknown): s is string => typeof s === "string" && s === s.trim() &&
  s.length > 0 && s.length <= 512 && !/[\u0000-\u001f]/.test(s);
function exact(v: unknown, fields: string[]) {
  return !!v && typeof v === "object" && !Array.isArray(v) &&
    Object.keys(v).sort().join(",") === [...fields].sort().join(",");
}
function instant(s: string) {
  if (!ref(s) || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?Z$/.test(s))
    throw new Error("meta_hourly_timestamp");
  nyDate(s);
  return Date.parse(s);
}
function instantMicros(s: string) {
  const ms = instant(s), fraction = /\.(\d+)Z$/.exec(s)?.[1] ?? "";
  return BigInt(ms) * BigInt(1000) + BigInt(fraction.padEnd(6, "0").slice(3));
}
function localHour(time: number, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", hourCycle: "h23",
  }).formatToParts(time);
  const part = (name: string) => parts.find(p => p.type === name)?.value;
  return `${part("year")}-${part("month")}-${part("day")}T${part("hour")}`;
}

/** Derive boundaries, not offsets supplied by a caller. Repeated/missing local
 * hours cannot be disambiguated by Meta's advertiser-hour label alone.
 */
export function metaHourlyWindow(date: string) {
  reportDates(date, date);
  const anchor = Date.parse(`${date}T00:00:00Z`), hours: number[] = [];
  for (let time = anchor - 24 * HOUR; time < anchor + 48 * HOUR; time += HOUR)
    if (nyDate(new Date(time).toISOString()) === date) hours.push(time);
  if (hours.length !== 24) throw new Error("meta_hourly_dst_unsupported");
  const from = hours[0], until = hours[hours.length - 1] + HOUR;
  const since = localHour(from, "America/Los_Angeles").slice(0, 10);
  const through = localHour(until - HOUR, "America/Los_Angeles").slice(0, 10);
  const providerHours = new Map<string, number>();
  for (let time = anchor - 48 * HOUR; time < anchor + 72 * HOUR; time += HOUR) {
    const label = localHour(time, "America/Los_Angeles");
    if (label.slice(0, 10) < since || label.slice(0, 10) > through) continue;
    if (providerHours.has(label)) throw new Error("meta_hourly_dst_unsupported");
    providerHours.set(label, time);
  }
  const dates = reportDates(since, through);
  if (providerHours.size !== dates.length * 24) throw new Error("meta_hourly_dst_unsupported");
  return { fromAt: new Date(from).toISOString(), untilAt: new Date(until).toISOString(),
    since, until: through, providerHours };
}

/** Native campaign-hour spend and a separately captured account-hour control.
 * No provider calls, missing-page repair, daily proration or timezone relabeling.
 */
export function prepareMetaHourlySpendDay(packet: MetaHourlySpendDay, input: {
  projectRef: string; shop: string; publication: string; freshnessCutoffAt: string; asOf: string;
}) {
  if (!exact(packet, ["version", "projectRef", "shop", "generationId", "accountId", "date",
    "sourceCurrency", "sourceTimezone", "approvalRef", "actorRef", "window", "source", "control"]) ||
    packet.version !== 2 || packet.projectRef !== input.projectRef || packet.shop !== input.shop ||
    ![packet.generationId, packet.accountId, packet.approvalRef, packet.actorRef].every(ref) ||
    !/^[A-Za-z0-9:_-]{1,128}$/.test(packet.generationId) || !/^act_[1-9]\d+$/.test(packet.accountId) ||
    packet.sourceCurrency !== "USD" || packet.sourceTimezone !== "America/Los_Angeles")
    throw new Error("meta_hourly_scope");
  const window = metaHourlyWindow(packet.date);
  if (!exact(packet.window, ["reportTimezone", "fromAt", "untilAt"]) ||
    packet.window.reportTimezone !== "America/New_York" ||
    instantMicros(packet.window.fromAt) !== instantMicros(window.fromAt) ||
    instantMicros(packet.window.untilAt) !== instantMicros(window.untilAt))
    throw new Error("meta_hourly_window");
  const source = packet.source, control = packet.control;
  if (!exact(source, ["evidenceRef", "accountMetadataRef", "capturedAt", "complete", "paginationComplete",
    "verifiedEmpty", "query", "rows"]) ||
    !exact(control, ["evidenceRef", "approvalRef", "capturedAt", "independentlyExtracted", "complete",
      "paginationComplete", "verifiedEmpty", "query", "rows"]) ||
    ![source.evidenceRef, source.accountMetadataRef, control.evidenceRef, control.approvalRef].every(ref) ||
    new Set([source.evidenceRef, source.accountMetadataRef, control.evidenceRef]).size !== 3 ||
    source.complete !== true || source.paginationComplete !== true ||
    control.complete !== true || control.paginationComplete !== true || control.independentlyExtracted !== true ||
    typeof source.verifiedEmpty !== "boolean" || typeof control.verifiedEmpty !== "boolean" ||
    !Array.isArray(source.rows) || source.rows.length > 1000 ||
    !Array.isArray(control.rows) || control.rows.length > 48)
    throw new Error("meta_hourly_coverage");
  for (const [query, level] of [[source.query, "campaign"], [control.query, "account"]] as const)
    if (!exact(query, ["since", "until", "timeIncrement", "breakdown", "level", "unfiltered"]) ||
      query.since !== window.since || query.until !== window.until || query.timeIncrement !== 1 ||
      query.breakdown !== "hourly_stats_aggregated_by_advertiser_time_zone" ||
      query.level !== level || query.unfiltered !== true)
      throw new Error("meta_hourly_query");
  const cutoff = instantMicros(input.freshnessCutoffAt), asOf = instantMicros(input.asOf);
  const queryEnd = Math.max(...window.providerHours.values()) + HOUR;
  if (cutoff > asOf || instantMicros(window.untilAt) > asOf ||
    [source.capturedAt, control.capturedAt].some(time =>
      instantMicros(time) < cutoff || instantMicros(time) > asOf ||
      instantMicros(time) < BigInt(queryEnd) * BigInt(1000)))
    throw new Error("meta_hourly_stale_or_open");
  const hourFields = ["account_id", "date_start", "date_stop",
    "hourly_stats_aggregated_by_advertiser_time_zone", "spend"];
  const account = packet.accountId.slice(4);
  const parse = (row: HourRow, campaign: boolean) => {
    if (!exact(row, campaign ? [...hourFields, "campaign_id"] : hourFields) ||
      row.account_id !== account || row.date_start !== row.date_stop ||
      typeof row.hourly_stats_aggregated_by_advertiser_time_zone !== "string" ||
      typeof row.spend !== "string" || !/^(0|[1-9]\d*)(\.\d{1,6})?$/.test(row.spend))
      throw new Error("meta_hourly_row");
    const hour = /^([01]\d|2[0-3]):00:00 - \1:59:59$/.exec(
      row.hourly_stats_aggregated_by_advertiser_time_zone)?.[1];
    const label = `${row.date_start}T${hour}`, time = window.providerHours.get(label);
    if (time === undefined) throw new Error("meta_hourly_row_window");
    return { label, time, amount: micros(row.spend) };
  };
  const seen = new Set<string>(), campaignHours = new Map<string, bigint>();
  const campaigns = new Map<string, bigint>();
  const from = instant(window.fromAt), until = instant(window.untilAt);
  let selectedRows = 0;
  for (const row of source.rows) {
    const { label, time, amount } = parse(row, true);
    if (!ref(row.campaign_id) || !/^[1-9]\d*$/.test(row.campaign_id) ||
      seen.has(`${label}:${row.campaign_id}`)) throw new Error("meta_hourly_duplicate_campaign_hour");
    seen.add(`${label}:${row.campaign_id}`);
    campaignHours.set(label, (campaignHours.get(label) ?? BigInt(0)) + amount);
    if (time >= from && time < until) {
      selectedRows++;
      campaigns.set(row.campaign_id, (campaigns.get(row.campaign_id) ?? BigInt(0)) + amount);
    }
  }
  const accountHours = new Map<string, bigint>();
  let selectedControls = 0;
  for (const row of control.rows) {
    const { label, time, amount } = parse(row, false);
    if (accountHours.has(label)) throw new Error("meta_hourly_duplicate_account_hour");
    accountHours.set(label, amount);
    if (time >= from && time < until) selectedControls++;
  }
  // Reconcile the full two-day capture, including boundary hours excluded from
  // the NY day. A missing bucket is tolerated only when its counterpart is zero
  // and both independently captured, unfiltered responses are complete.
  for (const label of new Set([...accountHours.keys(), ...campaignHours.keys()]))
    if ((accountHours.get(label) ?? BigInt(0)) !== (campaignHours.get(label) ?? BigInt(0)))
      throw new Error("meta_hourly_control_mismatch");
  if (source.verifiedEmpty !== (selectedRows === 0) ||
    control.verifiedEmpty !== (selectedControls === 0) ||
    source.verifiedEmpty !== control.verifiedEmpty)
    throw new Error("meta_hourly_empty_not_verified");
  const base: SpendBase = {
    provider: "meta_ads", accountId: packet.accountId, date: packet.date, baseReportId: packet.generationId,
    sourceTimezone: packet.sourceTimezone, sourceCurrency: packet.sourceCurrency,
    completedAt: source.capturedAt, paginationComplete: true, verifiedEmpty: source.verifiedEmpty,
    evidenceRef: source.evidenceRef,
    rows: [...campaigns].sort(([a], [b]) => a.localeCompare(b))
      .map(([campaignId, amount]) => ({ campaignId, costMicros: String(amount) })),
  };
  // Unlike a daily LA aggregate, these facts have an exact reconciled NY window.
  // Keep source_timezone LA. Do not pass a falsified NY source to the normalizer.
  const facts = (base.rows.length ? base.rows : [{ campaignId: "", costMicros: "0" }]).map(row => {
    const amount = decimal(BigInt(row.costMicros));
    return checked("marketing_spend_daily", {
      provider: base.provider, account_id: base.accountId,
      campaign_key: key(base.provider, base.accountId, row.campaignId || "__verified_empty_account_day__"),
      source_campaign_id: row.campaignId || null, report_date: base.date, base_report_id: base.baseReportId,
      source_timezone: base.sourceTimezone, source_currency: base.sourceCurrency, source_amount: amount,
      report_currency: "USD", spend_usd: amount, impressions: null, clicks: null, click_definition: null,
      channel: base.provider, source_updated_at: base.completedAt, publication_id: input.publication,
    });
  });
  return { base, facts, packetDigest: evidenceDigest(packet) };
}

export type MetaGraphCapture = {
  startedAt: string; finishedAt: string; method: string; url: string;
  params: Record<string, string>; status: number; bodyBytes: number; bodySha256: string;
  pagingCredentialQueryParametersRemoved: boolean; response: unknown;
};
const object = (v: unknown): Record<string, unknown> => {
  if (!v || typeof v !== "object" || Array.isArray(v)) throw new Error("meta_graph_object");
  return v as Record<string, unknown>;
};
/** Accept the retained native HTTP receipt, never the flattened MCP ad_entities
 * response. A single exhausted native page is the bounded supported capture.
 * The receipt digest identifies evidence, not an independently authenticated API.
 */
export function metaHourlyPacketFromCaptures(input: {
  projectRef: string; shop: string; generationId: string; accountId: string; date: string;
  approvalRef: string; actorRef: string; controlApprovalRef: string;
  metadata: MetaGraphCapture; accountHours: MetaGraphCapture; campaignHours: MetaGraphCapture;
  freshnessCutoffAt: string; asOf: string;
}): MetaHourlySpendDay {
  if (!/^act_[1-9]\d+$/.test(input.accountId)) throw new Error("meta_graph_account");
  const window = metaHourlyWindow(input.date);
  const receiptTime = (s: string) => {
    if (typeof s !== "string") throw new Error("meta_graph_timestamp");
    const utc = s.replace(/\+00:00$/, "Z");
    instant(utc);
    return utc;
  };
  const receipt = (capture: MetaGraphCapture, insights: boolean) => {
    if (!capture || capture.method !== "GET" || capture.status !== 200 ||
      capture.url !== `https://graph.facebook.com/v25.0/${input.accountId}${insights ? "/insights" : ""}` ||
      !Number.isSafeInteger(capture.bodyBytes) || capture.bodyBytes < 2 || capture.bodyBytes > 1000000 ||
      !/^[a-f0-9]{64}$/.test(capture.bodySha256) ||
      instantMicros(receiptTime(capture.startedAt)) > instantMicros(receiptTime(capture.finishedAt)))
      throw new Error("meta_graph_receipt");
    const body = object(capture.response);
    if (Object.hasOwn(body, "error")) throw new Error("meta_graph_provider_error");
    return body;
  };
  const metadata = receipt(input.metadata, false);
  if (!exact(input.metadata.params, ["fields"]) ||
    input.metadata.params.fields !== "id,account_id,currency,timezone_name,account_status,business" ||
    metadata.id !== input.accountId || metadata.account_id !== input.accountId.slice(4) ||
    metadata.currency !== "USD" || metadata.timezone_name !== "America/Los_Angeles" ||
    metadata.account_status !== 1 ||
    instantMicros(receiptTime(input.metadata.finishedAt)) < instantMicros(input.freshnessCutoffAt) ||
    instantMicros(receiptTime(input.metadata.finishedAt)) > instantMicros(input.asOf))
    throw new Error("meta_graph_metadata");
  const rows = (capture: MetaGraphCapture, level: "account" | "campaign") => {
    const body = receipt(capture, true), params = capture.params;
    const queryEnd = BigInt(Math.max(...window.providerHours.values()) + HOUR) * BigInt(1000);
    // A response arriving after close does not prove that its request observed
    // a closed provider date. Both independent reads must start after close.
    if (instantMicros(receiptTime(capture.startedAt)) < queryEnd)
      throw new Error("meta_graph_query_started_open");
    if (!exact(params, ["time_range", "time_increment", "breakdowns", "level", "fields", "limit"]) ||
      params.time_increment !== "1" || params.breakdowns !== "hourly_stats_aggregated_by_advertiser_time_zone" ||
      params.level !== level || params.limit !== (level === "account" ? "49" : "1001"))
      throw new Error("meta_graph_query");
    const range = object(JSON.parse(params.time_range));
    const fields = params.fields.split(","), required = [
      "account_id", "account_currency", "date_start", "date_stop", "spend",
      ...(level === "campaign" ? ["campaign_id"] : []),
    ];
    if (!exact(range, ["since", "until"]) || range.since !== window.since || range.until !== window.until ||
      new Set(fields).size !== fields.length || required.some(f => !fields.includes(f)) ||
      fields.some(f => ![...required, "clicks", "impressions"].includes(f)) ||
      !Array.isArray(body.data) || body.data.length > (level === "account" ? 48 : 1000) ||
      Object.keys(body).some(k => !["data", "paging"].includes(k)))
      throw new Error("meta_graph_query_or_budget");
    if (body.paging !== undefined && Object.hasOwn(object(body.paging), "next"))
      throw new Error("meta_graph_pagination_incomplete");
    return body.data.map(value => {
      const row = object(value);
      if (row.account_currency !== "USD") throw new Error("meta_graph_row_currency");
      // Project native identifiers and decimal strings without trimming or
      // normalizing their contents. Delivery counts are outside this contract.
      const projected = {
        account_id: row.account_id, date_start: row.date_start, date_stop: row.date_stop,
        hourly_stats_aggregated_by_advertiser_time_zone: row.hourly_stats_aggregated_by_advertiser_time_zone,
        spend: row.spend, ...(level === "campaign" ? { campaign_id: row.campaign_id } : {}),
      };
      return projected;
    });
  };
  const campaignRows = rows(input.campaignHours, "campaign") as (HourRow & { campaign_id: string })[];
  const accountRows = rows(input.accountHours, "account") as HourRow[];
  const query = (level: "account" | "campaign"): HourQuery => ({
    since: window.since, until: window.until, timeIncrement: 1,
    breakdown: "hourly_stats_aggregated_by_advertiser_time_zone", level, unfiltered: true,
  });
  const selected = (row: HourRow) => {
    const hour = String(row.hourly_stats_aggregated_by_advertiser_time_zone).slice(0, 2);
    const time = window.providerHours.get(`${row.date_start}T${hour}`);
    return time !== undefined && time >= instant(window.fromAt) && time < instant(window.untilAt);
  };
  const packet: MetaHourlySpendDay = {
    version: 2, projectRef: input.projectRef, shop: input.shop, generationId: input.generationId,
    accountId: input.accountId, date: input.date, sourceCurrency: "USD", sourceTimezone: "America/Los_Angeles",
    approvalRef: input.approvalRef, actorRef: input.actorRef,
    window: { reportTimezone: "America/New_York", fromAt: window.fromAt, untilAt: window.untilAt },
    source: {
      evidenceRef: `meta-graph:campaign:${evidenceDigest(input.campaignHours)}`,
      accountMetadataRef: `meta-graph:metadata:${evidenceDigest(input.metadata)}`,
      capturedAt: receiptTime(input.campaignHours.finishedAt), complete: true, paginationComplete: true,
      verifiedEmpty: !campaignRows.some(selected), query: query("campaign"), rows: campaignRows,
    },
    control: {
      evidenceRef: `meta-graph:account:${evidenceDigest(input.accountHours)}`, approvalRef: input.controlApprovalRef,
      capturedAt: receiptTime(input.accountHours.finishedAt), independentlyExtracted: true,
      complete: true, paginationComplete: true, verifiedEmpty: !accountRows.some(selected),
      query: query("account"), rows: accountRows,
    },
  };
  prepareMetaHourlySpendDay(packet, { ...input, publication: "private:meta-hourly-preparation" });
  return packet;
}
