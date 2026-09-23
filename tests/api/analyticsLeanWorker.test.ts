import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { runAnalyticsWorker } from "@/lib/analytics/worker";
let db: PGlite;
const token = "a".repeat(32), token2 = "b".repeat(32);
beforeAll(async () => {
  db = new PGlite();
  await db.exec("create role service_role");
  for (const file of ["001_staging", "003_receipts", "004_worker"]) await db.exec(readFileSync(`sql/analytics/${file}.sql`, "utf8"));
}, 30000);
afterAll(async () => { await db.close(); });
async function seed(id: string) {
  await db.query("select public.lean_accept_receipt('shopify',$1,'order','orders/paid',$2,'{}')", [id, "a".repeat(64)]);
}
const claim = (t = token) => db.query<{ work_id: number }>("select * from public.lean_claim_work($1,1,30)", [t]);
describe("leased durable warehouse work", () => {
  it("does not lease active work to overlapping workers", async () => {
    await seed("one");
    expect((await claim()).rows).toHaveLength(1);
    expect((await claim(token2)).rows).toHaveLength(0);
  });
  it("reclaims expired work and fences a stale worker from committing", async () => {
    await db.exec("update lean_private.work set lease_until=now()-interval '1 second'");
    const row = (await claim(token2)).rows[0];
    const finish = (t: string) => db.query<{ ok: boolean }>("select public.lean_finish_work($1,$2,'v1','{}') as ok", [row.work_id, t]);
    expect((await finish(token)).rows[0].ok).toBe(false);
    expect((await finish(token2)).rows[0].ok).toBe(true);
    expect((await finish(token2)).rows[0].ok).toBe(false);
    expect((await db.query("select * from lean_private.projections")).rows).toHaveLength(1);
  });
  it("dead-letters exhausted crash retries", async () => {
    await seed("crash");
    await claim();
    await db.exec("update lean_private.work set attempts=5,lease_until=now()-interval '1 second' where state='leased'");
    expect((await claim()).rows).toHaveLength(0);
    expect((await db.query("select * from lean_private.work where state='dead'")).rows).toHaveLength(1);
  });
  it("requires approval for replay and records the actor", async () => {
    await expect(db.exec("select public.lean_replay_work(1,'','operator')")).rejects.toThrow();
    await db.exec("select public.lean_replay_work(1,'ticket-123','operator')");
    expect((await db.query("select * from lean_private.replay_audit")).rows).toHaveLength(1);
    expect((await claim()).rows).toHaveLength(1);
  });
  it("persists bounded backoff without raw exception content", async () => {
    await db.query("select public.lean_fail_work(1,$1,'transform_failed')", [token]);
    expect((await claim()).rows).toHaveLength(0);
    await expect(db.query("select public.lean_fail_work(1,$1,'secret raw error')", [token])).rejects.toThrow();
  });
  it("does not retry or mark failure after an ambiguous completion response", async () => {
    const fail = vi.fn();
    await expect(runAnalyticsWorker({
      claim: async () => [{ work_id: "1", receipt_id: "1", topic: "orders/paid", payload: {}, attempts: 1 }],
      finish: async () => { throw new Error("response lost"); }, fail,
    }, () => ({ orders: [] }), "v1")).rejects.toThrow("response lost");
    expect(fail).not.toHaveBeenCalled();
  });
});
