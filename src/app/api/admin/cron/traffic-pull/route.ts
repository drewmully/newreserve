/**
 * GET /api/admin/cron/traffic-pull
 *
 * Pulls daily site funnel metrics into `traffic_pulls`:
 *   - GA4 (Google Analytics Data API v1beta)        source='ga4'
 *   - PostHog (insights / events query API)         source='posthog'
 *
 * Metrics:
 *   visitors          → GA4 `activeUsers`, PostHog `page_view` distinct IDs
 *   accounts_created  → GA4 event `account_created` (Drew can rename via env), PostHog event `account_created`
 *   purchases         → GA4 event `purchase`, PostHog event `purchase`
 *
 * Idempotent on (pull_date, source, metric).
 *
 * GA4 requires: GA_PROPERTY_ID + GOOGLE_SERVICE_ACCOUNT_JSON_BASE64
 *               (with Analytics Data Viewer role on the property)
 * PostHog requires the existing dedicated LEAN query key/project and private
 * LEAN_POSTHOG_TEST_ACCOUNT_FILTERS. Six reviewed predicates apply server-side.
 *
 * GA4 remains optional when unconfigured. Provider errors fail this job after
 * retaining the other source's valid rows; they never overwrite failures as zero.
 * Default window: last 14 closed UTC days. Purchase counts are recorded events,
 * not independently verified paid orders, conversions or receipt evidence.
 */

import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseService, withJobRun } from "@/app/api/_lib/supabaseService";
import { pullTrafficPosthog, trafficWindow } from "@/lib/analytics/trafficSourcePull";

export const runtime = "nodejs";
export const maxDuration = 120;

function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const expected = Buffer.from(`Bearer ${secret}`), supplied = Buffer.from(req.headers.get("authorization") ?? "");
  return expected.length === supplied.length && timingSafeEqual(expected, supplied);
}

async function mintGoogleToken(scope: string): Promise<string | null> {
  const b64 = process.env.GOOGLE_SERVICE_ACCOUNT_JSON_BASE64;
  if (!b64) return null;
  const sa = JSON.parse(Buffer.from(b64, "base64").toString("utf-8")) as {
    client_email: string;
    private_key: string;
  };
  const { createSign } = await import("node:crypto");
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64url");
  const claims = Buffer.from(
    JSON.stringify({
      iss: sa.client_email,
      scope,
      aud: "https://oauth2.googleapis.com/token",
      iat: now,
      exp: now + 3600,
    }),
  ).toString("base64url");
  const signer = createSign("RSA-SHA256");
  signer.update(`${header}.${claims}`);
  const sig = signer.sign(sa.private_key).toString("base64url");
  const jwt = `${header}.${claims}.${sig}`;
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });
  if (!r.ok) throw new Error(`google token: ${r.status} ${await r.text()}`);
  return ((await r.json()) as { access_token: string }).access_token;
}

type FlatRow = { pull_date: string; source: string; metric: string; value: number; raw?: unknown };

async function pullGA4(startISO: string, endISO: string, log: (k: string, v: unknown) => void): Promise<FlatRow[]> {
  const propId = process.env.GA_PROPERTY_ID;
  if (!propId) {
    log("ga4_skipped", "missing GA_PROPERTY_ID");
    return [];
  }
  const token = await mintGoogleToken("https://www.googleapis.com/auth/analytics.readonly");
  if (!token) {
    log("ga4_skipped", "missing GOOGLE_SERVICE_ACCOUNT_JSON_BASE64");
    return [];
  }
  const accountEvent = process.env.GA_ACCOUNT_EVENT || "account_created";
  const purchaseEvent = process.env.GA_PURCHASE_EVENT || "purchase";

  async function runReport(metric: string, eventName?: string): Promise<Array<[string, number]>> {
    const body: Record<string, unknown> = {
      dateRanges: [{ startDate: startISO, endDate: endISO }],
      dimensions: [{ name: "date" }],
      metrics: [{ name: metric }],
    };
    if (eventName) {
      body.dimensionFilter = {
        filter: { fieldName: "eventName", stringFilter: { value: eventName } },
      };
    }
    const r = await fetch(
      `https://analyticsdata.googleapis.com/v1beta/properties/${propId}:runReport`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
    );
    if (!r.ok) throw new Error(`ga4 ${metric}: ${r.status} ${await r.text()}`);
    const j = (await r.json()) as {
      rows?: Array<{ dimensionValues?: Array<{ value?: string }>; metricValues?: Array<{ value?: string }> }>;
    };
    return (j.rows || [])
      .map<[string, number]>((row) => {
        const d = row.dimensionValues?.[0]?.value || ""; // YYYYMMDD
        const iso = d.length === 8 ? `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}` : "";
        const v = Number(row.metricValues?.[0]?.value || 0);
        return [iso, v];
      })
      .filter(([d]) => d);
  }

  const visitors = await runReport("activeUsers");
  const accounts = await runReport("eventCount", accountEvent);
  const purchases = await runReport("eventCount", purchaseEvent);
  const rows: FlatRow[] = [];
  for (const [d, v] of visitors) rows.push({ pull_date: d, source: "ga4", metric: "visitors", value: v });
  for (const [d, v] of accounts) rows.push({ pull_date: d, source: "ga4", metric: "accounts_created", value: v });
  for (const [d, v] of purchases) rows.push({ pull_date: d, source: "ga4", metric: "purchases", value: v });
  return rows;
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  let window: ReturnType<typeof trafficWindow>;
  try {
    if ([...url.searchParams.keys()].some(k => k !== "days") || url.searchParams.getAll("days").length > 1)
      throw new Error("query");
    window = trafficWindow(Date.now(), url.searchParams.get("days"));
  } catch { return NextResponse.json({ error: "invalid_window" }, { status: 400 }); }

  const result = await withJobRun("traffic-pull", async ({ setMeta, bumpRows }) => {
    const meta: Record<string, unknown> = { range: [window.from, window.through], timezone: "UTC",
      posthog_definition: "traffic-filtered-utc-v1", purchases_basis: "recorded_events_not_paid_orders" };
    let sourceFailed = false;
    const log = (k: string, v: unknown) => {
      meta[k] = v;
    };

    const ga4 = await pullGA4(window.from, window.through, log).catch(() => {
      sourceFailed = true; log("ga4_error", "source_unavailable");
      return [] as FlatRow[];
    });
    const ph = await pullTrafficPosthog(window.from, window.until, process.env).catch(() => {
      sourceFailed = true; log("posthog_error", "source_unavailable");
      return [] as FlatRow[];
    });

    const all = [...ga4, ...ph].filter((r) => r.pull_date && Number.isFinite(r.value));
    if (all.length > 0) {
      const svc = getSupabaseService();
      const { error } = await svc
        .from("traffic_pulls")
        .upsert(all, { onConflict: "pull_date,source,metric" });
      if (error) throw new Error("traffic_upsert_unavailable");
    }

    bumpRows(all.length, all.length);
    meta.ga4_rows = ga4.length;
    meta.posthog_rows = ph.length;
    setMeta(meta);
    if (sourceFailed) throw new Error("traffic_pull_source_unavailable");
    return { ga4_rows: ga4.length, posthog_rows: ph.length };
  });

  return NextResponse.json(result, { status: result.ok ? 200 : 503, headers: { "Cache-Control": "no-store" } });
}
