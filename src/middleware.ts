import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { recoverShopifyPath } from "@/lib/shopifyPathRecovery";

const MAINTENANCE_MODE = process.env.MAINTENANCE_MODE === "true";

/**
 * Route consolidation (2026-09-18):
 *
 *   /                → curated shop
 *   /subscription    → preserved subscription LP (ConsultQuizFirstClient)
 *   /lp/consult      → 301 to /subscription
 *   /lp/discover     → 301 to /subscription
 *   /lp/subscription → 301 to /subscription
 *
 * Rationale (data over 30 days):
 *   - /lp/consult inline_quiz arm: 1.70% session→CTA click (winner)
 *   - /lp/consult modal_quiz arm:  0.97%
 *   - /lp/discover:                1.17% (but 41.4% reveal→CTA vs 24.5% for
 *                                  inline_quiz — the tier discount picker
 *                                  drove the closer, so that mechanic moved
 *                                  into the reveal page for everyone)
 *   - /lp/subscription:            30 sessions/30d, negligible
 *
 * The mr_ab bucket cookie is retired — there is no longer a variant split.
 *
 * Query params (utm_*, gclid, gbraid, wbraid, fbclid, …) are preserved on
 * every redirect so paid attribution survives the hop.
 */

const CONSOLIDATED_LP_PATHS = new Set([
  "/lp/consult",
  "/lp/discover",
  "/lp/subscription",
]);

export function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  // ─── Maintenance mode short-circuit ───
  if (MAINTENANCE_MODE) {
    if (
      pathname === "/maintenance" ||
      pathname.startsWith("/_next") ||
      pathname.startsWith("/favicon")
    ) {
      return NextResponse.next();
    }
    return NextResponse.rewrite(new URL("/maintenance", request.url));
  }

  // Consolidated subscription LP paths retain their original funnel.
  // Preserve any query params so utm_*/gclid/fbclid survive the redirect.
  // Also handle trailing slash variants (/lp/consult/).
  const normalized = pathname.endsWith("/") && pathname.length > 1
    ? pathname.slice(0, -1)
    : pathname;

  if (CONSOLIDATED_LP_PATHS.has(normalized)) {
    const url = request.nextUrl.clone();
    url.pathname = "/subscription";
    url.search = search;
    return NextResponse.redirect(url, 301);
  }

  // The Shopify redirect theme's custom rule "/ > /dashboard?tab=shop" is a
  // prefix match, so every Shopify URL arrives here mangled, for example
  // /dashboard?tab=shopproducts/<handle>?variant=1. Recover the real path.
  if (normalized === "/dashboard") {
    const recovered = recoverShopifyPath(request.nextUrl.searchParams.get("tab"));
    if (recovered) {
      const url = request.nextUrl.clone();
      url.pathname = recovered.pathname;
      url.searchParams.delete("tab");
      recovered.params.forEach((value, key) => url.searchParams.set(key, value));
      return NextResponse.redirect(url, 301);
    }
  }

  // Keep old bookmarks functional, but retire the dashboard entry points.
  if (normalized === "/home" || normalized === "/dashboard") {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    url.searchParams.delete("tab");
    return NextResponse.redirect(url, 307);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!api/webhooks).*)"],
};
