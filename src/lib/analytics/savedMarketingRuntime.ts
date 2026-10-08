import { createHash, timingSafeEqual } from "node:crypto";
import { prepareSavedMarketingReport, savedMarketingPath, savedMarketingProject } from "./savedMarketingReport";
const headers = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
const empty = (status: number) => new Response(null, { status, headers });

/** Dedicated DB-hashed bearer; no new environment keys or Google authority.
 * Exactly one bounded read RPC. The incoming bearer never enters its arguments.
 */
export async function savedMarketingGet(req: Request, env: Record<string, string | undefined> = process.env,
  transport: typeof fetch = fetch) {
  if (env.LEAN_PRODUCTION_REPORTS_ENABLED !== "true" || env.VERCEL_ENV !== "production" ||
    env.VERCEL_GIT_COMMIT_REF !== "main") return empty(404);
  if (req.method !== "GET") return empty(405);
  const url = new URL(req.url);
  if (url.pathname !== savedMarketingPath || url.search || req.body !== null ||
    req.headers.has("transfer-encoding") ||
    req.headers.has("content-length") && req.headers.get("content-length") !== "0") return empty(400);
  const match = /^Bearer ([!-~]{32,512})$/.exec(req.headers.get("authorization") ?? "");
  if (!match) return empty(401);
  const digest = (s: string) => createHash("sha256").update(s).digest();
  const supplied = digest(match[1]);
  const existingCapabilities = ["LEAN_PRODUCTION_REPORTS_SECRET", "LEAN_PRODUCTION_WORKBOOK_REPORTS_SECRET",
    "LEAN_ANALYTICS_FULL_SECRET", "LEAN_GOOGLE_AUTOMATIC_PRODUCER_SECRET", "LEAN_GOOGLE_AUTOMATIC_OBSERVER_SECRET",
    "LEAN_GOOGLE_COMMISSION_SECRET", "LEAN_GOOGLE_DELIVERY_SECRET", "LEAN_ANALYTICS_MONITOR_SECRET"]
    .map(name => env[name]).filter((s): s is string => !!s);
  if (existingCapabilities.some(s => timingSafeEqual(supplied, digest(s)))) return empty(401);
  const project = savedMarketingProject, key = env.LEAN_ANALYTICS_SUPABASE_SERVICE_ROLE_KEY;
  if (env.LEAN_ANALYTICS_PIPELINE_PROJECT_REF !== project ||
    env.LEAN_ANALYTICS_SUPABASE_URL !== `https://${project}.supabase.co` || !key?.trim()) return empty(503);
  if (req.signal.aborted) return empty(503);
  const deadline = Date.now() + 15000;
  const controller = new AbortController();
  let reject: (error: Error) => void = () => {};
  const aborted = new Promise<never>((_, r) => { reject = r; });
  void aborted.catch(() => {});
  const stop = () => { controller.abort(); reject(new Error("saved_marketing_unavailable")); };
  const timer = setTimeout(stop, 15000);
  req.signal.addEventListener("abort", stop, { once: true });
  if (req.signal.aborted) stop();
  try {
    const response = await Promise.race([transport(`https://${project}.supabase.co/rest/v1/rpc/lean_saved_marketing_read`, {
      method: "POST", redirect: "error", signal: controller.signal,
      headers: { "Content-Type": "application/json", apikey: key, Authorization: `Bearer ${key}` },
      body: JSON.stringify({ p_token_sha256: supplied.toString("hex") }),
    }), aborted]);
    if (!response.ok) { void response.body?.cancel().catch(() => {}); return empty(503); }
    const reader = response.body?.getReader(); if (!reader) return empty(503);
    const chunks: Uint8Array[] = []; let bytes = 0;
    try {
      for (;;) {
        const part = await Promise.race([reader.read(), aborted]);
        if (part.done) break;
        bytes += part.value.byteLength;
        if (bytes > 8388608) throw new Error("saved_marketing_budget");
        chunks.push(part.value);
      }
    } finally { void reader.cancel().catch(() => {}); reader.releaseLock(); }
    const data: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)));
    if (data === null) return empty(403);
    const payload = prepareSavedMarketingReport(data);
    if (controller.signal.aborted || Date.now() >= deadline ||
      Date.now() >= Date.parse((data as { scope: { expires_at: string } }).scope.expires_at)) return empty(503);
    const text = JSON.stringify(payload);
    if ([match[1], key, ...existingCapabilities].some(s => text.includes(s))) return empty(503);
    return new Response(text, { headers: { ...headers, "Content-Type": "application/json" } });
  } catch { return empty(503); }
  finally { clearTimeout(timer); req.signal.removeEventListener("abort", stop); controller.abort(); }
}
