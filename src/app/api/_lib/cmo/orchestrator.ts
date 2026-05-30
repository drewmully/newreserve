/**
 * CMO Brain — orchestrator.
 *
 * Runs all 6 layers in order, persisting each layer's output to the
 * marketing_cmo_runs row as it completes. If any layer throws, the row is
 * marked failed with the error captured.
 */

import { getSupabaseService } from "@/app/api/_lib/supabaseService";
import { collectAllSensors } from "./sensors";
import { runAllAnalysts } from "./analysts";
import { runResearchers } from "./research";
import { runStrategist } from "./strategist";
import { runSimulator } from "./simulator";
import { runCMO, flattenPlays } from "./cmo";
import { newLedger, ledgerCostCents, type TokenLedger } from "./llm";
import type { CMORun } from "./types";

interface RunOptions {
  windowDays?: number;          // default 14
  source?: string;              // 'manual' | 'cron' | 'admin-ui'
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

export async function runCMOBrain(opts: RunOptions = {}): Promise<RunResult> {
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
  console.log(`[cmo] run ${id} started — window ${windowStart} → ${windowEnd}`);

  try {
    // Layer 1 — Sensors
    console.log(`[cmo] run ${id}: layer 1 sensors`);
    const sensors = await collectAllSensors(windowStart, windowEnd);
    await updateRow(id, { sensors });

    // Layer 2 — Analysts
    console.log(`[cmo] run ${id}: layer 2 analysts`);
    const analysts = await runAllAnalysts(sensors, ledger);
    await updateRow(id, { analysts });
    await snapshotLedger(id, ledger);

    // Layer 3 — Researchers
    console.log(`[cmo] run ${id}: layer 3 research`);
    const research = await runResearchers(analysts, ledger);
    await updateRow(id, { research });
    await snapshotLedger(id, ledger);

    // Layer 4 — Strategist
    console.log(`[cmo] run ${id}: layer 4 strategist`);
    const strategist = await runStrategist(sensors, analysts, research, ledger);
    await updateRow(id, { strategist });
    await snapshotLedger(id, ledger);

    // Layer 5 — Simulator (deterministic)
    console.log(`[cmo] run ${id}: layer 5 simulator`);
    const simulator = runSimulator(sensors, strategist.plays);
    await updateRow(id, { simulator });

    // Layer 6 — CMO synthesis
    console.log(`[cmo] run ${id}: layer 6 cmo`);
    const cmo = await runCMO(sensors, analysts, simulator, ledger);
    const plays = flattenPlays(cmo);

    const completedAt = new Date();
    const duration_ms = completedAt.getTime() - startedAt.getTime();
    await updateRow(id, {
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
      `[cmo] run ${id} complete in ${duration_ms}ms — $${(ledgerCostCents(ledger) / 100).toFixed(2)}`
    );
    return {
      id,
      status: "complete",
      duration_ms,
      cost_usd_cents: ledgerCostCents(ledger),
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const completedAt = new Date();
    const duration_ms = completedAt.getTime() - startedAt.getTime();
    await updateRow(id, {
      status: "failed",
      error: msg,
      completed_at: completedAt.toISOString(),
      duration_ms,
      tokens_in: ledger.input,
      tokens_out: ledger.output,
      cost_usd_cents: ledgerCostCents(ledger),
    });
    console.error(`[cmo] run ${id} failed:`, msg);
    return {
      id,
      status: "failed",
      duration_ms,
      cost_usd_cents: ledgerCostCents(ledger),
      error: msg,
    };
  }
}
