import { timingSafeEqual } from "node:crypto";
import { googleDeliveryDefinition, googleDeliveryMetrics, googleDeliveryPath } from "./googleDeliveryReport";

type Row = Record<string, unknown>;
const object = (v: unknown): v is Row => !!v && typeof v === "object" && !Array.isArray(v);
const exact = (v: Row, keys: readonly string[]) => Object.keys(v).sort().join(",") === [...keys].sort().join(",");
const dimensions = ["shop_id", "publication_id", "definition_version", "report_scope", "provider", "account_id",
  "report_date", "source_currency", "source_timezone", "click_definition", "as_of_at", "is_stale"];
const instant = (v: unknown): v is string => typeof v === "string" &&
  /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,6})?Z$/.test(v) &&
  Number.isFinite(Date.parse(v)) && new Date(v).toISOString().slice(0, 19) === v.slice(0, 19);
type Binding = { runId: string; resultHash: string; accountId: string; date: string };
export function validGoogleDeliveryPayload(data: unknown, binding: Binding): boolean {
  if (!object(data) || !exact(data, ["google_account_daily", "google_delivery_status"]) ||
    !Array.isArray(data.google_account_daily) || data.google_account_daily.length !== 1 ||
    !object(data.google_delivery_status)) return false;
  const s = data.google_delivery_status, r = data.google_account_daily[0];
  if (!exact(s, ["state", "report_scope", "run_id", "result_hash", "row_hash", "selection_revision",
    "row_count", "atomic_resource_refresh", "not_before", "expires_at"]) ||
    s.state !== "selected" || s.report_scope !== "single_google_account" || s.run_id !== binding.runId ||
    s.result_hash !== binding.resultHash || typeof s.row_hash !== "string" || !/^[a-f0-9]{32}$/.test(s.row_hash) ||
    typeof s.selection_revision !== "string" || !/^[1-9]\d{0,18}$/.test(s.selection_revision) ||
    BigInt(s.selection_revision) > BigInt("9223372036854775807") ||
    s.row_count !== "1" || s.atomic_resource_refresh !== false || !instant(s.not_before) || !instant(s.expires_at) ||
    Date.parse(s.expires_at) <= Date.parse(s.not_before) ||
    Date.parse(s.expires_at) - Date.parse(s.not_before) > 3600000 ||
    Date.now() < Date.parse(s.not_before) || Date.now() >= Date.parse(s.expires_at)) return false;
  if (!object(r) || !exact(r, [...dimensions, ...googleDeliveryMetrics, "readiness"]) ||
    !object(r.readiness) || !exact(r.readiness, googleDeliveryMetrics) ||
    typeof r.shop_id !== "string" || !/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(r.shop_id) ||
    r.publication_id !== `full:${binding.runId}` || r.account_id !== binding.accountId || r.report_date !== binding.date ||
    r.definition_version !== googleDeliveryDefinition || r.report_scope !== "single_google_account" ||
    r.provider !== "google_ads" || r.source_currency !== "USD" || r.source_timezone !== "America/New_York" ||
    r.click_definition !== "google_ads.metrics.clicks" || !instant(r.as_of_at) || typeof r.is_stale !== "boolean")
    return false;
  for (const field of googleDeliveryMetrics) {
    const v = r[field];
    if (v === null) { if (r.readiness[field] !== "withheld") return false; }
    else {
      if (r.readiness[field] !== "ready" || typeof v !== "string") return false;
      if (field === "clicks" || field === "impressions") {
        if (!/^(0|[1-9]\d{0,15})$/.test(v) || BigInt(v) > BigInt(Number.MAX_SAFE_INTEGER)) return false;
      } else if (!/^(0|[1-9]\d{0,13})\.\d{6}$/.test(v)) return false;
    }
  }
  return true;
}
const headers = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
const empty = (status: number) => new Response(null, { status, headers });
const project = "xnfjdbpjuaezxjgargto";

/** Separate default-off, fixed one-day selection. No provider reads or writes.
 * One bounded read RPC; never falls back to generic/observed/workbook bearers.
 */
