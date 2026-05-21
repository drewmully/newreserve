/**
 * GET /api/admin/customers/search?q=<query>&limit=<n>
 *
 * Fuzzy search across name / email / phone / city / zip.
 * Returns up to 25 hits from the customer_360 view.
 *
 * Auth: Firebase ID token from admin allowlist.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/app/api/_lib/adminAuth";
import { getSupabaseService } from "@/app/api/_lib/supabaseService";

export const runtime = "nodejs";

const SELECT_COLS = [
  "id",
  "email",
  "first_name",
  "last_name",
  "phone_e164",
  "city",
  "province",
  "zip",
  "country",
  "total_orders",
  "total_spent",
  "subscriber_status",
  "sub_plan_code",
  "sub_next_order_date",
  "last_order_at",
  "tenure_days",
  "is_email_suppressed",
  "is_sms_suppressed",
  "accepts_email_marketing",
  "accepts_sms_marketing",
].join(",");

export async function GET(req: NextRequest) {
  const guard = await requireAdmin(req);
  if (!guard.ok) return guard.response;

  const url = new URL(req.url);
  const q = (url.searchParams.get("q") || "").trim();
  const limit = Math.min(50, Math.max(1, Number(url.searchParams.get("limit") || "25")));
  if (q.length < 2) {
    return NextResponse.json({ results: [], reason: "query too short" });
  }

  const svc = getSupabaseService();
  // We use ilike across several columns. PostgREST `or` syntax requires
  // careful escaping: commas/parentheses inside values must be quoted.
  const safe = q.replace(/[,()*]/g, " ").trim();
  const pattern = `%${safe}%`;

  const { data, error } = await svc
    .from("customer_360")
    .select(SELECT_COLS)
    .or(
      [
        `email.ilike.${pattern}`,
        `first_name.ilike.${pattern}`,
        `last_name.ilike.${pattern}`,
        `phone_e164.ilike.${pattern}`,
        `phone.ilike.${pattern}`,
        `city.ilike.${pattern}`,
        `zip.ilike.${pattern}`,
      ].join(","),
    )
    .order("last_order_at", { ascending: false, nullsFirst: false })
    .limit(limit);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ results: data || [] });
}
