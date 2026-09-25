/** Explicit invocation only: no schedule or source configuration installed. */
import { pathToFileURL } from "node:url";
export function refreshDispatchConfig(env) {
  if (env.LEAN_ANALYTICS_REFRESH_DISPATCH_ENABLED !== "true") throw new Error("refresh_dispatch_disabled");
  const origin = new URL(env.LEAN_ANALYTICS_RUNNER_ORIGIN);
  if (origin.protocol !== "https:" || origin.username || origin.password ||
      origin.pathname !== "/" || origin.search || origin.hash) throw new Error("invalid_runner_origin");
  const maxCalls = Number(env.LEAN_ANALYTICS_REFRESH_MAX_CALLS ?? "5");
  if (!Number.isInteger(maxCalls) || maxCalls < 1 || maxCalls > 128) throw new Error("invalid_refresh_call_budget");
  const secret = env.LEAN_ANALYTICS_REFRESH_SECRET ?? "";
  if (secret.length < 32) throw new Error("missing_stage_secret");
  return { origin: origin.href, maxCalls, secret };
}
export async function dispatchRefresh(config, request = fetch) {
  let calls = 0;
  for (let i = 0; i < config.maxCalls; i++) {
    const response = await request(new URL("/api/analytics/ingest/refresh", config.origin), {
      method: "POST", headers: { authorization: `Bearer ${config.secret}` },
      redirect: "error", signal: AbortSignal.timeout(95000),
    });
    calls++;
    if (!response.ok) throw new Error("refresh_stage_unavailable");
    const result = await response.json();
    if (result.state === "complete") return { state: "complete", calls, publication: "private_candidate" };
    if (result.state !== "partial") return { state: "stopped", calls };
  }
  return { state: "bounded", calls };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  dispatchRefresh(refreshDispatchConfig(process.env))
    .then(result => { console.log(JSON.stringify(result)); if (result.state === "bounded") process.exitCode = 1; })
    .catch(() => { console.error("refresh_dispatch_failed"); process.exitCode = 1; });
