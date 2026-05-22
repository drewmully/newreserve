/**
 * GET /api/admin/cron/subscribers-rebuild
 *
 * RESUMABLE rebuild of the `subscribers` table from Shopify customer tags.
 * Designed to fit inside Vercel's 800s function limit by splitting work
 * across multiple invocations and persisting progress in `cron_state`.
 *
 * Loop is the system of record for subscription state; it syncs state to
 * Shopify via customer tags. Plan code is derived from `subscription_plan_map`.
 *
 * UPSERT on customer_id, overwriting ONLY the tag-derived columns:
 *   status, plan_code, shopify_customer_gid, tags_raw, is_past_due,
 *   is_card_declined, email, name, total_orders, total_spent,
 *   shopify_synced_at, updated_at, acquired_at, churned_at, paused_at.
 *
 * Loop-API-only columns are preserved untouched.
 *
 * Phases (persisted in cron_state.phase):
 *   idle      -> no run in progress. Hitting the endpoint moves to `polling`
 *                after starting a Shopify bulk op.
 *   polling   -> Shopify bulk op is running/created. Each invocation polls;
 *                when COMPLETED, transitions to `streaming`.
 *   streaming -> JSONL is ready. Each invocation streams from
 *                offset_processed for up to ~600s, then saves progress and
 *                returns. Re-invoke until offset_processed >= total_count.
 *                Then transitions back to `idle`.
 *
 * Query params:
 *   ?reset=1   -> wipe cron_state row (use when stuck).
 *
 * Auth: CRON_SECRET Bearer.
 */

import { NextRequest, NextResponse } from "next/server";
import { getSupabaseService, withJobRun } from "@/app/api/_lib/supabaseService";
import { startBulkQuery, pollBulkOperation } from "@/app/api/_lib/shopifyBulkAsync";

export const runtime = "nodejs";
export const maxDuration = 800;

const JOB = "subscribers-rebuild";
// Stop streaming and save progress when this much time has elapsed in the
// current invocation. 600s leaves headroom for Postgres writes + response.
const STREAM_BUDGET_MS = 600_000;
const UPSERT_BATCH = 500;

function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

const BULK_CUSTOMERS_QUERY = `
{
  customers {
    edges {
      node {
        id
        email
        firstName
        lastName
        tags
        createdAt
        updatedAt
        numberOfOrders
        amountSpent { amount }
      }
    }
  }
}
`.trim();

interface ShopifyCustomerNode {
  id: string;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
  tags: string[];
  createdAt: string;
  updatedAt: string;
  numberOfOrders: string;
  amountSpent: { amount: string } | null;
}

interface PlanMapRow {
  tag: string;
  plan_code: string;
  plan_label: string;
}

interface CronStateRow {
  job_name: string;
  phase: "idle" | "polling" | "streaming";
  bulk_op_id: string | null;
  jsonl_url: string | null;
  total_count: number | null;
  offset_processed: number;
  meta: Record<string, unknown> | null;
  started_at: string | null;
  updated_at: string | null;
}

function deriveStatus(tags: string[]): {
  status: string;
  isPastDue: boolean;
  isCardDeclined: boolean;
} {
  const has = (t: string) => tags.includes(t);
  const isPastDue = has("Past Due Subscriber");
  const isCardDeclined = has("Subscription card declined");
  if (has("Active Subscriber")) return { status: "active", isPastDue, isCardDeclined };
  if (has("Paused Subscriber")) return { status: "paused", isPastDue, isCardDeclined };
  if (isPastDue) return { status: "past_due", isPastDue, isCardDeclined };
  if (has("Inactive Subscriber")) return { status: "inactive", isPastDue, isCardDeclined };
  return { status: "never", isPastDue, isCardDeclined };
}

function derivePlanCode(tags: string[], planMap: PlanMapRow[]): string | null {
  for (const row of planMap) {
    if (tags.includes(row.tag)) return row.plan_code;
  }
  return null;
}

function customerIdFromGid(gid: string): string {
  const m = gid.match(/Customer\/(\d+)$/);
  return m ? m[1] : gid;
}

// ---- cron_state helpers --------------------------------------------------

async function loadState(): Promise<CronStateRow> {
  const sb = getSupabaseService();
  const { data, error } = await sb
    .from("cron_state")
    .select("*")
    .eq("job_name", JOB)
    .maybeSingle();
  if (error) throw new Error(`cron_state load: ${error.message}`);
  if (!data) {
    return {
      job_name: JOB,
      phase: "idle",
      bulk_op_id: null,
      jsonl_url: null,
      total_count: null,
      offset_processed: 0,
      meta: null,
      started_at: null,
      updated_at: null,
    };
  }
  return data as CronStateRow;
}

