import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const upsertMock = vi.fn();
const postAdSpendMock = vi.fn();

vi.mock("@/app/api/_lib/supabaseService", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/app/api/_lib/supabaseService")>();
  return {
    ...original,
    getSupabaseService: () => ({
      from: () => ({ upsert: upsertMock }),
    }),
    withJobRun: async (
      _jobName: string,
      work: (context: {
        runId: number;
        bumpRows: (rowsIn?: number, rowsOut?: number) => void;
        setWatermark: (watermark: string) => void;
        setMeta: (meta: Record<string, unknown>) => void;
        setOutcome: (outcome: string) => void;
      }) => Promise<unknown>,
    ) => {
      let outcome = "success";
      let meta: Record<string, unknown> = {};
      const result = await work({
        runId: 73,
        bumpRows: () => undefined,
        setWatermark: () => undefined,
        setMeta: (next) => {
          meta = { ...meta, ...next };
        },
        setOutcome: (next) => {
          outcome = next;
        },
      });
      return {
        ok: outcome === "success" || outcome === "empty",
        outcome,
        runId: 73,
        result,
        meta,
      };
    },
  };
});

vi.mock("@/app/api/admin/cron/_lib/postAdSpendToPostHog", () => ({
  postAdSpendToPostHog: postAdSpendMock,
}));

const GOOGLE_ENV_KEYS = [
  "GOOGLE_ADS_DEVELOPER_TOKEN",
  "GOOGLE_ADS_LOGIN_CUSTOMER_ID",
  "GOOGLE_ADS_CUSTOMER_ID",
  "GOOGLE_ADS_REFRESH_TOKEN",
  "GOOGLE_ADS_OAUTH_CLIENT_ID",
  "GOOGLE_ADS_OAUTH_CLIENT_SECRET",
] as const;

function cronRequest(path: string) {
  return new NextRequest(`http://localhost${path}`, {
    headers: { authorization: "Bearer test-cron-secret" },
  });
}

describe("ingestion route outcomes", () => {
  beforeEach(() => {
    process.env.CRON_SECRET = "test-cron-secret";
    upsertMock.mockReset().mockResolvedValue({ error: null });
    postAdSpendMock.mockReset().mockResolvedValue({ captured: 0 });
  });

  it("reports missing Google Ads configuration as skipped", async () => {
    for (const key of GOOGLE_ENV_KEYS) delete process.env[key];
    const { GET } = await import("@/app/api/admin/cron/google-ads-spend/route");

    const response = await GET(cronRequest("/api/admin/cron/google-ads-spend"));

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual(
      expect.objectContaining({
        ok: false,
        outcome: "skipped",
        result: { skipped: true, missing: [...GOOGLE_ENV_KEYS] },
      }),
    );
    expect(upsertMock).not.toHaveBeenCalled();
  });

  it("reports an authenticated Google Ads response with no rows as empty", async () => {
    for (const key of GOOGLE_ENV_KEYS) process.env[key] = `fixture-${key.toLowerCase()}`;
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: "fixture-token" })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ results: [] }))));
    const { GET } = await import("@/app/api/admin/cron/google-ads-spend/route");

    const response = await GET(cronRequest("/api/admin/cron/google-ads-spend"));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(
      expect.objectContaining({
        ok: true,
        outcome: "empty",
        result: { rows: 0 },
      }),
    );
    expect(upsertMock).not.toHaveBeenCalled();
  });

  it("reports traffic as partial when PostHog succeeds and GA4 is skipped", async () => {
    delete process.env.GA_PROPERTY_ID;
    process.env.POSTHOG_PROJECT_ID = "fixture-project";
    process.env.POSTHOG_PERSONAL_API_KEY = "fixture-api-key";
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ results: [["2026-09-12", 4]] })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ results: [] })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ results: [] }))));
    const { GET } = await import("@/app/api/admin/cron/traffic-pull/route");

    const response = await GET(cronRequest("/api/admin/cron/traffic-pull"));
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body).toEqual(expect.objectContaining({ ok: false, outcome: "partial" }));
    expect(body.meta.sources).toEqual({
      ga4: { outcome: "skipped", rows: 0, reason: "missing GA_PROPERTY_ID" },
      posthog: { outcome: "success", rows: 1 },
    });
    expect(upsertMock).toHaveBeenCalledOnce();
  });

  it("reports traffic as failed when its only attempted source fails", async () => {
    delete process.env.GA_PROPERTY_ID;
    process.env.POSTHOG_PROJECT_ID = "fixture-project";
    process.env.POSTHOG_PERSONAL_API_KEY = "fixture-api-key";
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("fixture PostHog outage")));
    const { GET } = await import("@/app/api/admin/cron/traffic-pull/route");

    const response = await GET(cronRequest("/api/admin/cron/traffic-pull"));
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body).toEqual(expect.objectContaining({ ok: false, outcome: "failed" }));
    expect(body.meta.sources).toEqual({
      ga4: { outcome: "skipped", rows: 0, reason: "missing GA_PROPERTY_ID" },
      posthog: { outcome: "failed", rows: 0, reason: "fixture PostHog outage" },
    });
    expect(upsertMock).not.toHaveBeenCalled();
  });
});
