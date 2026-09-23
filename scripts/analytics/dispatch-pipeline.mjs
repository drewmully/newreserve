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
  if (secret.length < 32 || !Number.isInteger(interval) || interval < 60 || interval > 3600)
    throw new Error("invalid_dispatch_configuration");
  return { url: new URL("/api/analytics/ingest/process", url).href, secret, interval };
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
async function main() {
  const config = dispatchConfig(process.env);
  const stop = new AbortController();
  process.once("SIGTERM", () => stop.abort());
  process.once("SIGINT", () => stop.abort());
  do {
    try {
      const result = await dispatchOnce(config, fetch, stop.signal);
      console.log(JSON.stringify({ event: "analytics_queue_health", ...result }));
      if (process.argv.includes("--once") && !result.healthy) process.exitCode = 1;
    } catch {
      if (!stop.signal.aborted) console.error(JSON.stringify({ event: "analytics_dispatch_unhealthy" }));
      if (process.argv.includes("--once")) process.exitCode = 1;
    }
    if (process.argv.includes("--once") || stop.signal.aborted) break;
    try { await sleep(config.interval * 1000, undefined, { signal: stop.signal }); } catch { break; }
  } while (!stop.signal.aborted);
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  main().catch(() => { console.error("analytics_dispatch_configuration_failed"); process.exitCode = 1; });
