/**
 * CMO Brain — orchestrator.
 *
 * Runs all 6 layers in order, persisting each layer's output to the
 * marketing_cmo_runs row as it completes. If any layer throws, the row is
 * marked failed with the error captured.
 *
 * SPLIT-PHASE EXECUTION (added 2026-05):
 *
 * Layers 1-5 (sensors → analysts → research → strategist → simulator) and
 * Layer 6 (cmo synthesis + flattened plays) used to run inside a single
 * serverless invocation. The full pipeline routinely exceeds Vercel's
 * function timeout, leaving rows in status='running' with cmo/plays NULL.
 *
 * The pipeline is now split into two phases:
 *
 *   Phase 1 — runCMOBrainPhase1()
 *     Creates the run row, runs layers 1-5, persists each layer to DB.
 *     Returns immediately after the simulator (cheap, deterministic) finishes.
 *     Row is left status='running' with simulator IS NOT NULL.
 *
 *   Phase 2 — runCMOBrainPhase2(runId)
 *     Loads a partial run from DB, runs layer 6 (cmo synthesis), persists
 *     cmo + plays + final status='complete'.
 *     Idempotent: re-running on an already-complete row is a no-op.
 *
 * The HTTP endpoints chain them via fire-and-forget — Phase 1 returns to the
 * caller, then a background fetch kicks Phase 2 on a fresh invocation. A
 * safety-net cron also picks up any stuck partial rows every 5 minutes.
 *
 * runCMOBrain() is preserved as a convenience wrapper that runs both phases
 * in-process (only safe for short pipelines / local dev).
 */

import { getSupabaseService } from "@/app/api/_lib/supabaseService";
import { collectAllSensors } from "./sensors";
import { runAllAnalysts } from "./analysts";
import { runResearchers } from "./research";
import { runStrategist } from "./strategist";
import { runSimulator } from "./simulator";
import { runCMO, flattenPlays } from "./cmo";
import { newLedger, ledgerCostCents, type TokenLedger } from "./llm";
import type {
  CMORun,
  SensorBundle,
  AnalystOutput,
  SimulatorOutput,
} from "./types";

interface RunOptions {
  windowDays?: number;          // default 14
  source?: string;              // 'manual' | 'cron' | 'admin-ui'
}

export interface Phase1Result {
  id: number;
  phase: "phase1";
  status: "partial" | "failed";
  duration_ms: number;
  cost_usd_cents: number;
  error?: string;
}

export interface Phase2Result {
  id: number;
  phase: "phase2";
  status: "complete" | "failed" | "skipped";
  duration_ms: number;
  cost_usd_cents: number;
  error?: string;
  reason?: string;
}

export interface RunResult {
  id: number;
  status: "complete" | "failed";
  duration_ms: number;
  cost_usd_cents: number;
  error?: string;
}

function isoDays(daysAgo: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - daysAgo);
  return d.toISOString().slice(0, 10);
}

async function updateRow(
  id: number,
  patch: Partial<CMORun>
): Promise<void> {
  const supa = getSupabaseService();
  const { error } = await supa.from("marketing_cmo_runs").update(patch).eq("id", id);
  if (error) {
    console.error(`[cmo] failed to update run ${id}:`, error.message);
  }
}

async function snapshotLedger(id: number, ledger: TokenLedger): Promise<void> {
  await updateRow(id, {
    tokens_in: ledger.input,
    tokens_out: ledger.output,
    cost_usd_cents: ledgerCostCents(ledger),
  });
}

