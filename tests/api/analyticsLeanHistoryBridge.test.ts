/** Synthetic source transport, disposable loopback PostgreSQL, actual consumer.
 * No hosted/source credentials. This suite does not establish business policy. */
import { Client } from "pg";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { beforeAll, afterAll, beforeEach, describe, expect, it } from "vitest";
import { runHistoryReportStep, normalizeHistoricalOrder } from "@/lib/analytics/historyReportBridge";
import { runHistoryReportOperator } from "@/lib/analytics/historyReportOperator";
import { SHOPIFY_FINANCIAL_CUSTOMER_QUERY, SHOPIFY_FINANCIAL_ORDER_QUERY } from "@/lib/analytics/shopifySource";
import type { PilotSource } from "@/lib/analytics/shopifyPilotSource";
const url = process.env.HISTORY_BRIDGE_TEST_URL ?? process.env.LOCAL_POSTGRES_TEST_URL;
const project = "xeqlgxvrhgwwudyqtnun", shop = "mullybox-store.myshopify.com", run = "fixture-history-report";
const gid = (k: string, n: string) => `gid://shopify/${k}/${n}`;
const money = (amount: string) => ({ shopMoney: { amount, currencyCode: "USD" } });
function packet(id = "1"): PilotSource {
  return { commerce: { shop, apiVersion: "2026-07", projection: "financial_no_geo", order: {
    id: gid("Order", id), createdAt: "2026-09-21T12:00:00Z", updatedAt: "2026-09-22T13:00:00Z",
    currencyCode: "USD", edited: false, taxesIncluded: false, test: false, cancelledAt: null,
    originalTotalPriceSet: money("10"), subtotalPriceSet: money("10"),
    transactionsCount: { count: 1, precision: "EXACT" },
    transactions: [{ id: gid("OrderTransaction", id), kind: "SALE", status: "SUCCESS", gateway: "fixture",
      test: false, createdAt: "2026-09-21T12:00:00Z", processedAt: "2026-09-21T12:00:00Z",
      amountSet: money("10"), parentTransaction: null }],
    lineItems: { nodes: [{ id: gid("LineItem", id), sku: "FIXTURE", quantity: 1, isGiftCard: false,
      product: { id: gid("Product", "3") }, originalUnitPriceSet: money("10"),
      originalTotalSet: money("10"), discountAllocations: [] }],
    pageInfo: { hasNextPage: false, endCursor: null } },
  } }, financial: { id: gid("Order", id), updatedAt: "2026-09-22T13:00:00Z", currencyCode: "USD",
    originalTotalPriceSet: money("10"), totalTaxSet: money("0"), originalTotalDutiesSet: null,
    originalTotalAdditionalFeesSet: null, totalTipReceivedSet: money("0"),
    shippingLines: { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } }, refunds: [] }, refunds: [] };
}
const policy = { productClasses: { "3": "merchandise" }, decision: {
  eligibility: "eligible", commerceSource: "other", acquisitionEligible: false, approvalRef: "fixture:historical-policy",
}, saleClock: "paid_at", refundClock: "refund_created_at", financialApprovalRef: "fixture:finance" };
const baseScope = { runId: run, sourceJob: "fixture-completed", projectRef: project, shop,
  fromDate: "2026-09-21", throughDate: "2026-09-21", includeCustomerId: false,
  policy: null, spendRuns: [], approvalRef: "fixture:normalization-only", actorRef: "fixture:owner" };
