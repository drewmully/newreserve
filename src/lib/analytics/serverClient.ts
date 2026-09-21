import { createClient } from "@supabase/supabase-js";

/** Analytics never inherits the application's hard-coded production fallback.
 * Separate configuration is mandatory even when both use the same project.
 * Deliberately uncached so a changed configuration cannot reuse a stale target.
 */
export function getAnalyticsSupabase() {
  if (typeof window !== "undefined") throw new Error("analytics_server_only");
  const rawUrl = process.env.LEAN_ANALYTICS_SUPABASE_URL;
  const key = process.env.LEAN_ANALYTICS_SUPABASE_SERVICE_ROLE_KEY;
  if (!rawUrl || !key?.trim()) throw new Error("analytics_database_not_configured");
  let url: URL;
  try { url = new URL(rawUrl); }
  catch { throw new Error("analytics_database_invalid_url"); }
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash ||
      url.pathname !== "/") throw new Error("analytics_database_invalid_url");
  return createClient(url.origin, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
