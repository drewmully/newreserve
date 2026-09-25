/** Opt-in process supervisor entry point. No installed cron, deployment or live
 * call on import. Start ONLY after target/cost/credential approval.
 */
import { pathToFileURL } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";

export function dispatchConfig(env) {
  if (env.LEAN_ANALYTICS_DISPATCH_ENABLED !== "true") throw new Error("dispatch_disabled");
  const url = new URL(env.LEAN_ANALYTICS_RUNNER_ORIGIN);
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || url.pathname !== "/")
    throw new Error("invalid_runner_origin");
  const secret = env.LEAN_ANALYTICS_PIPELINE_SECRET ?? "";
  const interval = Number(env.LEAN_ANALYTICS_DISPATCH_INTERVAL_SECONDS ?? "60");
  const maxCalls = Number(env.LEAN_ANALYTICS_DISPATCH_MAX_CALLS ?? "2");
  const deadlineSeconds = Number(env.LEAN_ANALYTICS_DISPATCH_DEADLINE_SECONDS ?? "300");
  if (secret.length < 32 || !Number.isInteger(interval) || interval < 60 || interval > 3600)
    throw new Error("invalid_dispatch_configuration");
  if (!Number.isInteger(maxCalls) || maxCalls < 2 || maxCalls > 120 || maxCalls % 2 ||
      !Number.isInteger(deadlineSeconds) || deadlineSeconds < 1 || deadlineSeconds > 3600)
    throw new Error("invalid_dispatch_budget");
  return { url: new URL("/api/analytics/ingest/process", url).href, secret, interval, maxCalls, deadlineSeconds };
}
export async function dispatchOnce(config, fetcher = fetch, signal = undefined) {
  const headers = { authorization: `Bearer ${config.secret}` };
  const options = { headers, redirect: "error",
    signal: AbortSignal.any([AbortSignal.timeout(95000), ...(signal ? [signal] : [])]) };
  // Do not log response bodies: reverse-proxy errors may contain private data.
  const response = await fetcher(config.url, { ...options, method: "POST" });
  if (!response.ok) throw new Error("pipeline_dispatch_failed");
  const health = await fetcher(config.url, { ...options, method: "GET" });
  if (!health.ok) throw new Error("pipeline_health_unavailable");
  const data = await health.json();
  for (const key of ["pending", "leased", "dead", "done", "oldestPendingSeconds", "expiredLeases"])
    if (!Number.isFinite(data[key]) || data[key] < 0) throw new Error("pipeline_invalid_health");
  if (data.enabled !== true) throw new Error("pipeline_scope_disabled");
  return { healthy: data.dead === 0 && data.expiredLeases === 0 && data.oldestPendingSeconds < 900,
    pending: data.pending, dead: data.dead, oldestPendingSeconds: data.oldestPendingSeconds };
}
/** Finite invocation. Every cycle reserves POST + health GET from one budget.
 * No schedule, new source inventory, retries or configuration writes are created.
 * @param {ReturnType<typeof dispatchConfig>} config
 * @param {{fetcher?: typeof fetch, signal?: AbortSignal,
 * pause?: (ms: number, value: undefined, options: {signal: AbortSignal}) => Promise<unknown>,
 * now?: () => number, onResult?: (result: Awaited<ReturnType<typeof dispatchOnce>>) => void}} options
 */
export async function runDispatch(config, {
  fetcher = fetch, signal, pause = sleep, now = Date.now, onResult = () => {},
} = {}) {
  const started = now(), expires = started + config.deadlineSeconds * 1000;
  const deadline = AbortSignal.timeout(config.deadlineSeconds * 1000);
  const active = AbortSignal.any([deadline, ...(signal ? [signal] : [])]);
  let calls = 0;
  const stopped = () => signal?.aborted ? "cancelled" :
    deadline.aborted || now() >= expires ? "deadline" : null;
  const boundedFetch = async (...args) => {
    if (stopped()) throw new Error("dispatch_stopped");
    calls++;
    const result = await fetcher(...args);
    if (stopped()) throw new Error("dispatch_stopped");
    return result;
  };
  while (calls + 2 <= config.maxCalls) {
    if (stopped()) return { state: stopped(), calls };
    try {
      const result = await dispatchOnce(config, boundedFetch, active);
      if (stopped()) return { state: stopped(), calls };
      onResult(result);
      if (!result.healthy) return { state: "unhealthy", calls };
    } catch { return { state: stopped() ?? "failed", calls }; }
    if (calls + 2 > config.maxCalls) break;
    // Do not wait if there is no remaining time for another approved interval.
    if (now() + config.interval * 1000 >= expires) return { state: "deadline", calls };
    try { await pause(config.interval * 1000, undefined, { signal: active }); }
    catch { return { state: stopped() ?? "failed", calls }; }
  }
  return { state: "complete", calls };
}
async function main() {
  const config = dispatchConfig(process.env);
  if (process.argv.includes("--once")) config.maxCalls = 2;
  const stop = new AbortController();
  process.once("SIGTERM", () => stop.abort());
  process.once("SIGINT", () => stop.abort());
  const result = await runDispatch(config, { signal: stop.signal,
    onResult: health => console.log(JSON.stringify({ event: "analytics_queue_health", ...health })) });
  console.log(JSON.stringify({ event: "analytics_dispatch_stopped", ...result }));
  if (!["complete", "cancelled"].includes(result.state)) process.exitCode = 1;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  main().catch(() => { console.error("analytics_dispatch_configuration_failed"); process.exitCode = 1; });