async function saveState(patch: Partial<CronStateRow>): Promise<void> {
  const sb = getSupabaseService();
  const row = {
    job_name: JOB,
    ...patch,
    updated_at: new Date().toISOString(),
  };
  const { error } = await sb.from("cron_state").upsert(row, { onConflict: "job_name" });
  if (error) throw new Error(`cron_state save: ${error.message}`);
}

async function resetState(): Promise<void> {
  const sb = getSupabaseService();
  await sb.from("cron_state").delete().eq("job_name", JOB);
}

// ---- handler -------------------------------------------------------------

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  if (url.searchParams.get("reset") === "1") {
    await resetState();
    return NextResponse.json({ ok: true, reset: true });
  }

  const result = await withJobRun(JOB, async ({ bumpRows, setMeta, setWatermark }) => {
    const sb = getSupabaseService();
    let state = await loadState();

    // ---- Phase: idle -> start a bulk op ----
    if (state.phase === "idle") {
      const started = await startBulkQuery(BULK_CUSTOMERS_QUERY);
      await saveState({
        phase: "polling",
        bulk_op_id: started.operationId,
        jsonl_url: null,
        total_count: null,
        offset_processed: 0,
        meta: { started_status: started.status },
        started_at: new Date().toISOString(),
      });
      setWatermark(started.operationId);
      setMeta({ phase: "polling", bulk_op_id: started.operationId });
      return {
        phase: "polling",
        bulk_op_id: started.operationId,
        note: "Bulk op kicked off. Re-invoke to poll & stream.",
      };
    }

    // ---- Phase: polling -> wait (up to STREAM_BUDGET_MS) for COMPLETED ----
    if (state.phase === "polling") {
      if (!state.bulk_op_id) {
        await resetState();
        throw new Error("polling phase with no bulk_op_id; state reset");
      }
      const deadline = Date.now() + STREAM_BUDGET_MS;
      let last = await pollBulkOperation(state.bulk_op_id);
      while (
        (last.status === "CREATED" || last.status === "RUNNING") &&
        Date.now() < deadline
      ) {
        await new Promise((r) => setTimeout(r, 5_000));
        last = await pollBulkOperation(state.bulk_op_id);
      }

      if (last.status === "COMPLETED") {
        const jsonlUrl = last.url || last.partialDataUrl || "";
        const total = Number(last.objectCount ?? "0");
        await saveState({
          phase: "streaming",
          jsonl_url: jsonlUrl,
          total_count: total,
          offset_processed: 0,
          meta: { ...(state.meta || {}), object_count: total },
        });
        // Fall through to streaming path within this same invocation.
        state = await loadState();
      } else if (
        last.status === "FAILED" ||
        last.status === "CANCELED" ||
        last.status === "EXPIRED"
      ) {
        await resetState();
        throw new Error(
          `Bulk op ${state.bulk_op_id} ended ${last.status}; state reset (re-run to start fresh).`,
        );
      } else {
        setMeta({ phase: "polling", bulk_op_id: state.bulk_op_id, last_status: last.status });
        return {
          phase: "polling",
          bulk_op_id: state.bulk_op_id,
          last_status: last.status,
          note: "Still running on Shopify side. Re-invoke to keep polling.",
        };
      }
    }

    // ---- Phase: streaming -> consume slice of JSONL, upsert, save offset ----
    if (state.phase === "streaming") {
      if (!state.jsonl_url) {
        await resetState();
        throw new Error("streaming phase with no jsonl_url; state reset");
      }

      // Load plan_map + prior status snapshot once per invocation.
      const { data: planMap, error: planErr } = await sb
        .from("subscription_plan_map")
        .select("tag, plan_code, plan_label")
        .eq("is_active", true);
      if (planErr) throw new Error(`plan_map load: ${planErr.message}`);

      const { data: priorRows } = await sb
        .from("subscribers")
        .select("customer_id, status, acquired_at, churned_at, paused_at");
      const prior = new Map<
        string,
        {
          status: string;
          acquired_at: string | null;
          churned_at: string | null;
          paused_at: string | null;
        }
      >();
      for (const row of priorRows || []) {
        prior.set(row.customer_id, {
          status: row.status,
          acquired_at: row.acquired_at,
          churned_at: row.churned_at,
          paused_at: row.paused_at,
        });
      }

      const start = state.offset_processed;
      const deadline = Date.now() + STREAM_BUDGET_MS;
      const now = new Date().toISOString();

      // Stream JSONL directly with a fetch+reader so we can skip until start
      // and bail when we hit our soft deadline.
      const res = await fetch(state.jsonl_url);
      if (!res.ok || !res.body) {
        throw new Error(`JSONL fetch failed ${res.status}: ${state.jsonl_url}`);
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let seen = 0;
      let processed = 0;
      let buf: Array<Record<string, unknown>> = [];
      let totalWritten = 0;
      let newSubs = 0;
      let churned = 0;
      let paused = 0;

      async function flush() {
        if (buf.length === 0) return;
        const { error } = await sb
          .from("subscribers")
          .upsert(buf, { onConflict: "customer_id" });
        if (error)
          throw new Error(`subscribers upsert batch (n=${buf.length}): ${error.message}`);
        totalWritten += buf.length;
        buf = [];
      }

      function processNode(node: ShopifyCustomerNode) {
        const customerId = customerIdFromGid(node.id);
        const { status, isPastDue, isCardDeclined } = deriveStatus(node.tags);
        const planCode = derivePlanCode(node.tags, (planMap as PlanMapRow[]) || []);
        const priorRow = prior.get(customerId);
        let acquired_at: string | null = priorRow?.acquired_at ?? null;
        let churned_at: string | null = priorRow?.churned_at ?? null;
        let paused_at: string | null = priorRow?.paused_at ?? null;

        const wasActive = priorRow?.status === "active";
        const isActive = status === "active";
        if (isActive && !acquired_at) {
          acquired_at = now;
          if (!priorRow) newSubs++;
        }
        if (!isActive && wasActive) {
          churned_at = now;
          churned++;
        }
        if (status === "paused" && priorRow?.status !== "paused") {
          paused_at = now;
          paused++;
        }

        buf.push({
          customer_id: customerId,
          email: node.email,
          name: [node.firstName, node.lastName].filter(Boolean).join(" ") || null,
          status,
          plan_code: planCode,
          shopify_customer_gid: node.id,
          tags_raw: node.tags,
          is_past_due: isPastDue,
          is_card_declined: isCardDeclined,
          total_orders: node.numberOfOrders ? Number(node.numberOfOrders) : null,
          total_spent: node.amountSpent ? Number(node.amountSpent.amount) : null,
          shopify_synced_at: now,
          updated_at: now,
          acquired_at,
          churned_at,
          paused_at,
        });
      }

      let timedOut = false;
      outer: while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let nl: number;
        while ((nl = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, nl).trim();
          buffer = buffer.slice(nl + 1);
          if (!line) continue;
          if (seen < start) {
            seen++;
            continue; // skip until offset
          }
          try {
            const record = JSON.parse(line) as ShopifyCustomerNode;
            processNode(record);
            processed++;
          } catch (err) {
            console.error("[subscribers-rebuild] JSONL parse error:", line.slice(0, 200), err);
          }
          seen++;
          if (buf.length >= UPSERT_BATCH) await flush();
          if (Date.now() > deadline) {
            timedOut = true;
            break outer;
          }
        }
      }
      // Drain remaining buffer only if we didn't time out
      if (!timedOut) {
        const tail = buffer.trim();
        if (tail) {
          if (seen >= start) {
            try {
              const record = JSON.parse(tail) as ShopifyCustomerNode;
              processNode(record);
              processed++;
            } catch (err) {
              console.error(
                "[subscribers-rebuild] JSONL tail parse error:",
                tail.slice(0, 200),
                err,
              );
            }
          }
          seen++;
        }
        // Best-effort cancel the stream so the connection releases.
        try {
          await reader.cancel();
        } catch {
          /* ignore */
        }
      } else {
        try {
          await reader.cancel();
        } catch {
          /* ignore */
        }
      }
      await flush();

      const newOffset = start + processed;
      const total = state.total_count ?? null;
      const done = !timedOut && (total == null || newOffset >= total);

      bumpRows(processed, totalWritten);
      setMeta({
        phase: done ? "done" : "streaming",
        processed_this_invocation: processed,
        offset_processed: newOffset,
        total_count: total,
        new_subs: newSubs,
        churned,
        paused,
        plan_map_tags: (planMap || []).length,
      });

      if (done) {
        await resetState();
      } else {
        await saveState({
          phase: "streaming",
          offset_processed: newOffset,
          jsonl_url: state.jsonl_url,
          total_count: total,
          bulk_op_id: state.bulk_op_id,
          started_at: state.started_at,
          meta: state.meta,
        });
      }

      return {
        phase: done ? "done" : "streaming",
        processed_this_invocation: processed,
        offset_processed: newOffset,
        total_count: total,
        new_subs: newSubs,
        churned,
        paused,
        note: done
          ? "Rebuild complete. State reset."
          : `Hit ${STREAM_BUDGET_MS / 1000}s budget — re-invoke to continue from offset ${newOffset}.`,
      };
    }

    throw new Error(`Unexpected phase: ${state.phase}`);
  });

  return NextResponse.json(result, { status: result.ok ? 200 : 500 });
}
