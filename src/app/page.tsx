/**
 * Homepage — server-side redirect fallback.
 *
 * The primary redirect (and query-param forwarding) happens in
 * `src/middleware.ts`, which routes ALL `/` traffic to /lp/consult and
 * sets the sticky `mr_ab` cookie for the consult A/B bucket.
 *
 * This server component is a defensive fallback for the case where
 * middleware is bypassed (e.g. maintenance rewrites, config regressions).
 * It mirrors the middleware routing so behaviour is consistent even when
 * middleware doesn't run.
 */

import { redirect } from "next/navigation";

const HOMEPAGE_DESTINATION = "/lp/consult";

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
  redirect(qs ? `${HOMEPAGE_DESTINATION}?${qs}` : HOMEPAGE_DESTINATION);
}
