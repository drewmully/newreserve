/**
 * Reveal page A/B variant selection.
 *
 * v1 = legacy long reveal with edit grid + value math (control).
 * v2 = "Brick": one screen, preference validation, single CTA.
 *
 * Selection rules:
 *   - URL override: ?reveal_v=v1 or ?reveal_v=v2 always wins (debug/QA).
 *   - Cookie sticky: once a profileId has been bucketed, keep it for the
 *     duration of the cookie so the same visitor doesn't flip variants
 *     between visits. Cookie value is "v1" or "v2".
 *   - First-touch: deterministic hash of profileId → 50/50 split. This
 *     guarantees that if cookie storage is blocked, the same profile still
 *     resolves to the same variant. Also lets us recompute attribution
 *     from a profileId after the fact.
 *
 * Cookie name is `mr_reveal_ab` so it lines up with the existing tracking
 * conventions (see src/lib/tracking.ts).
 */

import { cookies } from "next/headers";

export type RevealVariant = "v1" | "v2";

export const REVEAL_AB_COOKIE = "mr_reveal_ab";

/**
 * Fallback variant when no override and no cookie exist.
 *
 * As of 2026-06-22, v2 (Brick) is the production winner (+218% checkout rate,
 * p<0.001) and is shipped to 100% of new visitors. Keeping this function with
 * a static return preserves the previous call sites and lets us flip back to
 * a split (or to v1) without touching the page code.
 */
function hashSplit(_profileId: string): RevealVariant {
  return "v2";
}

export async function resolveRevealVariant(
  profileId: string,
  searchOverride?: string | string[]
): Promise<RevealVariant> {
  // URL override wins everything.
  const raw = Array.isArray(searchOverride) ? searchOverride[0] : searchOverride;
  if (raw === "v1" || raw === "v2") return raw;

  // Cookie next.
  try {
    const c = await cookies();
    const existing = c.get(REVEAL_AB_COOKIE)?.value;
    if (existing === "v1" || existing === "v2") return existing;
  } catch {
    // cookies() can throw if called outside a request context (e.g. tests).
    // Fall through to the hash split.
  }

  return hashSplit(profileId);
}