// ─── Phase 1 ──────────────────────────────────────────────────────────────
//
// Layers 1-5. Stops after the simulator. Leaves the row in status='running'
// with simulator IS NOT NULL so Phase 2 (or the safety-net cron) can pick
// it up.
export async function runCMOBrainPhase1(opts: RunOptions = {}): Promise<Phase1Result> {
  const windowDays = opts.windowDays ?? 14;
  const source = opts.source ?? "manual";
  const startedAt = new Date();
  const windowEnd = isoDays(0);
  const windowStart = isoDays(windowDays);

  const supa = getSupabaseService();
  const { data: created, error: insertErr } = await supa
    .from("marketing_cmo_runs")
    .insert({
      status: "running",
      source,
      window_start: windowStart,
      window_end: windowEnd,
      started_at: startedAt.toISOString(),
    })
    .select("id")
    .single();

  if (insertErr || !created) {
    throw new Error(`failed to create run row: ${insertErr?.message ?? "unknown"}`);
  }
  const id = created.id as number;

  const ledger = newLedger();
  console.log(`[cmo] run ${id} phase1 started — window ${windowStart} → ${windowEnd}`);

  try {
    console.log(`[cmo] run ${id}: layer 1 sensors`);
    const sensors = await collectAllSensors(windowStart, windowEnd);
    await updateRow(id, { sensors });

    console.log(`[cmo] run ${id}: layer 2 analysts`);
    const analysts = await runAllAnalysts(sensors, ledger);
    await updateRow(id, { analysts });
    await snapshotLedger(id, ledger);

    console.log(`[cmo] run ${id}: layer 3 research`);
    const research = await runResearchers(analysts, ledger);
    await updateRow(id, { research });
    await snapshotLedger(id, ledger);

    console.log(`[cmo] run ${id}: layer 4 strategist`);
    const strategist = await runStrategist(sensors, analysts, research, ledger);
    await updateRow(id, { strategist });
    await snapshotLedger(id, ledger);

    console.log(`[cmo] run ${id}: layer 5 simulator`);
    const simulator = runSimulator(sensors, strategist.plays);
    await updateRow(id, { simulator });
    await snapshotLedger(id, ledger);

    const duration_ms = Date.now() - startedAt.getTime();
    console.log(
      `[cmo] run ${id} phase1 done in ${duration_ms}ms — $${(ledgerCostCents(ledger) / 100).toFixed(2)} — ready for phase2`
    );
    return {
      id,
      phase: "phase1",
      status: "partial",
      duration_ms,
      cost_usd_cents: ledgerCostCents(ledger),
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const duration_ms = Date.now() - startedAt.getTime();
    await updateRow(id, {
      status: "failed",
      error: `phase1: ${msg}`,
      completed_at: new Date().toISOString(),
      duration_ms,
      tokens_in: ledger.input,
      tokens_out: ledger.output,
      cost_usd_cents: ledgerCostCents(ledger),
    });
    console.error(`[cmo] run ${id} phase1 failed:`, msg);
    return {
      id,
      phase: "phase1",
      status: "failed",
      duration_ms,
      cost_usd_cents: ledgerCostCents(ledger),
      error: msg,
    };
  }
}

// ─── Phase 2 ──────────────────────────────────────────────────────────────
//
// Layer 6 (cmo synthesis + flattened plays). Loads partial row from DB by id,
// runs synthesis, persists final state.
//
// Idempotent:
//   - If row.cmo IS NOT NULL → already complete, returns 'skipped'.
//   - If row.simulator IS NULL → phase 1 hasn't finished yet, returns 'skipped'.
//   - If row.status='failed' → returns 'skipped'.
export async function runCMOBrainPhase2(runId: number): Promise<Phase2Result> {
  const startedAt = new Date();
  const supa = getSupabaseService();

  const { data: row, error: fetchErr } = await supa
    .from("marketing_cmo_runs")
    .select(
      "id, status, sensors, analysts, simulator, cmo, started_at, tokens_in, tokens_out"
    )
    .eq("id", runId)
    .single<{
      id: number;
      status: string;
      sensors: SensorBundle | null;
      analysts: AnalystOutput[] | null;
      simulator: SimulatorOutput | null;
      cmo: unknown | null;
      started_at: string;
      tokens_in: number | null;
      tokens_out: number | null;
    }>();

  if (fetchErr || !row) {
    const msg = fetchErr?.message ?? "row not found";
    console.error(`[cmo] phase2 run ${runId} fetch failed:`, msg);
    return {
      id: runId,
      phase: "phase2",
      status: "failed",
      duration_ms: 0,
      cost_usd_cents: 0,
      error: msg,
    };
  }

  if (row.cmo !== null) {
    console.log(`[cmo] phase2 run ${runId} skipped — cmo already populated`);
    return {
      id: runId,
      phase: "phase2",
      status: "skipped",
      duration_ms: 0,
      cost_usd_cents: 0,
      reason: "already-complete",
    };
  }
  if (row.status === "failed") {
    console.log(`[cmo] phase2 run ${runId} skipped — row marked failed`);
    return {
      id: runId,
      phase: "phase2",
      status: "skipped",
      duration_ms: 0,
      cost_usd_cents: 0,
      reason: "row-failed",
    };
  }
  if (!row.sensors || !row.analysts || !row.simulator) {
    console.log(`[cmo] phase2 run ${runId} skipped — phase1 incomplete`);
    return {
      id: runId,
      phase: "phase2",
      status: "skipped",
      duration_ms: 0,
      cost_usd_cents: 0,
      reason: "phase1-incomplete",
    };
  }

  // Re-seed ledger with whatever phase1 spent so total tokens/cost remain
  // accurate across the whole run.
  const ledger: TokenLedger = {
    input: row.tokens_in ?? 0,
    output: row.tokens_out ?? 0,
  };
  const runStartedAt = new Date(row.started_at);

  try {
    console.log(`[cmo] run ${runId}: layer 6 cmo`);
    const cmo = await runCMO(row.sensors, row.analysts, row.simulator, ledger);
    const plays = flattenPlays(cmo);

    const completedAt = new Date();
    const duration_ms = completedAt.getTime() - runStartedAt.getTime();
    await updateRow(runId, {
      cmo,
      plays,
      status: "complete",
      completed_at: completedAt.toISOString(),
      duration_ms,
      tokens_in: ledger.input,
      tokens_out: ledger.output,
      cost_usd_cents: ledgerCostCents(ledger),
    });
    console.log(
      `[cmo] run ${runId} complete in ${duration_ms}ms — $${(ledgerCostCents(ledger) / 100).toFixed(2)}`
    );
    return {
      id: runId,
      phase: "phase2",
      status: "complete",
      duration_ms: completedAt.getTime() - startedAt.getTime(),
      cost_usd_cents: ledgerCostCents(ledger),
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const completedAt = new Date();
    const duration_ms = completedAt.getTime() - runStartedAt.getTime();
    await updateRow(runId, {
      status: "failed",
      error: `phase2: ${msg}`,
      completed_at: completedAt.toISOString(),
      duration_ms,
      tokens_in: ledger.input,
      tokens_out: ledger.output,
      cost_usd_cents: ledgerCostCents(ledger),
    });
    console.error(`[cmo] run ${runId} phase2 failed:`, msg);
    return {
      id: runId,
      phase: "phase2",
      status: "failed",
      duration_ms: completedAt.getTime() - startedAt.getTime(),
      cost_usd_cents: ledgerCostCents(ledger),
      error: msg,
    };
  }
}

// ─── Convenience: run both phases in one process ──────────────────────────
//
// Only safe when there is no function timeout (e.g. local dev) — kept for
// backwards compatibility and ad-hoc scripts. HTTP entry points should
// instead call runCMOBrainPhase1 + chain Phase2 via fire-and-forget.
export async function runCMOBrain(opts: RunOptions = {}): Promise<RunResult> {
  const p1 = await runCMOBrainPhase1(opts);
  if (p1.status === "failed") {
    return {
      id: p1.id,
      status: "failed",
      duration_ms: p1.duration_ms,
      cost_usd_cents: p1.cost_usd_cents,
      error: p1.error,
    };
  }
  const p2 = await runCMOBrainPhase2(p1.id);
  if (p2.status === "complete") {
    return {
      id: p1.id,
      status: "complete",
      duration_ms: p1.duration_ms + p2.duration_ms,
      cost_usd_cents: p2.cost_usd_cents,
    };
  }
  // p2 skipped/failed — surface the underlying state from the row instead of
  // inventing a status here.
  return {
    id: p1.id,
    status: p2.status === "failed" ? "failed" : "complete",
    duration_ms: p1.duration_ms + p2.duration_ms,
    cost_usd_cents: p2.cost_usd_cents,
    error: p2.error,
  };
}

// ─── Phase-chaining helper ────────────────────────────────────────────────
//
// Fires a POST to the synthesis endpoint without awaiting the response so
// the calling invocation can return immediately. Vercel keeps the outbound
// request alive long enough for the receiver to start a new invocation.
//
// We intentionally do NOT await — the receiver runs in a separate
// serverless function with its own timeout budget.
export function triggerPhase2Async(runId: number): void {
  const base =
    process.env.NEXT_PUBLIC_SITE_URL ??
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null);
  const secret = process.env.CRON_SECRET;
  if (!base || !secret) {
    console.warn(
      `[cmo] cannot trigger phase2 for run ${runId} — missing NEXT_PUBLIC_SITE_URL/VERCEL_URL or CRON_SECRET`
    );
    return;
  }
  const url = `${base}/api/admin/cmo/run-synthesis`;
  // Fire-and-forget. Catch but don't await.
  fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secret}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ runId }),
    cache: "no-store",
  })
    .then((r) => {
      console.log(`[cmo] phase2 trigger for run ${runId}: HTTP ${r.status}`);
    })
    .catch((err) => {
      console.error(`[cmo] phase2 trigger for run ${runId} failed:`, err);
    });
}
