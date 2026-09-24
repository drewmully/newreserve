/** No calls on import; no schedule is installed. Deployment and recurring costs
 * require separate approval. Saved run IDs, source windows and hard bounds live
 * in the database; callers cannot expand them through this dispatcher.
 */
import { pathToFileURL } from "node:url";
export function fullDispatchConfig(env) {
  if (env.LEAN_ANALYTICS_FULL_DISPATCH_ENABLED !== "true") throw new Error("full_dispatch_disabled");
  const origin = new URL(env.LEAN_ANALYTICS_RUNNER_ORIGIN);
  if (origin.protocol !== "https:" || origin.username || origin.password ||
      origin.pathname !== "/" || origin.search || origin.hash) throw new Error("invalid_runner_origin");
  const maxCalls = Number(env.LEAN_ANALYTICS_FULL_MAX_CALLS ?? "5");
  if (!Number.isInteger(maxCalls) || maxCalls < 1 || maxCalls > 128)
    throw new Error("invalid_full_call_budget");
  const secret = env.LEAN_ANALYTICS_FULL_SECRET ?? "";
  if (secret.length < 32) throw new Error("missing_stage_secret");
  return { origin: origin.href, maxCalls, secret };
}
export async function dispatchFull(config, request = fetch) {
  let calls = 0;
  for (let i = 0; i < config.maxCalls; i++) {
      const response = await request(new URL("/api/analytics/ingest/full", config.origin), {
        method: "POST", headers: { authorization: `Bearer ${config.secret}` },
        redirect: "error", signal: AbortSignal.timeout(95000),
      });
      calls++;
      if (!response.ok) throw new Error("full_stage_unavailable");
      const result = await response.json();
      if (result.state === "complete") return { state: "complete", calls, publication: "private_candidate" };
      // Continue only after a successful saved checkpoint, never after an error.
      if (result.state !== "partial") return { state: "stopped", calls };
  }
  return { state: "bounded", calls };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  dispatchFull(fullDispatchConfig(process.env))
    .then(result => { console.log(JSON.stringify(result)); if (result.state !== "complete") process.exitCode = 1; })
    .catch(() => { console.error("full_dispatch_failed"); process.exitCode = 1; });
