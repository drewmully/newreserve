import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const MAINTENANCE_MODE = process.env.MAINTENANCE_MODE === "true";

/**
 * Homepage routing on `/` — traffic-aware split (2026-07-27):
 *
 *   Meta / Instagram paid traffic  → /lp/consult   (phone-gated OR quiz-first,
 *                                                  see ConsultLPClient A/B)
 *   Everything else                → /lp/subscription (editorial control)
 *
 * Rationale: /lp/consult is Meta-optimized (quiz → phone → quiz → reveal) and
 * carries the highest conversion for Meta-warmed visitors. Sending organic,
 * Google, and direct traffic through the same phone-gated flow was costing
 * top-of-funnel conversion (see the /lp/subscription pageview cliff on 07/21
 * when 100% of `/` was routed to /lp/consult). The editorial subscription LP
 * remains the better default for non-Meta visitors.
 *
 * Detection signals — any of these means "Meta traffic":
 *   - `fbclid` query param       (Meta click identifier, always set on ad clicks)
 *   - `utm_source` in {facebook, meta, instagram, ig, fb}
 *   - `utm_medium` = paid_social AND utm_source matches
 *
 * The sticky `mr_ab` bucket cookie (0..99) is still set for downstream
 * analytics attribution, but no longer changes the destination.
 *
 * Query params (utm_*, gclid, fbclid, …) are forwarded so paid attribution
 * survives the redirect.
 */
const META_DESTINATION = "/lp/consult";
const DEFAULT_DESTINATION = "/lp/subscription";
const META_SOURCE_TOKENS = new Set([
  "facebook",
  "meta",
  "instagram",
  "ig",
  "fb",
]);

function isMetaTraffic(request: NextRequest): boolean {
  const params = request.nextUrl.searchParams;
  const fbclid = params.get("fbclid");
  if (fbclid && fbclid.trim().length > 0) return true;
  const utmSource = params.get("utm_source")?.toLowerCase().trim() ?? "";
  if (utmSource && META_SOURCE_TOKENS.has(utmSource)) return true;
  return false;
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

  // ─── Homepage traffic-aware redirect ───
  // Only rewrite the exact "/" path. Every other path (LPs, /login, /shop,
  // /account, API routes) is untouched, aside from ensuring the cookie is set.
  const { pathname, search } = request.nextUrl;
  if (pathname === "/") {
    const destination = isMetaTraffic(request)
      ? META_DESTINATION
      : DEFAULT_DESTINATION;
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
