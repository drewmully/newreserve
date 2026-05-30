/**
 * GET /api/admin/site-health
 *
 * Returns the current site-health snapshot for the dashboard.
 *
 * Query params:
 *   ?range=7d|14d|30d  (default 7d)
 *   ?status=active|all (default active — hides "ignored"/"fixed")
 *
 * Response:
 *   {
 *     window: { startMs, endMs, startLabel, endLabel },
 *     kpis: {
 *       total, by_severity: {P0,P1,P2}, by_journey: {...},
 *       new_this_window, recurring,
 *     },
 *     findings: SiteHealthFinding[]   // sorted last_seen_at desc, capped 500
 *   }
 *
 * Auth: Firebase Bearer token, admin allowlist.
 */

import { NextRequest, NextResponse } from "next/server";
import { adminAuth, adminDb } from "@/lib/firebase-admin";
import { isAllowedAdminEmail } from "@/lib/adminEmailAllowlist";
import type { SiteHealthFinding } from "@/lib/siteHealth";
import {
  summarizeBySeverity,
  summarizeByJourney,
} from "@/lib/siteHealthDigest";

export const runtime = "nodejs";

const COLLECTION = "site_health_findings";

async function verifyAdmin(request: NextRequest): Promise<void> {
  const header = request.headers.get("Authorization") ?? "";
  const token = header.replace(/^Bearer\s+/i, "").trim();
  if (!token) throw new Error("Missing Authorization header");
  const decoded = await adminAuth.verifyIdToken(token, true);
  if (!decoded.email || !isAllowedAdminEmail(decoded.email)) {
    throw new Error("Forbidden");
  }
}

function parseRange(range: string | null): {
  startMs: number;
  endMs: number;
  startLabel: string;
  endLabel: string;
} {
  const days = range === "14d" ? 14 : range === "30d" ? 30 : 7;
  const endMs = Date.now();
  const startMs = endMs - days * 24 * 60 * 60 * 1000;
  const fmt = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "America/Detroit",
  });
  return {
    startMs,
    endMs,
    startLabel: fmt.format(new Date(startMs)),
    endLabel: fmt.format(new Date(endMs)),
  };
}

export async function GET(request: NextRequest) {
  try {
    await verifyAdmin(request);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unauthorized";
    return NextResponse.json(
      { error: msg },
      { status: msg === "Forbidden" ? 403 : 401 },
    );
  }

  const url = new URL(request.url);
  const window = parseRange(url.searchParams.get("range"));
  const statusFilter = url.searchParams.get("status") ?? "active";

  const snap = await adminDb
    .collection(COLLECTION)
    .where("last_seen_at", ">=", window.startMs)
    .where("last_seen_at", "<", window.endMs)
    .orderBy("last_seen_at", "desc")
    .limit(500)
    .get();

  let findings = snap.docs.map((d) => d.data() as SiteHealthFinding);

  if (statusFilter === "active") {
    findings = findings.filter(
      (f) => f.status !== "ignored" && f.status !== "fixed",
    );
  }

  const newInWindow = findings.filter(
    (f) => f.first_seen_at >= window.startMs,
  ).length;
  const recurring = findings.length - newInWindow;

  return NextResponse.json({
    window,
    kpis: {
      total: findings.length,
      by_severity: summarizeBySeverity(findings),
      by_journey: summarizeByJourney(findings),
      new_this_window: newInWindow,
      recurring,
    },
    findings,
  });
}

/**
 * POST /api/admin/site-health
 *
 * Update finding status (acknowledge / mark fixed / ignore).
 * Body: { id: string, status: "acknowledged" | "fixed" | "ignored" }
 */
export async function POST(request: NextRequest) {
  try {
    await verifyAdmin(request);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unauthorized";
    return NextResponse.json(
      { error: msg },
      { status: msg === "Forbidden" ? 403 : 401 },
    );
  }

  const body = (await request.json().catch(() => null)) as {
    id?: string;
    status?: string;
  } | null;

  if (!body?.id || !body?.status) {
    return NextResponse.json(
      { error: "id and status required" },
      { status: 400 },
    );
  }

  const allowed = ["new", "acknowledged", "fixed", "ignored"];
  if (!allowed.includes(body.status)) {
    return NextResponse.json(
      { error: `status must be one of ${allowed.join(", ")}` },
      { status: 400 },
    );
  }

  const ref = adminDb.collection(COLLECTION).doc(body.id);
  const snap = await ref.get();
  if (!snap.exists) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  await ref.update({
    status: body.status,
    updated_at: Date.now(),
  });

  return NextResponse.json({ ok: true });
}
