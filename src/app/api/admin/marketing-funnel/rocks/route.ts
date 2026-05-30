/**
 * GET /api/admin/marketing-funnel/rocks
 *
 * Returns Loop-backed Rock counters (300 new Reserve signups + 300
 * Reserve Swaps). Split out from /api/admin/marketing-funnel so the
 * main dashboard can render immediately while this slower (~10-15s
 * first call, then cached 5min) lookup runs in parallel.
 *
 * Snapshot model — the dashboard's hot path:
 *   - ?snapshot=cached  → read the latest Supabase snapshot (~50ms) and
 *                          return it. Falls back to a fresh compute if no
 *                          snapshot exists yet.
 *   - default            → compute live, write a new snapshot for the
 *                          next caller, return the fresh result.
 *
 * The hourly cron at /api/admin/cron/marketing-funnel-snapshot keeps
 * the snapshot warm so users see instant numbers + a freshness chip.
 *
 * Auth: Firebase Bearer token (admin allowlist) OR Bearer <CRON_SECRET>
 *       so the cron and "refresh now" button work too.
 */
import { NextRequest, NextResponse } from "next/server";
import { adminAuth } from "@/lib/firebase-admin";
import { isAllowedAdminEmail } from "@/lib/adminEmailAllowlist";
import { getRocksProgress, type RocksData } from "@/app/api/_lib/loopRocks";
import {
  latestSnapshot,
  writeSnapshot,
  ROCKS_CACHE_KEY,
} from "@/app/api/_lib/funnelSnapshot";

export const runtime = "nodejs";
export const maxDuration = 60;

async function verifyCaller(request: NextRequest): Promise<void> {
  const header = request.headers.get("Authorization") ?? "";
  const token = header.replace(/^Bearer\s+/i, "").trim();
  if (!token) throw new Error("Missing Authorization header");

  // Cron / internal callers use the CRON_SECRET—avoids a real Firebase
  // token round-trip for server-to-server calls.
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && token === cronSecret) return;
  if (cronSecret && request.headers.get("user-agent")?.includes("vercel-cron")) {
    return;
  }

  const decoded = await adminAuth.verifyIdToken(token, true);
  if (!decoded.email || !isAllowedAdminEmail(decoded.email)) {
    throw new Error("Forbidden");
  }
}

interface RocksSnapshotPayload {
  rocks: RocksData | null;
  rocks_error: string | null;
  generated_at: string;
  computed_in_ms: number | null;
}

export async function GET(request: NextRequest) {
  try {
    await verifyCaller(request);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unauthorized";
    return NextResponse.json(
      { error: msg },
      { status: msg === "Forbidden" ? 403 : 401 }
    );
  }

  const url = new URL(request.url);
  const wantsCached = url.searchParams.get("snapshot") === "cached";

  // ─── Cached read ───────────────────────────────────────────────
  if (wantsCached) {
    try {
      const snap = await latestSnapshot<RocksSnapshotPayload>(
        "rocks",
        ROCKS_CACHE_KEY
      );
      if (snap) {
        return NextResponse.json({
          ...snap.payload,
          generated_at: snap.generated_at,
          computed_in_ms: snap.computed_in_ms,
          snapshot: { age_ms: Date.now() - Date.parse(snap.generated_at) },
        });
      }
    } catch (err) {
      console.warn("[rocks] snapshot read failed:", err);
    }
    // Fall through to live compute when no snapshot yet.
  }

  // ─── Live compute + write snapshot ────────────────────────────────────
  const startedAt = Date.now();
  try {
    const rocks: RocksData = await getRocksProgress();
    const computed_in_ms = Date.now() - startedAt;
    const payload: RocksSnapshotPayload = {
      rocks,
      rocks_error: null,
      generated_at: new Date().toISOString(),
      computed_in_ms,
    };
    // Fire-and-forget write — don't make the user wait on Supabase write.
    void writeSnapshot("rocks", ROCKS_CACHE_KEY, payload, {
      computedInMs: computed_in_ms,
      source: wantsCached ? "fallback" : "on_demand",
    }).catch((err) => console.warn("[rocks] snapshot write failed:", err));
    return NextResponse.json({
      ...payload,
      snapshot: { age_ms: 0 },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn("[marketing-funnel/rocks] failed:", msg);
    return NextResponse.json(
      {
        rocks: null,
        rocks_error: msg,
        generated_at: new Date().toISOString(),
        computed_in_ms: Date.now() - startedAt,
      },
      { status: 200 }
    );
  }
}
