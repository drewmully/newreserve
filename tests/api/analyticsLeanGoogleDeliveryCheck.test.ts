import { expect, it, vi } from "vitest";
import { checkGoogleSpend, type GoogleCheckScope } from "@/lib/analytics/googleSpendCheck";

const dates = ["2026-09-21", "2026-09-22"];
const scope: GoogleCheckScope = { accountId: "1234567890", loginCustomerId: null,
  fromDate: dates[0], throughDate: dates[1], maxPages: 1, maxRequests: 6,
  deadlineSeconds: 30, approvalRef: "fixture:delivery-read", actorRef: "fixture:operator",
  includeDeliveryMetrics: true };
const options = () => ({ scope, auth: { mode: "oauth_refresh" as const,
  clientId: "fixture", clientSecret: "fixture", refreshToken: "fixture" },
  developerToken: "fixture", now: "2026-09-25T00:00:00Z" });
type Metrics = { costMicros: string; clicks?: string; impressions?: string };
const values: Metrics[] = [
  { costMicros: "1000000", clicks: "1", impressions: "10" },
  { costMicros: "9000000", clicks: "3", impressions: "90" },
];
function wire(input: { controls?: Metrics[]; campaign?: Metrics[]; empty?: boolean;
  currency?: string; mask?: string; omitDay?: boolean } = {}) {
  return vi.fn<typeof fetch>(async (url, init) => {
    if (String(url).includes("oauth2.googleapis.com"))
      return Response.json({ access_token: "fixture", token_type: "Bearer" });
    const query = JSON.parse(String(init?.body)).query as string;
    if (query.includes("customer.id")) return Response.json({ results: [
      { customer: { id: scope.accountId, currencyCode: input.currency ?? "USD", timeZone: "America/New_York" } },
    ] });
    if (query.includes("FROM campaign")) {
      const date = query.match(/= '([^']+)'/)![1], index = dates.indexOf(date);
      return Response.json({ fieldMask: "campaign.id,segments.date,metrics.costMicros,metrics.clicks,metrics.impressions",
        results: input.empty ? [] : [{ campaign: { id: "101" }, segments: { date },
          metrics: (input.campaign ?? values)[index] }] });
    }
    const delivery = query.includes("metrics.clicks");
    return Response.json({ fieldMask: input.mask ??
      `segments.date,metrics.costMicros${delivery ? ",metrics.clicks,metrics.impressions" : ""}`,
      results: dates.slice(0, input.omitDay ? 1 : 2).map((date, i) =>
        ({ segments: { date }, metrics: (input.controls ?? values)[i] })) });
  });
}
it("compares each day's independent counts and uses the existing ratio-of-sums formulas", async () => {
  const fetcher = wire(), result = await checkGoogleSpend({ ...options(), fetcher });
  expect(result).toMatchObject({ requests: 6, state: "sample_amounts_match", databaseWrites: false,
    independentCoverageCertified: false, delivery: { state: "sample_delivery_match", metricAcceptance: false,
      metrics: { ctr: "0.040000", cpc_usd: "2.500000", cpm_usd: "100.000000" } } });
  expect(result.delivery?.rows.every(row => row.matches)).toBe(true);
  expect(fetcher).toHaveBeenCalledTimes(6);
});
it.each([undefined, false])("preserves the old query and output when opt-in is %s", async value => {
  const fetcher = wire(), result = await checkGoogleSpend({ ...options(),
    scope: { ...scope, includeDeliveryMetrics: value }, fetcher });
  expect(result).not.toHaveProperty("delivery");
  expect(JSON.parse(String(fetcher.mock.calls.at(-1)?.[1]?.body)).query)
    .toBe("SELECT segments.date, metrics.cost_micros FROM customer WHERE segments.date BETWEEN '2026-09-21' AND '2026-09-22' ORDER BY segments.date");
});
it("does not let equal window totals hide counts moved between dates", async () => {
  const result = await checkGoogleSpend({ ...options(), fetcher: wire({
    controls: [{ ...values[0], clicks: "3" }, { ...values[1], clicks: "1" }],
  }) });
  expect(result.state).toBe("sample_amounts_match");
  expect(result.delivery).toMatchObject({ state: "sample_delivery_unverified",
    metrics: { ctr: null, cpc_usd: null, cpm_usd: null } });
});
it.each(["control", "campaign", "day"] as const)("withholds missing %s evidence rather than inventing zero", async kind => {
  const missing = values.map(row => ({ ...row, clicks: undefined }));
  const result = await checkGoogleSpend({ ...options(), fetcher: wire(kind === "control"
    ? { controls: missing } : kind === "campaign" ? { campaign: missing } : { omitDay: true }) });
  expect(result.delivery?.state).toBe("sample_delivery_unverified");
  expect(result.delivery?.metrics).toEqual({ ctr: null, cpc_usd: null, cpm_usd: null });
});
it("retains explicit zero delivery but does not infer it from empty cost evidence", async () => {
  const zero = values.map(() => ({ costMicros: "0", clicks: "0", impressions: "10" }));
  const matched = await checkGoogleSpend({ ...options(), fetcher: wire({ campaign: zero, controls: zero }) });
  expect(matched.delivery?.metrics).toEqual({ ctr: "0.000000", cpc_usd: null, cpm_usd: "0.000000" });
  const empty = await checkGoogleSpend({ ...options(), fetcher: wire({ empty: true, controls: zero }) });
  expect(empty.delivery?.state).toBe("sample_delivery_unverified");
});
it.each(["-1", "1.5", "9007199254740992"])("rejects invalid control count %s", async clicks => {
  await expect(checkGoogleSpend({ ...options(), fetcher: wire({
    controls: values.map(row => ({ ...row, clicks })),
  }) })).rejects.toThrow("google_check_control_count");
});
it("requires the opted-in control field mask and supported monetary metadata", async () => {
  await expect(checkGoogleSpend({ ...options(), fetcher: wire({ mask: "segments.date,metrics.costMicros" }) }))
    .rejects.toThrow("google_check_control_incomplete");
  const result = await checkGoogleSpend({ ...options(), fetcher: wire({ currency: "CAD" }) });
  expect(result.delivery?.metrics).toEqual({ ctr: null, cpc_usd: null, cpm_usd: null });
});
it("rejects invalid opt-in before authentication or reads", async () => {
  const fetcher = vi.fn<typeof fetch>();
  await expect(checkGoogleSpend({ ...options(), scope: { ...scope,
    includeDeliveryMetrics: "true" as unknown as boolean }, fetcher })).rejects.toThrow("google_check_invalid_scope");
  expect(fetcher).not.toHaveBeenCalled();
});
