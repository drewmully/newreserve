/** Fresh disposable SQL only. No source calls, credentials or hosted writes. */
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { composeRetainedOrderReports } from "@/lib/analytics/shopifyRetainedOrder";
import { projectOrderSizeLine } from "@/lib/analytics/shopifyOrderSize";
import type { PilotSource } from "@/lib/analytics/shopifyPilotSource";
import type { PilotPolicy } from "@/lib/analytics/shopifyPilotMapping";
import type { Row } from "@/lib/analytics/primitives";

const sql = (name: string) => readFileSync(`sql/analytics/${name}.sql`, "utf8");
const shop = "extended-fixture.myshopify.com", project = "aaaaaaaaaaaaaaaaaaaa";
const money = (amount: string) => ({ shopMoney: { amount, currencyCode: "USD" } });
const conn = (nodes: unknown[]) => ({ nodes, pageInfo: { hasNextPage: false, endCursor: null } });
const gid = (kind: string, id: string) => `gid://shopify/${kind}/${id}`;
const policy: PilotPolicy = {
  decision: { eligibility: "eligible", commerceSource: "storefront", acquisitionEligible: false, approvalRef: "fixture:decision" },
  lineClasses: { "2": "merchandise", "5": "merchandise" }, financialApprovalRef: "fixture:finance",
  saleClock: "paid_at", refundClock: "refund_created_at",
};
function source(sized: boolean, orderId: string, revision: string, lineCount?: number): PilotSource {
  const total = String(lineCount ?? 30);
  const lineRows = lineCount === undefined ? [["2", "3", "BOX", "10"], ["5", "6", "SHIRT", "20"]] :
    Array.from({ length: lineCount }, (_, index) => [String(1000 + index), "3", `SKU-${index}`, "1"]);
  const order = {
    id: gid("Order", orderId), createdAt: "2026-01-01T12:00:00Z", updatedAt: revision,
    currencyCode: "USD", edited: false, taxesIncluded: false, test: false, cancelledAt: null,
    originalTotalPriceSet: money(total), subtotalPriceSet: money(total),
    transactionsCount: { count: 1, precision: "EXACT" },
    transactions: [{ id: gid("OrderTransaction", "4"), kind: "SALE", status: "SUCCESS", gateway: "fixture",
      test: false, createdAt: "2026-01-01T12:00:00Z", processedAt: "2026-01-01T12:01:00Z",
      amountSet: money(total), parentTransaction: null }],
    lineItems: conn(lineRows.map(([id, product, sku, amount]) => {
      const line = { id: gid("LineItem", id), sku, quantity: 1, isGiftCard: false, product: { id: gid("Product", product) },
        originalUnitPriceSet: money(amount), originalTotalSet: money(amount), discountAllocations: [] };
      return sized ? projectOrderSizeLine({ ...line, customAttributes: [{ key: "Top size", value: "M" }], variantTitle: null }) : line;
    })),
  };
  return { commerce: { shop, apiVersion: "2026-07", projection: sized ? "financial_no_geo_order_size" : "financial_no_geo", order },
    financial: { id: order.id, updatedAt: order.updatedAt, currencyCode: "USD", originalTotalPriceSet: money(total),
      totalTaxSet: money("0"), originalTotalDutiesSet: null, originalTotalAdditionalFeesSet: null,
      totalTipReceivedSet: money("0"), shippingLines: conn([]), refunds: [] }, refunds: [] };
}
let db: PGlite, network: ReturnType<typeof vi.fn>;
const rows = async (query: string) => (await db.query<Row>(query)).rows;
beforeEach(async () => {
  network = vi.fn(() => { throw new Error("network_forbidden"); }); vi.stubGlobal("fetch", network);
  db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role;
    alter default privileges in schema public grant execute on functions to anon,authenticated,service_role;`);
  for (const name of ["001_staging", "003_receipts", "004_worker", "013_release", "014_reporting_views", "017_shopify_pipeline"])
    await db.exec(sql(name));
  await db.exec(sql("047_pipeline_extended"));
}, 30000);
afterEach(async () => { await db?.close(); expect(network).not.toHaveBeenCalled(); vi.unstubAllGlobals(); });

async function prepare(sized = false, saved: Record<string, unknown> = {},
  orderId = "1", revision = "2026-01-02T12:00:00Z", lineCount?: number) {
  const mapper: PilotPolicy = { ...policy,
    ...(lineCount === undefined ? {} : { lineClasses: Object.fromEntries(
      Array.from({ length: lineCount }, (_, index) => [String(1000 + index), "merchandise" as const])) }),
    ...(sized ? { orderSize: { policyRef: "fixture:size",
    productSemantics: { "3": "requested_box_top_size", "6": "requested_box_top_size" } } } : {}) };
  const snapshotPolicy = { ...mapper, productClasses: { "3": "merchandise", "6": "merchandise" },
    sourceProjection: sized ? "financial_no_geo_order_size" : "financial_no_geo", retainedReports: "product-v1", ...saved };
  await db.query(`insert into lean_private.pipeline_scope(shop,project_ref,enabled,from_time,until_time,policy,approval_ref,actor_ref)
    values($1,$2,true,'2026-01-01','2026-02-01',$3::jsonb,'fixture:scope','fixture:owner') on conflict do nothing`,
  [shop, project, JSON.stringify(snapshotPolicy)]);
  await db.query(`select public.lean_accept_receipt('shopify',$4,$1,'orders/paid',$2,$3::jsonb)`,
    [JSON.stringify([shop, orderId]), "a".repeat(64), JSON.stringify({ admin_graphql_api_id: gid("Order", orderId) }), randomUUID()]);
  const token = randomUUID();
  const claimed = (await db.query<{ r: { workId: string; publication: string } }>(
    "select public.lean_pipeline_claim($1::uuid,$2,$3) r", [token, project, shop])).rows[0].r;
  const retained = source(sized, orderId, revision, lineCount);
  expect((await db.query<{ ok: boolean }>("select public.lean_pipeline_retain($1::bigint,$2::uuid,$3::jsonb) ok",
    [claimed.workId, token, JSON.stringify(retained)])).rows[0].ok).toBe(true);
  const output = composeRetainedOrderReports(retained, mapper, claimed.publication, "fixture:retained",
    "shopify-observed-v1", sized ? { orderSizeSidecar: true } : undefined);
  return { workId: claimed.workId, token, output };
}
type Prepared = Awaited<ReturnType<typeof prepare>>;
async function finish(p: Prepared, products: unknown = p.output.productReports,
  sizes: unknown = p.output.order_item_sizes ?? null) {
  const result = await db.query<{ ok: boolean }>(
    "select public.lean_pipeline_finish_extended($1::bigint,$2::uuid,$3::jsonb,$4::jsonb,$5::jsonb,$6::jsonb) ok",
    [p.workId, p.token, JSON.stringify(p.output.facts), JSON.stringify(p.output.reports),
      JSON.stringify(products), sizes === null ? null : JSON.stringify(sizes)]);
  return result.rows[0].ok;
}
async function untouched(p: Prepared) {
  for (const table of ["orders", "order_items", "sales_ledger", "payments", "report_store_daily", "report_product_daily", "pipeline_heads"])
    expect(await rows(`select count(*)::int n from lean_private.${table}`)).toEqual([{ n: 0 }]);
  expect(await rows("select state,lease_token from lean_private.work")).toEqual([{ state: "leased", lease_token: p.token }]);
  expect(await rows("select count(*)::int n from lean_private.pipeline_snapshots where source is not null")).toEqual([{ n: 1 }]);
}
it("preserves legacy finish definition/ACL and legacy path; grants only the additive RPC to service", async () => {
  const legacy = await rows(`select pg_get_functiondef(oid) body,proacl::text acl from pg_proc
    where oid='public.lean_pipeline_finish(bigint,uuid,jsonb,jsonb)'::regprocedure`);
  expect(legacy[0].body).toContain("insert into lean_private.report_store_daily");
  // Recreate a fresh baseline digest rather than assuming an old checked-in hash.
  const baseline = new PGlite();
  try {
    await baseline.exec("create role anon; create role authenticated; create role service_role; alter default privileges in schema public grant execute on functions to anon,authenticated,service_role;");
    for (const name of ["001_staging", "003_receipts", "004_worker", "013_release", "014_reporting_views", "017_shopify_pipeline"])
      await baseline.exec(sql(name));
    expect((await baseline.query("select pg_get_functiondef(oid) body,proacl::text acl from pg_proc where oid='public.lean_pipeline_finish(bigint,uuid,jsonb,jsonb)'::regprocedure")).rows).toEqual(legacy);
    const viewQuery = `select relname,pg_get_viewdef(oid) body,relacl::text acl from pg_class where
      relnamespace='lean_analytics'::regnamespace and relkind='v' and relname<>'observed_product_daily' order by relname`;
    expect(await rows(viewQuery)).toEqual((await baseline.query(viewQuery)).rows);
  } finally { await baseline.close(); }
  expect(await rows(`select has_function_privilege('anon','public.lean_pipeline_finish_extended(bigint,uuid,jsonb,jsonb,jsonb,jsonb)','execute') a,
    has_function_privilege('authenticated','public.lean_pipeline_finish_extended(bigint,uuid,jsonb,jsonb,jsonb,jsonb)','execute') u,
    has_function_privilege('service_role','public.lean_pipeline_finish_extended(bigint,uuid,jsonb,jsonb,jsonb,jsonb)','execute') s`))
    .toEqual([{ a: false, u: false, s: true }]);
  const p = await prepare(false, { retainedReports: null });
  await expect(finish(p)).rejects.toThrow("extended report policy required");
  expect((await db.query<{ ok: boolean }>("select public.lean_pipeline_finish($1::bigint,$2::uuid,$3::jsonb,$4::jsonb) ok",
    [p.workId, p.token, JSON.stringify(p.output.facts), JSON.stringify(p.output.reports)])).rows[0].ok).toBe(true);
  expect(await rows("select count(*)::int n from lean_private.report_product_daily")).toEqual([{ n: 0 }]);
});
it("commits product-only without 046 and handles replay/lost response without duplicate writes", async () => {
  const p = await prepare();
  expect(await rows("select to_regclass('lean_private.order_item_sizes') is null absent")).toEqual([{ absent: true }]);
  expect(await finish({ ...p, token: randomUUID() })).toBe(false);
  await untouched(p);
  await db.exec("set role service_role");
  expect(await finish(p)).toBe(true);
  expect(await finish(p)).toBe(false);
  await db.exec("reset role");
  expect(await rows("select count(*)::int n from lean_private.report_product_daily")).toEqual([{ n: 2 }]);
  expect(await rows("select state from lean_private.work")).toEqual([{ state: "done" }]);
  expect(await rows("select count(*)::int n from lean_private.pipeline_heads")).toEqual([{ n: 1 }]);
  expect(await rows("select count(*)::int n from lean_analytics.product_daily")).toEqual([{ n: 0 }]); // No selected publication.
});
it.each(["expired", "disabled"] as const)("rejects %s fence without writes", async mode => {
  const p = await prepare();
  await db.exec(mode === "expired" ? "update lean_private.work set lease_until=clock_timestamp()-interval '1 second'" :
    "update lean_private.pipeline_scope set enabled=false");
  expect(await finish(p)).toBe(false); await untouched(p);
});
it("requires 046 only when opted in and commits canonical sidecars atomically after it is installed", async () => {
  const p = await prepare(true);
  await expect(finish(p)).rejects.toThrow("size sink unavailable"); await untouched(p);
  await db.exec(sql("046_order_item_sizes"));
  await db.exec("set role service_role");
  expect(await finish(p)).toBe(true);
  await db.exec("reset role");
  expect((await rows("select * from lean_private.order_item_sizes order by order_item_id")))
    .toEqual([...p.output.order_item_sizes!].sort((a, b) => a.order_item_id.localeCompare(b.order_item_id)));
});
it.each(["product", "size"] as const)("rolls back facts/store/product/head/work on injected %s sink failure", async mode => {
  await db.exec(sql("046_order_item_sizes"));
  const p = await prepare(true);
  await db.exec(`create function lean_private.fixture_reject() returns trigger language plpgsql as
    $$ begin raise exception 'fixture injected sink failure'; end $$;
    create trigger fixture_reject before insert on lean_private.${mode === "product" ? "report_product_daily" : "order_item_sizes"}
    for each row execute function lean_private.fixture_reject();`);
  await expect(finish(p)).rejects.toThrow("fixture injected sink failure");
  await untouched(p);
  expect(await rows("select count(*)::int n from lean_private.order_item_sizes")).toEqual([{ n: 0 }]);
});
it.each([
  ["foreign shop", { shop_id: "other.myshopify.com" }], ["foreign publication", { publication_id: "other" }],
  ["foreign definition", { definition_version: "other" }], ["foreign SKU", { sku_bucket: "OTHER" }],
  ["foreign date", { report_date: "2026-02-01" }], ["extra key", { private: "must not persist" }],
  ["numeric JSON metric", { units: 1 }], ["overprecision", { units: "1.0000001" }],
  ["non-stale", { is_stale: false }], ["malformed readiness", { readiness: [] }],
] as const)("rejects product %s before writing", async (_name, change) => {
  const p = await prepare();
  const products = structuredClone(p.output.productReports); Object.assign(products[0], change);
  await expect(finish(p, products)).rejects.toThrow(/invalid product|product report coverage/); await untouched(p);
});
it.each(["duplicate", "omitted", "scalar", "null"] as const)("rejects %s product batch", async mode => {
  const p = await prepare(), products = p.output.productReports;
  const changed = mode === "duplicate" ? [products[0], products[0]] : mode === "omitted" ? [products[0]] : mode === "scalar" ? "bad" : null;
  await expect(finish(p, changed)).rejects.toThrow(/invalid extended batch|extended batch budget|product report coverage/); await untouched(p);
});
it.each([
  ["foreign item", { order_item_id: "other" }], ["foreign publication", { publication_id: "other" }],
  ["foreign policy", { policy_ref: "other" }], ["wrong semantics", { size_semantics: "purchased_shirt_variant" }],
  ["invalid size enum", { size_value: "arbitrary" }], ["extra key", { email: "must not persist" }],
] as const)("rejects size %s; even writer-level failure rolls back legacy finish", async (_name, change) => {
  await db.exec(sql("046_order_item_sizes")); const p = await prepare(true);
  const sizes = structuredClone(p.output.order_item_sizes!); Object.assign(sizes[0], change);
  await expect(finish(p, p.output.productReports, sizes)).rejects.toThrow(
    /size sidecar scope|size sidecar semantics|order_item_sizes_size_value_check|invalid order size shape/);
  await untouched(p);
});
it.each(["missing", "duplicate"] as const)("rejects %s size coverage", async mode => {
  await db.exec(sql("046_order_item_sizes")); const p = await prepare(true);
  const sizes = p.output.order_item_sizes!;
  await expect(finish(p, p.output.productReports, mode === "missing" ? [sizes[0]] : [sizes[0], sizes[0]])).rejects.toThrow("size sidecar scope mismatch");
  await untouched(p);
});
it.each([null, "not-an-object", { policyRef: "", productSemantics: {} }] as const)("rejects malformed immutable orderSize %j", async orderSize => {
  const p = await prepare(false, { orderSize });
  await expect(finish(p)).rejects.toThrow("invalid size policy"); await untouched(p);
});
it("refuses unapproved sidecars even with 046 installed", async () => {
  await db.exec(sql("046_order_item_sizes")); const p = await prepare();
  await expect(finish(p, p.output.productReports, [])).rejects.toThrow("size sidecar not approved"); await untouched(p);
});
it("owner-only aggregate uses latest heads across orders, never old revisions, and flags missing legacy coverage", async () => {
  const aggregate = () => rows(`select sku_bucket,units::text,gross_merchandise_sales_usd::text,pipeline_stale,
    certification,coverage from lean_analytics.observed_product_daily order by sku_bucket`);
  expect(await rows(`select has_table_privilege(role,'lean_analytics.observed_product_daily','select') allowed
    from unnest(array['anon','authenticated','service_role','lean_observed_reader']) role`))
    .toEqual(Array(4).fill({ allowed: false }));
  const first = await prepare(); expect(await finish(first)).toBe(true);
  const expected = await aggregate();
  const newer = await prepare(false, {}, "1", "2026-01-04T12:00:00Z");
  expect(await finish(newer)).toBe(true); expect(await aggregate()).toEqual(expected);
  const older = await prepare(false, {}, "1", "2026-01-03T12:00:00Z");
  expect(await finish(older)).toBe(true); expect(await aggregate()).toEqual(expected);
  const another = await prepare(false, {}, "9");
  expect(await finish(another)).toBe(true);
  expect(await aggregate()).toEqual([
    { sku_bucket: "BOX", units: "2.000000", gross_merchandise_sales_usd: "20.000000", pipeline_stale: false,
      certification: "unverified", coverage: "webhook_observed_only" },
    { sku_bucket: "SHIRT", units: "2.000000", gross_merchandise_sales_usd: "40.000000", pipeline_stale: false,
      certification: "unverified", coverage: "webhook_observed_only" },
  ]);
  const oldCaller = await prepare(false, {}, "10");
  await db.query("select public.lean_pipeline_finish($1::bigint,$2::uuid,$3::jsonb,$4::jsonb)",
    [oldCaller.workId, oldCaller.token, JSON.stringify(oldCaller.output.facts), JSON.stringify(oldCaller.output.reports)]);
  expect((await aggregate()).every(row => row.pipeline_stale)).toBe(true);
  const columns = (await rows("select * from lean_analytics.observed_product_daily limit 1"))[0];
  expect(Object.keys(columns)).not.toEqual(expect.arrayContaining(["publication_id"]));
  for (const forbidden of ["order_gid", "work_id", "customer_id", "source_revision", "aov_usd"])
    expect(columns).not.toHaveProperty(forbidden);
});
it("aggregate null-propagates included unknown product values and reports queue/scope staleness", async () => {
  expect(await finish(await prepare())).toBe(true);
  const second = await prepare(false, {}, "9");
  second.output.productReports[0].net_merchandise_sales_usd = null;
  (second.output.productReports[0].readiness as Record<string, string>).net_merchandise_sales_usd = "withheld";
  expect(await finish(second)).toBe(true);
  expect(await rows(`select net_merchandise_sales_usd,readiness->>'net_merchandise_sales_usd' status
    from lean_analytics.observed_product_daily where sku_bucket='BOX'`)).toEqual([{ net_merchandise_sales_usd: null, status: "withheld" }]);
  await prepare(false, {}, "10"); // A real pending/leased fixture receipt, not a synthetic health override.
  expect(await rows("select bool_and(pipeline_stale) stale from lean_analytics.observed_product_daily")).toEqual([{ stale: true }]);
  await db.exec("update lean_private.pipeline_scope set enabled=false");
  expect(await rows("select bool_and(pipeline_stale) stale from lean_analytics.observed_product_daily")).toEqual([{ stale: true }]);
});
it.each([101, 500])("accepts supported original-line capacity %i with complete SKU coverage", async lineCount => {
  const p = await prepare(false, {}, "1", "2026-01-02T12:00:00Z", lineCount);
  expect(p.output.facts.order_items).toHaveLength(lineCount);
  expect(p.output.productReports).toHaveLength(lineCount);
  expect(await finish(p)).toBe(true);
  expect(await rows("select count(*)::int n from lean_private.order_items")).toEqual([{ n: lineCount }]);
  expect(await rows("select count(*)::int n from lean_private.report_product_daily")).toEqual([{ n: lineCount }]);
  expect(await rows("select sum(units)::text units from lean_analytics.observed_product_daily"))
    .toEqual([{ units: `${lineCount}.000000` }]);
});
it("rejects original-line capacity 501 without writes", async () => {
  const p = await prepare(false, {}, "1", "2026-01-02T12:00:00Z", 501);
  await expect(finish(p)).rejects.toThrow("extended batch budget"); await untouched(p);
});
it("rejects product-row capacity 2001 before duplicate/shape checks without writes", async () => {
  const p = await prepare();
  await expect(finish(p, Array.from({ length: 2001 }, () => p.output.productReports[0])))
    .rejects.toThrow("extended batch budget");
  await untouched(p);
});
it("rejects empty size product semantics, matching caller policy validation", async () => {
  const p = await prepare(true, { orderSize: { policyRef: "fixture:size", productSemantics: {} } });
  await expect(finish(p)).rejects.toThrow("empty size product semantics"); await untouched(p);
});
