import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { GOOGLE_ACCOUNT_QUERY, readGoogleSpend, refreshGoogleSpendToken } from "@/lib/analytics/googleSpendSource";
import { normalizeSpendBase } from "@/lib/analytics/spend";
const mask = "campaign.id,segments.date,metrics.costMicros,metrics.clicks,metrics.impressions";
const row = (id = "1", cost = "1500001") => ({ campaign: { id }, segments: { date: "2026-09-01" },
  metrics: { costMicros: cost, clicks: "2", impressions: "100" } });
const options = () => ({ accountId: "1234567890", loginCustomerId: null, date: "2026-09-01",
  maxPages: 2, approvalRef: "fixture:approval", accessToken: "fixture:token",
  now: "2026-09-23T00:00:00Z", evidenceRef: "fixture:source", baseReportId: "fixture:base",
  signal: AbortSignal.timeout(30000) });
function network(pages: unknown[], currencyCode = "USD", timeZone = "America/New_York") {
  return vi.fn<typeof fetch>(async (url, init) => {
    expect(url).toBe("https://googleads.googleapis.com/v25/customers/1234567890/googleAds:search");
    expect(init?.redirect).toBe("error");
    expect(init?.headers).not.toHaveProperty("developer-token");
    const payload = JSON.parse(String(init?.body));
    expect(payload).not.toHaveProperty("pageSize");
    const response = payload.query === GOOGLE_ACCOUNT_QUERY
      ? { results: [{ customer: { id: "1234567890", currencyCode, timeZone } }] } : pages.shift();
    return new Response(JSON.stringify(response));
  });
}
beforeEach(() => vi.stubGlobal("fetch", () => { throw new Error("external_network_forbidden"); }));
afterEach(() => vi.unstubAllGlobals());
it("reads actual account metadata and all pages with a fixed query", async () => {
  const fetcher = network([{ fieldMask: mask, results: [row()], nextPageToken: "next" },
    { fieldMask: mask, results: [row("2")] }]);
  const base = await readGoogleSpend({ ...options(), fetcher });
  expect(base.rows).toHaveLength(2);
  expect(base).toMatchObject({ sourceCurrency: "USD", sourceTimezone: "America/New_York", paginationComplete: true });
  expect(normalizeSpendBase(base, "fixture")[0].spend_usd).toBe("1.500001");
  const calls = fetcher.mock.calls.slice(1).map(c => JSON.parse(String(c[1]?.body)));
  expect(calls[0].query).toBe(calls[1].query); expect(calls[1].pageToken).toBe("next");
});
it("recognizes a documented empty response only with the exact field mask", async () => {
  const base = await readGoogleSpend({ ...options(), fetcher: network([{ fieldMask: mask }]) });
  expect(base.verifiedEmpty).toBe(true);
  expect(normalizeSpendBase(base, "fixture")[0].spend_usd).toBe("0.000000");
  await expect(readGoogleSpend({ ...options(), fetcher: network([{}]) })).rejects.toThrow("schema_drift");
});
it("withholds USD daily metrics for non-USD or non-NY accounts", async () => {
  for (const [currency, zone] of [["CAD", "America/New_York"], ["USD", "America/Los_Angeles"]]) {
    const base = await readGoogleSpend({ ...options(), fetcher: network([{ fieldMask: mask, results: [row()] }], currency, zone) });
    expect(normalizeSpendBase(base, "fixture")[0]).toMatchObject({ spend_usd: null, source_amount: "1.500001" });
  }
});
it("rejects partial pagination, repeated cursors and duplicate campaigns", async () => {
  const first = { fieldMask: mask, results: [row()], nextPageToken: "next" };
  await expect(readGoogleSpend({ ...options(), maxPages: 1, fetcher: network([first]) })).rejects.toThrow("incomplete_pagination");
  await expect(readGoogleSpend({ ...options(), fetcher: network([first, { ...first, results: [row("2")] }]) })).rejects.toThrow("invalid_cursor");
  await expect(readGoogleSpend({ ...options(), fetcher: network([first, { fieldMask: mask, results: [row()] }]) })).rejects.toThrow("duplicate_base_campaign");
});
it("rejects wrong dates, missing cost, malformed fields and unsafe counts", async () => {
  for (const bad of [{ ...row(), segments: { date: "2026-09-02" } },
    { ...row(), metrics: {} }, { ...row(), metrics: { costMicros: "1", clicks: "9007199254740993" } }]) {
    await expect(readGoogleSpend({ ...options(), fetcher: network([{ fieldMask: mask, results: [bad] }]) })).rejects.toThrow();
  }
});
it("blocks unapproved or open-day scopes before source calls", async () => {
  const fetcher = vi.fn();
  for (const overrides of [{ approvalRef: "" }, { accountId: "../other" }, { date: "2026-09-22" }, { maxPages: 11 }])
    await expect(readGoogleSpend({ ...options(), ...overrides, fetcher })).rejects.toThrow("invalid_scope");
  expect(fetcher).not.toHaveBeenCalled();
});
it("sanitizes provider auth failures instead of returning raw error bodies", async () => {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response("private token details", { status: 403 }));
  await expect(readGoogleSpend({ ...options(), fetcher })).rejects.toThrow("google_spend_auth_or_http_failed");
  expect(fetcher).toHaveBeenCalledTimes(1);
});
it("refreshes only at the fixed OAuth host and validates the token response", async () => {
  const fetcher = vi.fn<typeof fetch>(async (url, init) => {
    expect(url).toBe("https://oauth2.googleapis.com/token"); expect(init?.redirect).toBe("error");
    return new Response(JSON.stringify({ access_token: "fixture:access", token_type: "Bearer" }));
  });
  expect(await refreshGoogleSpendToken({ ...options(), fetcher, clientId: "fixture:client",
    clientSecret: "fixture:secret", refreshToken: "fixture:refresh" })).toBe("fixture:access");
});
