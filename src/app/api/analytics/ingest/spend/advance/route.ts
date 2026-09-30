import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { getAnalyticsSupabase } from "@/lib/analytics/serverClient";
import { googleSpendAuthFromEnv } from "@/lib/analytics/googleSpendSource";
import { advanceGoogleSpendPilot } from "@/lib/analytics/googleSpendPilot";
import { advanceFreshGoogleSpend, prepareFreshGoogleSpend } from "@/lib/analytics/googleSpendRegistration";
import { validatePipelineTarget } from "@/lib/analytics/shopifyPipeline";
export const runtime = "nodejs";
export const maxDuration = 90;
const headers = { "Cache-Control": "no-store" };
export async function POST(req: NextRequest) {
  if (process.env.LEAN_ANALYTICS_SPEND_PILOT_ENABLED !== "true") return new NextResponse(null, { status: 404, headers });
  const secret = process.env.LEAN_ANALYTICS_SPEND_PILOT_SECRET ?? "";
  if (secret.length < 32) return new NextResponse(null, { status: 503, headers });
  const expected = Buffer.from(`Bearer ${secret}`), supplied = Buffer.from(req.headers.get("authorization") ?? "");
  if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied))
    return new NextResponse(null, { status: 401, headers });
  if (req.nextUrl.search || req.body !== null) return new NextResponse(null, { status: 400, headers });
  try {
    const mode = process.env.LEAN_ANALYTICS_SPEND_PILOT_MODE ?? "legacy";
    let result;
    if (mode === "fresh") {
      // Server configuration only. Never fall back to the legacy pilot on a
      // missing opt-in, invalid manifest or identity mismatch.
      if (process.env.LEAN_ANALYTICS_SPEND_FRESH_ENABLED !== "true") throw new Error("fresh_spend_disabled");
      const raw = process.env.LEAN_ANALYTICS_SPEND_FRESH_MANIFEST_JSON ?? "";
      if (!raw || Buffer.byteLength(raw, "utf8") > 16384) throw new Error("fresh_spend_manifest_size");
      const prepared = prepareFreshGoogleSpend(JSON.parse(raw)), manifest = prepared.manifest;
      if (raw !== JSON.stringify(manifest) ||
          manifest.projectRef !== process.env.LEAN_ANALYTICS_PIPELINE_PROJECT_REF ||
          prepared.registration.args.p_scope.pilotId !== process.env.LEAN_ANALYTICS_SPEND_PILOT_ID)
        throw new Error("fresh_spend_manifest_binding");
      const databaseUrl = process.env.LEAN_ANALYTICS_SUPABASE_URL ?? "";
      validatePipelineTarget(manifest.projectRef, databaseUrl);
      const now = new Date().toISOString();
      if (now < manifest.preparedAt) throw new Error("fresh_spend_not_started");
      req.signal.throwIfAborted();
      // Validate all scope/configuration before constructing either credential
      // reader or database client. Expired manifests do not reach either one.
      result = now >= manifest.expiresAt ? { state: "expired" } : await advanceFreshGoogleSpend({
        manifest, enabled: true, databaseUrl, client: getAnalyticsSupabase(),
        auth: googleSpendAuthFromEnv(process.env), developerToken: process.env.LEAN_GOOGLE_ADS_DEVELOPER_TOKEN,
        signal: AbortSignal.any([req.signal, AbortSignal.timeout(65000)]),
      });
    } else {
      if (mode !== "legacy") throw new Error("spend_invalid_mode");
      result = await advanceGoogleSpendPilot({
        client: getAnalyticsSupabase(), projectRef: process.env.LEAN_ANALYTICS_PIPELINE_PROJECT_REF ?? "",
        databaseUrl: process.env.LEAN_ANALYTICS_SUPABASE_URL ?? "",
        pilotId: process.env.LEAN_ANALYTICS_SPEND_PILOT_ID ?? "",
        auth: googleSpendAuthFromEnv(process.env), developerToken: process.env.LEAN_GOOGLE_ADS_DEVELOPER_TOKEN,
        now: new Date().toISOString(), signal: AbortSignal.any([req.signal, AbortSignal.timeout(65000)]),
      });
    }
    return NextResponse.json(result, { status: ["failed", "blocked", "lost_lease"].includes(result.state) ? 422 : 200,
      headers });
  } catch {
    return NextResponse.json({ state: "unavailable" }, { status: 503, headers });
  }
}
