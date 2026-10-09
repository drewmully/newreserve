/**
 * POST /api/lifecycle/shopify-flow
 *
 * Intake for Shopify Flow "Send HTTP request" actions that describe
 * Shopify-native (first-party Shopify Subscriptions) contracts.
 *
 * OFF by default: returns 404 unless LIFECYCLE_NATIVE_FLOW_INGEST_ENABLED is
 * exactly "true" AND LIFECYCLE_FLOW_SHARED_SECRET (>= 32 chars) is set. Even
 * when on, it only stores IDs/status/timestamps. It never sends email, edits
 * profiles or consent, or changes subscriptions.
 */
import { NextResponse } from "next/server";
import { getSupabaseService } from "@/app/api/_lib/supabaseService";
import { FLOW_SECRET_HEADER, parseFlowEvent, toRow, verifyFlowSecret } from "@/lib/lifecycle/flowBridge";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 4096;

export async function POST(req: Request) {
  if (process.env.LIFECYCLE_NATIVE_FLOW_INGEST_ENABLED !== "true") {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  if (!verifyFlowSecret(req.headers.get(FLOW_SECRET_HEADER), process.env.LIFECYCLE_FLOW_SHARED_SECRET)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const raw = await req.text();
  if (Buffer.byteLength(raw, "utf8") > MAX_BODY_BYTES) return NextResponse.json({ error: "too_large" }, { status: 413 });
  let body: unknown;
  try { body = JSON.parse(raw); } catch { return NextResponse.json({ error: "invalid_json" }, { status: 400 }); }
  const parsed = parseFlowEvent(body);
  // 422 (not 5xx) so Flow does not retry a body that can never succeed.
  if (!parsed.ok) return NextResponse.json({ error: parsed.reason }, { status: 422 });
  const { error } = await getSupabaseService().from("lifecycle_native_subscription_events")
    .upsert(toRow(parsed.event), { onConflict: "idempotency_key", ignoreDuplicates: true });
  if (error) return NextResponse.json({ error: "store_failed" }, { status: 503 });
  return NextResponse.json({ ok: true, kind: parsed.event.kind });
}
