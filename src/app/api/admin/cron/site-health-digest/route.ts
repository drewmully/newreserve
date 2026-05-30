/**
 * GET /api/admin/cron/site-health-digest
 *
 * Friday-morning digest of the prior Fri→Thu site-health window.
 *
 * Runs from Vercel cron at 10:00 UTC and 11:00 UTC every Friday; the route
 * self-guards so the email only ships when the local hour in
 * America/Detroit is exactly 6 (handles EDT vs EST automatically).
 *
 * Recipients: drew@mullybox.com, jack@mullybox.com
 *
 * Body:
 *   - HTML / text digest summarizing every finding in the window
 * Attachments:
 *   - One PDF per P0/P1 + per new-this-week P2 (recurring P2s = bullets only)
 *
 * Auth: CRON_SECRET Bearer or vercel-cron User-Agent. May also be invoked
 * manually with `?force=1` to bypass the local-hour guard (useful for QA).
 */

import { NextRequest, NextResponse } from "next/server";
import { Resend } from "resend";
import {
  getFindingsInWindow,
  getPriorFridayThursdayWindow,
} from "@/lib/siteHealth";
import {
  filterFindingsForDigest,
  renderDigestHtml,
  renderDigestText,
  summarizeBySeverity,
  summarizeByJourney,
  pdfFilename,
  buildFindingPdf,
} from "@/lib/siteHealthDigest";
import { FROM, REPLY_TO } from "@/lib/email/resend";

export const runtime = "nodejs";
export const maxDuration = 300;

const RECIPIENTS = ["drew@mullybox.com", "jack@mullybox.com"];

function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  if (req.headers.get("authorization") === `Bearer ${secret}`) return true;
  const ua = req.headers.get("user-agent") || "";
  return ua.includes("vercel-cron");
}

/**
 * Returns the current hour (0-23) in America/Detroit, regardless of host TZ.
 * This is how we lock the send to 6 AM ET year-round in spite of UTC crons
 * and DST transitions.
 */
function detroitHour(now: Date = new Date()): number {
  const fmt = new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    hour12: false,
    timeZone: "America/Detroit",
  });
  return parseInt(fmt.format(now), 10);
}

function detroitWeekday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    timeZone: "America/Detroit",
  }).format(now);
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const force = url.searchParams.get("force") === "1";
  const dryRun = url.searchParams.get("dry") === "1";

  const now = new Date();
  const weekday = detroitWeekday(now);
  const hour = detroitHour(now);

  // We schedule the cron twice (10:00 + 11:00 UTC) so that one of them
  // always lands on local 6 AM regardless of DST. The other quietly
  // returns "skipped". Manual ?force=1 bypasses.
  if (!force && (weekday !== "Fri" || hour !== 6)) {
    return NextResponse.json({
      ok: true,
      skipped: true,
      reason: "not Friday 6am ET",
      detroit_weekday: weekday,
      detroit_hour: hour,
    });
  }

  const window = getPriorFridayThursdayWindow(now);
  const findings = await getFindingsInWindow(window.startMs, window.endMs);

  const { withPdf, bullets } = filterFindingsForDigest(findings, window);

  const sevCounts = summarizeBySeverity(findings);
  const journeyCounts = summarizeByJourney(findings);

  const baseUrl =
    process.env.MULLY_BASE_URL?.trim() || "https://mymully.com";

  const subject = buildSubject(sevCounts, window);
  const html = renderDigestHtml({
    window,
    findings,
    withPdf,
    bullets,
    baseUrl,
  });
  const text = renderDigestText({
    window,
    findings,
    withPdf,
    bullets,
    baseUrl,
  });

  // Build all attachments (one PDF per finding with withPdf flag).
  const attachments: { filename: string; content: string }[] = [];
  for (const f of withPdf) {
    try {
      const bytes = await buildFindingPdf(f);
      attachments.push({
        filename: pdfFilename(f),
        // Resend expects base64-encoded content for attachments.
        content: Buffer.from(bytes).toString("base64"),
      });
    } catch (err) {
      // Don't fail the whole digest just because one PDF blew up.
      console.error("[site-health-digest] PDF build failed", {
        finding_id: f.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  if (dryRun) {
    return NextResponse.json({
      ok: true,
      dry_run: true,
      window,
      counts: {
        total: findings.length,
        with_pdf: withPdf.length,
        bullets_only: bullets.length,
        attachments_built: attachments.length,
      },
      severities: sevCounts,
      journeys: journeyCounts,
      subject,
    });
  }

  // If nothing happened this week, still send a "clean week" note so we know
  // the bot is alive — but no attachments.
  const apiKey = process.env.RESEND_API_KEY?.trim();
  if (!apiKey) {
    return NextResponse.json(
      { error: "RESEND_API_KEY missing" },
      { status: 500 },
    );
  }

  const resend = new Resend(apiKey);
  const { data, error } = await resend.emails.send({
    from: FROM,
    replyTo: REPLY_TO,
    to: RECIPIENTS,
    subject,
    html,
    text,
    ...(attachments.length > 0 ? { attachments } : {}),
    tags: [
      { name: "category", value: "site_health_digest" },
      { name: "flow", value: "ops_digest" },
    ],
  });

  if (error) {
    return NextResponse.json(
      {
        error: "resend_failed",
        details: error,
      },
      { status: 500 },
    );
  }

  return NextResponse.json({
    ok: true,
    message_id: data?.id ?? null,
    recipients: RECIPIENTS,
    window,
    counts: {
      total: findings.length,
      with_pdf: withPdf.length,
      bullets_only: bullets.length,
      attachments_sent: attachments.length,
    },
    severities: sevCounts,
  });
}

function buildSubject(
  sev: Record<"P0" | "P1" | "P2", number>,
  window: { startLabel: string; endLabel: string },
): string {
  const total = sev.P0 + sev.P1 + sev.P2;
  if (total === 0) {
    return `Site health · clean week (${window.startLabel} – ${window.endLabel})`;
  }
  const parts: string[] = [];
  if (sev.P0) parts.push(`${sev.P0} P0`);
  if (sev.P1) parts.push(`${sev.P1} P1`);
  if (sev.P2) parts.push(`${sev.P2} P2`);
  return `Site health · ${parts.join(" · ")} (${window.startLabel} – ${window.endLabel})`;
}
