import { randomUUID } from "node:crypto";
export type Work = { work_id: string; receipt_id: string; topic: string; payload: unknown; attempts: number };
export type WorkerStore = {
  claim(token: string, limit: number, leaseSeconds: number): Promise<Work[]>;
  finish(id: string, token: string, version: string, facts: Record<string, unknown>): Promise<boolean>;
  fail(id: string, token: string, code: "transform_failed"): Promise<boolean>;
};
/** Pure transformation only: this registry must not contain business side effects.
 * Output and completion commit atomically under a fencing token in PostgreSQL.
 */
export async function runAnalyticsWorker(store: WorkerStore,
  transform: (work: Work) => Record<string, unknown>, version: string, limit = 10,
) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 50 || !version) throw new Error("invalid_worker_bounds");
  const token = randomUUID();
  const work = await store.claim(token, limit, 120);
  let completed = 0;
  let failed = 0;
  let lostLease = 0;
  for (const item of work) {
    let facts: Record<string, unknown>;
    try { facts = transform(item); }
    catch {
      if (await store.fail(item.work_id, token, "transform_failed")) failed++;
      else lostLease++;
      continue;
    }
    // A lost response to finish is ambiguous: do not write a failure or repeat
    // external effects. The next claim observes committed done or an expired lease.
    if (await store.finish(item.work_id, token, version, facts)) completed++;
    else lostLease++;
  }
  return { claimed: work.length, completed, failed, lostLease };
}
