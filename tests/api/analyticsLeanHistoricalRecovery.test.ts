/** Native loopback PostgreSQL only. No hosted database or source-provider calls.
 * P2_NATIVE=1 opts into a disposable local database on port 55439.
 * The frozen amendment is installed verbatim. An owner inserts synthetic active
 * admission directly, because P1 activation is a separate, already-owned proof.
 */
import { Client } from "pg";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { prepareHistoricalRecovery } from "@/lib/analytics/pipelineHistoricalRecovery";
import { REFUND_SUPPLEMENT, INGESTION_SCOPE } from "@/lib/analytics/pipelineIngestionAmendment";
import { projectPilotRetention } from "@/lib/analytics/shopifyRetention";
import { sourceObject } from "@/lib/analytics/shopifySource";
import type { PipelinePolicy } from "@/lib/analytics/shopifyPipeline";
import { runtimeSource, runtimeMoney as money, runtimeConnection as connection } from "../fixtures/analyticsRetainedRuntime";

const sql = (n: string) => readFileSync(`sql/analytics/${n}.sql`, "utf8");
const shop = "mullybox-store.myshopify.com", project = "xnfjdbpjuaezxjgargto";
const refundPins = { ...REFUND_SUPPLEMENT };
const approval = "Jessica Singh approved ongoing sales activation 2026-09-30T19:00:00Z; installed-baseline amendment approved 2026-09-30T19:14:00Z; session 9e554880-77db-414c-9f03-6574efa210d7";
const policy: PipelinePolicy = {
  decision: { approvalRef: approval, eligibility: "eligible", commerceSource: "other", acquisitionEligible: false },
  orderSize: { policyRef: "Jessica-Singh-approved-order-size-20260930T201000Z", productSemantics: { "8501257044160": "requested_box_top_size" } },
  saleClock: "paid_at", refundClock: "refund_created_at", productClasses: { "8501257044160": "merchandise" },
  retainedReports: "product-v1", sourceRetention: "financial_allowlist_v1", sourceProjection: "financial_no_geo_order_size",
  financialApprovalRef: approval,
};
const connect = async (database = "postgres") => {
  const c = new Client({ host: "127.0.0.1", port: 55439, user: "postgres", password: "local-fixture-only", database });
  await c.connect(); return c;
};
let db: Client, admin: Client, database: string;
let serial = 0;
async function q<T = unknown>(text: string, args: unknown[] = []): Promise<T> {
  return (await db.query(text, args)).rows[0].r;
}
function source(id = "1", product = "10244806213824") {
  const s = runtimeSource(), o = s.commerce.order;
  s.commerce.shop = shop; s.commerce.projection = "financial_no_geo_order_size";
  o.id = `gid://shopify/Order/${id}`; o.createdAt = "2026-10-01T12:00:00Z"; o.updatedAt = "2026-10-01T17:27:27Z";
  s.financial.id = o.id; s.financial.updatedAt = o.updatedAt;
  const line = sourceObject((sourceObject(o.lineItems).nodes as unknown[])[0]);
  line.id = `gid://shopify/LineItem/${id}2`; line.product = { id: `gid://shopify/Product/${product}` };
  line.orderSize = { topSize: { status: "known", value: "L" }, variantTitle: { status: "known", value: "XL" } };
  const tx = sourceObject((o.transactions as unknown[])[0]);
  tx.id = `gid://shopify/OrderTransaction/${id}4`; tx.createdAt = "2026-10-01T12:00:00Z"; tx.processedAt = "2026-10-01T12:01:00Z";
  return projectPilotRetention(s);
}
async function retained(s = source()) {
  const token = randomUUID();
  await db.query("select public.lean_accept_receipt('shopify',$1,$2,'orders/updated',$3,$4::jsonb)", [
    randomUUID(), JSON.stringify([shop, s.commerce.order.id]), "a".repeat(64),
    JSON.stringify({ admin_graphql_api_id: s.commerce.order.id, updated_at: s.commerce.order.updatedAt }),
  ]);
  const claim = await q<{ workId: string }>("select public.lean_pipeline_claim($1,$2,$3) r", [token, project, shop]);
  expect(await q("select public.lean_pipeline_retain($1,$2,$3::jsonb) r", [claim.workId, token, JSON.stringify(s)])).toBe(true);
  // Construct an exhausted fixture, not an implementation operation.
  await db.query("update lean_private.work set state='dead',attempts=5,last_error_code='mapping_rejected',lease_token=null,lease_until=null where work_id=$1", [claim.workId]);
  return { id: claim.workId, source: s };
}
async function plan(r: Awaited<ReturnType<typeof retained>>) {
  const operation = randomUUID();
  const admission = await q("select lean_private.pipeline_ingestion_context(s,c) r from lean_private.pipeline_snapshots s cross join lean_private.pipeline_scope c where s.work_id=$1", [r.id]);
  const output = prepareHistoricalRecovery({ operationId: operation, originalWorkId: r.id, source: r.source,
    policy, admission, fromTime: "2026-09-30T19:19:02.220236Z", untilTime: "9999-12-31T00:00:00Z" });
  const binding = await q("select lean_private.pipeline_recovery_binding($1) r", [r.id]);
  const hash = await q<string>("select encode(sha256(convert_to($1::jsonb::text,'UTF8')),'hex') r", [JSON.stringify(output)]);
  return { operation, output, binding, hash, id: r.id };
}
async function authorize(p: Awaited<ReturnType<typeof plan>>, enabled = true, deadline = "clock_timestamp()+interval '1 minute'") {
  return q(`select lean_private.authorize_pipeline_recovery($1,$2,$3::jsonb,$4,'fixture:approve','fixture:owner',${deadline},$5) r`,
    [p.operation, p.id, JSON.stringify(p.binding), p.hash, enabled]);
}
const finish = (p: Awaited<ReturnType<typeof plan>>, c = db) => c.query(
  "select lean_private.complete_pipeline_recovery($1,$2::jsonb) r", [p.operation, JSON.stringify(p.output)]);
