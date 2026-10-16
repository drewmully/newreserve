/**
 * GET /api/admin/cron/growth-os-live
 * Every 30 min (vercel.json). Refreshes Growth OS spend, status, budgets and order attribution
 * without using Perplexity credits. Read-only against Meta, Google Ads and Shopify.
 * Auth: Bearer CRON_SECRET, or vercel-cron user-agent.
 */
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseService } from "@/app/api/_lib/supabaseService";
import { runLiveRefresh } from "@/lib/growthOs/liveRefresh";

export const runtime = "nodejs";
export const maxDuration = 120;

function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  if (req.headers.get("authorization") === `Bearer ${secret}`) return true;
  return (req.headers.get("user-agent") || "").includes("vercel-cron");
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  if (!isAuthorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const started = Date.now();
  try {
    const sb = getSupabaseService();
    const out = await runLiveRefresh(process.env, async (fn, args) => {
      const { data, error } = await sb.rpc(fn, args);
      if (error) throw new Error(`${fn}: ${error.message}`);
      return data;
    });
    if (out.errors.length) console.warn("[growth-os-live] partial", out.errors);
    return NextResponse.json({ ok: true, duration_ms: Date.now() - started, ...out });
  } catch (e) {
    console.error("[growth-os-live] failed", e);
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
