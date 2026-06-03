/**
 * Homepage — redirects to the Reserve LP.
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

export default function Home() {
  redirect("/lp/subscription");
}
