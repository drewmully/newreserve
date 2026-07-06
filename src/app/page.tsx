/**
 * Homepage — 50/50 A/B split between the two funnel entry points.
 *
 * The actual split (and query-param forwarding) happens in `src/middleware.ts`
 * so that:
 *   1. The visitor's sticky bucket cookie (`mr_ab`, 0..99) is set on the very
 *      first request, before any React runs.
 *   2. Repeat visitors always land on the same variant.
 *   3. All downstream analytics events fire with the same `homepage-lp`
 *      property (via `getAbVariantProperties` in `src/lib/tracking.ts`), so
 *      the daily rollup can attribute conversions back to the assigned LP.
 *
 * This server component is a defensive fallback for the case where middleware
 * is bypassed (e.g. maintenance rewrites, config regressions). It performs
 * the same subscription-side redirect the pre-A/B homepage used to do, with
 * query params preserved. In practice it should never render.
 */

import { redirect } from "next/navigation";

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const usp = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) {
    if (v == null) continue;
    if (Array.isArray(v)) {
      for (const item of v) if (item != null) usp.append(k, item);
    } else {
      usp.append(k, v);
    }
  }
  const qs = usp.toString();
  redirect(qs ? `/lp/subscription?${qs}` : "/lp/subscription");
}