export async function googleDeliveryGet(req: Request,
  env: Record<string, string | undefined> = process.env, transport: typeof fetch = fetch) {
  if (env.LEAN_GOOGLE_DELIVERY_ENABLED !== "true" || env.VERCEL_ENV !== "production" ||
    env.VERCEL_GIT_COMMIT_REF !== "main") return empty(404);
  if (req.method !== "GET") return empty(405);
  const url = new URL(req.url);
  if (url.pathname !== googleDeliveryPath || url.search || req.body !== null ||
    req.headers.has("transfer-encoding") ||
    req.headers.has("content-length") && req.headers.get("content-length") !== "0") return empty(400);
  const secret = env.LEAN_GOOGLE_DELIVERY_SECRET;
  if (!secret || !/^[!-~]{32,512}$/.test(secret) ||
    [env.LEAN_PRODUCTION_REPORTS_SECRET, env.LEAN_PRODUCTION_WORKBOOK_REPORTS_SECRET,
      env.LEAN_ANALYTICS_FULL_SECRET].some(s => s !== undefined && s === secret)) return empty(503);
  const expected = new TextEncoder().encode(`Bearer ${secret}`);
  const supplied = new TextEncoder().encode(req.headers.get("authorization") ?? "");
  if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) return empty(401);
  const binding: Binding = { runId: env.LEAN_GOOGLE_DELIVERY_RUN_ID ?? "",
    resultHash: env.LEAN_GOOGLE_DELIVERY_RESULT_HASH ?? "", accountId: env.LEAN_GOOGLE_DELIVERY_ACCOUNT_ID ?? "",
    date: env.LEAN_GOOGLE_DELIVERY_DATE ?? "" };
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(binding.runId) || !/^[a-f0-9]{32}$/.test(binding.resultHash) ||
    !/^\d{10}$/.test(binding.accountId) || !/^\d{4}-\d\d-\d\d$/.test(binding.date) ||
    !Number.isFinite(Date.parse(binding.date)) || new Date(binding.date).toISOString().slice(0, 10) !== binding.date ||
    env.LEAN_ANALYTICS_PIPELINE_PROJECT_REF !== project ||
    env.LEAN_ANALYTICS_SUPABASE_URL !== `https://${project}.supabase.co` ||
    !env.LEAN_ANALYTICS_SUPABASE_SERVICE_ROLE_KEY?.trim()) return empty(503);
  const controller = new AbortController(), deadline = Date.now() + 15000;
  let reject: (reason: Error) => void = () => {};
  const aborted = new Promise<never>((_, fail) => { reject = fail; });
  void aborted.catch(() => {});
  const stop = () => { controller.abort(); reject(new Error("google_delivery_unavailable")); };
  const timer = setTimeout(stop, 15000);
  req.signal.addEventListener("abort", stop, { once: true });
  if (req.signal.aborted) stop();
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  try {
    if (controller.signal.aborted) return empty(503);
    const key = env.LEAN_ANALYTICS_SUPABASE_SERVICE_ROLE_KEY;
    const response = await Promise.race([transport(`https://${project}.supabase.co/rest/v1/rpc/lean_google_delivery_read`, {
      method: "POST", redirect: "error", signal: controller.signal,
      headers: { "Content-Type": "application/json", apikey: key, Authorization: `Bearer ${key}` },
      body: JSON.stringify({ p_project_ref: project, p_run: binding.runId, p_result_hash: binding.resultHash,
        p_account_id: binding.accountId, p_date: binding.date }),
    }), aborted]);
    if (!response.ok) { void response.body?.cancel().catch(() => {}); return empty(503); }
    reader = response.body?.getReader();
    if (!reader) return empty(503);
    let bytes = 0; const chunks: Uint8Array[] = [];
    for (;;) {
      const part = await Promise.race([reader.read(), aborted]);
      if (controller.signal.aborted || Date.now() >= deadline) return empty(503);
      if (part.done) break;
      bytes += part.value.byteLength;
      if (bytes > 16384) return empty(503);
      chunks.push(part.value);
    }
    const text = new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks));
    if (!validGoogleDeliveryPayload(JSON.parse(text), binding) ||
      controller.signal.aborted || Date.now() >= deadline) return empty(503);
    return new Response(text, { status: 200, headers: { ...headers, "Content-Type": "application/json" } });
  } catch { return empty(503); }
  finally {
    clearTimeout(timer); req.signal.removeEventListener("abort", stop); controller.abort();
    void reader?.cancel().catch(() => {}); reader?.releaseLock();
  }
}
