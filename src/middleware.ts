import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const MAINTENANCE_MODE = process.env.MAINTENANCE_MODE === "true";

/**
 * A/B test on `/`:
 *   Bucket 0..49  → control  (/lp/subscription)
 *   Bucket 50..99 → variant  (/lp/editorial)
 *
 * The `mr_ab` cookie (0..99) is the source of truth. If a visitor lands
 * without one, we set it here BEFORE the redirect so their bucket sticks
 * for 90 days (identical variant on repeat visits, and every downstream
 * analytics event they fire carries the same `homepage-lp` property via
 * tracking.ts::getAbVariantProperties).
 *
 * Query params (utm_*, gclid, fbclid, …) are forwarded so paid attribution
 * survives the split.
 */
function pickHomepageVariant(bucket: number): "subscription" | "editorial" {
  return bucket < 50 ? "subscription" : "editorial";
}

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
    const variant = pickHomepageVariant(bucket);
    const destination =
      variant === "subscription" ? "/lp/subscription" : "/lp/editorial";
    const url = request.nextUrl.clone();
    url.pathname = destination;
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
