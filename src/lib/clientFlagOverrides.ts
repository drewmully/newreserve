"use client";

/**
 * Client-side reader for the `flag_overrides` table in Supabase. The table is
 * the source of truth for live winner-locked variants; both /onboarding and
 * /choose-plan use this so the same A/B framework drives both surfaces.
 *
 * Returns an empty map on any error so the UI never blocks waiting for
 * Supabase. Network failures fall back to the cookie-bucket default.
 */

const FLAG_OVERRIDES_URL =
  "https://xnfjdbpjuaezxjgargto.supabase.co/rest/v1/flag_overrides?select=flag_key,forced_variant";

const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhuZmpkYnBqdWFlenhqZ2FyZ3RvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ0NzMxOTAsImV4cCI6MjA5MDA0OTE5MH0.rY1jpedgZ0qJmIRNJLYJNCuIBwBTljWJGpcZI9-YN_g";

export type FlagOverrideMap = Record<string, string>;

export async function fetchClientFlagOverrides(): Promise<FlagOverrideMap> {
  try {
    const res = await fetch(FLAG_OVERRIDES_URL, {
      headers: { apikey: SUPABASE_ANON_KEY },
    });
    if (!res.ok) return {};
    const rows: Array<{ flag_key: string; forced_variant: string | null }> =
      await res.json();
    const map: FlagOverrideMap = {};
    for (const row of rows) {
      if (row.forced_variant) map[row.flag_key] = row.forced_variant;
    }
    return map;
  } catch {
    return {};
  }
}

/** Read the cookie-bucket A/B id (0..99) the middleware sets. */
export function getABBucket(): number {
  if (typeof document === "undefined") return 0;
  const match = document.cookie.match(/(?:^|; )mr_ab=(\d+)/);
  return match ? parseInt(match[1], 10) : 0;
}
