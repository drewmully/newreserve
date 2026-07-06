/**
 * GET /api/admin/cron/ab-homepage-daily
 *
 * Fires once per day at 3am America/Detroit. For "yesterday" (Detroit local),
 * pulls funnel counts from PostHog split by `homepage-lp` (control =
 * /lp/subscription, variant-a = /lp/editorial) and appends ONE row to the
 * "A/B Test Results" tab of the "Mully Master Growth Plan" spreadsheet.
 *
 * Drew clears the tab at end-of-day; the 3am run then writes the previous
 * day's numbers. Idempotency isn't strictly required (a re-run just appends
 * a duplicate row that's easy to remove) but the endpoint accepts
 * `?date=YYYY-MM-DD` to backfill an arbitrary Detroit-local day.
 *
 * Metrics per variant (A = control, B = variant-a):
 *   Visitors   → distinct $anon_distinct_id on `page_view`
 *   Emails     → count of `email_submitted`
 *   ATC        → count of `add_to_cart`
 *   Checkout   → count of `checkout_clicked`
 *   Purchases  → count of `purchase`
 *   Revenue    → SUM(properties.value) on `purchase`
 *
 * Sheet columns (in order):
 *   Date | Test Name | Visitors A | Emails A | ATC A | Checkout A | Purchases A | Revenue A
 *        |            Visitors B | Emails B | ATC B | Checkout B | Purchases B | Revenue B | Notes
 *
 * Requires:
 *   POSTHOG_PROJECT_ID, POSTHOG_PERSONAL_API_KEY   — HogQL access
 *   GOOGLE_SHEETS_SERVICE_ACCOUNT_BASE64 or
 *     GOOGLE_SERVICE_ACCOUNT_JSON_BASE64 or
 *     firebase service-account fallbacks           — see src/lib/v1GoogleSheet.ts
 *   CRON_SECRET                                    — Bearer for manual triggers
 */

import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 60;

const GROWTH_SHEET_ID =
  process.env.AB_HOMEPAGE_SHEET_ID ||
  "1oP1RODoV-79sIGIqysCbfDr6B83FzZ5lTyIs0CwiFzA";
const GROWTH_SHEET_TAB =
  process.env.AB_HOMEPAGE_SHEET_TAB || "A/B Test Results";
const TEST_NAME = process.env.AB_HOMEPAGE_TEST_NAME || "Homepage: Subscription vs Editorial";

// ─── auth
function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  if (req.headers.get("authorization") === `Bearer ${secret}`) return true;
  return (req.headers.get("user-agent") || "").includes("vercel-cron");
}

// ─── Detroit-local "yesterday" (YYYY-MM-DD)
function yesterdayInDetroit(now: Date = new Date()): string {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Detroit",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const detroitYMD = fmt.format(now); // e.g. "2026-07-06"
  const [y, m, d] = detroitYMD.split("-").map(Number);
  // Compute the calendar day BEFORE Detroit's "today" by treating the
  // Detroit YMD as a UTC anchor and stepping back one day. This avoids the
  // trap of subtracting 24h off `now` (which lands in the wrong day when
  // now is between 00:00 and 04:00 UTC).
  const anchor = new Date(Date.UTC(y, m - 1, d));
  anchor.setUTCDate(anchor.getUTCDate() - 1);
  return anchor.toISOString().slice(0, 10);
}

// ─── PostHog HogQL query
type VariantCounts = {
  visitors: number;
  emails: number;
  atc: number;
  checkout: number;
  purchases: number;
  revenue: number;
};

const EMPTY_COUNTS: VariantCounts = {
  visitors: 0,
  emails: 0,
  atc: 0,
  checkout: 0,
  purchases: 0,
  revenue: 0,
};

type PosthogRow = [string, number, number, number, number, number, number];

async function runHogQL(
  projectId: string,
  apiKey: string,
  host: string,
  query: string,
): Promise<PosthogRow[]> {
  const r = await fetch(`${host}/api/projects/${projectId}/query/`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query: { kind: "HogQLQuery", query } }),
  });
  if (!r.ok) {
    throw new Error(`posthog hogql: ${r.status} ${await r.text().catch(() => "")}`);
  }
  const j = (await r.json()) as { results?: PosthogRow[] };
  return j.results || [];
}

/**
 * Pull yesterday's counts split by the `homepage-lp` event property.
 * Detroit is UTC-4 (EDT) or UTC-5 (EST); to keep the query stable, we ask
 * PostHog for the raw property on events whose Detroit-local date matches
 * `dateISO`. Uses `toString(toDate(timestamp, 'America/Detroit'))` so DST
 * flips are handled by ClickHouse, not by us.
 */
async function pullPosthogSplit(dateISO: string): Promise<{
  control: VariantCounts;
  variantA: VariantCounts;
}> {
  const projectId = process.env.POSTHOG_PROJECT_ID;
  const apiKey = process.env.POSTHOG_PERSONAL_API_KEY;
  const host = process.env.POSTHOG_HOST || "https://us.posthog.com";
  if (!projectId || !apiKey) {
    return { control: { ...EMPTY_COUNTS }, variantA: { ...EMPTY_COUNTS } };
  }

  // One query, six aggregates, two rows out (one per variant). Filters events
  // to the target Detroit-local day.
  const query = `
    SELECT
      properties['homepage-lp'] AS variant,
      count(DISTINCT if(event = '$pageview' OR event = 'page_view', distinct_id, NULL)) AS visitors,
      countIf(event = 'email_submitted') AS emails,
      countIf(event = 'add_to_cart') AS atc,
      countIf(event = 'checkout_clicked') AS checkout,
      countIf(event = 'purchase') AS purchases,
      sumIf(toFloat64OrZero(toString(properties['value'])), event = 'purchase') AS revenue
    FROM events
    WHERE toString(toDate(timestamp, 'America/Detroit')) = '${dateISO}'
      AND properties['homepage-lp'] IN ('control', 'variant-a')
    GROUP BY variant
  `;
  const rows = await runHogQL(projectId, apiKey, host, query);
  const map: Record<string, VariantCounts> = {};
  for (const row of rows) {
    const [variant, visitors, emails, atc, checkout, purchases, revenue] = row;
    map[variant] = {
      visitors: Number(visitors) || 0,
      emails: Number(emails) || 0,
      atc: Number(atc) || 0,
      checkout: Number(checkout) || 0,
      purchases: Number(purchases) || 0,
      revenue: Number(revenue) || 0,
    };
  }
  return {
    control: map["control"] || { ...EMPTY_COUNTS },
    variantA: map["variant-a"] || { ...EMPTY_COUNTS },
  };
}