const originals = (id: string) => q(`select jsonb_build_object('work',to_jsonb(w),'receipt',to_jsonb(r),'snapshot',to_jsonb(s)) r
  from lean_private.work w join lean_private.receipts r using(receipt_id)
  join lean_private.pipeline_snapshots s using(work_id) where w.work_id=$1`, [id]);
const effects = () => q(`select jsonb_build_object('orders',(select count(*) from lean_private.orders),
  'internal',(select count(*) from lean_private.receipts where source='internal_recovery'),
  'recovery',(select count(*) from lean_private.pipeline_recovery_completions),
  'amended',(select count(*) from lean_private.pipeline_ingestion_completions),
  'heads',(select count(*) from lean_private.pipeline_heads)) r`);

describe("offline recovery preparation", () => {
  it("requires explicit amendment admission and rejects an unsupported product", () => {
    const input = { operationId: randomUUID(), originalWorkId: "1", source: source(), policy,
      admission: null, fromTime: "2026-09-30T19:19:02.220236Z", untilTime: "9999-12-31T00:00:00Z" };
    expect(() => prepareHistoricalRecovery(input)).toThrow("recovery_amendment_required");
    const admission = { version: "ingestion-amendment-20261002", revision: 1, approvalRef: "fixture",
      scopeSha256: INGESTION_SCOPE, retainedSourceSha256: "a".repeat(64) };
    expect(() => prepareHistoricalRecovery({ ...input, admission, source: source("1", "999") }))
      .toThrow("recovery_amendment_required");
    const before = structuredClone(input);
    const output = prepareHistoricalRecovery({ ...input, admission });
    expect(input).toEqual(before);
    expect(output.facts.orders[0].publication_id).toBe(`recovery:${input.operationId}`);
  });
});

