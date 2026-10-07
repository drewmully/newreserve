import { reportDates } from "./commerceCandidate";
import { authorizeGoogleSpend, readGoogleSpend, GOOGLE_ADS_VERSION, type GoogleSpendAuth } from "./googleSpendSource";
import { sourceObject, sourceString } from "./shopifySource";
import { normalizeSpendBase } from "./spend";
import { deliveryMetrics } from "./reporting";

export type GoogleCheckScope = {
  accountId: string; loginCustomerId: string | null; fromDate: string; throughDate: string;
  maxPages: number; maxRequests: number; deadlineSeconds: number; approvalRef: string; actorRef: string;
  /** Explicitly include independent click/impression controls in this approved read. */
  includeDeliveryMetrics?: boolean;
};
function count(value: unknown): bigint | null {
  if (value === undefined) return null;
  if (typeof value !== "string" || !/^(0|[1-9]\d{0,15})$/.test(value) ||
      BigInt(value) > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("google_check_control_count");
  return BigInt(value);
}
/** Read-only sample comparison, not a registered spend job or coverage certificate.
 * A separate customer/day query controls the campaign sums. Missing days remain
 * missing, never synthesized as verified zero. No record details leave this check.
 */
type GoogleCheckInput = {
  scope: GoogleCheckScope; auth: GoogleSpendAuth; developerToken: string;
  fetcher?: typeof fetch; now?: string; signal?: AbortSignal;
};
async function executeGoogleSpendCheck(input: GoogleCheckInput) {
  const scope = input.scope, dates = reportDates(scope.fromDate, scope.throughDate);
  if (Object.keys(scope).some(k => !["accountId", "loginCustomerId", "fromDate", "throughDate",
    "maxPages", "maxRequests", "deadlineSeconds", "approvalRef", "actorRef", "includeDeliveryMetrics"].includes(k)) ||
      scope.includeDeliveryMetrics !== undefined && typeof scope.includeDeliveryMetrics !== "boolean" ||
      !/^\d{10}$/.test(scope.accountId) || scope.loginCustomerId !== null && !/^\d{10}$/.test(scope.loginCustomerId) ||
      !scope.approvalRef?.trim() || !scope.actorRef?.trim() || !input.developerToken?.trim() ||
      dates.length > 3 || !Number.isInteger(scope.maxPages) || scope.maxPages < 1 || scope.maxPages > 5 ||
      !Number.isInteger(scope.maxRequests) || scope.maxRequests < 1 || scope.maxRequests > 20 ||
      2 + dates.length * (1 + scope.maxPages) > scope.maxRequests ||
      !Number.isInteger(scope.deadlineSeconds) || scope.deadlineSeconds < 1 || scope.deadlineSeconds > 90)
    throw new Error("google_check_invalid_scope");
  const signal = AbortSignal.any([AbortSignal.timeout(scope.deadlineSeconds * 1000),
    ...(input.signal ? [input.signal] : [])]);
  let requests = 0, bytes = 0;
  const fetcher: typeof fetch = async (url, init) => {
    const active = AbortSignal.any([signal, ...(init?.signal ? [init.signal] : [])]);
    active.throwIfAborted();
    if (++requests > scope.maxRequests) throw new Error("google_check_request_budget");
    const response = await (input.fetcher ?? fetch)(url, { ...init, redirect: "error", signal: active });
    const chunks: Uint8Array[] = [];
    const reader = response.body?.getReader();
    if (reader) try {
      while (true) {
        active.throwIfAborted();
        const { done, value } = await reader.read();
        active.throwIfAborted();
        if (done) break;
        bytes += value.length;
        if (bytes > 8 * 1024 * 1024) throw new Error("google_check_byte_budget");
        chunks.push(value);
      }
    } catch (error) { await reader.cancel(); throw error; }
    active.throwIfAborted();
    return new Response(Buffer.concat(chunks), { status: response.status, headers: response.headers });
  };
  const accessToken = await authorizeGoogleSpend({ auth: input.auth,
    developerToken: input.developerToken, fetcher, signal });
  const capturedAt = input.now ?? new Date().toISOString();
  const bases: Awaited<ReturnType<typeof readGoogleSpend>>[] = [];
  for (const date of dates) {
    bases.push(await readGoogleSpend({ ...scope, date, accessToken, developerToken: input.developerToken,
      fetcher, signal, now: capturedAt, evidenceRef: `google-check:${scope.approvalRef}:${date}`,
      baseReportId: `google-check:${date}` }));
  }
  if (bases.some(base => base.sourceCurrency !== bases[0].sourceCurrency ||
      base.sourceTimezone !== bases[0].sourceTimezone)) throw new Error("google_check_changed_account");
  const delivery = scope.includeDeliveryMetrics === true;
  const controlFields = ["segments.date", "metrics.costMicros",
    ...(delivery ? ["metrics.clicks", "metrics.impressions"] : [])];
  const response = await fetcher(
    `https://googleads.googleapis.com/${GOOGLE_ADS_VERSION}/customers/${scope.accountId}/googleAds:search`, {
      method: "POST", headers: { Authorization: `Bearer ${accessToken}`, "developer-token": input.developerToken,
        "Content-Type": "application/json", ...(scope.loginCustomerId ? { "login-customer-id": scope.loginCustomerId } : {}) },
      body: JSON.stringify({ query: `SELECT segments.date, metrics.cost_micros${delivery ? ", metrics.clicks, metrics.impressions" : ""} FROM customer WHERE segments.date BETWEEN '${scope.fromDate}' AND '${scope.throughDate}' ORDER BY segments.date` }),
    });
  if (!response.ok) throw new Error("google_check_control_http_failed");
  const control = sourceObject(await response.json());
  signal.throwIfAborted();
  if (control.error !== undefined || control.nextPageToken ||
      typeof control.fieldMask !== "string" ||
      control.fieldMask.split(",").sort().join(",") !== [...controlFields].sort().join(",") ||
      control.results !== undefined && !Array.isArray(control.results)) throw new Error("google_check_control_incomplete");
  const values = (control.results ?? []) as unknown[];
  if (values.length > dates.length) throw new Error("google_check_control_scope");
  const totals = new Map<string, string>();
  const counts = new Map<string, { clicks: bigint | null; impressions: bigint | null }>();
  for (const value of values) {
    const row = sourceObject(value), date = sourceString(sourceObject(row.segments).date);
    const metrics = sourceObject(row.metrics), amount = sourceString(metrics.costMicros);
    if (!dates.includes(date) || totals.has(date) || !/^\d+$/.test(amount) || amount.length > 24)
      throw new Error("google_check_control_scope");
    totals.set(date, BigInt(amount).toString());
    if (delivery) counts.set(date, { clicks: count(metrics.clicks), impressions: count(metrics.impressions) });
  }
  const rows = bases.map(base => {
    const campaignMicros = base.rows.reduce((sum, row) => sum + BigInt(row.costMicros), BigInt(0)).toString();
    const controlMicros = totals.get(base.date) ?? null;
    return { date: base.date, campaigns: base.rows.length, campaignMicros, controlMicros,
      matches: controlMicros !== null && campaignMicros === controlMicros };
  });
  const deliveryRows = delivery ? bases.map((base, index) => {
    const sum = (field: "clicks" | "impressions") => {
      // Empty monetary evidence cannot certify a zero delivery count.
      if (!base.rows.length) return null;
      const values = base.rows.map(row => count(row[field]));
      return values.some(value => value === null) ? null :
        values.reduce<bigint>((total, value) => total + value!, BigInt(0));
    };
    const campaignClicks = sum("clicks"), campaignImpressions = sum("impressions");
    const controlClicks = counts.get(base.date)?.clicks ?? null;
    const controlImpressions = counts.get(base.date)?.impressions ?? null;
    return { date: base.date, campaignClicks: campaignClicks?.toString() ?? null,
      controlClicks: controlClicks?.toString() ?? null,
      campaignImpressions: campaignImpressions?.toString() ?? null,
      controlImpressions: controlImpressions?.toString() ?? null,
      matches: rows[index].matches && campaignClicks !== null && campaignImpressions !== null &&
        campaignClicks === controlClicks && campaignImpressions === controlImpressions };
  }) : [];
  const deliveryReady = deliveryRows.length === dates.length && deliveryRows.every(row => row.matches) &&
    bases[0].sourceCurrency === "USD" && bases[0].sourceTimezone === "America/New_York";
  const summary = { state: rows.every(row => row.matches) ? "sample_amounts_match" : "sample_amounts_unverified",
    accountId: scope.accountId, currency: bases[0].sourceCurrency, timezone: bases[0].sourceTimezone,
    capturedAt, requests, bytes, rows, certification: "unverified", databaseWrites: false,
    independentCoverageCertified: false, approvalRef: scope.approvalRef,
    ...(delivery ? { delivery: {
      state: deliveryReady ? "sample_delivery_match" : "sample_delivery_unverified",
      clickDefinition: "google_ads.metrics.clicks", rows: deliveryRows,
      metrics: deliveryMetrics(deliveryReady
        ? bases.flatMap(base => normalizeSpendBase(base, "google-check-delivery")) : [], deliveryReady),
      metricAcceptance: false,
    } } : {}),
  };
  return { summary, bases, control };
}

/** Existing public summary is unchanged. It is not registration evidence. */
export async function checkGoogleSpend(input: GoogleCheckInput) {
  return (await executeGoogleSpendCheck(input)).summary;
}

/** Private producer input. Separate campaign and customer queries must both
 * complete and match. Callers cannot submit campaign rows or proof booleans. */
export async function captureGoogleIndependentControls(input: Omit<GoogleCheckInput, "now">) {
  if (input.scope.includeDeliveryMetrics !== true || input.scope.fromDate !== input.scope.throughDate)
    throw new Error("google_control_capture_scope");
  const startedAt = new Date().toISOString();
  const { summary, bases, control } = await executeGoogleSpendCheck(input);
  const completedAt = new Date().toISOString();
  if (summary.state !== "sample_amounts_match" || summary.delivery?.state !== "sample_delivery_match" ||
    bases.length !== 1 || !bases[0].rows.length || bases[0].rows.length > 10000)
    throw new Error("google_control_capture_unverified");
  return { startedAt, completedAt, accountId: summary.accountId, date: input.scope.fromDate,
    currency: summary.currency, timezone: summary.timezone,
    campaigns: bases[0].rows.map(row => ({ id: row.campaignId, costMicros: row.costMicros,
      clicks: row.clicks!, impressions: row.impressions! })),
    totalCostMicros: summary.rows[0].controlMicros!,
    clicks: summary.delivery.rows[0].controlClicks!, impressions: summary.delivery.rows[0].controlImpressions!,
    requests: summary.requests, bytes: summary.bytes,
    // Actual customer response retained privately for receipt hashing only.
    accountResponse: control,
  };
}
