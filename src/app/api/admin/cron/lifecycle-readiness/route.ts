/**
 * GET /api/admin/cron/lifecycle-readiness?offset=0&limit=50
 *
 * Writes the readiness profile properties the draft Klaviyo flows and
 * campaign segments check. NOT scheduled in vercel.json. With
 * LIFECYCLE_READINESS_WRITE_ENABLED unset (the default) it reads nothing,
 * writes nothing and returns { enabled: false }.
 *
 * Program "ready" flags are true only for programs listed in
 * LIFECYCLE_READINESS_PROGRAMS, so flows can be launched one at a time.
 * Properties only: never subscribes, unsubscribes or suppresses anyone.
 * Returns counts and hold codes only, no PII.
 */
import { NextResponse } from "next/server";
import { isCronAuthorized } from "@/lib/klaviyo/worker";
import { computeReadiness, readReadinessConfig } from "@/lib/lifecycle/readiness";
import { readinessCandidates, readReadinessEvidence, writeReadinessProperties } from "@/lib/lifecycle/readinessSources";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(req: Request) {
  if (!isCronAuthorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const config = readReadinessConfig();
  if (!config.enabled) return NextResponse.json({ ok: true, enabled: false });
  const url = new URL(req.url);
  const offset = Math.max(0, Math.floor(Number(url.searchParams.get("offset") ?? 0)) || 0);
  const limit = Math.min(100, Math.max(1, Math.floor(Number(url.searchParams.get("limit") ?? 50)) || 50));
  let candidates: string[];
  try { candidates = await readinessCandidates(); }
  catch { return NextResponse.json({ ok: false, error: "candidates_failed" }, { status: 500 }); }
  const batch = candidates.slice(offset, offset + limit);
  const summary = { ok: true, enabled: true, programs: [...config.programs].sort(), total: candidates.length, offset,
    processed: 0, written: 0, failed: 0, ready: {} as Record<string, number>, holds: {} as Record<string, number> };
  for (const email of batch) {
    summary.processed++;
    try {
      const evidence = await readReadinessEvidence(email);
      const { properties, holds } = computeReadiness(evidence, config);
      await writeReadinessProperties(email, properties);
      summary.written++;
      for (const [k, v] of Object.entries(properties)) if (v === true) summary.ready[k] = (summary.ready[k] ?? 0) + 1;
      for (const h of holds) { const code = h.split(":").slice(0, 2).join(":"); summary.holds[code] = (summary.holds[code] ?? 0) + 1; }
    } catch { summary.failed++; }
  }
  return NextResponse.json({ ...summary, nextOffset: offset + batch.length < candidates.length ? offset + batch.length : null });
}
