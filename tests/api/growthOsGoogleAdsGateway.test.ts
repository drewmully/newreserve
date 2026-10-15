import { describe, expect, it, vi } from "vitest";
vi.mock("@/lib/analytics/googleSpendSource", () => ({ authorizeGoogleSpend: vi.fn(async () => "tok") }));
import { isAuthorized, parseRequest, runGateway, GatewayError } from "@/lib/growthOs/googleAdsGateway";

const secret = "s".repeat(40);
const env = { GROWTH_OS_GOOGLE_SECRET: secret, GOOGLE_ADS_DEVELOPER_TOKEN: "dev", GOOGLE_ADS_SERVICE_ACCOUNT_JSON_BASE64: "e30=" };

describe("growth os google ads gateway", () => {
  it("auth requires exact long secret", () => {
    expect(isAuthorized(`Bearer ${secret}`, env)).toBe(true);
    expect(isAuthorized("Bearer nope", env)).toBe(false);
    expect(isAuthorized(`Bearer short`, { GROWTH_OS_GOOGLE_SECRET: "short" })).toBe(false);
  });
  it("only allows SELECT reads", () => {
    expect(() => parseRequest({ action: "search", query: "DELETE x" }, env)).toThrow(GatewayError);
    expect(parseRequest({ action: "search", query: "SELECT campaign.id FROM campaign", maxPages: 99 }, env)).toMatchObject({ maxPages: 5 });
  });
  it("enforces budget cap and rejects unknown actions", () => {
    expect(() => parseRequest({ action: "update_budget", campaignBudgetId: "1", dailyUsd: 500 }, env)).toThrow("daily_usd_above_cap");
    expect(() => parseRequest({ action: "remove_campaign", campaignId: "1" }, env)).toThrow("unsupported_action");
  });
  it("sends budget mutate to the fixed customer with own developer token", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ results: [{ resourceName: "x" }] }), { status: 200 }));
    await runGateway(parseRequest({ action: "update_budget", campaignBudgetId: "123", dailyUsd: 25 }, env), env, fetcher as unknown as typeof fetch);
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://googleads.googleapis.com/v25/customers/4335795219/campaignBudgets:mutate");
    const h = init.headers as Record<string, string>;
    expect(h["developer-token"]).toBe("dev");
    expect(h["login-customer-id"]).toBe("9552995078");
    expect(JSON.parse(String(init.body)).operations[0].update.amountMicros).toBe("25000000");
  });
});