describe.skipIf(!url)("040 source to real private canonical/report consumer", () => {
  let control: Client, admin: Client, runtime: Client, peer: Client, calls: number, customer: boolean;
  let source: PilotSource, errors: string[], functions: unknown;
  const rpc = async (client: Client, name: string, args: Record<string, unknown>) => {
    if (!/^lean_history_report_[a-z]+$/.test(name)) throw new Error("unexpected RPC");
    return (await client.query(`select public.${name}(${Object.keys(args).map((k,i) => `${k}=>$${i+1}`).join(",")}) result`,
      Object.values(args).map(v => v && typeof v === "object" ? JSON.stringify(v) : v))).rows[0].result;
  };
  const common = (token = randomUUID()) => ({ p_run: run, p_project: project, p_token: token });
  beforeAll(async () => {
    const u = new URL(url!);
    if (!["127.0.0.1","localhost"].includes(u.hostname) ||
      !["fixture_owner","fixture_shopify_install"].includes(u.username) ||
      !["/postgres","/analytics_test_pipeline"].includes(u.pathname)) throw new Error("loopback fixture only");
    control = new Client({ connectionString: u.href }); await control.connect();
    await control.query("drop database if exists analytics_test_history_bridge");
    await control.query("create database analytics_test_history_bridge"); u.pathname = "/analytics_test_history_bridge";
    admin = new Client({ connectionString: u.href }); runtime = new Client({ connectionString: u.href }); peer = new Client({ connectionString: u.href });
    await admin.connect(); await runtime.connect(); await peer.connect();
    await admin.query(`do $$ begin
      if not exists(select 1 from pg_roles where rolname='anon') then create role anon; end if;
      if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated; end if;
      if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role; end if;
    end $$; alter default privileges in schema public grant execute on functions to anon,authenticated,service_role`);
    for (const file of ["001_staging","013_release","014_reporting_views","019_spend_jobs","038_google_spend_pilot","040_shopify_history_import"])
      await admin.query(readFileSync(`sql/analytics/${file}.sql`, "utf8"));
    functions = (await admin.query("select oid::regprocedure::text n,pg_get_functiondef(oid) d from pg_proc where proname like 'lean_spend_%' order by 1")).rows;
    await admin.query(readFileSync("sql/analytics/041_history_report_bridge.sql", "utf8"));
    await runtime.query("set role service_role;set statement_timeout='5s'"); await peer.query("set statement_timeout='5s'");
  }, 30000);
  afterAll(async () => {
    await admin?.query("rollback");
    if (admin && functions) expect((await admin.query("select oid::regprocedure::text n,pg_get_functiondef(oid) d from pg_proc where proname like 'lean_spend_%' order by 1")).rows).toEqual(functions);
    await runtime?.end(); await peer?.end(); await admin?.end();
    if (control) { await control.query("drop database if exists analytics_test_history_bridge"); await control.end(); }
  });
  beforeEach(async () => {
    await admin.query("truncate lean_private.history_import_jobs,lean_private.publications cascade");
    await admin.query("drop trigger if exists bridge_delay on lean_private.orders");
    source = packet(); calls = 0; customer = false; errors = [];
    await admin.query(`insert into lean_private.history_import_jobs(job_id,scope,expires_at,enabled,state,orders,lines,completion)
      values('fixture-completed',$1,clock_timestamp()-interval '1 day',true,'complete',1,1,'{\"eof\":true,\"sha256\":\"fixture\"}')`,
      [JSON.stringify({ projectRef: project, shop })]);
    await addOrder("1");
  });
  async function addOrder(id: string) {
    const p = packet(id), o = p.commerce.order;
    const original=Object.fromEntries(["id","createdAt","updatedAt","cancelledAt","test","edited","taxesIncluded","currencyCode"].map(k=>[k,o[k]]));
    Object.assign(original,{__typename:"Order",processedAt:null,displayFinancialStatus:"PAID",totalPriceSet:money("10"),
      currentTotalPriceSet:money("10"),subtotalPriceSet:money("10"),totalTaxSet:money("0"),totalDiscountsSet:money("0"),
      totalRefundedSet:money("0"),refunds:[]});
    await admin.query("insert into lean_private.history_import_orders values('fixture-completed',$1,$2)", [o.id, JSON.stringify(original)]);
    const line={__typename:"LineItem",__parentId:o.id,id:gid("LineItem",id),quantity:1,currentQuantity:1,
      isGiftCard:false,requiresShipping:true,taxable:false,product:{id:gid("Product","3")},variant:null,
      originalUnitPriceSet:money("10"),originalTotalSet:money("10"),totalDiscountSet:money("0")};
    await admin.query("insert into lean_private.history_import_lines values('fixture-completed',$1,$2,$3)",
      [gid("LineItem", id), o.id, JSON.stringify(line)]);
  }
  async function register(overrides = {}, enabled = true) {
    const sourceHash = (await admin.query("select encode(sha256(convert_to(completion::text,'UTF8')),'hex') h from lean_private.history_import_jobs")).rows[0].h;
    const scope = { ...baseScope, sourceHash, expiresAt: new Date(Date.now()+3600000).toISOString(), ...overrides };
    await rpc(admin, "lean_history_report_register", { p_scope: scope });
    if (enabled) await admin.query("update lean_private.history_report_jobs set enabled=true");
    return scope;
  }
  const transport: typeof fetch = async (_u, init) => {
    calls++;
    const { query, variables } = JSON.parse(String(init?.body));
    expect(query).not.toMatch(/shippingAddress|email|phone|customAttributes|firstName|lastName/);
    let data;
    if (query.includes("AnalyticsOrder")) {
      expect(query.includes("customer { id }")).toBe(customer);
      const o = structuredClone(source.commerce.order);
      if (customer) o.customer = { id: gid("Customer", "90") };
      expect(variables.id).toBe(o.id); data = { order: o };
    } else { expect(query).toContain("AnalyticsFinancial"); data = { order: source.financial }; }
    return Response.json({ data }, { headers: { "X-Shopify-API-Version": "2026-07" } });
  };
  const step = () => runHistoryReportStep({ client: { async rpc(name,args) {
    try { return { data: await rpc(runtime,name,args), error: null }; }
    catch (e) { errors.push(String(e)); return { data: null, error: e }; }
  } }, projectRef: project, databaseUrl: `https://${project}.supabase.co`, runId: run,
    accessToken: "fixture-not-a-secret", fetcher: transport });
  it("installs disabled, denies direct runtime/owner writes, and fixed projection never reads PII", async () => {
    await register({},false); expect(await step()).toEqual({ state: "disabled" }); expect(calls).toBe(0);
    await expect(runtime.query("select * from lean_private.history_report_sources")).rejects.toThrow("permission denied");
    await expect(rpc(runtime,"lean_history_report_register",{p_scope:{}})).rejects.toThrow("permission denied");
    expect(SHOPIFY_FINANCIAL_ORDER_QUERY).not.toMatch(/customer|shippingAddress/);
    expect(SHOPIFY_FINANCIAL_CUSTOMER_QUERY).toContain("customer { id }");
  });
  it("actual source→retained pending core→actual reports→complete replay with no guessed sales", async () => {
    await register(); expect(await step()).toEqual({state:"order_written",outcome:"pending_policy"});
    expect(calls).toBe(4);
    expect(await step()).toEqual({state:"report_written",date:"2026-09-21"});
    expect(await step()).toEqual({state:"complete"}); expect(calls).toBe(4);
    expect((await admin.query("select eligibility_status,customer_id,shipping_country from lean_private.orders")).rows)
      .toEqual([{eligibility_status:"pending",customer_id:null,shipping_country:null}]);
    const report=(await admin.query("select * from lean_private.report_store_daily")).rows[0];
    expect(report.net_merchandise_sales_usd).toBeNull(); expect(report.eligible_orders).toBeNull();
    expect(report.readiness.net_merchandise_sales_usd).toBe("withheld");
    expect((await admin.query("select count(*) n from lean_private.customers")).rows[0].n).toBe("0");
    expect((await admin.query("select state from lean_private.publications")).rows[0].state).toBe("candidate");
  });
  it("approved fixture financial branch uses actual mappers and formulas, not bulk totals", async () => {
    await register({policy});
    expect(await step()).toEqual({state:"order_written",outcome:"financial_observed"});
    expect(await step()).toEqual({state:"report_written",date:"2026-09-21"});
    const r=(await admin.query("select * from lean_private.report_store_daily")).rows[0];
    expect(r.net_merchandise_sales_usd).toBe("10.000000"); expect(r.aov_usd).toBe("10.000000");
    expect(r.collected_cash_usd).toBeNull(); expect(r.mer).toBeNull();
    expect(r.readiness.net_merchandise_sales_usd).toBe("observed_unverified");
  });
  it("customer opt-in retains ID only; never creates identity or permission", async () => {
    customer=true; await register({includeCustomerId:true}); await step();
    const s=(await admin.query("select source from lean_private.history_report_sources")).rows[0].source;
    expect(s.commerce.order.customer).toEqual({id:gid("Customer","90")});
    expect((await admin.query("select customer_id from lean_private.orders")).rows[0].customer_id).toBeNull();
  });
  it("changed source revision persists evidence and pending result, never upgrades financial", async () => {
    await register({policy}); source.commerce.order.updatedAt="2026-09-23T13:00:00Z"; source.financial.updatedAt="2026-09-23T13:00:00Z";
    expect(await step()).toEqual({state:"order_written",outcome:"source_revision_changed"});
    expect((await admin.query("select count(*) n from lean_private.sales_ledger")).rows[0].n).toBe("0");
  });
  it("edited source has explicit unsupported outcome and retained pending order", async () => {
    await admin.query("update lean_private.history_import_orders set source=jsonb_set(source,'{edited}','true')");
    await register({policy}); source.commerce.order.edited=true;
    expect(await step()).toEqual({state:"order_written",outcome:"shopify_original_purchase_snapshot_required"});
    expect((await admin.query("select count(*) n from lean_private.orders")).rows[0].n).toBe("1");
  });
  it("unchanged header cannot hide changed line content", async () => {
    await register({policy});
    ((source.commerce.order.lineItems as {nodes:Record<string,unknown>[]}).nodes[0]).product={id:gid("Product","4")};
    expect(await step()).toEqual({state:"order_written",outcome:"source_inventory_mismatch"});
  });
  it("finite operator refuses production/default-off before any DB or source request", async () => {
    let reads=0;const noFetch:typeof fetch=async()=>{reads++;throw new Error("forbidden");};
    const config={enabled:false,runId:run,maxSteps:1,maxProviderRequests:8};
    expect(await runHistoryReportOperator({},config,noFetch)).toEqual({status:"disabled"});
    await expect(runHistoryReportOperator({VERCEL_ENV:"production"},{...config,enabled:true},noFetch)).rejects.toThrow("history_operator_scope");
    expect(reads).toBe(0);
  });
  it("retained source resumes without another provider call after a lost worker", async () => {
    await register(); const c=common(); const input=await rpc(runtime,"lean_history_report_claim",c);
    expect(input.canRead).toBe(true);
    await rpc(runtime,"lean_history_report_retain",{...c,p_order:gid("Order","1"),p_source:source,p_captured_at:new Date().toISOString()});
    await admin.query("update lean_private.history_report_jobs set lease_until=clock_timestamp()-interval '1 second'");
    expect(await step()).toEqual({state:"order_written",outcome:"pending_policy"}); expect(calls).toBe(0);
  });
  it("unretained interrupted source attempt is not automatically repeated", async () => {
    await register(); await rpc(runtime,"lean_history_report_claim",common());
    await admin.query("update lean_private.history_report_jobs set lease_until=clock_timestamp()-interval '1 second'");
    expect(await step()).toEqual({state:"order_written",outcome:"interrupted_source_attempt"}); expect(calls).toBe(0);
  });
  it("durable progress spans orders/invocations, rejects source kill, wrong scope and changed snapshot", async () => {
    await addOrder("2"); await admin.query("update lean_private.history_import_jobs set orders=2,lines=2");
    await register(); await step(); source=packet("2"); await step();
    expect((await admin.query("select processed from lean_private.history_report_jobs")).rows[0].processed).toBe(2);
    await admin.query("update lean_private.history_import_jobs set enabled=false");
    await expect(step()).rejects.toThrow("pipeline_storage_unavailable");
    await expect(rpc(runtime,"lean_history_report_claim",{...common(),p_project:"a".repeat(20)})).rejects.toThrow("unapproved");
    expect(errors.some(e=>e.includes("history source changed"))).toBe(true);
  });
  it("concurrent claims serialize and old tokens cannot retain/write", async () => {
    await register(); const a=common(),b=common();
    const outcomes=await Promise.all([rpc(runtime,"lean_history_report_claim",a),rpc(peer,"lean_history_report_claim",b)]);
    expect(outcomes.map(o=>o.state).sort()).toEqual(["busy","order"]);
    const losing=outcomes[0].state==="busy"?a:b;
    await expect(rpc(runtime,"lean_history_report_retain",{...losing,p_order:gid("Order","1"),
      p_source:source,p_captured_at:new Date().toISOString()})).rejects.toThrow("fence");
  });
  it("post-write lease expiry rolls back core rows and cursor atomically", async () => {
    await register(); const c=common(),input=await rpc(runtime,"lean_history_report_claim",c);
    const output=normalizeHistoricalOrder({...input,evidenceRef:"fixture:retained"},null,"source_unavailable");
    await admin.query("update lean_private.history_report_jobs set lease_until=clock_timestamp()+interval '100 milliseconds'");
    await admin.query(`create function pg_temp.slow_bridge() returns trigger language plpgsql as $$begin perform pg_sleep(0.2);return new;end$$;
      create trigger bridge_delay before insert on lean_private.orders for each row execute function pg_temp.slow_bridge()`);
    await expect(rpc(runtime,"lean_history_report_order",{...c,p_order:gid("Order","1"),p_facts:output.facts,p_outcome:output.outcome})).rejects.toThrow("fence");
    expect((await admin.query("select count(*) n from lean_private.orders")).rows[0].n).toBe("0");
    expect((await admin.query("select processed from lean_private.history_report_jobs")).rows[0].processed).toBe(0);
  });
});
