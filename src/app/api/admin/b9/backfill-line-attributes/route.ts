/**
 * POST /api/admin/b9/backfill-line-attributes
 *
 * Backfills Loop subscription line-item attributes with the fit data
 * captured in Supabase `public.b9_migrations.fit_attributes` for every
 * B9 member who submitted the migration form but never had their fit
 * pushed to Loop (so packing wouldn't see it at renewal).
 *
 * IMPORTANT — this route explicitly does NOT swap the product. Drew is
 * doing swaps manually. Do not add a swap call here.
 *
 * Auth: CRON_SECRET Bearer.
 *
 * Query params (all optional):
 *   ?cohort=2026-07-06_to_07-19   Renewal cohort tag (default this string)
 *   ?renews_from=2026-07-13       ISO date (America/Detroit) inclusive
 *   ?renews_to=2026-07-20         ISO date (America/Detroit) exclusive
 *   ?dry_run=1                    Show payloads but skip Loop PUTs + DB writes
 *   ?limit=50                     Max rows this invocation (default 50)
 *   ?email=foo@bar.com            Restrict to a single member (dry-run testing)
 */

import { NextRequest, NextResponse } from "next/server";
import { getSupabaseService } from "@/app/api/_lib/supabaseService";
import {
  getLoopSubscriptionById,
  updateLoopSubscriptionLineAttributes,
} from "@/app/api/_lib/loopAdmin";

export const runtime = "nodejs";
export const maxDuration = 300;

const DEFAULT_COHORT = "2026-07-06_to_07-19";
const DEFAULT_RENEWS_FROM_UTC = "2026-07-13T04:00:00Z"; // 2026-07-13 00:00 America/Detroit
const DEFAULT_RENEWS_TO_UTC = "2026-07-20T04:00:00Z";

function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

type B9Row = {
  id: number;
  email: string;
  first_name: string | null;
  last_name: string | null;
  loop_subscription_id: string | null;
  shopify_customer_id: string | null;
  fit_attributes: Record<string, unknown> | null;
  status: string | null;
  submitted_at: string | null;
  swap_completed_at: string | null;
  notes: string | null;
  loop_swap_response: unknown;
};

function toStringMap(attrs: Record<string, unknown> | null): Record<string, string> {
  if (!attrs) return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null) continue;
    if (typeof v === "string") {
      const trimmed = v.trim();
      if (trimmed.length > 0) out[k] = trimmed;
    } else if (typeof v === "number" || typeof v === "boolean") {
      out[k] = String(v);
    } else {
      // arrays / objects -> comma join or JSON
      try {
        if (Array.isArray(v)) out[k] = v.map((x) => String(x)).join(", ");
        else out[k] = JSON.stringify(v);
      } catch {
        /* skip */
      }
    }
  }
  return out;
}

