/**
 * GET /api/admin/cron/site-health-sweep
 *
 * Daily site-health sweep. Walks the critical user journeys, asks Claude
 * to grade each screenshot/DOM for UX issues, ingests the last 24h of
 * PostHog $exception events, and writes/upserts findings to Firestore.
 *
 * Runs daily via Vercel Cron (see vercel.json, 06:00 UTC = 02:00 ET).
 * Idempotent: findings are deduped on a stable content hash so re-running
 * the same day just bumps occurrence_count.
 *
 * Auth:
 *   - Vercel-Cron user-agent (managed cron)
 *   - or  Authorization: Bearer ${CRON_SECRET}
 *
 * Required envs:
 *   - ANTHROPIC_API_KEY        (Claude UX judge)
 *   - FIREBASE_*               (Firestore admin, already configured)
 *
 * Optional envs:
 *   - BROWSER_WS_ENDPOINT      Browserless/Browserbase websocket URL.
 *                              If set, the sweep loads pages with a real
 *                              Chromium and captures screenshots + console.
 *                              If unset, lite mode: HTML fetch + DOM parse,
 *                              no screenshots (Claude review is skipped).
 *   - SITE_HEALTH_BASE_URL     Defaults to https://mymully.com
 *   - SITE_HEALTH_TEST_EMAIL   Firebase test-user email for authed journeys.
 *   - SITE_HEALTH_TEST_PASSWORD
 *   - POSTHOG_PROJECT_ID, POSTHOG_PERSONAL_API_KEY, POSTHOG_HOST
 *                              For the $exception ingest. Reuses the same
 *                              envs that /admin/cron/traffic-pull already uses.
 */

import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import {
  upsertFinding,
  type Journey,
  type NewFinding,
  type Severity,
} from "@/lib/siteHealth";

export const runtime = "nodejs";
export const maxDuration = 300; // 5 min — sweep is the heaviest cron we run

function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get("authorization") === `Bearer ${secret}`) return true;
  const ua = req.headers.get("user-agent") ?? "";
  return ua.toLowerCase().includes("vercel-cron");
}

interface JourneyDef {
  id: Journey;
  label: string;
  path: string;
  requiresAuth: boolean;
  /** Critical user-facing journeys — failures here are P0 by default. */
  critical: boolean;
}

const JOURNEYS: JourneyDef[] = [
  { id: "home", label: "Public homepage", path: "/", requiresAuth: false, critical: true },
  { id: "signup", label: "Subscription LP", path: "/lp/subscription", requiresAuth: false, critical: true },
  { id: "login", label: "Login page", path: "/login", requiresAuth: false, critical: true },
  { id: "shop", label: "Shop landing", path: "/shop", requiresAuth: false, critical: false },
  { id: "account", label: "Account dashboard", path: "/account", requiresAuth: true, critical: true },
  { id: "upgrade", label: "Account ?upgrade=1 (legacy→Reserve)", path: "/account?upgrade=1", requiresAuth: true, critical: true },
  { id: "returns", label: "Returns lookup", path: "/returns", requiresAuth: false, critical: false },
];

interface JourneyResult {
  journey: JourneyDef;
  ok: boolean;
  status?: number;
  consoleErrors: string[];
  networkErrors: { url: string; status: number }[];
  screenshotUrl?: string | null;
  domExcerpt: string;
  finalUrl: string;
}

const BASE_URL = (process.env.SITE_HEALTH_BASE_URL ?? "https://mymully.com").replace(/\/+$/, "");

/* ─── Journey runner ───────────────────────────────────────────────────── */

