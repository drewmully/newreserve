/**
 * POST /api/experiments/pdp-complete-look
 *
 * Evaluates the PostHog experiment flag `pdp_complete_look` for the
 * shopper's Mully anonymous_id (mully_anon_id), so the arm is sticky per
 * anonymous_id and lines up with the distinct id the server already uses
 * for the purchase event. posthog-node records $feature_flag_called, which
 * the PostHog experiment uses as its exposure.
 *
 * QA override (?pdp_complete_look=test|control) is honored only outside
 * production (Vercel preview/development), or when the payload of the
 * shopper's evaluated variant sets {"allow_overrides": true}. Overridden
 * views send no $feature_flag_called, so QA stays out of the experiment.
 *
 * Response: { variant: "control" | "test" | null, source }
 *   null = flag inactive, not rolled out, or PostHog unreachable. The site
 *   then renders the current (control) experience and stamps nothing.
 */

import { NextRequest, NextResponse } from "next/server";
import { PostHog } from "posthog-node";
import {
  completeLookOverridesAllowed as overridesAllowed,
  PDP_COMPLETE_LOOK_FLAG,
  parseCompleteLookVariant,
  type CompleteLookVariant,
} from "@/lib/pdpCompleteLook";

export const dynamic = "force-dynamic";

const ANON_RE = /^[A-Za-z0-9_-]{6,80}$/;

function posthogClient(): PostHog | null {
  const apiKey = process.env.POSTHOG_PROJECT_API_KEY ?? process.env.NEXT_PUBLIC_POSTHOG_KEY;
  if (!apiKey) return null;
  const host = process.env.POSTHOG_HOST ?? process.env.NEXT_PUBLIC_POSTHOG_HOST ?? "https://us.i.posthog.com";
  return new PostHog(apiKey, { host, flushAt: 1, flushInterval: 0 });
}

export async function POST(req: NextRequest) {
  let body: { anonymous_id?: unknown; override?: unknown } = {};
  try { body = await req.json(); } catch { /* empty body */ }
  const anonymousId = typeof body.anonymous_id === "string" && ANON_RE.test(body.anonymous_id)
    ? body.anonymous_id
    : null;
  const override = parseCompleteLookVariant(body.override);
  const noStore = { headers: { "Cache-Control": "no-store" } };

  // Outside production an override never needs PostHog.
  if (override && overridesAllowed(null, process.env.VERCEL_ENV)) {
    return NextResponse.json({ variant: override, source: "override" }, noStore);
  }
  if (!anonymousId) return NextResponse.json({ variant: null, source: "no_id" }, noStore);

  const posthog = posthogClient();
  if (!posthog) return NextResponse.json({ variant: null, source: "no_posthog" }, noStore);

  let variant: CompleteLookVariant | null = null;
  let source = "flag";
  try {
    if (override) {
      // Production: the payload of the shopper's evaluated variant must opt in.
      // Read without an exposure event so QA traffic stays out of the results.
      const result = await posthog.getFeatureFlagResult(PDP_COMPLETE_LOOK_FLAG, anonymousId, {
        sendFeatureFlagEvents: false,
      });
      if (overridesAllowed(result?.payload, process.env.VERCEL_ENV)) {
        return NextResponse.json({ variant: override, source: "override" }, noStore);
      }
    }
    const value = await posthog.getFeatureFlag(PDP_COMPLETE_LOOK_FLAG, anonymousId);
    variant = parseCompleteLookVariant(value);
  } catch (err) {
    console.error("[pdp-complete-look] flag evaluation failed:", err);
    source = "error";
  } finally {
    await posthog.shutdown().catch(() => undefined);
  }
  return NextResponse.json({ variant, source }, noStore);
}
