import { evidenceDigest } from "./evidenceIntake";
import { acceptGoogleSpend, type SpendDayControl } from "./googleSpendAcceptance";
import { prepareFreshGoogleSpend } from "./googleSpendRegistration";
import { metaHourlyPacketFromCaptures, metaHourlyWindow, type MetaHourlySpendDay,
  type MetaGraphCapture } from "./metaHourlySpendInput";
import { decimal, key, micros, nyDate, type Row } from "./primitives";
import type { SpendBase } from "./spend";

export type StandingMarketingScope = {
  version: 1; definitionVersion: string; approvalRef: string; declaredAt: string;
  declarationSha256: string;
  /** Actual retained ID-binding receipts, not rewritten as fresh discovery. */
  identityBindingSha256: { google: string; meta: string };
  accounts: { provider: "google_ads" | "meta_ads"; accountId: string;
    sourceCurrency: "USD"; sourceTimezone: "America/New_York" | "America/Los_Angeles" }[];
};
export type NativeSpendWindowBinding = {
  version: 1; digest: string; cycleId: string; grantId: string; grantRevision: string;
  projectRef: string; shop: string; runId: string; date: string;
  standingScopeDigest: string; googleCaptureSha256: string; metaPacketSha256: string;
};
export type NativeSpendWindowInput = {
  version: 1; digest: string;
  binding: Omit<NativeSpendWindowBinding, "digest">;
  cycleStartedAt: string; validUntil: string; scopeDefinition: StandingMarketingScope;
  google: {
    manifest: unknown; base: SpendBase; control: SpendDayControl;
    accountMetadata: { accountId: string; currency: string; timezone: string;
      startedAt: string; finishedAt: string; responseSha256: string }[];
  };
  meta: { packet: MetaHourlySpendDay; receipts: {
    metadata: MetaGraphCapture; accountHours: MetaGraphCapture; campaignHours: MetaGraphCapture;
  }; freshnessCutoffAt: string };
};
const hash = (v: unknown) => typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
const ref = (v: unknown) => typeof v === "string" && v === v.trim() && v.length > 0 && v.length <= 512;
const instant = (v: string) => { nyDate(v); return Date.parse(v); };
function refuse(code: string): never { throw new Error(`native_spend_window_${code}`); }
const emptyId = "__verified_empty_account_day__";
const fields = ["provider", "account_id", "campaign_key", "source_campaign_id", "report_date", "base_report_id",
  "source_timezone", "source_currency", "source_amount", "report_currency", "spend_usd", "channel", "source_updated_at"];
function projection(rows: Row[]) {
  const clock = (value: string) => {
    instant(value);
    return value.replace(/(?:\.(\d+))?Z$/, (_, digits: string | undefined) => `.${(digits ?? "").padEnd(6, "0")}Z`);
  };
  return rows.map(row => fields.map(f => f === "source_updated_at" ? clock(String(row[f])) : row[f]))
    .map(evidenceDigest).sort();
}

/** This is native source correspondence plus independent account controls.
 * It NEVER returns Reconciliation/independentlyExtracted canonical fact keys.
 * The owner-controlled SQL cycle fence must authenticate the binding and sources.
 */
