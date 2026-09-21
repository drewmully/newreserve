/**
 * Supabase service-role client — server-side only.
 *
 * Reuses SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY env vars.
 * Never import from client code.
 */
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { assessCompletion, canCheckpoint, legacyOutcome, type CompletionEvidence, type RunOutcome } from "@/lib/analytics/outcomes";

let cached: SupabaseClient | null = null;

export function getSupabaseService(): SupabaseClient {
  if (cached) return cached;

  const url =
    process.env.SUPABASE_URL ||
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    "https://xnfjdbpjuaezxjgargto.supabase.co";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!key) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY missing. Required for service-role operations."
    );
  }

  cached = createClient(url, key, { auth: { persistSession: false } });
  return cached;
}

type JobContext = {
    runId: number;
    bumpRows: (rowsIn?: number, rowsOut?: number) => void;
    setWatermark: (w: string) => void;
    setMeta: (m: Record<string, unknown>) => void;
};
type AnalyticsJobContext = JobContext & {
    complete: (evidence: CompletionEvidence) => void;
    incomplete: (outcome: "missing_auth" | "partial" | "schema_drift") => void;
};
type JobResult<T> = { ok: true; runId: number; result: T } | { ok: false; runId: number; error: string };

/** Compatibility wrapper for existing operational jobs. A normal return is NOT
 * analytics completion evidence. Its watermark is operational, never certified.
 */
export function withJobRun<T>(jobName: string, fn: (ctx: JobContext) => Promise<T>): Promise<JobResult<T>> {
  return recordJobRun(jobName, fn, false);
}

/** Opt-in analytics wrapper. Only explicit completeness evidence can checkpoint.
 * A recorded incomplete outcome cannot be overwritten by a later complete call.
 */
export function withAnalyticsJobRun<T>(jobName: string, fn: (ctx: AnalyticsJobContext) => Promise<T>): Promise<JobResult<T>> {
  return recordJobRun(jobName, fn, true);
}

async function recordJobRun<T>(
  jobName: string, fn: (ctx: AnalyticsJobContext) => Promise<T>, strict: boolean,
): Promise<JobResult<T>> {
  const sb = getSupabaseService();
  const { data: started, error: startErr } = await sb
    .from("job_runs")
    .insert({ job_name: jobName, status: "running" })
    .select("id")
    .single();

  if (startErr || !started) {
    // Do not perform unlogged work when the start record cannot be persisted.
    throw new Error(`Failed to record job start for ${jobName}: ${startErr?.message ?? "unknown"}`);
  }

  const runId: number = started.id;
  let rowsIn = 0;
  let rowsOut = 0;
  let watermark: string | null = null;
  let meta: Record<string, unknown> = {};
  let outcome: RunOutcome | undefined;

  try {
    const result = await fn({
      runId,
      bumpRows: (inc = 0, outc = 0) => {
        rowsIn += inc;
        rowsOut += outc;
      },
      setWatermark: (w) => {
        watermark = w;
      },
      setMeta: (m) => {
        meta = { ...meta, ...m };
      },
      complete: (evidence) => {
        const assessed = assessCompletion(evidence);
        if (!outcome || canCheckpoint(outcome)) outcome = assessed;
        meta = { ...meta, completion_evidence: evidence };
      },
      incomplete: (value) => { outcome = value; },
    });
    // Never allow an operational job (or caller-supplied metadata) to claim
    // analytics completeness. Preserve its historical return/checkpoint behavior.
    outcome = strict ? outcome ?? legacyOutcome(result, meta) : "unverified";
    const incomplete = strict && !canCheckpoint(outcome);
    const { error: finishError } = await sb
      .from("job_runs")
      .update({
        status: incomplete ? "error" : "ok",
        finished_at: new Date().toISOString(),
        rows_in: rowsIn,
        rows_out: rowsOut,
        watermark: incomplete ? null : watermark,
        meta: { ...meta, completion_policy: strict ? "analytics" : "operational",
          analytics_outcome: outcome, analytics_checkpoint: strict && !incomplete ? watermark : null,
          watermark_scope: strict ? "analytics" : "operational" },
        error: incomplete ? `Run not certified: ${outcome}` : null,
      })
      .eq("id", runId);
    if (finishError) throw new Error("Failed to persist job completion");
    if (incomplete) return { ok: false, runId, error: `Run not certified: ${outcome}` };
    return { ok: true, runId, result };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const { error: failureLogError } = await sb
      .from("job_runs")
      .update({
        status: "error",
        finished_at: new Date().toISOString(),
        rows_in: rowsIn,
        rows_out: rowsOut,
        watermark: null,
        meta: { ...meta, completion_policy: strict ? "analytics" : "operational",
          analytics_outcome: "failed", analytics_checkpoint: null,
          watermark_scope: strict ? "analytics" : "operational" },
        error: message,
      })
      .eq("id", runId);
    if (failureLogError) throw new Error("Job failed and failure status could not be persisted");
    return { ok: false, runId, error: message };
  }
}
