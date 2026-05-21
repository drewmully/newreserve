/**
 * Supabase service-role client — server-side only.
 *
 * Reuses SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY env vars.
 * Never import from client code.
 */
import { createClient, SupabaseClient } from "@supabase/supabase-js";

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

/**
 * Wrap a cron / ingestion job with structured logging to public.job_runs.
 * Always returns the wrapped result; never swallows errors silently.
 */
export async function withJobRun<T>(
  jobName: string,
  fn: (ctx: {
    runId: number;
    bumpRows: (rowsIn?: number, rowsOut?: number) => void;
    setWatermark: (w: string) => void;
    setMeta: (m: Record<string, unknown>) => void;
  }) => Promise<T>
): Promise<{ ok: true; runId: number; result: T } | { ok: false; runId: number; error: string }> {
  const sb = getSupabaseService();
  const { data: started, error: startErr } = await sb
    .from("job_runs")
    .insert({ job_name: jobName, status: "running" })
    .select("id")
    .single();

  if (startErr || !started) {
    // job_runs is itself broken — fail loudly but still try the work
    throw new Error(`Failed to record job start for ${jobName}: ${startErr?.message ?? "unknown"}`);
  }

  const runId: number = started.id;
  let rowsIn = 0;
  let rowsOut = 0;
  let watermark: string | null = null;
  let meta: Record<string, unknown> = {};

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
    });

    await sb
      .from("job_runs")
      .update({
        status: "ok",
        finished_at: new Date().toISOString(),
        rows_in: rowsIn,
        rows_out: rowsOut,
        watermark,
        meta,
      })
      .eq("id", runId);

    return { ok: true, runId, result };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await sb
      .from("job_runs")
      .update({
        status: "error",
        finished_at: new Date().toISOString(),
        rows_in: rowsIn,
        rows_out: rowsOut,
        watermark,
        meta,
        error: message,
      })
      .eq("id", runId);
    return { ok: false, runId, error: message };
  }
}