async function handle(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const cohort = url.searchParams.get("cohort") || DEFAULT_COHORT;
  const renewsFrom = url.searchParams.get("renews_from")
    ? new Date(url.searchParams.get("renews_from")!).toISOString()
    : DEFAULT_RENEWS_FROM_UTC;
  const renewsTo = url.searchParams.get("renews_to")
    ? new Date(url.searchParams.get("renews_to")!).toISOString()
    : DEFAULT_RENEWS_TO_UTC;
  const dryRun = url.searchParams.get("dry_run") === "1";
  const limit = Math.max(1, Math.min(500, parseInt(url.searchParams.get("limit") || "50", 10)));
  const emailFilter = url.searchParams.get("email");

  const supa = getSupabaseService();

  let q = supa
    .from("b9_migrations")
    .select(
      "id,email,first_name,last_name,loop_subscription_id,shopify_customer_id,fit_attributes,status,submitted_at,swap_completed_at,notes,loop_swap_response"
    )
    .eq("renewal_cohort", cohort)
    .gte("next_billing_utc", renewsFrom)
    .lt("next_billing_utc", renewsTo)
    .not("submitted_at", "is", null)
    .is("swap_completed_at", null)
    .order("submitted_at", { ascending: true })
    .limit(limit);

  if (emailFilter) q = q.eq("email", emailFilter);

  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const rows = (data ?? []) as B9Row[];
  if (rows.length === 0) {
    return NextResponse.json({ cohort, renewsFrom, renewsTo, dryRun, processed: 0, results: [] });
  }

  const results: Array<{
    id: number;
    email: string;
    status: "updated" | "skipped" | "failed";
    reason?: string;
    line_id?: string;
    attributes?: Record<string, string>;
    http_status?: number;
  }> = [];

  for (const row of rows) {
    const attributes = toStringMap(row.fit_attributes);
    if (Object.keys(attributes).length === 0) {
      results.push({ id: row.id, email: row.email, status: "skipped", reason: "no fit_attributes" });
      continue;
    }
    if (!row.loop_subscription_id || !row.shopify_customer_id) {
      results.push({
        id: row.id,
        email: row.email,
        status: "skipped",
        reason: "missing loop_subscription_id or shopify_customer_id",
      });
      continue;
    }

    // Look up the first line on the subscription to get the lineId.
    let lineId: string | null = null;
    try {
      const sub = (await getLoopSubscriptionById(row.loop_subscription_id)) as
        | (Record<string, unknown> & { lines?: Array<{ id?: string }> })
        | null;
      const subStatus = (sub?.status as string | undefined)?.toUpperCase() ?? "";
      if (sub?.isPrepaid) {
        results.push({
          id: row.id,
          email: row.email,
          status: "skipped",
          reason: "prepaid subscription (Loop 423 territory)",
        });
        continue;
      }
      if (subStatus && subStatus !== "ACTIVE") {
        results.push({
          id: row.id,
          email: row.email,
          status: "skipped",
          reason: `subscription status=${subStatus}`,
        });
        continue;
      }
      lineId = sub?.lines?.[0]?.id ?? null;
      if (!lineId) {
        results.push({
          id: row.id,
          email: row.email,
          status: "skipped",
          reason: "no line found on subscription",
        });
        continue;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      results.push({ id: row.id, email: row.email, status: "failed", reason: `lookup: ${msg}` });
      // Flag in Supabase so it shows up in the digest
      if (!dryRun) {
        const ts = new Date().toISOString();
        await supa
          .from("b9_migrations")
          .update({
            notes: `${row.notes ?? ""}\nloop_line_update_failed:${ts}:lookup:${msg.slice(0, 200)}`.trim(),
          })
          .eq("id", row.id);
      }
      continue;
    }

    if (dryRun) {
      results.push({
        id: row.id,
        email: row.email,
        status: "updated",
        reason: "dry_run",
        line_id: lineId,
        attributes,
      });
      continue;
    }

    // Fire the PUT.
    try {
      const { status: httpStatus, response } = await updateLoopSubscriptionLineAttributes({
        shopifyCustomerId: row.shopify_customer_id,
        subscriptionId: row.loop_subscription_id,
        lineId,
        attributes,
      });

      const ts = new Date().toISOString();
      await supa
        .from("b9_migrations")
        .update({
          notes: `${row.notes ?? ""}\nloop_line_updated:${ts}:line=${lineId}`.trim(),
          loop_swap_response: {
            kind: "line_attribute_update",
            at: ts,
            line_id: lineId,
            http_status: httpStatus,
            response,
          },
          last_touch: "loop_line_attribute_update",
        })
        .eq("id", row.id);

      results.push({
        id: row.id,
        email: row.email,
        status: "updated",
        line_id: lineId,
        attributes,
        http_status: httpStatus,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const ts = new Date().toISOString();
      await supa
        .from("b9_migrations")
        .update({
          notes: `${row.notes ?? ""}\nloop_line_update_failed:${ts}:${msg.slice(0, 200)}`.trim(),
        })
        .eq("id", row.id);
      results.push({ id: row.id, email: row.email, status: "failed", reason: msg });
    }
  }

  const summary = {
    updated: results.filter((r) => r.status === "updated").length,
    skipped: results.filter((r) => r.status === "skipped").length,
    failed: results.filter((r) => r.status === "failed").length,
  };

  return NextResponse.json({
    cohort,
    renewsFrom,
    renewsTo,
    dryRun,
    processed: rows.length,
    summary,
    results,
  });
}

export const POST = handle;
export const GET = handle; // convenience for manual runs
