/**
 * GET /api/admin/email-funnel-live?days=7|30|90[&refresh=1]
 *
 * Live email funnel for /admin/email-funnel. Read-only: every number is
 * recomputed from Klaviyo, PostHog and Shopify on request (cached 10 minutes
 * per window). Auth: Firebase Bearer token on the admin allowlist.
 * The older /api/admin/email-funnel route (Firestore drip sequences) is separate.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/app/api/_lib/adminAuth";
import { parseWindow } from "@/lib/emailFunnel/config";
import { buildFunnelReport, type FunnelReport } from "@/lib/emailFunnel/build";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const CACHE_MS = 10 * 60_000;
const cache = new Map<number, { at: number; report: FunnelReport }>();

export async function GET(req: NextRequest) {
  const guard = await requireAdmin(req);
  if (!guard.ok) return guard.response;

  const window = parseWindow(req.nextUrl.searchParams.get("days"));
  const refresh = req.nextUrl.searchParams.get("refresh") === "1";
  const hit = cache.get(window);
  if (!refresh && hit && Date.now() - hit.at < CACHE_MS) {
    return NextResponse.json({ ...hit.report, cached: true }, { headers: { "Cache-Control": "no-store" } });
  }
  try {
    const report = await buildFunnelReport(window);
    cache.set(window, { at: Date.now(), report });
    return NextResponse.json({ ...report, cached: false }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    const message = err instanceof Error ? err.message.slice(0, 160) : "unknown";
    return NextResponse.json({ error: "email_funnel_failed", message }, { status: 500 });
  }
}