async function runJourneyLite(j: JourneyDef): Promise<JourneyResult> {
  // Lite mode: fetch raw HTML, scan for obvious red flags. No screenshots.
  const url = `${BASE_URL}${j.path}`;
  try {
    const res = await fetch(url, {
      redirect: "follow",
      headers: { "user-agent": "mully-site-health-bot/1.0" },
    });
    const html = await res.text();
    const consoleErrors: string[] = [];
    // Heuristics for server-rendered error frames (Next.js error overlays
    // are dev-only, but error boundaries print recognizable strings).
    if (/application error|something went wrong|Loop API error/i.test(html)) {
      consoleErrors.push("Page HTML contains an error/empty-state phrase");
    }
    return {
      journey: j,
      ok: res.ok,
      status: res.status,
      consoleErrors,
      networkErrors: [],
      screenshotUrl: null,
      domExcerpt: html.slice(0, 8000),
      finalUrl: res.url,
    };
  } catch (err) {
    return {
      journey: j,
      ok: false,
      consoleErrors: [`fetch failed: ${err instanceof Error ? err.message : String(err)}`],
      networkErrors: [],
      screenshotUrl: null,
      domExcerpt: "",
      finalUrl: url,
    };
  }
}

/**
 * Full-fidelity browser run. Requires BROWSER_WS_ENDPOINT (Browserless,
 * Browserbase, or a self-hosted Chromium debug socket). We dynamic-import
 * playwright-core so the dependency is optional — if Playwright isn't
 * installed, the sweep cleanly falls back to lite mode.
 */
