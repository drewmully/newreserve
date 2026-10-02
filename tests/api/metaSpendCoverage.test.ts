import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createMetaSpendReader, metaAccountId, metaSpendCents } from
  "@/app/api/admin/cron/_lib/metaSpendSource";
import { GET } from "@/app/api/admin/cron/meta-ads-spend/route";

const boundary = vi.hoisted(() => ({
  writes: [] as { table: string; rows: Record<string, unknown>[] }[],
  meta: {} as Record<string, unknown>,
  mirror: vi.fn(async () => ({ captured: 1 })),
}));
vi.mock("@/app/api/_lib/supabaseService", () => ({
  getSupabaseService: () => ({
    from: (table: string) => ({
      upsert: async (rows: Record<string, unknown>[]) => {
        boundary.writes.push({ table, rows }); return { error: null };
      },
    }),
  }),
  withJobRun: async (_name: string, work: (ctx: {
    setMeta: (meta: Record<string, unknown>) => void; bumpRows: () => void;
  }) => Promise<unknown>) => {
    try {
      return await work({ setMeta: meta => { Object.assign(boundary.meta, meta); }, bumpRows: () => {} });
    } catch (error) { return { error: error instanceof Error ? error.message : String(error) }; }
  },
}));
vi.mock("@/app/api/admin/cron/_lib/postAdSpendToPostHog", () => ({
  postAdSpendToPostHog: boundary.mirror,
}));
const accountId = "act_123456789";
const account = { id: accountId, account_id: "123456789", currency: "USD", timezone_name: "America/New_York" };
const row = { date_start: "2026-09-30", date_stop: "2026-09-30",
  spend: "0.00", clicks: "0", impressions: "3" };
const fields = "spend,impressions,clicks";
const scope = { since: "2026-09-29", until: "2026-09-30", fields, level: "account" as const };
const makeReader = (fetcher: typeof fetch, signal = AbortSignal.timeout(10000)) =>
  createMetaSpendReader({ accountId, token: "synthetic-secret", apiVersion: "v21.0", signal, fetcher });
const paging = (after: string) => ({
  next: `https://graph.facebook.com/v21.0/${accountId}/insights?after=${after}&access_token=synthetic-secret`,
  cursors: { after },
});
beforeEach(() => {
  boundary.writes.length = 0; boundary.meta = {}; boundary.mirror.mockClear();
  vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime("2026-10-01T05:00:00Z");
  vi.stubEnv("CRON_SECRET", "synthetic-cron");
  vi.stubEnv("META_MARKETING_API_TOKEN", "synthetic-secret");
  vi.stubEnv("META_AD_ACCOUNT_ID", accountId);
  vi.stubEnv("META_API_VERSION", "v21.0");
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.useRealTimers(); });

it("rejects stored newline account keys instead of silently creating a second natural key", () => {
  expect(metaAccountId("123456789")).toBe(accountId);
  expect(() => metaAccountId(`${accountId}\n`)).toThrow("meta_spend_account_id");
  expect(() => metaAccountId("act_123 456")).toThrow("meta_spend_account_id");
});

it.each(["-1.00", "", "NaN", "1.001", undefined, null])("rejects invalid or missing monetary %s", value => {
  expect(() => metaSpendCents(value)).toThrow("meta_spend_amount");
});

it("validates account metadata, preserves explicit zero and leaves an omitted day unknown", async () => {
  const fetcher = vi.fn<typeof fetch>(async url =>
    Response.json(String(url).endsWith("/insights") ? {} :
      String(url).includes("/insights?") ? { data: [row] } : account));
  const reader = makeReader(fetcher);
  await expect(reader.readInsights(scope)).rejects.toThrow("account_unverified");
  await reader.readAccount();
  const result = await reader.readInsights(scope);
  expect(result.rows[0].spend).toBe("0.00");
  expect(result.missingDates).toEqual(["2026-09-29"]);
  expect(result.paginationComplete).toBe(true);
  for (const [url, init] of fetcher.mock.calls) {
    expect(String(url)).not.toContain("synthetic-secret");
    expect(init?.redirect).toBe("error");
    expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer synthetic-secret");
  }
});

it("continues an empty page when next exists and rebuilds a bounded cursor request", async () => {
  const fetcher = vi.fn<typeof fetch>(async url => {
    const u = new URL(String(url));
    if (!u.pathname.endsWith("/insights")) return Response.json(account);
    return Response.json(u.searchParams.has("after") ? { data: [row] } : { data: [], paging: paging("next") });
  });
  const reader = makeReader(fetcher); await reader.readAccount();
  const result = await reader.readInsights(scope);
  expect(result.pages).toBe(2);
  const next = new URL(String(fetcher.mock.calls[2][0]));
  expect(next.searchParams.get("time_range")).toBe(JSON.stringify({ since: scope.since, until: scope.until }));
  expect(next.searchParams.get("access_token")).toBe(null);
});

it("refuses a remaining page at the 25-page limit instead of returning partial rows", async () => {
  let n = 0;
  const fetcher = vi.fn<typeof fetch>(async url => Response.json(
    String(url).includes("/insights?") ? { data: [], paging: paging(String(++n)) } : account));
  const reader = makeReader(fetcher); await reader.readAccount();
  await expect(reader.readInsights(scope)).rejects.toThrow("meta_spend_incomplete_pagination");
  expect(fetcher).toHaveBeenCalledTimes(26);
});

