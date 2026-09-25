/** Opt-in health + alert transport. No schedule is installed. The configured
 * destination must be separately approved. Sends at most one alert per call,
 * never retries a possibly delivered alert, and never sends raw response data.
 * Repeated unhealthy invocations can repeat alerts; this is not exactly-once. */
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
function httpsUrl(value, originOnly = false) {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || url.hash ||
    (originOnly && (url.pathname !== "/" || url.search))) throw new Error("invalid_monitor_url");
  return url;
}
export function monitorConfig(env) {
  if (env.LEAN_ANALYTICS_MONITOR_DISPATCH_ENABLED !== "true") throw new Error("monitor_dispatch_disabled");
  const origin = httpsUrl(env.LEAN_ANALYTICS_RUNNER_ORIGIN, true).href;
  const secret = env.LEAN_ANALYTICS_MONITOR_SECRET ?? "";
  if (secret.length < 32) throw new Error("monitor_secret_required");
  let alertUrl;
  if (env.LEAN_ANALYTICS_ALERT_ENABLED === "true") {
    if (!env.LEAN_ANALYTICS_ALERT_APPROVAL_REF?.trim()) throw new Error("alert_approval_required");
    alertUrl = httpsUrl(env.LEAN_ANALYTICS_ALERT_WEBHOOK_URL).href;
  }
  return { origin, secret, alertUrl };
}
async function boundedResponse(response) {
  const reader = response.body?.getReader(); if (!reader) throw new Error("empty_monitor_response");
  const parts = []; let bytes = 0;
  try {
    for (;;) {
      const part = await reader.read(); if (part.done) break;
      bytes += part.value.length;
      if (bytes > 16384) { await reader.cancel(); throw new Error("monitor_response_budget"); }
      parts.push(part.value);
    }
  } finally { reader.releaseLock(); }
  return JSON.parse(Buffer.concat(parts).toString("utf8"));
}
export async function monitorRefresh(config, request = fetch) {
  let state = "unavailable", issues = ["monitor_unavailable"];
  try {
    const response = await request(new URL("/api/analytics/ingest/health", config.origin), {
      method: "GET", redirect: "error", headers: { authorization: `Bearer ${config.secret}` },
      signal: AbortSignal.timeout(20000),
    });
    if (![200, 503].includes(response.status)) throw new Error("monitor_http");
    const result = await boundedResponse(response);
    if (!["healthy", "attention", "disabled", "unconfigured", "unavailable"].includes(result.state) ||
      !Array.isArray(result.issues) || result.issues.length > 100 ||
      result.issues.some(i => typeof i !== "string" || !/^[a-z_]+(?::(?:store_daily|product_daily|acquisition_daily|customer_cohorts|funnel_daily))?$/.test(i)) ||
      (result.state === "healthy" && (response.status !== 200 || result.issues.length)))
      throw new Error("monitor_invalid_response");
    state = result.state; issues = [...new Set(result.issues)].sort();
  } catch { /* Deliberately do not forward transport errors, URLs or bodies. */ }
  const fingerprint = createHash("sha256").update(JSON.stringify({ state, issues })).digest("hex");
  let alerted = false;
  if (state !== "healthy" && config.alertUrl) {
    const response = await request(config.alertUrl, {
      method: "POST", redirect: "error", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: `MyMully lean analytics: ${state}. Checks: ${issues.join(", ")}. Diagnostic: ${fingerprint}` }),
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) throw new Error("alert_delivery_unconfirmed");
    alerted = true;
  }
  return { state, issues, fingerprint, alerted, posthogReadbackVerified: false };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const result = await monitorRefresh(monitorConfig(process.env));
    console.log(JSON.stringify(result));
    if (result.state !== "healthy") process.exitCode = 1;
  } catch { console.error("monitor_or_alert_unconfirmed"); process.exitCode = 1; }
}