async function runJourneyFull(j: JourneyDef): Promise<JourneyResult> {
  const wsEndpoint = process.env.BROWSER_WS_ENDPOINT;
  if (!wsEndpoint) return runJourneyLite(j);

  let playwright: typeof import("playwright-core") | null = null;
  try {
    playwright = await import("playwright-core");
  } catch {
    return runJourneyLite(j);
  }

  const browser = await playwright.chromium.connectOverCDP(wsEndpoint);
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } }); // mobile-first
  const page = await context.newPage();
  const consoleErrors: string[] = [];
  const networkErrors: { url: string; status: number }[] = [];

  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  page.on("response", (res) => {
    if (res.status() >= 400) networkErrors.push({ url: res.url(), status: res.status() });
  });

  let ok = true;
  let status: number | undefined;
  let finalUrl = `${BASE_URL}${j.path}`;
  let domExcerpt = "";
  let screenshotUrl: string | null = null;

  try {
    if (j.requiresAuth && process.env.SITE_HEALTH_TEST_EMAIL) {
      await loginWithFirebase(page, process.env.SITE_HEALTH_TEST_EMAIL, process.env.SITE_HEALTH_TEST_PASSWORD ?? "");
    }
    const resp = await page.goto(`${BASE_URL}${j.path}`, { waitUntil: "networkidle", timeout: 30_000 });
    status = resp?.status();
    ok = (resp?.ok() ?? false) && consoleErrors.length === 0;
    finalUrl = page.url();
    domExcerpt = (await page.content()).slice(0, 12_000);

    // Screenshot → upload to Firebase Storage (cheap, already provisioned).
    const buf = await page.screenshot({ fullPage: true, type: "png" });
    screenshotUrl = await uploadScreenshot(buf, j.id);
  } catch (err) {
    ok = false;
    consoleErrors.push(`navigation failed: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    await browser.close().catch(() => {});
  }

  return {
    journey: j,
    ok,
    status,
    consoleErrors,
    networkErrors,
    screenshotUrl,
    domExcerpt,
    finalUrl,
  };
}

async function loginWithFirebase(
  page: import("playwright-core").Page,
  email: string,
  password: string
): Promise<void> {
  await page.goto(`${BASE_URL}/login`, { waitUntil: "domcontentloaded" });
  await page.fill('input[type="email"]', email);
  const passField = page.locator('input[type="password"]');
  if ((await passField.count()) > 0) {
    await passField.fill(password);
  }
  await page.click('button[type="submit"]');
  await page.waitForURL(/\/(home|account)/, { timeout: 15_000 }).catch(() => {});
}

async function uploadScreenshot(buf: Buffer, journeyId: string): Promise<string | null> {
  try {
    const { getStorage } = await import("firebase-admin/storage");
    const storage = getStorage();
    const bucket = storage.bucket();
    const filename = `site-health/${new Date().toISOString().slice(0, 10)}/${journeyId}-${Date.now()}.png`;
    const file = bucket.file(filename);
    await file.save(buf, { metadata: { contentType: "image/png" } });
    const [signed] = await file.getSignedUrl({
      action: "read",
      expires: Date.now() + 30 * 86_400_000,
    });
    return signed;
  } catch {
    return null;
  }
}

/* ─── Claude UX judge ──────────────────────────────────────────────────── */

interface JudgeFinding {
  severity: Severity;
  title: string;
  description: string;
  suggested_fix?: string;
}

async function judgeWithClaude(result: JourneyResult): Promise<JudgeFinding[]> {
  if (!process.env.ANTHROPIC_API_KEY) return [];
  if (!result.domExcerpt) return [];

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const sys = `You are reviewing a page on mymully.com — a quarterly golf apparel subscription site — for objective UX defects. You are not a marketing critic; you only flag things that hurt usability.

Categorize each finding by severity:
- P0: User cannot complete the journey (button unresponsive, modal blocks UI, page crashed, fatal error visible)
- P1: User is confused or misled (broken layout, contradictory copy, dead-end error like "Loop API error" with no recovery, text truncation that hides meaning)
- P2: Cosmetic only (text overflow without information loss, alignment quirks, low contrast on non-critical elements)

Return ONLY a JSON array. No prose. If nothing is wrong, return [].
Each element: { "severity": "P0"|"P1"|"P2", "title": "<short>", "description": "<what>", "suggested_fix": "<how>" }`;

  const userMsg = `Journey: ${result.journey.label}
URL: ${result.finalUrl}
HTTP status: ${result.status ?? "unknown"}
Console errors: ${JSON.stringify(result.consoleErrors).slice(0, 1500)}
Network errors: ${JSON.stringify(result.networkErrors).slice(0, 1500)}

DOM excerpt (truncated):
${result.domExcerpt.slice(0, 8000)}`;

  try {
    const resp = await client.messages.create({
      model: "claude-sonnet-4-5",
      max_tokens: 1500,
      system: sys,
      messages: [{ role: "user", content: userMsg }],
    });
    const text = resp.content
      .filter((c): c is Anthropic.TextBlock => c.type === "text")
      .map((c) => c.text)
      .join("");
    // Find the first JSON array in the response.
    const match = text.match(/\[[\s\S]*\]/);
    if (!match) return [];
    const parsed = JSON.parse(match[0]) as JudgeFinding[];
    return parsed.filter((f) => f && f.severity && f.title);
  } catch (err) {
    console.error("[site-health-sweep] Claude judge failed:", err);
    return [];
  }
}

/* ─── PostHog $exception ingest ────────────────────────────────────────── */

interface PostHogException {
  event_id: string;
  message: string;
  url: string;
  stack: string;
  count: number;
}

async function fetchRecentExceptions(): Promise<PostHogException[]> {
  const projectId = process.env.POSTHOG_PROJECT_ID;
  const apiKey = process.env.POSTHOG_PERSONAL_API_KEY;
  const host = process.env.POSTHOG_HOST || "https://us.posthog.com";
  if (!projectId || !apiKey) return [];

  const query = `SELECT
    any(uuid) as event_id,
    properties.\$exception_message as message,
    properties.\$current_url as url,
    properties.\$exception_stack_trace_raw as stack,
    count() as count
   FROM events
   WHERE event = '$exception'
     AND timestamp > now() - INTERVAL 24 HOUR
   GROUP BY message, url, stack
   ORDER BY count DESC
   LIMIT 25`;

  try {
    const res = await fetch(`${host}/api/projects/${projectId}/query/`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query: { kind: "HogQLQuery", query } }),
    });
    if (!res.ok) {
      console.warn("[site-health-sweep] PostHog query failed:", res.status, await res.text());
      return [];
    }
    const data = (await res.json()) as { results?: unknown[][] };
    return (data.results ?? []).map((row) => ({
      event_id: String(row[0] ?? ""),
      message: String(row[1] ?? ""),
      url: String(row[2] ?? ""),
      stack: String(row[3] ?? ""),
      count: Number(row[4] ?? 0),
    }));
  } catch (err) {
    console.error("[site-health-sweep] PostHog fetch failed:", err);
    return [];
  }
}

function classifyExceptionJourney(url: string): Journey {
  try {
    const p = new URL(url).pathname;
    if (p.startsWith("/account")) return "account";
    if (p.startsWith("/login") || p.startsWith("/signup")) return "signup";
    if (p.startsWith("/admin")) return "admin";
    if (p.startsWith("/shop") || p.startsWith("/products")) return "shop";
    if (p.startsWith("/returns")) return "returns";
    if (p.startsWith("/lp")) return "signup";
    if (p === "/" || p === "/home") return "home";
    return "other";
  } catch {
    return "other";
  }
}

/* ─── Orchestrator ─────────────────────────────────────────────────────── */

export async function GET(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const sweepId = `sweep-${new Date().toISOString().replace(/[:.]/g, "-")}`;
  const summary = {
    sweep_id: sweepId,
    started_at: Date.now(),
    finished_at: 0,
    journeys_run: 0,
    findings_new: 0,
    findings_recurring: 0,
    errors: [] as string[],
  };

  // 1. Synthetic journey sweep
  for (const j of JOURNEYS) {
    summary.journeys_run += 1;
    try {
      const result = await runJourneyFull(j);

      // a) Hard failure (HTTP error or navigation crash)
      if (!result.ok) {
        const sev: Severity = j.critical ? "P0" : "P1";
        const finding: NewFinding = {
          severity: sev,
          source: "synthetic",
          journey: j.id,
          title: `${j.label} returned ${result.status ?? "error"}`,
          description: `The synthetic sweep could not complete the ${j.label} journey. Console errors: ${result.consoleErrors.slice(0, 3).join(" | ") || "none"}. Network errors: ${result.networkErrors.slice(0, 3).map((n) => `${n.status} ${n.url}`).join(" | ") || "none"}.`,
          evidence: {
            url: result.finalUrl,
            screenshot_url: result.screenshotUrl ?? null,
            console_excerpt: result.consoleErrors.slice(0, 5).join("\n") || null,
            network_excerpt: result.networkErrors.slice(0, 5).map((n) => `${n.status} ${n.url}`).join("\n") || null,
            dom_excerpt: result.domExcerpt.slice(0, 2000) || null,
          },
        };
        const { created } = await upsertFinding(finding, sweepId);
        if (created) summary.findings_new += 1;
        else summary.findings_recurring += 1;
      }

      // b) Claude UX review (only when we have a real DOM)
      const judged = await judgeWithClaude(result);
      for (const f of judged) {
        const { created } = await upsertFinding(
          {
            severity: f.severity,
            source: "llm-ux",
            journey: j.id,
            title: f.title,
            description: f.description,
            evidence: {
              url: result.finalUrl,
              screenshot_url: result.screenshotUrl ?? null,
              dom_excerpt: result.domExcerpt.slice(0, 2000) || null,
            },
            suggested_fix: f.suggested_fix ?? null,
          },
          sweepId
        );
        if (created) summary.findings_new += 1;
        else summary.findings_recurring += 1;
      }
    } catch (err) {
      summary.errors.push(`${j.id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // 2. PostHog $exception ingest (last 24h)
  try {
    const exceptions = await fetchRecentExceptions();
    for (const ex of exceptions) {
      if (!ex.message) continue;
      const severity: Severity = ex.count >= 10 ? "P0" : ex.count >= 3 ? "P1" : "P2";
      const finding: NewFinding = {
        severity,
        source: "posthog",
        journey: classifyExceptionJourney(ex.url),
        title: ex.message.slice(0, 140),
        description: `PostHog captured this exception ${ex.count}× in the last 24 hours on ${ex.url || "(unknown URL)"}.`,
        evidence: {
          url: ex.url || `${BASE_URL}/`,
          posthog_event_id: ex.event_id,
          stack_excerpt: ex.stack.slice(0, 2000) || null,
        },
      };
      const { created } = await upsertFinding(finding, sweepId);
      if (created) summary.findings_new += 1;
      else summary.findings_recurring += 1;
    }
  } catch (err) {
    summary.errors.push(`posthog: ${err instanceof Error ? err.message : String(err)}`);
  }

  summary.finished_at = Date.now();
  return NextResponse.json(summary);
}
