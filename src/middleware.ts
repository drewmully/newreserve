import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const MAINTENANCE_MODE = process.env.MAINTENANCE_MODE === "true";

/**
 * Homepage routing on `/`:
 *   100% of traffic is redirected to /lp/consult.
 *
 * The prior 50/50 A/B split (subscription vs editorial) is retired. We still
 * set the sticky `mr_ab` cookie (0..99) on first visit so downstream analytics
 * events keep carrying the `homepage-lp` property via
 * tracking.ts::getAbVariantProperties; the bucket no longer changes the
 * destination.
 *
 * Query params (utm_*, gclid, fbclid, …) are forwarded so paid attribution
 * survives the redirect.
 */
const HOMEPAGE_DESTINATION = "/lp/consult";

export function middleware(request: NextRequest) {
  // ─── A/B bucket cookie (sticky visitor assignment) ───
  const existingBucketRaw = request.cookies.get("mr_ab")?.value;
  const existingBucket =
    existingBucketRaw !== undefined && /^\d+$/.test(existingBucketRaw)
      ? Number(existingBucketRaw)
      : null;
  const bucket =
    existingBucket !== null && existingBucket >= 0 && existingBucket < 100
      ? existingBucket
      : Math.floor(Math.random() * 100);
  const needsBucketCookie = existingBucket === null;

  // ─── Maintenance mode short-circuit ───
  if (MAINTENANCE_MODE) {
    const { pathname } = request.nextUrl;
    if (
      pathname === "/maintenance" ||
      pathname.startsWith("/_next") ||
      pathname.startsWith("/favicon")
    ) {
      return NextResponse.next();
    }
    return NextResponse.rewrite(new URL("/maintenance", request.url));
  }

  // ─── Homepage A/B redirect ───
  // Only rewrite the exact "/" path. Every other path (LPs, /login, /shop,
  // /account, API routes) is untouched, aside from ensuring the cookie is set.
  const { pathname, search } = request.nextUrl;
  if (pathname === "/") {
    const url = request.nextUrl.clone();
    url.pathname = HOMEPAGE_DESTINATION;
    // `search` already includes the leading "?" if there are params, and is ""
    // otherwise. Preserving it keeps utm_*, gclid, fbclid, etc. attached to
    // the destination LP.
    url.search = search;
    const response = NextResponse.redirect(url, 307);
    if (needsBucketCookie) {
      response.cookies.set("mr_ab", String(bucket), {
        maxAge: 60 * 60 * 24 * 90, // 90 days
        path: "/",
        sameSite: "lax",
      });
    }
    return response;
  }

  const response = NextResponse.next();
  if (needsBucketCookie) {
    response.cookies.set("mr_ab", String(bucket), {
      maxAge: 60 * 60 * 24 * 90, // 90 days
      path: "/",
      sameSite: "lax",
    });
  }
  return response;
}

export const config = {
  matcher: ["/((?!api/webhooks).*)"],
};