// ─── Google Sheets append
type ServiceAccount = { client_email: string; private_key: string };

function resolveServiceAccount(): ServiceAccount | null {
  const parseB64 = (b64?: string): ServiceAccount | null => {
    if (!b64) return null;
    try {
      const parsed = JSON.parse(Buffer.from(b64, "base64").toString("utf-8")) as {
        client_email?: string;
        private_key?: string;
      };
      if (!parsed.client_email || !parsed.private_key) return null;
      return {
        client_email: parsed.client_email,
        private_key: parsed.private_key.replace(/\\n/g, "\n"),
      };
    } catch {
      return null;
    }
  };
  const parseJson = (raw?: string): ServiceAccount | null => {
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw) as { client_email?: string; private_key?: string };
      if (!parsed.client_email || !parsed.private_key) return null;
      return {
        client_email: parsed.client_email,
        private_key: parsed.private_key.replace(/\\n/g, "\n"),
      };
    } catch {
      return null;
    }
  };

  return (
    parseB64(process.env.GOOGLE_SHEETS_SERVICE_ACCOUNT_BASE64) ||
    parseJson(process.env.GOOGLE_SHEETS_SERVICE_ACCOUNT_JSON) ||
    parseB64(process.env.GOOGLE_SERVICE_ACCOUNT_JSON_BASE64) ||
    parseB64(process.env.FIREBASE_SERVICE_ACCOUNT_BASE64) ||
    parseJson(process.env.FIREBASE_SERVICE_ACCOUNT_JSON) ||
    null
  );
}

async function mintGoogleAccessToken(
  sa: ServiceAccount,
  scope: string,
): Promise<string> {
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
  if (!r.ok) throw new Error(`google oauth: ${r.status} ${await r.text().catch(() => "")}`);
  return ((await r.json()) as { access_token: string }).access_token;
}

async function appendRow(
  spreadsheetId: string,
  tab: string,
  row: Array<string | number>,
  accessToken: string,
): Promise<void> {
  const range = encodeURIComponent(`${tab}!A:O`);
  const url =
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}` +
    `/values/${range}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`;
  const r = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ values: [row] }),
  });
  if (!r.ok) {
    throw new Error(`sheets append: ${r.status} ${await r.text().catch(() => "")}`);
  }
}

// ─── handler
export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const dateOverride = url.searchParams.get("date");
  const dryRun = url.searchParams.get("dry_run") === "1";
  const dateISO =
    dateOverride && /^\d{4}-\d{2}-\d{2}$/.test(dateOverride)
      ? dateOverride
      : yesterdayInDetroit();

  const meta: Record<string, unknown> = { date: dateISO, tab: GROWTH_SHEET_TAB };

  let split: { control: VariantCounts; variantA: VariantCounts };
  try {
    split = await pullPosthogSplit(dateISO);
  } catch (e) {
    meta.posthog_error = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, ...meta }, { status: 500 });
  }
  meta.control = split.control;
  meta.variantA = split.variantA;

  const notesBits: string[] = [];
  const totalA =
    split.control.visitors +
    split.control.emails +
    split.control.atc +
    split.control.checkout +
    split.control.purchases;
  const totalB =
    split.variantA.visitors +
    split.variantA.emails +
    split.variantA.atc +
    split.variantA.checkout +
    split.variantA.purchases;
  if (totalA === 0 && totalB === 0) {
    notesBits.push("No PostHog events tagged with homepage-lp on this day.");
  }

  const row: Array<string | number> = [
    dateISO,
    TEST_NAME,
    split.control.visitors,
    split.control.emails,
    split.control.atc,
    split.control.checkout,
    split.control.purchases,
    Number(split.control.revenue.toFixed(2)),
    split.variantA.visitors,
    split.variantA.emails,
    split.variantA.atc,
    split.variantA.checkout,
    split.variantA.purchases,
    Number(split.variantA.revenue.toFixed(2)),
    `A=/lp/subscription, B=/lp/editorial${notesBits.length ? " · " + notesBits.join(" ") : ""}`,
  ];
  meta.row = row;

  if (dryRun) {
    return NextResponse.json({ ok: true, dry_run: true, ...meta });
  }

  const sa = resolveServiceAccount();
  if (!sa) {
    meta.sheets_error = "Missing Google service account credentials";
    return NextResponse.json({ ok: false, ...meta }, { status: 500 });
  }

  try {
    const token = await mintGoogleAccessToken(
      sa,
      "https://www.googleapis.com/auth/spreadsheets",
    );
    await appendRow(GROWTH_SHEET_ID, GROWTH_SHEET_TAB, row, token);
  } catch (e) {
    meta.sheets_error = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, ...meta }, { status: 500 });
  }

  return NextResponse.json({ ok: true, ...meta });
}
