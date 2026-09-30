/** One bounded dispatch to an existing owner-registered subscription plan.
 * No Loop token, database credential, registration or retry authority. */
import { pathToFileURL } from "node:url";

function instant(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value))
    throw new Error("subscription_schedule_window");
  const time = Date.parse(value);
  if (!Number.isFinite(time) || new Date(time).toISOString() !== value)
    throw new Error("subscription_schedule_window");
  return time;
}

/** @param {Record<string, string | undefined>} env
 * @param {{fetcher?: typeof fetch, now?: () => number, signal?: AbortSignal}} options */
export async function runScheduledSubscriptions(env, { fetcher = fetch, now = Date.now, signal } = {}) {
  if (env.LEAN_SUBSCRIPTIONS_SCHEDULE_ENABLED !== "true" ||
      env.LEAN_SUBSCRIPTIONS_DISPATCH_ENABLED !== "true") return { state: "disabled", calls: 0 };
  const start = instant(env.LEAN_SUBSCRIPTIONS_SCHEDULE_START_AT);
  const stop = instant(env.LEAN_SUBSCRIPTIONS_SCHEDULE_STOP_AT);
  if (stop <= start || stop - start > 7 * 86400000) throw new Error("subscription_schedule_window");
  const clock = now();
  if (!Number.isFinite(clock)) throw new Error("subscription_schedule_clock");
  if (clock < start) return { state: "not_started", calls: 0 };
  // Do not begin a dispatch with less than one second left in the approved window.
  const remaining = Math.floor((stop - clock) / 1000);
  if (remaining < 1) return { state: "expired", calls: 0 };
  if (env.LEAN_ANALYTICS_RUNNER_ORIGIN !== "https://www.mymully.com" ||
      env.LEAN_ANALYTICS_PIPELINE_PROJECT_REF !== "xnfjdbpjuaezxjgargto")
    throw new Error("subscription_schedule_target");
  const secret = env.LEAN_ANALYTICS_SUBSCRIPTIONS_SECRET;
  if (typeof secret !== "string" || secret.length < 32 || secret.length > 512 || /[\s\x00-\x1f\x7f]/.test(secret))
    throw new Error("subscription_schedule_secret");
  if (signal?.aborted) return { state: "cancelled", calls: 0 };
  let response;
  try {
    response = await fetcher("https://www.mymully.com/api/analytics/subscriptions/process", {
      method: "POST", redirect: "error",
      headers: { authorization: `Bearer ${secret}` },
      signal: AbortSignal.any([AbortSignal.timeout(Math.min(90000, remaining * 1000)), ...(signal ? [signal] : [])]),
    });
    if (!response.ok || response.redirected || !response.body) throw new Error();
    const reader = response.body.getReader();
    const chunks = [];
    let bytes = 0;
    try {
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) break;
        bytes += chunk.value.byteLength;
        if (bytes > 1024) throw new Error();
        chunks.push(Buffer.from(chunk.value));
      }
    } finally { await reader.cancel().catch(() => {}); }
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!body || typeof body !== "object" || Array.isArray(body) ||
        Object.keys(body).length !== 1 || typeof body.state !== "string" ||
        !["observation_saved", "waiting", "busy", "completed", "complete", "disabled",
          "expired", "halted", "failed", "lost_lease", "attempts_exhausted"].includes(body.state))
      throw new Error();
    return { state: body.state, calls: 1 };
  } catch {
    void response?.body?.cancel().catch(() => {});
    // A missing response may follow a committed page. Never retry this POST.
    return { state: signal?.aborted ? "cancelled" : "unavailable", calls: 1 };
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const stop = new AbortController();
  process.once("SIGTERM", () => stop.abort());
  process.once("SIGINT", () => stop.abort());
  try {
    const result = await runScheduledSubscriptions(process.env, { signal: stop.signal });
    console.log(JSON.stringify({ event: "analytics_subscription_dispatch", ...result }));
    if (!["disabled", "not_started", "expired", "waiting", "busy", "completed", "complete", "observation_saved"].includes(result.state))
      process.exitCode = 1;
  } catch {
    console.error("analytics_subscription_configuration_failed");
    process.exitCode = 1;
  }
}
