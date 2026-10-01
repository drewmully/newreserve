/** Default-off production supervisor. No database credential, source inventory,
 * registration, publication, or scheduling side effect exists in this module. */
import { pathToFileURL } from "node:url";
import { dispatchConfig, parsePipelineHealth, readPipelineJson, runDispatch } from "./dispatch-pipeline.mjs";

const productionOrigin = "https://www.mymully.com/";
const productionProject = "xnfjdbpjuaezxjgargto";
const maxWindowMs = 7 * 24 * 60 * 60 * 1000;
function instant(value) {
  if (typeof value !== "string" ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value))
    throw new Error("invalid_schedule_window");
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !==
      (value.length === 20 ? value.replace("Z", ".000Z") : value))
    throw new Error("invalid_schedule_window");
  return parsed;
}

/** The external operator owns activation and dates. These checks limit an
 * invocation; they do not establish source permission or verify server config. */
export function scheduledPipelineConfig(env, now = Date.now()) {
  if (env.LEAN_ANALYTICS_SCHEDULE_ENABLED !== "true") return { state: "disabled" };
  if (!Number.isFinite(now)) throw new Error("invalid_schedule_clock");
  const mode = env.LEAN_ANALYTICS_SCHEDULE_MODE || "bounded";
  if (!["bounded", "continuous"].includes(mode)) throw new Error("invalid_schedule_mode");
  let remaining = 180;
  if (mode === "continuous") {
    // A distinct standing-operation opt-in, never an implicit extension of a trial.
    if (env.LEAN_ANALYTICS_SCHEDULE_START_AT || env.LEAN_ANALYTICS_SCHEDULE_STOP_AT)
      throw new Error("continuous_schedule_has_trial_dates");
  } else {
    const start = instant(env.LEAN_ANALYTICS_SCHEDULE_START_AT);
    const stop = instant(env.LEAN_ANALYTICS_SCHEDULE_STOP_AT);
    if (stop <= start || stop - start > maxWindowMs) throw new Error("invalid_schedule_window");
    if (now < start) return { state: "not_started" };
    // Floor the remaining time: never start a request in the last partial second.
    remaining = Math.floor((stop - now) / 1000);
    if (remaining < 1) return { state: "expired" };
  }
  if (new URL(env.LEAN_ANALYTICS_RUNNER_ORIGIN).href !== productionOrigin ||
      env.LEAN_ANALYTICS_PIPELINE_PROJECT_REF !== productionProject ||
      env.LEAN_ANALYTICS_SUPABASE_URL !== `https://${productionProject}.supabase.co`)
    throw new Error("invalid_schedule_target");
  const config = dispatchConfig({
    ...env,
    // Require the existing opt-in too; the schedule switch cannot bypass it.
    LEAN_ANALYTICS_DISPATCH_MAX_CALLS: "2",
    LEAN_ANALYTICS_DISPATCH_INTERVAL_SECONDS: "60",
    LEAN_ANALYTICS_DISPATCH_DEADLINE_SECONDS: String(Math.min(180, remaining)),
  });
  return { state: "ready", config, mode };
}

/** @param {Record<string, string | undefined>} env
 * @param {{fetcher?: typeof fetch, now?: () => number, signal?: AbortSignal}} options */
export async function runScheduledPipeline(env, { fetcher = fetch, now = Date.now, signal } = {}) {
  const admittedAt = now();
  const prepared = scheduledPipelineConfig(env, admittedAt);
  if (prepared.state !== "ready") return { state: prepared.state, calls: 0 };
  // One admission-time abort deadline covers preflight, POST and final health.
  // Passing the admission clock alone cannot abort an already in-flight fetch.
  const deadline = AbortSignal.timeout(prepared.config.deadlineSeconds * 1000);
  const active = AbortSignal.any([deadline, ...(signal ? [signal] : [])]);
  let health;
  let preflightCalls = 0;
  if (prepared.mode === "continuous") {
    if (signal?.aborted) return { state: "cancelled", calls: 0 };
    try {
      preflightCalls = 1;
      const preflightSignal = AbortSignal.any([AbortSignal.timeout(95000), active]);
      const response = await fetcher(prepared.config.url, {
        method: "GET", redirect: "error",
        headers: { authorization: `Bearer ${prepared.config.secret}` },
        signal: preflightSignal,
      });
      if (!response.ok) throw new Error("health_unavailable");
      const data = parsePipelineHealth(await readPipelineJson(response, preflightSignal));
      if (data.enabled !== true) return { state: "scope_disabled", calls: 1 };
      health = { healthy: data.dead === 0 && data.expiredLeases === 0 &&
        data.oldestPendingSeconds < 900, pending: data.pending,
        dead: data.dead, oldestPendingSeconds: data.oldestPendingSeconds };
      // Normal idle production is not a failed test and must not hydrate a source.
      if (data.pending === 0 && data.expiredLeases === 0)
        return { state: health.healthy ? "idle" : "unhealthy", calls: 1, health,
          financialAdmission: { phase: "idle", health: data } };
      // Known backlog/dead-letter warnings remain visible, but must not freeze
      // unrelated eligible work. Existing SQL owns capped retry/expired-lease
      // recovery; this invocation still advances at most one saved receipt.
    } catch {
      return { state: signal?.aborted ? "cancelled" : deadline.aborted ? "deadline" : "health_unavailable", calls: preflightCalls };
    }
  }
  let firstClockRead = true;
  // Charge setup time to the existing dispatch deadline rather than moving its
  // start forward between schedule admission and the first network request.
  const dispatchClock = () => {
    if (firstClockRead) { firstClockRead = false; return admittedAt; }
    return now();
  };
  let completedCycle;
  const result = await runDispatch(prepared.config, {
    fetcher, now: dispatchClock, signal: active, onResult: value => { health = value; },
    onCompletedCycle: value => { completedCycle = value; },
  });
  // "complete" means only that this bounded invocation ended successfully.
  // It is not proof of a new source event, complete coverage or published reports.
  return { ...result, ...(deadline.aborted && !signal?.aborted ? { state: "deadline" } : {}),
    calls: result.calls + preflightCalls, ...(health ? { health } : {}),
    ...(prepared.mode === "continuous" && completedCycle
      ? { financialAdmission: { phase: "post_cycle", ...completedCycle } } : {}) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const stop = new AbortController();
  process.once("SIGTERM", () => stop.abort());
  process.once("SIGINT", () => stop.abort());
  try {
    const result = await runScheduledPipeline(process.env, { signal: stop.signal });
    console.log(JSON.stringify({ event: "analytics_scheduled_invocation", ...result }));
    if (!["disabled", "not_started", "expired", "idle", "complete"].includes(result.state))
      process.exitCode = 1;
  } catch {
    console.error("analytics_scheduled_configuration_failed");
    process.exitCode = 1;
  }
}
