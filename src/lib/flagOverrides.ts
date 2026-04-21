/**
 * Flag Overrides — reads the `flag_overrides` table from Supabase to force specific
 * variants when Drew (or the CRO cron) has declared a winner.
 *
 * How it works:
 *   - On winner declaration (HQ app `cro.tsx` -> declareExperiment) we upsert a row
 *     into `flag_overrides` keyed by `flag_key` (e.g. "hero-headline") with the
 *     `forced_variant` field set to the winning variant.
 *   - Consumers (homepage flags.ts, onboarding/page.tsx) check this table. If a
 *     forced_variant exists, it wins over the cookie bucket.
 *   - PostHog events still get the variant property so future analysis works.
 *
 * Kept intentionally dependency-free (uses fetch directly) so it can run in the
 * Next.js server runtime, edge runtime, and client bundles alike.
 */

const SUPABASE_URL = "https://xnfjdbpjuaezxjgargto.supabase.co";
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhuZmpkYnBqdWFlenhqZ2FyZ3RvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ0NzMxOTAsImV4cCI6MjA5MDA0OTE5MH0.rY1jpedgZ0qJmIRNJLYJNCuIBwBTljWJGpcZI9-YN_g";

export type FlagOverrideMap = Record<string, string>;

type RawRow = {
  flag_key: string;
  forced_variant: string | null;
};

/**
 * Server-side fetcher with a short in-memory TTL. Revalidates every 60s so a
 * freshly-declared winner rolls out within a minute without a redeploy.
 */
let cache: { data: FlagOverrideMap; fetchedAt: number } | null = null;
const TTL_MS = 60_000;

export async function getFlagOverrides(): Promise<FlagOverrideMap> {
  const now = Date.now();
  if (cache && now - cache.fetchedAt < TTL_MS) return cache.data;

  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/flag_overrides?select=flag_key,forced_variant`,
      {
        headers: {
          apikey: SUPABASE_ANON_KEY,
          Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        },
        // Next.js: allow the platform cache to dedupe concurrent requests.
        next: { revalidate: 60, tags: ["flag-overrides"] },
      } as RequestInit,
    );
    if (!res.ok) {
      console.error("[flagOverrides] fetch failed", res.status);
      return cache?.data ?? {};
    }
    const rows: RawRow[] = await res.json();
    const map: FlagOverrideMap = {};
    for (const row of rows) {
      if (row.forced_variant) map[row.flag_key] = row.forced_variant;
    }
    cache = { data: map, fetchedAt: now };
    return map;
  } catch (err) {
    console.error("[flagOverrides] error", err);
    return cache?.data ?? {};
  }
}

/**
 * Merge an override on top of a cookie-bucket-decided variant.
 * If the override exists for the flag, it wins.
 */
export function resolveVariant(
  flagKey: string,
  bucketDecision: string,
  overrides: FlagOverrideMap,
): string {
  return overrides[flagKey] ?? bucketDecision;
}