describe.skipIf(process.env.P2_NATIVE !== "1")("bounded historical recovery on native PostgreSQL", () => {
  beforeEach(async () => {
    vi.stubGlobal("fetch", vi.fn(() => { throw Error("provider_forbidden"); }));
    admin = await connect(); database = `p2_recovery_${process.pid}_${++serial}`;
    await admin.query(`create database ${database}`); db = await connect(database);
    await db.query("set timezone='UTC'");
    for (const n of ["001_staging", "003_receipts", "004_worker", "013_release", "014_reporting_views",
      "017_shopify_pipeline", "046_order_item_sizes", "047_pipeline_extended", "052_pipeline_before_window_exclusion",
      "pipeline_throughput.review", "pipeline_annual_access_exclusion.review", "pipeline_zero_total_exception.review",
      "pipeline_ingestion_amendment.review", "pipeline_historical_recovery.review"]) {
      await db.query(sql(n).replace("create role lean_observed_reader nologin noinherit;", ""));
    }
    await db.query(`insert into lean_private.pipeline_scope(shop,project_ref,enabled,from_time,until_time,policy,approval_ref,actor_ref)
      values($1,$2,true,'2026-09-30T19:19:02.220236Z','9999-12-31T00:00:00Z',$3::jsonb,'fixture:scope','fixture:owner')`,
    [shop, project, JSON.stringify(policy)]);
    await db.query(`insert into lean_private.pipeline_ingestion_amendment(enabled,revision,scope_sha256,approval_ref,actor_ref)
      values(true,1,$1,'fixture:amendment','fixture:owner')`, [INGESTION_SCOPE]);
  }, 30000);
  afterEach(async () => {
    Object.assign(REFUND_SUPPLEMENT, refundPins);
    expect(fetch).not.toHaveBeenCalled(); vi.unstubAllGlobals();
    await db?.end(); await admin?.query(`drop database ${database} with(force)`); await admin?.end();
  });

  it("installs default-off and refuses role access or implicit authorization", async () => {
    const p = await plan(await retained());
    expect(await q("select count(*)::int r from lean_private.pipeline_recovery_permits")).toBe(0);
    await expect(finish(p)).rejects.toThrow();
    await expect(authorize(p, false)).rejects.toThrow("authorization unbound");
    expect(await q(`select has_function_privilege('service_role',
      'lean_private.complete_pipeline_recovery(uuid,jsonb)','EXECUTE') r`)).toBe(false);
    await db.query("set role service_role");
    await expect(finish(p)).rejects.toThrow("permission denied");
    await db.query("reset role");
    expect(await effects()).toEqual({ orders: 0, internal: 0, recovery: 0, amended: 0, heads: 0 });
  });

  it("reads exact bounded inventory without changing retained state", async () => {
    const r = await retained(), before = await originals(r.id);
    const response = await db.query(sql("pipeline_historical_recovery_inventory"));
    const result = (response as unknown as { rows: Record<string, unknown>[] }[]).find(x => x.rows.length)?.rows[0];
    const inventory = Object.values(result ?? {})[0] as { recordCount: number; rows: { category: string }[]; executionAuthorized: boolean };
    expect(inventory.recordCount).toBe(1);
    expect(inventory.rows[0].category).toBe("catalog_candidate");
    expect(inventory.executionAuthorized).toBe(false);
    expect(await originals(r.id)).toEqual(before);
  });

  it("rolls back permit and audit when a real scope lock wait crosses the authorization deadline", async () => {
    const r = await retained(), p = await plan(r), before = await originals(r.id);
    const blocker = await connect(database);
    const pid = await q<number>("select pg_backend_pid() r");
    try {
      await blocker.query("begin");
      await blocker.query("select 1 from lean_private.pipeline_scope for update");
      // Attach both handlers immediately; the refusal must follow a real lock
      // wait, not an unhandled rejection or a substituted clock.
      const pending = authorize(p, true, "clock_timestamp()+interval '80 milliseconds'")
        .then(value => ({ value, error: null }), error => ({ value: null, error: String(error) }));
      const end = Date.now() + 2000;
      let locked = false;
      while (Date.now() < end) {
        const state = await blocker.query("select wait_event_type from pg_stat_activity where pid=$1", [pid]);
        if (state.rows[0]?.wait_event_type === "Lock") { locked = true; break; }
        await new Promise(resolve => setTimeout(resolve, 5));
      }
      expect(locked).toBe(true);
      await blocker.query("select pg_sleep(0.12)");
      await blocker.query("commit");
      const result = await pending;
      expect(result.value).toBe(null);
      expect(result.error).toContain("recovery authorization deadline");
      const state = await q(`select jsonb_build_object(
        'permits',(select count(*) from lean_private.pipeline_recovery_permits where operation_id=$1),
        'authorizedAuditRows',(select count(*) from lean_private.pipeline_operator_audit
          where event='historical_recovery_authorized' and previous_state->>'operation'=$1::text)) r`,
      [p.operation]);
      expect(state).toEqual({ permits: 0, authorizedAuditRows: 0 });
      expect(await originals(r.id)).toEqual(before);
      expect(await effects()).toEqual({ orders: 0, internal: 0, recovery: 0, amended: 0, heads: 0 });
      console.log(JSON.stringify({ regression: "authorization deadline after actual scope lock wait",
        actualLockWait: true, state, financialEffects: 0, originalPreserved: true }));
    } finally { await blocker.query("rollback"); await blocker.end(); }
  });

  it("atomically completes once across duplicate dead records and keeps original/coverage unchanged", async () => {
    const r = await retained(), duplicate = await retained();
    const before = await originals(r.id), otherBefore = await originals(duplicate.id);
    const p = await plan(r), other = await plan(duplicate);
    await authorize(p); await authorize(other); await finish(p);
    await expect(finish(p)).rejects.toThrow();
    await expect(finish(other)).rejects.toThrow();
    expect(await originals(r.id)).toEqual(before); expect(await originals(duplicate.id)).toEqual(otherBefore);
    expect(await effects()).toEqual({ orders: 1, internal: 1, recovery: 1, amended: 1, heads: 1 });
    expect(await q("select bool_and(pipeline_stale) r from lean_analytics.observed_order_daily")).toBe(true);
    expect(await q("select bool_and(cash_amount_usd is null and not cash_eligible) r from lean_private.payments")).toBe(true);
    expect(await q("select bool_and(state='done' and lease_token is null and lease_until is null) r from lean_private.work w join lean_private.receipts r using(receipt_id) where r.source='internal_recovery'")).toBe(true);
    await expect(db.query("delete from lean_private.pipeline_recovery_completions")).rejects.toThrow("immutable");
  });

  it.each(["source", "work", "scope", "revision", "amendment_stop", "definition", "isolation", "output", "revoke", "expired", "lease"])("refuses stale %s without synthetic effects", async change => {
    const r = await retained(), p = await plan(r); await authorize(p);
    if (change === "source") await db.query("update lean_private.pipeline_snapshots set source=jsonb_set(source,'{commerce,order,test}','true') where work_id=$1", [r.id]);
    if (change === "work") await db.query("update lean_private.work set last_error_code='attempts_exhausted' where work_id=$1", [r.id]);
    if (change === "scope") await db.query("update lean_private.pipeline_scope set enabled=false");
    if (change === "revision") await db.query("update lean_private.pipeline_ingestion_amendment set revision=2,approval_ref='fixture:revision'");
    if (change === "amendment_stop") await db.query("update lean_private.pipeline_ingestion_amendment set enabled=false,revision=2,approval_ref='fixture:stop'");
    if (change === "definition") {
      const definition = await q<string>("select pg_get_functiondef('public.lean_pipeline_finish(bigint,uuid,jsonb,jsonb)'::regprocedure) r");
      await db.query(definition.replace("begin\n", "begin\n-- fixture definition drift\n"));
    }
    if (change === "isolation") await db.query("begin isolation level repeatable read");
    if (change === "output") p.output.reports[0].net_sales_usd = "999.000000";
    if (change === "revoke") await db.query("select lean_private.revoke_pipeline_recovery($1,'fixture:stop','fixture:owner')", [p.operation]);
    if (change === "expired") {
      const fresh = await plan(r); await authorize(fresh, true, "clock_timestamp()+interval '50 milliseconds'");
      await db.query("select pg_sleep(0.08)"); p.operation = fresh.operation; p.output = fresh.output;
    }
    if (change === "lease") await db.query("update lean_private.work set lease_token=$2 where work_id=$1", [r.id, randomUUID()]);
    await expect(finish(p)).rejects.toThrow();
    if (change === "isolation") await db.query("rollback");
    expect(await effects()).toEqual({ orders: 0, internal: 0, recovery: 0, amended: 0, heads: 0 });
  });

  it("rolls back completion when provenance insertion fails", async () => {
    const r = await retained(), p = await plan(r), before = await originals(r.id); await authorize(p);
    await db.query(`create function lean_private.fixture_reject() returns trigger language plpgsql as $$
      begin raise exception 'fixture provenance failure'; end $$;
      create trigger reject_recovery before insert on lean_private.pipeline_recovery_completions
      for each row execute function lean_private.fixture_reject()`);
    await expect(finish(p)).rejects.toThrow("fixture provenance failure");
    expect(await originals(r.id)).toEqual(before);
    expect(await effects()).toEqual({ orders: 0, internal: 0, recovery: 0, amended: 0, heads: 0 });
    expect(await q("select count(*)::int r from lean_private.publications where publication_id like 'recovery:%'")).toBe(0);
  });

  it("serializes concurrent duplicate recovery and refuses the loser after the winner commits", async () => {
    const p = await plan(await retained()), other = await plan(await retained());
    await authorize(p); await authorize(other);
    const a = await connect(database), b = await connect(database);
    try {
      const pid = (await b.query("select pg_backend_pid() pid")).rows[0].pid;
      await a.query("begin"); await finish(p, a);
      let settled = false;
      const waiting = finish(other, b).then(() => "unexpected success", e => String(e)).finally(() => { settled = true; });
      await db.query("select pg_sleep(0.08)"); expect(settled).toBe(false);
      expect(await q("select wait_event_type r from pg_stat_activity where pid=$1", [pid])).toBe("Lock");
      await a.query("commit"); expect(await waiting).toContain("already materialized");
      expect(await effects()).toEqual({ orders: 1, internal: 1, recovery: 1, amended: 1, heads: 1 });
    } finally { await a.end(); await b.end(); }
  });

  it("waits for ordinary amended completion and refuses its equal-revision recovery", async () => {
    const original = await retained(), p = await plan(original); await authorize(p);
    const ordinary = await retained(), token = randomUUID();
    const publication = await q<string>("select publication_id r from lean_private.pipeline_snapshots where work_id=$1", [ordinary.id]);
    // Only the separate fixture contender gets a lease. The recovery original
    // remains terminal. Use the actual mapped output with its publication.
    await db.query("update lean_private.work set state='leased',lease_token=$2,lease_until=clock_timestamp()+interval '1 minute' where work_id=$1", [ordinary.id, token]);
    const output = JSON.parse(JSON.stringify(p.output).replaceAll(`recovery:${p.operation}`, publication));
    const a = await connect(database), b = await connect(database);
    try {
      const pid = (await b.query("select pg_backend_pid() pid")).rows[0].pid;
      await a.query("begin");
      expect((await a.query("select public.lean_pipeline_finish_amended($1,$2,1,$3::jsonb,$4::jsonb,$5::jsonb,$6::jsonb) r",
        [ordinary.id, token, JSON.stringify(output.facts), JSON.stringify(output.reports),
          JSON.stringify(output.productReports), JSON.stringify(output.orderItemSizes)])).rows[0].r).toBe(true);
      const waiting = finish(p, b).then(() => "unexpected success", e => String(e));
      await db.query("select pg_sleep(0.08)");
      expect(await q("select wait_event_type r from pg_stat_activity where pid=$1", [pid])).toBe("Lock");
      await a.query("commit"); expect(await waiting).toContain("equal or newer materialization");
      expect(await effects()).toEqual({ orders: 1, internal: 0, recovery: 0, amended: 1, heads: 1 });
      expect(await q("select state r from lean_private.work where work_id=$1", [original.id])).toBe("dead");
    } finally { await a.end(); await b.end(); }
  });

  it.each(["revoke", "source"])("waits for concurrent %s and refuses after its commit", async change => {
    const p = await plan(await retained()); await authorize(p);
    const a = await connect(database), b = await connect(database);
    try {
      const pid = (await b.query("select pg_backend_pid() pid")).rows[0].pid;
      await a.query("begin");
      if (change === "revoke") await a.query("select lean_private.revoke_pipeline_recovery($1,'fixture:stop','fixture:owner')", [p.operation]);
      else await a.query("update lean_private.pipeline_snapshots set source=jsonb_set(source,'{commerce,order,test}','true') where work_id=$1", [p.id]);
      let settled = false;
      const waiting = finish(p, b).then(() => "unexpected success", e => String(e)).finally(() => { settled = true; });
      await db.query("select pg_sleep(0.08)"); expect(settled).toBe(false);
      expect(await q("select wait_event_type r from pg_stat_activity where pid=$1", [pid])).toBe("Lock");
      await a.query("commit");
      expect(await waiting).toContain(change === "revoke" ? "revoked or expired" : "binding CAS");
      expect(await effects()).toEqual({ orders: 0, internal: 0, recovery: 0, amended: 0, heads: 0 });
    } finally { await a.end(); await b.end(); }
  });

  it("refuses an expired synthetic lease and rolls back all inserted rows", async () => {
    const p = await plan(await retained()); await authorize(p);
    await db.query(`create function lean_private.fixture_expired_lease() returns trigger language plpgsql as $$
      begin
        if exists(select 1 from lean_private.receipts where receipt_id=new.receipt_id and source='internal_recovery')
          then new.lease_until:=clock_timestamp()-interval '1 second'; end if;
        return new;
      end $$;
      create trigger expired_recovery before insert on lean_private.work
      for each row execute function lean_private.fixture_expired_lease()`);
    await expect(finish(p)).rejects.toThrow("completion refused");
    expect(await effects()).toEqual({ orders: 0, internal: 0, recovery: 0, amended: 0, heads: 0 });
  });

  it("rejects materialization even if a head is missing", async () => {
    const p = await plan(await retained()), other = await plan(await retained());
    await authorize(p); await authorize(other); await finish(p);
    // Remove only synthetic fixture guards/evidence to exercise the independent
    // financial-row defense, rather than stopping at the recovery unique key.
    await db.query("delete from lean_private.pipeline_heads");
    await db.query("alter table lean_private.pipeline_recovery_completions disable trigger immutable_recovery; delete from lean_private.pipeline_recovery_completions");
    await expect(finish(other)).rejects.toThrow("equal or newer materialization");
    expect(await q("select count(*)::int r from lean_private.orders")).toBe(1);
  });

  it("keeps exact historical refund supplement order-level and never invents cash or item allocation", async () => {
    const s = source("9", "8501257044160"), o = s.commerce.order;
    const tx = sourceObject((o.transactions as unknown[])[0]);
    const rt = { id: "gid://shopify/OrderTransaction/95", kind: "REFUND", status: "SUCCESS", gateway: "fixture",
      test: false, createdAt: "2026-10-01T17:27:24Z", processedAt: "2026-10-01T17:27:24Z",
      amountSet: money("13.50"), parentTransaction: { id: tx.id, gateway: "fixture" } };
    (o.transactions as unknown[]).push(rt); o.transactionsCount = { count: 2, precision: "EXACT" };
    s.financial.refunds = [{ id: "gid://shopify/Refund/97", updatedAt: "2026-10-01T17:27:26Z" }];
    s.refunds = [{ id: "gid://shopify/Refund/97", createdAt: "2026-10-01T17:27:26Z", updatedAt: "2026-10-01T17:27:26Z",
      order: { id: o.id }, totalRefundedSet: money("13.50"), duties: [],
      orderAdjustments: connection([{ id: "gid://shopify/OrderAdjustment/98" }]),
      refundLineItems: connection([]), refundShippingLines: connection([]),
      transactions: connection([{ id: rt.id, kind: rt.kind, status: rt.status, processedAt: rt.processedAt, amountSet: rt.amountSet }]) }];
    const r = await retained(projectPilotRetention(s));
    // Same explicit four synthetic identity substitutions as the retained
    // amendment proof. Production source and money constants stay unchanged.
    const hash = (v: unknown) => createHash("sha256").update(String(v)).digest("hex");
    Object.assign(REFUND_SUPPLEMENT, {
      sourceSha256: await q("select encode(sha256(convert_to(source::text,'UTF8')),'hex') r from lean_private.pipeline_snapshots where work_id=$1", [r.id]),
      orderSha256: hash(o.id), refundSha256: hash(s.refunds[0].id),
      adjustmentSha256: hash("gid://shopify/OrderAdjustment/98"),
    });
    const p = await plan(r); await authorize(p); await finish(p);
    expect(await q(`select jsonb_agg(jsonb_build_object('amount',amount_usd::text,'item',order_item_id,
      'allocation',product_allocation_status)) r from lean_private.sales_ledger where component='other_sales_adjustment'`))
      .toEqual([{ amount: "-13.500000", item: null, allocation: "order_level" }]);
    expect(await q("select sum(other_sales_adjustments_usd)::text r from lean_private.report_store_daily")).toBe("-13.500000");
    expect(await q("select sum(refunds_usd)::text r from lean_private.report_product_daily")).toBe("0.000000");
    expect(await q("select bool_and(cash_amount_usd is null and not cash_eligible) r from lean_private.payments")).toBe(true);
    const unsupported = structuredClone(r.source); unsupported.refunds[0].totalRefundedSet = money("14");
    await expect(plan({ ...r, source: unsupported })).rejects.toThrow();
  });

  it("refuses equal/newer heads, existing facts, and conflicting same-revision source under locks", async () => {
    const r = await retained(), other = await retained(source("2"));
    const p = await plan(r);
    await db.query("insert into lean_private.pipeline_heads(shop,order_gid,work_id,revision,source) select shop,order_gid,work_id,revision,source from lean_private.pipeline_snapshots where work_id=$1", [r.id]);
    await expect(authorize(p)).rejects.toThrow();
    await db.query("update lean_private.pipeline_heads set revision=revision+interval '1 day'");
    await expect(authorize(p)).rejects.toThrow();
    await db.query("delete from lean_private.pipeline_heads");
    await db.query(`update lean_private.pipeline_snapshots set order_gid=$2,
      source=jsonb_set(source,'{commerce,order,id}',to_jsonb($2::text)) where work_id=$1`, [other.id, r.source.commerce.order.id]);
    await expect(authorize(p)).rejects.toThrow("conflicting retained source");
    expect(await effects()).toEqual({ orders: 0, internal: 0, recovery: 0, amended: 0, heads: 0 });
  });

  it("refuses zero-total recovery without excluding its history from the pipeline", async () => {
    const s = source(); s.commerce.order.originalTotalPriceSet = money("0"); s.financial.originalTotalPriceSet = money("0");
    const r = await retained(s), before = await originals(r.id);
    await expect(q("select lean_private.pipeline_recovery_check($1) r", [r.id])).rejects.toThrow("source or admission unavailable");
    expect(await originals(r.id)).toEqual(before);
    expect(await q("select count(*)::int r from lean_private.work where state='dead'")).toBe(1);
  });
});
