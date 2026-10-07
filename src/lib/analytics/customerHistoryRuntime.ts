import { timingSafeEqual } from "node:crypto";
import { runHistoryCustomerStep } from "./historyCustomerSource";
import { validatePipelineTarget } from "./shopifyPipeline";
import type { AnalyticsRpcClient } from "./rpcStore";

const path = "/api/analytics/customers/process";
const headers = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
const empty = (status: number) => new Response(null, { status, headers });

async function hasEmptyBody(req: Request): Promise<boolean> {
  if (req.signal.aborted) return false;
  if (req.body === null) return true;
  if (req.body.locked || req.bodyUsed) return false;
  // The Node adapter can represent a zero-byte POST as a stream. Require EOF.
  const reader = req.body.getReader();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stop: () => void = () => {};
  const stopped = new Promise<false>(resolve => {
    stop = () => resolve(false);
    timer = setTimeout(stop, 1000);
    req.signal.addEventListener("abort", stop, { once: true });
    if (req.signal.aborted) stop();
  });
  try {
    return await Promise.race([reader.read().then(({ done, value }) =>
      done === true && (value === undefined || value.byteLength === 0), () => false), stopped]);
  } finally {
    clearTimeout(timer);
    req.signal.removeEventListener("abort", stop);
    void reader.cancel().catch(() => {});
  }
}

/** One retained member of one server-bound registered run. No provider reader,
 * registration, authority refresh, schedule, full-build selection or retry.
 * SQL remains responsible for the 90-second lease and current source authority.
 */
export async function customerHistoryPost(req: Request,
  env: Record<string, string | undefined> = process.env, request: typeof fetch = fetch) {
  if (env.LEAN_ANALYTICS_CUSTOMER_HISTORY_ENABLED !== "true") return empty(404);
  if (req.method !== "POST") return empty(405);
  const secret = env.LEAN_ANALYTICS_CUSTOMER_HISTORY_SECRET ?? "";
  if (secret.length < 32 || secret.length > 512) return empty(503);
  const encoder = new TextEncoder();
  const expected = encoder.encode(`Bearer ${secret}`), supplied = encoder.encode(req.headers.get("authorization") ?? "");
  if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) return empty(401);
  const url = new URL(req.url);
  if (url.pathname !== path || url.search || req.headers.has("transfer-encoding") ||
      req.headers.has("content-length") && req.headers.get("content-length") !== "0")
    return empty(400);
  if (!await hasEmptyBody(req)) return empty(400);

  try {
    const project = env.LEAN_ANALYTICS_PIPELINE_PROJECT_REF ?? "";
    const databaseUrl = env.LEAN_ANALYTICS_SUPABASE_URL ?? "";
    const run = env.LEAN_ANALYTICS_CUSTOMER_HISTORY_RUN_ID ?? "";
    const key = env.LEAN_ANALYTICS_SUPABASE_SERVICE_ROLE_KEY;
    validatePipelineTarget(project, databaseUrl);
    if (project !== project.trim() || run !== run.trim() ||
        !/^[A-Za-z0-9_-]{1,100}$/.test(run) || !key?.trim())
      throw new Error("customer_runtime_configuration");
    const signal = AbortSignal.any([req.signal, AbortSignal.timeout(60000)]);
    let calls = 0, bytes = 0;
    const client: AnalyticsRpcClient = { async rpc(name, args) {
      signal.throwIfAborted();
      if (name !== (calls === 0 ? "lean_history_customer_claim" : "lean_history_customer_finish") ||
          args.p_run !== run || args.p_project !== project || ++calls > 2)
        throw new Error("customer_runtime_rpc_scope");
      const body = JSON.stringify(args);
      const size = Buffer.byteLength(body);
      bytes += size;
      if (size > 16 * 1024 * 1024 || bytes > 32 * 1024 * 1024)
        throw new Error("customer_runtime_byte_budget");
      const response = await request(`${databaseUrl}/rest/v1/rpc/${name}`, {
        method: "POST", redirect: "error", signal,
        headers: { "Content-Type": "application/json", apikey: key, Authorization: `Bearer ${key}` },
        body,
      });
      signal.throwIfAborted();
      if (!response.ok) {
        void response.body?.cancel().catch(() => {});
        throw new Error("customer_runtime_storage");
      }
      const reader = response.body?.getReader();
      if (!reader) throw new Error("customer_runtime_storage");
      const chunks: Uint8Array[] = [];
      let responseBytes = 0;
      const cancel = () => { void reader.cancel().catch(() => {}); };
      signal.addEventListener("abort", cancel, { once: true });
      try {
        for (;;) {
          signal.throwIfAborted();
          const part = await reader.read();
          signal.throwIfAborted();
          if (part.done) break;
          responseBytes += part.value.byteLength; bytes += part.value.byteLength;
          if (responseBytes > 8 * 1024 * 1024 || bytes > 32 * 1024 * 1024)
            throw new Error("customer_runtime_byte_budget");
          chunks.push(part.value);
        }
        const data: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        if (name === "lean_history_customer_finish" && typeof data !== "boolean")
          throw new Error("customer_runtime_storage");
        return { data, error: null };
      } finally {
        signal.removeEventListener("abort", cancel);
        void reader.cancel().catch(() => {});
      }
    } };
    const result = await runHistoryCustomerStep({ approved: true, client, runId: run, projectRef: project });
    return Response.json({ state: result.state, providerRequests: 0, certification: "unverified" }, { headers });
  } catch {
    // A lost finish response can have committed. Do not retry, release or renew.
    return Response.json({ state: "unavailable" }, { status: 503, headers });
  }
}
