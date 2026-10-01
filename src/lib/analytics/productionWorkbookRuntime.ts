import { createHash, timingSafeEqual } from "node:crypto";
import { validProductionWorkbookPayload } from "./productionWorkbookDelivery";

export const workbookRuntimePath = "/api/analytics/reports/workbook";
export const workbookRuntimeManifestHash = "ede0c179ef4a9f1b28625691823cb8410ae54fdce2af341de915f4a0593df6f3";
const project = "xnfjdbpjuaezxjgargto";
const source = "01a0f3c6-8758-0000-378b-d15c40a96f3a";
const audience = `posthog:353503:source:${source}`;
const deadlineMs = 15000;
const headers = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
const empty = (status: number) => new Response(null, { status, headers });
const hash = (s: string) => createHash("sha256").update(s, "utf8").digest();
type Authorization = {
  revision: string; snapshot_hash: string; token_sha256: string; project_ref: string;
  source_id: string; audience: string; path: string; manifest_sha256: string;
  run_id: string; publication_id: string; result_hash: string; shop: string;
  approval_ref: string; not_before: string; expires_at: string;
};
const fields = ["revision", "snapshot_hash", "token_sha256", "project_ref", "source_id", "audience", "path",
  "manifest_sha256", "run_id", "publication_id", "result_hash", "shop", "approval_ref", "not_before", "expires_at"];
function validAuthorization(value: unknown): value is Authorization {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const a = value as Record<string, unknown>;
  if (Object.keys(a).sort().join(",") !== [...fields].sort().join(",") ||
    fields.some(k => typeof a[k] !== "string" || !(a[k] as string).trim() || (a[k] as string).length > 512)) return false;
  const b = value as Authorization;
  return /^[1-9][0-9]{0,18}$/.test(b.revision) && BigInt(b.revision) <= BigInt("9223372036854775807") &&
    /^[a-f0-9]{64}$/.test(b.snapshot_hash) && /^[a-f0-9]{64}$/.test(b.token_sha256) &&
    b.project_ref === project && b.source_id === source && b.audience === audience &&
    b.path === workbookRuntimePath && b.manifest_sha256 === workbookRuntimeManifestHash &&
    b.publication_id === `full:${b.run_id}` && b.run_id.length <= 128 &&
    [b.not_before, b.expires_at].every(t => /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{6}Z$/.test(t) &&
      Number.isFinite(Date.parse(t))) &&
    Date.parse(b.expires_at) > Date.parse(b.not_before) &&
    Date.parse(b.expires_at) - Date.parse(b.not_before) <= 3600000;
}
const current = (a: Authorization) => Date.now() >= Date.parse(a.not_before) && Date.now() < Date.parse(a.expires_at);

/**
 * Separate, default-closed route. The existing production endpoint/mode/secret
 * remains untouched. Owner approval lives in an expiring, revision-bound DB row.
 * Two RPCs only; the second delegates to the CURRENT privacy-wrapped SQL053.
 */
export async function productionWorkbookRuntimeGet(req: Request,
  env: Record<string, string | undefined> = process.env, transport: typeof fetch = fetch) {
  if (env.LEAN_PRODUCTION_REPORTS_ENABLED !== "true" || env.VERCEL_ENV !== "production" ||
    env.VERCEL_GIT_COMMIT_REF !== "main") return empty(404);
  if (req.method !== "GET") return empty(405);
  const url = new URL(req.url);
  if (url.pathname !== workbookRuntimePath || url.search || req.body !== null ||
    req.headers.has("transfer-encoding") ||
    (req.headers.has("content-length") && req.headers.get("content-length") !== "0")) return empty(400);
  const observed = env.LEAN_PRODUCTION_REPORTS_SECRET;
  const supplied = req.headers.get("authorization") ?? "";
  const match = /^Bearer ([!-~]{32,512})$/.exec(supplied);
  if (!match) return empty(401);
  // Never accept the existing observed bearer, including a mistakenly reused DB hash.
  if (!observed || observed.length < 32 || observed.length > 512) return empty(503);
  const suppliedHash = hash(match[1]);
  if (timingSafeEqual(hash(observed), suppliedHash)) return empty(401);
  const key = env.LEAN_ANALYTICS_SUPABASE_SERVICE_ROLE_KEY;
  if (env.LEAN_ANALYTICS_PIPELINE_PROJECT_REF !== project ||
    env.LEAN_ANALYTICS_SUPABASE_URL !== `https://${project}.supabase.co` || !key?.trim()) return empty(503);

  const controller = new AbortController();
  const expires = Date.now() + deadlineMs;
  let rejectAbort: (reason: Error) => void = () => {};
  const aborted = new Promise<never>((_, reject) => { rejectAbort = reject; });
  // Attach a rejection handler even if the caller was already aborted.
  void aborted.catch(() => {});
  const stop = () => { controller.abort(); rejectAbort(new Error("workbook_unavailable")); };
  const timer = setTimeout(stop, deadlineMs);
  req.signal.addEventListener("abort", stop, { once: true });
  if (req.signal.aborted) stop();
  const check = () => {
    if (controller.signal.aborted || Date.now() >= expires) throw new Error("workbook_unavailable");
  };
  async function rpc(name: string, body: Record<string, string>, limit: number) {
    check();
    const response = await Promise.race([transport(`https://${project}.supabase.co/rest/v1/rpc/${name}`, {
      method: "POST", redirect: "error", signal: controller.signal,
      headers: { "Content-Type": "application/json", apikey: key!, Authorization: `Bearer ${key}` },
      body: JSON.stringify(body),
    }), aborted]);
    check();
    if (!response.ok) { void response.body?.cancel().catch(() => {}); throw new Error("workbook_unavailable"); }
    const reader = response.body?.getReader();
    if (!reader) throw new Error("workbook_unavailable");
    const chunks: Uint8Array[] = []; let bytes = 0;
    try {
      for (;;) {
        const part = await Promise.race([reader.read(), aborted]); check();
        if (part.done) break;
        bytes += part.value.byteLength;
        if (bytes > limit) throw new Error("workbook_unavailable");
        chunks.push(part.value);
      }
      const text = new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks));
      const data: unknown = JSON.parse(text);
      check();
      return { data, text };
    } finally {
      // Cancellation itself may hang. Do not await an untrusted stream's cancel.
      void reader.cancel().catch(() => {}); reader.releaseLock();
    }
  }
  try {
    const { data: auth } = await rpc("lean_workbook_runtime_auth", { p_project_ref: project }, 8192);
    if (!validAuthorization(auth) || !current(auth)) return empty(503);
    if (!timingSafeEqual(Buffer.from(auth.token_sha256, "hex"), suppliedHash)) return empty(401);
    const { data, text } = await rpc("lean_workbook_runtime_read", {
      p_project_ref: project, p_revision: auth.revision, p_snapshot_hash: auth.snapshot_hash,
    }, 4194304);
    if (!validProductionWorkbookPayload(data)) return empty(503);
    const statuses = (data as { report_status: Record<string, unknown>[] }).report_status;
    if (statuses.some(s => s.publication_id !== auth.publication_id || s.shop_id !== auth.shop) || !current(auth)) return empty(503);
    check();
    return new Response(text, { status: 200, headers: { ...headers, "Content-Type": "application/json" } });
  } catch { return empty(503); }
  finally {
    clearTimeout(timer); req.signal.removeEventListener("abort", stop); controller.abort();
  }
}
