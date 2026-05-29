/**
 * GET /api/admin/marketing-funnel/rocks
 *
 * Returns Loop-backed Rock counters (300 new Reserve signups + 300
 * Reserve Swaps). Split out from /api/admin/marketing-funnel so the
 * main dashboard can render immediately while this slower (~10-15s
 * first call, then cached 5min) lookup runs in parallel.
 *
 * Auth: Firebase Bearer token, admin email allowlist.
 */
import { NextRequest, NextResponse } from "next/server";
import { adminAuth } from "@/lib/firebase-admin";
import { isAllowedAdminEmail } from "@/lib/adminEmailAllowlist";
import { getRocksProgress, type RocksData } from "@/app/api/_lib/loopRocks";

export const runtime = "nodejs";
export const maxDuration = 60;

async function verifyAdmin(request: NextRequest): Promise<void> {
  const header = request.headers.get("Authorization") ?? "";
  const token = header.replace(/^Bearer\s+/i, "").trim();
  if (!token) throw new Error("Missing Authorization header");
  const decoded = await adminAuth.verifyIdToken(token, true);
  if (!decoded.email || !isAllowedAdminEmail(decoded.email)) {
    throw new Error("Forbidden");
  }
}

export async function GET(request: NextRequest) {
  try {
    await verifyAdmin(request);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unauthorized";
    return NextResponse.json(
      { error: msg },
      { status: msg === "Forbidden" ? 403 : 401 }
    );
  }

  try {
    const rocks: RocksData = await getRocksProgress();
    return NextResponse.json({ rocks, rocks_error: null });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn("[marketing-funnel/rocks] failed:", msg);
    return NextResponse.json({ rocks: null, rocks_error: msg }, { status: 200 });
  }
}
