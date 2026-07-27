/**
 * Homepage — traffic-aware redirect fallback.
 *
 * The primary redirect (and query-param forwarding) happens in
 * `src/middleware.ts`, which routes Meta/Instagram paid traffic to
 * /lp/consult and everything else to /lp/subscription. Middleware also sets
 * the sticky `mr_ab` cookie so downstream analytics events keep firing with
 * the `homepage-lp` property.
 *
 * This server component is a defensive fallback for the case where middleware
 * is bypassed (e.g. maintenance rewrites, config regressions). It mirrors the
 * middleware routing logic. In practice it should rarely render.
 */

import { redirect } from "next/navigation";

const META_SOURCE_TOKENS = new Set([
  "facebook",
  "meta",
  "instagram",
  "ig",
  "fb",
]);

function firstString(v: string | string[] | undefined): string | null {
  if (v == null) return null;
  if (Array.isArray(v)) return v[0] ?? null;
  return v;
}

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

  const fbclid = firstString(sp.fbclid);
  const utmSource = firstString(sp.utm_source)?.toLowerCase().trim() ?? "";
  const isMeta =
    (fbclid !== null && fbclid.trim().length > 0) ||
    META_SOURCE_TOKENS.has(utmSource);
  const destination = isMeta ? "/lp/consult" : "/lp/subscription";

  const qs = usp.toString();
  redirect(qs ? `${destination}?${qs}` : destination);
}
