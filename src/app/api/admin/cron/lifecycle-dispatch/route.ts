/**
 * GET /api/admin/cron/lifecycle-dispatch
 *
 * Drains the lifecycle outbox. Scheduled every 15 minutes in vercel.json. With
 * LIFECYCLE_DISPATCH_ENABLED unset (the default) it claims nothing, changes
 * nothing and returns { enabled: false }. Even when enabled, every row is
 * freshly rechecked and only allowlisted programs can send. No PII returned.
 */
import { NextResponse } from "next/server";
import { klaviyoRequest, KlaviyoError } from "@/lib/klaviyo/client";
import { isCronAuthorized } from "@/lib/klaviyo/worker";
import { readDispatchConfig, runDispatchBatch } from "@/lib/lifecycle/dispatch";
import { recheckOutboxRow, supabaseOutboxRepo } from "@/lib/lifecycle/sources";
import { readKlaviyoConsent } from "@/lib/lifecycle/consent";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: Request) {
  if (!isCronAuthorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const config = readDispatchConfig();
  if (!config.enabled) return NextResponse.json({ ok: true, enabled: false });
  try {
    const summary = await runDispatchBatch({
      config,
      repo: supabaseOutboxRepo(),
      recheck: (row) => recheckOutboxRow(row, { consent: readKlaviyoConsent }),
      send: async (body) => {
        try { await klaviyoRequest("/api/events/", { method: "POST", body }); }
        catch (err) {
          const code = err instanceof KlaviyoError ? err.code : "unexpected";
          // Ambiguous failures retry safely: Klaviyo dedupes on unique_id.
          throw { retryable: ["rate_limited", "server_error", "timeout", "network"].includes(code), code };
        }
      },
    });
    return NextResponse.json({ ok: true, ...summary });
  } catch {
    return NextResponse.json({ ok: false, error: "dispatch_failed" }, { status: 500 });
  }
}
