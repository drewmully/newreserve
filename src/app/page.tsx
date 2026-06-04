/**
 * Homepage — redirects to the Reserve LP, preserving query params.
 *
 * Why a redirect instead of duplicating the LP markup here?
 *   - The Reserve LP at /lp/subscription is the single source of truth for
 *     the funnel. Iterations happen there. Duplicating its JSX into / would
 *     mean every change has to be applied in two places, with subtle drift
 *     between hero copy, CTAs, analytics source tags, and section spacing.
 *   - The existing analytics events fire with source: "lp_subscription_*".
 *     Keeping the URL stable preserves all of that.
 *   - GlassHeader's "/" logo link gracefully redirects back to the LP — no
 *     dead links from the rest of the site.
 *
 * Why we forward query params:
 *   Any ad, email link, or shared URL that points at `/` (rather than
 *   `/lp/subscription`) used to land on the LP with NO UTMs because the
 *   redirect dropped the search string. That silently broke attribution
 *   for AG5 and any future ad someone forgets to point at the canonical
 *   LP path. Now we preserve `?utm_*`, `?gclid`, `?fbclid`, and any other
 *   query the marketer attached.
 *
 * Redirect type:
 *   Using next/navigation `redirect()` from a server component yields a
 *   307 (temporary) by default. That's the right semantic for now —
 *   if/when we want search engines to fully transfer authority to the LP
 *   URL, switch to `permanentRedirect()` from next/navigation.
 *
 * The previous bespoke homepage layout lives in git history at commit
 * 2595803 (and earlier) — `git show HEAD~1:src/app/page.tsx` if we ever
 * need to bring it back.
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
