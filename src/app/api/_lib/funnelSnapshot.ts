/**
 * Persistence helpers for the marketing funnel dashboard.
 *
 * The dashboard caches two payload shapes — `funnel` (window-keyed) and
 * `rocks` (singleton) — in public.marketing_funnel_snapshots. The cron
 * /api/admin/cron/marketing-funnel-snapshot writes fresh rows hourly,
 * and the public-facing GET routes read the latest row for instant
 * page loads (sub-100ms) with a freshness indicator.
 *
 * Schema (see migration `marketing_funnel_snapshots`):
 *   id            bigserial pk
 *   kind          'funnel' | 'rocks'
 *   cache_key     'rocks' for rocks; 'YYYY-MM-DD..YYYY-MM-DD' for funnel
 *   payload       jsonb (the full response payload)
 *   generated_at  timestamptz
 *   computed_in_ms integer (optional)
 *   source        text     (e.g. 'cron' | 'manual')
 */

import { getSupabaseService } from "@/app/api/_lib/supabaseService";

export type SnapshotKind = "funnel" | "rocks";

export interface FunnelSnapshotRow<T = unknown> {
  payload: T;
  generated_at: string;
  computed_in_ms: number | null;
  source: string | null;
}

/**
 * Build the cache key used to identify a snapshot. Funnel snapshots are
 * keyed by date window so the cron can pre-warm popular windows.
 */
export function buildFunnelCacheKey(start: string, end: string): string {
  return `${start}..${end}`;
}

export const ROCKS_CACHE_KEY = "rocks";

/**
 * Insert a new snapshot row. We append-only so we have an audit trail —
 * `latestSnapshot` always picks the newest row for the (kind, key).
 */
export async function writeSnapshot<T>(
  kind: SnapshotKind,
  cacheKey: string,
  payload: T,
  opts: { computedInMs?: number; source?: string } = {}
): Promise<void> {
  const sb = getSupabaseService();
  const { error } = await sb.from("marketing_funnel_snapshots").insert({
    kind,
    cache_key: cacheKey,
    payload,
    computed_in_ms: opts.computedInMs ?? null,
    source: opts.source ?? "cron",
  });
  if (error) {
    throw new Error(`writeSnapshot(${kind}/${cacheKey}): ${error.message}`);
  }
}

/**
 * Read the most recent snapshot for (kind, cacheKey). Returns null when
 * no snapshot has been written yet — callers should fall back to a
 * live computation in that case.
 */
export async function latestSnapshot<T>(
  kind: SnapshotKind,
  cacheKey: string
): Promise<FunnelSnapshotRow<T> | null> {
  const sb = getSupabaseService();
  const { data, error } = await sb
    .from("marketing_funnel_snapshots")
    .select("payload, generated_at, computed_in_ms, source")
    .eq("kind", kind)
    .eq("cache_key", cacheKey)
    .order("generated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    throw new Error(`latestSnapshot(${kind}/${cacheKey}): ${error.message}`);
  }
  if (!data) return null;
  return {
    payload: data.payload as T,
    generated_at: data.generated_at as string,
    computed_in_ms: (data.computed_in_ms as number | null) ?? null,
    source: (data.source as string | null) ?? null,
  };
}

/**
 * Delete stale rows beyond the retention window to keep the table small.
 * Called from the cron after a successful write. Retention is generous —
 * we keep 14 days so historical comparisons remain possible.
 */
export async function pruneOldSnapshots(daysToKeep = 14): Promise<number> {
  const sb = getSupabaseService();
  const cutoff = new Date(Date.now() - daysToKeep * 24 * 3600 * 1000).toISOString();
  const { data, error } = await sb
    .from("marketing_funnel_snapshots")
    .delete()
    .lt("generated_at", cutoff)
    .select("id");
  if (error) {
    throw new Error(`pruneOldSnapshots: ${error.message}`);
  }
  return (data ?? []).length;
}
