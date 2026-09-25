import { reportDates } from "./commerceCandidate";
import { authorizeGoogleSpend, readGoogleSpend, GOOGLE_ADS_VERSION, type GoogleSpendAuth } from "./googleSpendSource";
import { sourceObject, sourceString } from "./shopifySource";

export type GoogleCheckScope = {
  accountId: string; loginCustomerId: string | null; fromDate: string; throughDate: string;
  maxPages: number; maxRequests: number; deadlineSeconds: number; approvalRef: string; actorRef: string;
};
/** Read-only sample comparison, not a registered spend job or coverage certificate.
 * A separate customer/day query controls the campaign sums. Missing days remain
 * missing, never synthesized as verified zero. No record details leave this check.
 */
export async function checkGoogleSpend(input: {
  scope: GoogleCheckScope; auth: GoogleSpendAuth; developerToken: string;
  fetcher?: typeof fetch; now?: string; signal?: AbortSignal;
}) {
  const scope = input.scope, dates = reportDates(scope.fromDate, scope.throughDate);
  if (Object.keys(scope).some(k => !["accountId", "loginCustomerId", "fromDate", "throughDate",
    "maxPages", "maxRequests", "deadlineSeconds", "approvalRef", "actorRef"].includes(k)) ||
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
  const response = await fetcher(
    `https://googleads.googleapis.com/${GOOGLE_ADS_VERSION}/customers/${scope.accountId}/googleAds:search`, {
      method: "POST", headers: { Authorization: `Bearer ${accessToken}`, "developer-token": input.developerToken,
        "Content-Type": "application/json", ...(scope.loginCustomerId ? { "login-customer-id": scope.loginCustomerId } : {}) },
      body: JSON.stringify({ query: `SELECT segments.date, metrics.cost_micros FROM customer WHERE segments.date BETWEEN '${scope.fromDate}' AND '${scope.throughDate}' ORDER BY segments.date` }),
    });
  if (!response.ok) throw new Error("google_check_control_http_failed");
  const control = sourceObject(await response.json());
  signal.throwIfAborted();
  if (control.error !== undefined || control.nextPageToken ||
      typeof control.fieldMask !== "string" ||
      control.fieldMask.split(",").sort().join(",") !== "metrics.costMicros,segments.date" ||
      control.results !== undefined && !Array.isArray(control.results)) throw new Error("google_check_control_incomplete");
  const values = (control.results ?? []) as unknown[];
  if (values.length > dates.length) throw new Error("google_check_control_scope");
  const totals = new Map<string, string>();
  for (const value of values) {
    const row = sourceObject(value), date = sourceString(sourceObject(row.segments).date);
    const amount = sourceString(sourceObject(row.metrics).costMicros);
    if (!dates.includes(date) || totals.has(date) || !/^\d+$/.test(amount) || amount.length > 24)
      throw new Error("google_check_control_scope");
    totals.set(date, BigInt(amount).toString());
  }
  const rows = bases.map(base => {
    const campaignMicros = base.rows.reduce((sum, row) => sum + BigInt(row.costMicros), BigInt(0)).toString();
    const controlMicros = totals.get(base.date) ?? null;
    return { date: base.date, campaigns: base.rows.length, campaignMicros, controlMicros,
      matches: controlMicros !== null && campaignMicros === controlMicros };
  });
  return { state: rows.every(row => row.matches) ? "sample_amounts_match" : "sample_amounts_unverified",
    accountId: scope.accountId, currency: bases[0].sourceCurrency, timezone: bases[0].sourceTimezone,
    capturedAt, requests, bytes, rows, certification: "unverified", databaseWrites: false,
    independentCoverageCertified: false, approvalRef: scope.approvalRef };
}
