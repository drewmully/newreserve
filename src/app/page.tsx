/**
 * Homepage — routes 100% of `/` traffic to /lp/consult.
 *
 * The redirect (and query-param forwarding) normally happens in
 * `src/middleware.ts`, which also sets the sticky `mr_ab` cookie so downstream
 * analytics events keep firing with the `homepage-lp` property.
 *
 * This server component is a defensive fallback for the case where middleware
 * is bypassed (e.g. maintenance rewrites, config regressions). It performs the
 * same /lp/consult redirect, with query params preserved. In practice it
 * should never render.
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
  redirect(qs ? `/lp/consult?${qs}` : "/lp/consult");
}
