import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const MAINTENANCE_MODE = process.env.MAINTENANCE_MODE === "true";

/**
 * Homepage routing on `/` — unified to /lp/consult (2026-07-28):
 *
 *   All traffic  → /lp/consult
 *
 * Prior to today (see git history) we split Meta traffic to /lp/consult
 * and everything else to /lp/subscription because /lp/consult carried a
 * phone gate that hurt non-Meta top-of-funnel. That phone gate was
 * removed on 2026-07-09, and the consult LP has since been unified with
 * the editorial subscription LP body (shared ConsultLPBody component,
 * MEMBER REVIEWS, SEE THE VALUE ROI slider, THE QUARTER, INLINE MINI
 * QUIZ, etc.), plus the /lp/consult A/B now covers both the modal-quiz
 * and inline-quiz containers server-side via the mr_ab cookie.
 *
 * With those changes the blocker is gone, and routing 100% of `/` to
 * /lp/consult unifies attribution + funnel measurement on a single LP.
 *
 * The sticky `mr_ab` bucket cookie (0..99) is still set on first visit
 * so the /lp/consult page can pick between modal_quiz and inline_quiz
 * arms server-side.
 *
 * Query params (utm_*, gclid, fbclid, …) are forwarded so paid
 * attribution survives the redirect.
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

  // ─── Homepage redirect ───
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
