/**
 * GET /s/[code]
 *
 * Sponsorship redirect endpoint. Sets the `mully_sponsor` cookie (90 days,
 * first-touch wins) then 302s to the homepage. The actual sponsor
 * resolution happens later in the orders-paid webhook where we have
 * a Supabase service-role client.
 *
 * The endpoint deliberately performs no DB lookup, keeping the redirect
 * edge-fast and resilient to DB outages. We only do a lightweight format
 * check, anything that looks like our `PREFIX-SUFFIX` shape is accepted.
 */
import { NextRequest, NextResponse } from "next/server";
import {
  parseSponsorshipCode,
  SPONSORSHIP_COOKIE_NAME,
  SPONSORSHIP_COOKIE_MAX_AGE_SECONDS,
} from "@/lib/sponsorship";

interface RouteContext {
  params: Promise<{ code: string }>;
}

export async function GET(request: NextRequest, context: RouteContext) {
  const { code } = await context.params;
  const parsed = parseSponsorshipCode(code);

  // Always send the visitor home, even on a malformed code. We never want
  // to surface an error here, the sponsor's link should always feel like
  // it works.
  const url = new URL(request.url);
  const destination = new URL("/", url.origin);

  // Surface a transparent `?via=PREFIX` so the LP can render a "via Drew"
  // chip if it wants to. The middleware-like behavior is purely cosmetic.
  if (parsed) {
    destination.searchParams.set("via", parsed.prefix);
  }

  const response = NextResponse.redirect(destination, 302);

  if (parsed) {
    const value = `${parsed.prefix}-${parsed.suffix}`;
    // First-touch wins. We only set the cookie if the visitor doesn't
    // already have one, so a friend who clicks Drew's link, then later
    // clicks Megan's, is still attributed to Drew.
    const existing = request.cookies.get(SPONSORSHIP_COOKIE_NAME)?.value;
    if (!existing) {
      response.cookies.set({
        name: SPONSORSHIP_COOKIE_NAME,
        value,
        maxAge: SPONSORSHIP_COOKIE_MAX_AGE_SECONDS,
        path: "/",
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        httpOnly: false, // readable from JS so attribution.ts can pick it up
      });
    }
  }

  return response;
}
