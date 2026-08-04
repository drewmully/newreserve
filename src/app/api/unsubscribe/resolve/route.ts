/**
 * GET /api/unsubscribe/resolve
 *
 * Resolves an incoming unsubscribe link into a signed token and redirects to
 * the preference page. Two supported inputs:
 *
 *   ?token=<signed>          — already a signed unsubscribe token, pass through.
 *   ?rid=<campaign_recipients.id>
 *                            — the legacy/dangling link shape already emitted
 *                              live by src/app/api/admin/campaigns/martine/send/route.ts
 *                              (`https://mymully.com/unsubscribe?rid=...`).
 *                              We look up the recipient's email and mint a
 *                              signed token so the rest of the flow only ever
 *                              deals with verified tokens, never raw ids.
 *
 * Always redirects to /unsubscribe?token=... (or /unsubscribe?error=... on
 * failure) rather than rendering here, so there is exactly one page
 * (src/app/unsubscribe/page.tsx) that shows UI.
 */

import { NextRequest, NextResponse } from "next/server";
import { getSupabaseService } from "@/app/api/_lib/supabaseService";
import { createUnsubscribeToken, verifyUnsubscribeToken } from "@/lib/email/unsubscribe-tokens";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function redirectTo(req: NextRequest, params: Record<string, string>): NextResponse {
  const url = new URL("/unsubscribe", req.url);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return NextResponse.redirect(url);
}

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token");
  const rid = req.nextUrl.searchParams.get("rid");

  if (token) {
    const payload = verifyUnsubscribeToken(token);
    if (!payload) return redirectTo(req, { error: "invalid_token" });
    return redirectTo(req, { token });
  }

  if (rid) {
    try {
      const sb = getSupabaseService();
      const { data, error } = await sb
        .from("campaign_recipients")
        .select("id,email")
        .eq("id", rid)
        .maybeSingle();

      if (error) {
        console.error(`[unsubscribe/resolve] campaign_recipients lookup failed for rid=${rid}:`, error.message);
        return redirectTo(req, { error: "lookup_failed" });
      }
      if (!data?.email) {
        return redirectTo(req, { error: "not_found" });
      }

      const newToken = createUnsubscribeToken(data.email, String(data.id));
      return redirectTo(req, { token: newToken });
    } catch (err) {
      console.error(`[unsubscribe/resolve] unexpected error resolving rid=${rid}:`, err);
      return redirectTo(req, { error: "lookup_failed" });
    }
  }

  return redirectTo(req, { error: "missing_params" });
}
