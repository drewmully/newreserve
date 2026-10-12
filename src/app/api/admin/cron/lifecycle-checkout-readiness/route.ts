/**
 * GET /api/admin/cron/lifecycle-checkout-readiness?minutes=180
 *
 * Every 15 minutes: refresh readiness for everyone who started a Shopify
 * checkout recently, so first-time shoppers get their checkout recovery
 * flag well before the flow's first send (4 hours, then the next 9 a.m.).
 * The Klaviyo flow checks the flag right before each email, not at entry.
 *
 * `minutes` (default 180, max 20160 = 14 days) widens the window for a
 * one-time catch-up. Same switches as the daily readiness job: with
 * LIFECYCLE_READINESS_WRITE_ENABLED unset it does nothing.
 * Properties only. Returns counts and hold codes only, no PII.
 */
import { NextResponse } from "next/server";
import { isCronAuthorized } from "@/lib/klaviyo/worker";
import { computeReadiness, readReadinessConfig } from "@/lib/lifecycle/readiness";
import { readReadinessEvidence, recentCheckoutEmails, writeReadinessProperties } from "@/lib/lifecycle/readinessSources";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(req: Request) {
  if (!isCronAuthorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const config = readReadinessConfig();
  if (!config.enabled) return NextResponse.json({ ok: true, enabled: false });
  const url = new URL(req.url);
  const minutes = Math.min(20_160, Math.max(15, Math.floor(Number(url.searchParams.get("minutes") ?? 180)) || 180));
  let emails: string[];
  try { emails = await recentCheckoutEmails(new Date(Date.now() - minutes * 60_000)); }
  catch { return NextResponse.json({ ok: false, error: "checkout_events_failed" }, { status: 500 }); }
  const started = Date.now();
  const summary = { ok: true, enabled: true, minutes, total: emails.length, processed: 0, written: 0, failed: 0,
    checkoutReady: 0, holds: {} as Record<string, number> };
  for (const email of emails) {
    if (Date.now() - started > 270_000) break;
    summary.processed++;
    try {
      const { properties, holds } = computeReadiness(await readReadinessEvidence(email), config);
      await writeReadinessProperties(email, properties);
      summary.written++;
      if (properties.mully_wave1_checkout_launch_ready === true) summary.checkoutReady++;
      for (const h of holds) { const code = h.split(":").slice(0, 2).join(":"); summary.holds[code] = (summary.holds[code] ?? 0) + 1; }
    } catch { summary.failed++; }
  }
  return NextResponse.json(summary);
}
