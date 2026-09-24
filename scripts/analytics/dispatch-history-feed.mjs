/** Explicit invocation only. No scheduler, source approval, or deployment.
 * Each call can consume one bounded Shopify page; stop on ambiguous response. */
import { pathToFileURL } from "node:url";
export function historyDispatchConfig(env) {
  if (env.LEAN_ANALYTICS_HISTORY_DISPATCH_ENABLED !== "true") throw new Error("history_dispatch_disabled");
  const origin = new URL(env.LEAN_ANALYTICS_RUNNER_ORIGIN);
  if (origin.protocol !== "https:" || origin.username || origin.password ||
    origin.pathname !== "/" || origin.search || origin.hash) throw new Error("invalid_runner_origin");
  const secret = env.LEAN_ANALYTICS_HISTORY_FEED_SECRET ?? "";
  const maxCalls = Number(env.LEAN_ANALYTICS_HISTORY_MAX_CALLS ?? "5");
  if (secret.length < 32 || !Number.isInteger(maxCalls) || maxCalls < 1 || maxCalls > 128)
    throw new Error("invalid_history_dispatch_budget_or_secret");
  return { origin: origin.href, secret, maxCalls };
}
export async function dispatchHistoryFeed(config, request = fetch) {
  for (let calls = 1; calls <= config.maxCalls; calls++) {
    const response = await request(new URL("/api/analytics/ingest/history-feed", config.origin), {
      method: "POST", redirect: "error", headers: { authorization: `Bearer ${config.secret}` },
      signal: AbortSignal.timeout(95000),
    });
    if (!response.ok) throw new Error("history_feed_unavailable");
    const result = await response.json();
    if (["complete", "caught_up"].includes(result.state)) return { state: result.state, calls };
    if (result.state !== "partial") return { state: "stopped", calls };
  }
  return { state: "bounded", calls: config.maxCalls };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const result = await dispatchHistoryFeed(historyDispatchConfig(process.env));
    console.log(JSON.stringify(result));
    if (!["complete", "caught_up"].includes(result.state)) process.exitCode = 1;
  } catch { console.error("history_dispatch_failed"); process.exitCode = 1; }
}