export function admitNativeSpendWindow(packet: NativeSpendWindowInput | undefined, context: {
  binding?: NativeSpendWindowBinding; projectRef: string; shop: string; publication: string;
  fromDate: string; throughDate: string; asOf: string; facts: Row[];
}) {
  if (!packet && !context.binding) return null;
  if (!packet || !context.binding) refuse("binding");
  const { digest, ...content } = packet, b = packet.binding, bound = context.binding;
  const { digest: boundDigest, ...boundFields } = bound;
  if (packet.version !== 1 || b.version !== 1 || !hash(digest) || digest !== boundDigest ||
      evidenceDigest(content) !== digest || evidenceDigest(b) !== evidenceDigest(boundFields) ||
      b.projectRef !== context.projectRef || b.shop !== context.shop || context.publication !== `full:${b.runId}` ||
      b.date !== context.fromDate || b.date !== context.throughDate ||
      !/^[a-f0-9-]{36}$/.test(b.cycleId) || !ref(b.grantId) || !/^[1-9]\d{0,18}$/.test(b.grantRevision) ||
      BigInt(b.grantRevision) > BigInt("9223372036854775807") ||
      ![b.standingScopeDigest, b.googleCaptureSha256, b.metaPacketSha256].every(hash) ||
      Buffer.byteLength(JSON.stringify(packet)) > 5000000 || context.facts.length > 10000)
    refuse("scope");
  const now = instant(context.asOf), began = instant(packet.cycleStartedAt);
  if (now < began || now >= instant(packet.validUntil) || nyDate(context.asOf) <= b.date) refuse("freshness");
  const scope = packet.scopeDefinition;
  if (scope.version !== 1 || evidenceDigest(scope) !== b.standingScopeDigest ||
      !ref(scope.definitionVersion) || !ref(scope.approvalRef) || !hash(scope.declarationSha256) ||
      !hash(scope.identityBindingSha256.google) || !hash(scope.identityBindingSha256.meta) ||
      instant(scope.declaredAt) > began || scope.accounts.length !== 2 ||
      new Set(scope.accounts.map(a => a.provider)).size !== 2) refuse("standing_scope");
  const googleAccount = scope.accounts.find(a => a.provider === "google_ads")!;
  const metaAccount = scope.accounts.find(a => a.provider === "meta_ads")!;
  if (!googleAccount || !metaAccount || !/^\d{10}$/.test(googleAccount.accountId) ||
      !/^act_[1-9]\d+$/.test(metaAccount.accountId) || scope.accounts.some(a => a.sourceCurrency !== "USD") ||
      googleAccount.sourceTimezone !== "America/New_York" || metaAccount.sourceTimezone !== "America/Los_Angeles")
    refuse("account_scope");
  const google = packet.google, { manifest } = prepareFreshGoogleSpend(google.manifest);
  if (manifest.projectRef !== b.projectRef || manifest.accountId !== googleAccount.accountId ||
      manifest.sourceCurrency !== "USD" || manifest.sourceTimezone !== "America/New_York" ||
      manifest.days.length !== 1 || manifest.days[0].date !== b.date ||
      instant(manifest.freshnessCutoffAt) < began || instant(packet.validUntil) > instant(manifest.expiresAt) ||
      google.base.date !== b.date || google.control.date !== b.date ||
      google.accountMetadata.length !== 2) refuse("google_scope");
  for (const metadata of google.accountMetadata)
    if (metadata.accountId !== googleAccount.accountId || metadata.currency !== "USD" ||
        metadata.timezone !== "America/New_York" || !hash(metadata.responseSha256) ||
        instant(metadata.startedAt) < began || instant(metadata.finishedAt) < instant(metadata.startedAt) ||
        instant(metadata.finishedAt) > now) refuse("google_identity");
  const checked = acceptGoogleSpend({ version: 1, manifest, bases: [google.base], controls: [google.control],
    shop: b.shop, publication: context.publication, asOf: context.asOf, sales: null });
  if (checked.checks.length !== 1 || checked.checks[0].spendIssues.length) refuse("google_control");
  const m = packet.meta, mp = m.packet;
  if (mp.version !== 2 || mp.projectRef !== b.projectRef || mp.shop !== b.shop || mp.date !== b.date ||
      mp.accountId !== metaAccount.accountId || instant(m.freshnessCutoffAt) < began)
    refuse("meta_scope");
  const decoded = metaHourlyPacketFromCaptures({ projectRef: b.projectRef, shop: b.shop,
    generationId: mp.generationId, accountId: mp.accountId, date: b.date,
    approvalRef: mp.approvalRef, actorRef: mp.actorRef, controlApprovalRef: mp.control.approvalRef,
    ...m.receipts, freshnessCutoffAt: m.freshnessCutoffAt, asOf: context.asOf });
  if (evidenceDigest(decoded) !== evidenceDigest(mp)) refuse("meta_receipt_packet");

  // Expected Google economics come from the separately captured control, not
  // normalizeSpendBase's output or copied candidate keys.
  const expected: Row[] = [];
  for (const campaign of google.control.campaigns.length ? google.control.campaigns : [{ id: "", costMicros: "0" }]) {
    const amount = decimal(BigInt(campaign.costMicros));
    expected.push({ provider: "google_ads", account_id: googleAccount.accountId,
      campaign_key: key("google_ads", googleAccount.accountId, campaign.id || emptyId),
      source_campaign_id: campaign.id || null, report_date: b.date, base_report_id: google.base.baseReportId,
      source_timezone: "America/New_York", source_currency: "USD", source_amount: amount,
      report_currency: "USD", spend_usd: amount, channel: "google_ads", source_updated_at: google.base.completedAt });
  }
  // A separate raw-native grouping, not the hourly mapper's returned rows. Its
  // account-hour validation above includes all captured boundary hours as well.
  const window = metaHourlyWindow(b.date), groups = new Map<string, bigint>();
  const source = m.receipts.campaignHours.response as { data: Record<string, unknown>[] };
  for (const row of source.data) {
    const hour = /^([01]\d|2[0-3]):00:00 - \1:59:59$/.exec(String(row.hourly_stats_aggregated_by_advertiser_time_zone))?.[1];
    const time = window.providerHours.get(`${row.date_start}T${hour}`);
    if (time === undefined) refuse("meta_raw_hour");
    if (time < instant(window.fromAt) || time >= instant(window.untilAt)) continue;
    const id = String(row.campaign_id), amount = micros(String(row.spend));
    groups.set(id, (groups.get(id) ?? BigInt(0)) + amount);
  }
  for (const [id, n] of groups.size ? groups : new Map([["", BigInt(0)]])) {
    const amount = decimal(n);
    expected.push({ provider: "meta_ads", account_id: metaAccount.accountId,
      campaign_key: key("meta_ads", metaAccount.accountId, id || emptyId), source_campaign_id: id || null,
      report_date: b.date, base_report_id: mp.generationId, source_timezone: "America/Los_Angeles",
      source_currency: "USD", source_amount: amount, report_currency: "USD", spend_usd: amount,
      channel: "meta_ads", source_updated_at: mp.source.capturedAt });
  }
  if (evidenceDigest(projection(context.facts)) !== evidenceDigest(projection(expected))) refuse("final_source_fact_mismatch");
  return { dates: new Set([b.date]), ref: `native-spend-window:sha256:${digest}`, digest,
    accountScope: "standing_owner_declaration_with_fresh_native_identity" as const,
    standingDeclarationAt: scope.declaredAt, cycleId: b.cycleId,
    accounts: scope.accounts, sourceCorrespondence: true, independentAccountControls: true,
    genericReconciliationClaimed: false };
}