it("refuses more than 1,000 unique ad-set rows without truncation", async () => {
  const reader = makeReader(async url => Response.json(String(url).includes("/insights?") ?
    { data: Array.from({ length: 1001 }, (_, i) => ({ ...row, adset_id: String(i + 1), campaign_id: "200" })) } :
    account));
  await reader.readAccount();
  await expect(reader.readInsights({ ...scope, level: "adset" })).rejects.toThrow("meta_spend_row_budget");
});

it("refuses repeated cursors and changed date scope", async () => {
  for (const alteredScope of [false, true]) {
    const next = paging("repeated");
    if (alteredScope) next.next += "&time_range=changed";
    const reader = makeReader(async url => Response.json(String(url).includes("/insights?") ?
      { data: [], paging: next } : account));
    await reader.readAccount();
    await expect(reader.readInsights(scope)).rejects.toThrow(alteredScope ?
      "meta_spend_cursor_scope" : "meta_spend_cursor");
  }
});

it.each([
  { currency: "CAD" }, { timezone_name: "UTC" }, { account_id: "999" }, { id: "act_999" },
])("rejects incompatible metadata %s before insights", async patch => {
  const fetcher = vi.fn<typeof fetch>(async () => Response.json({ ...account, ...patch }));
  await expect(makeReader(fetcher).readAccount()).rejects.toThrow("meta_spend_account_scope");
  expect(fetcher).toHaveBeenCalledTimes(1);
});

it.each([
  { data: [{ ...row, clicks: undefined }] },
  { data: [{ ...row, spend: undefined }] },
  { data: [{ ...row, date_stop: "2026-10-01" }] },
  { data: [row, row] },
  { paging: {} },
  { data: [], paging: { ...paging("next"), next: "https://unapproved.invalid/?after=next" } },
])("rejects malformed, duplicate or out-of-scope source data", async response => {
  const reader = makeReader(async url => Response.json(
    String(url).includes("/insights?") ? response : account));
  await reader.readAccount();
  await expect(reader.readInsights(scope)).rejects.toThrow(/meta_spend_/);
});

it("does not expose provider error text or credential-bearing URLs", async () => {
  const reader = makeReader(async () => Response.json({
    error: { message: "sensitive-provider-message synthetic-secret" },
  }, { status: 403 }));
  await expect(reader.readAccount()).rejects.toThrow("meta_spend_http");
});

it("enforces response byte and abort budgets", async () => {
  const reader = makeReader(async () => new Response("x".repeat(1024 * 1024 + 1)));
  await expect(reader.readAccount()).rejects.toThrow("meta_spend_byte_budget");
  const controller = new AbortController(); controller.abort();
  const fetcher = vi.fn<typeof fetch>();
  await expect(makeReader(fetcher, controller.signal).readAccount()).rejects.toThrow();
  expect(fetcher).not.toHaveBeenCalled();
});

const request = (days = "14") => new NextRequest(`https://fixture.invalid/api/admin/cron/meta-ads-spend?days=${days}`, {
  headers: { authorization: "Bearer synthetic-cron" },
});
it("actual route waits for both validated sources, writes returned zero and retains metadata", async () => {
  let reads = 0;
  vi.stubGlobal("fetch", vi.fn<typeof fetch>(async url => {
    reads++;
    expect(boundary.writes).toHaveLength(0);
    const u = new URL(String(url));
    if (!u.pathname.endsWith("/insights")) return Response.json(account);
    return Response.json({ data: u.searchParams.get("level") === "account" ? [row] :
      [{ ...row, adset_id: "100", campaign_id: "200" }] });
  }));
  const response = await GET(request());
  expect(response.status).toBe(200); expect(reads).toBe(3);
  expect(boundary.writes.map(write => write.table)).toEqual(["marketing_spend_daily", "meta_ad_performance_snapshots"]);
  expect(boundary.writes[0].rows[0]).toMatchObject({
    amount: 0, raw: { source_currency: "USD", source_timezone: "America/New_York", account_id: accountId,
      source_observed_at: "2026-10-01T05:00:00.000Z" },
  });
  expect(boundary.writes[1].rows[0]).toMatchObject({ spend_cents: 0, clicks: 0, impressions: 3 });
  expect(boundary.meta.all_marketing_inventory_complete).toBe(false);
  expect(boundary.mirror).toHaveBeenCalledTimes(1);
});

it("actual route performs no spend upsert or PostHog capture if second source is incomplete", async () => {
  vi.stubGlobal("fetch", vi.fn<typeof fetch>(async url => {
    const u = new URL(String(url));
    if (!u.pathname.endsWith("/insights")) return Response.json(account);
    return Response.json(u.searchParams.get("level") === "account" ? { data: [row] } : {});
  }));
  expect(await (await GET(request())).json()).toEqual({ error: "meta_spend_schema" });
  expect(boundary.writes).toHaveLength(0);
  expect(boundary.mirror).not.toHaveBeenCalled();
});

it("actual route rejects invalid day scope before any source fetch", async () => {
  const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
  expect((await GET(request("1000"))).status).toBe(400);
  expect(fetcher).not.toHaveBeenCalled();
});
