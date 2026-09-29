/** Synthetic only. Network blocked; no retained samples or provider calls. */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildCommerceCandidate } from "@/lib/analytics/commerceCandidate";
import { mapShopifyAnalyticsOrder } from "@/lib/analytics/shopifyMapping";
import { mapPilotSource, type PilotPolicy } from "@/lib/analytics/shopifyPilotMapping";
import { readPilotSource, PILOT_FINANCIAL_QUERY, type PilotSource } from "@/lib/analytics/shopifyPilotSource";
import {
  readShopifyAnalyticsOrder, SHOPIFY_FINANCIAL_ORDER_QUERY, SHOPIFY_FINANCIAL_ORDER_SIZE_QUERY,
  sourceObject, type SourceObject,
} from "@/lib/analytics/shopifySource";
import { ORDER_SIZES, projectOrderSizeLine } from "@/lib/analytics/shopifyOrderSize";

const shop = "mullybox-store.myshopify.com", project = "xeqlgxvrhgwwudyqtnun";
const run = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", pub = `pilot:${run}`;
const token = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const money = (amount: string) => ({ shopMoney: { amount, currencyCode: "USD" } });
const connection = (nodes: unknown[]) => ({ nodes, pageInfo: { hasNextPage: false, endCursor: null } });
const policy: PilotPolicy = {
  decision: { eligibility: "eligible", commerceSource: "storefront", acquisitionEligible: false,
    approvalRef: "synthetic:eligibility" },
  lineClasses: { "2": "merchandise" }, financialApprovalRef: "synthetic:finance",
  saleClock: "paid_at", refundClock: "refund_created_at",
};
const sizedPolicy: PilotPolicy = { ...policy, orderSize: { policyRef: "synthetic:size-policy",
  productSemantics: { "3": "requested_box_top_size" } } };
const scope = { shop, publication: pub, definition: "synthetic:v1",
  fromDate: "2026-01-01", throughDate: "2026-01-02" };
const sink = { orderSizeSidecar: true } as const;
function fixture(): PilotSource {
  const order = {
    id: "gid://shopify/Order/1", createdAt: "2026-01-01T12:00:00Z", updatedAt: "2026-01-02T12:00:00Z",
    currencyCode: "USD", test: false, cancelledAt: null, edited: false, taxesIncluded: false,
    originalTotalPriceSet: money("22"), subtotalPriceSet: money("18"),
    transactionsCount: { count: 1, precision: "EXACT" },
    transactions: [{ id: "gid://shopify/OrderTransaction/4", kind: "SALE", status: "SUCCESS",
      gateway: "synthetic", test: false, createdAt: "2026-01-01T12:00:00Z",
      processedAt: "2026-01-01T12:01:00Z", amountSet: money("22"), parentTransaction: null }],
    lineItems: connection([{ id: "gid://shopify/LineItem/2", sku: "SYNTHETIC-BOX", quantity: 2,
      isGiftCard: false, product: { id: "gid://shopify/Product/3" },
      originalUnitPriceSet: money("10"), originalTotalSet: money("20"),
      discountAllocations: [{ allocatedAmountSet: money("2") }] }]),
  };
  return { commerce: { shop, apiVersion: "2026-07", projection: "financial_no_geo", order },
    financial: { id: order.id, updatedAt: order.updatedAt, currencyCode: "USD",
      originalTotalPriceSet: money("22"), totalTaxSet: money("4"), originalTotalDutiesSet: null,
      originalTotalAdditionalFeesSet: null, totalTipReceivedSet: money("0"), shippingLines: connection([]), refunds: [] },
    refunds: [] };
}
function lines(source: PilotSource): SourceObject[] {
  return sourceObject(source.commerce.order.lineItems).nodes as SourceObject[];
}
function sized(raw: SourceObject = { customAttributes: [{ key: "Top size", value: " m " }], variantTitle: null }) {
  const source = fixture();
  source.commerce.projection = "financial_no_geo_order_size";
  sourceObject(source.commerce.order.lineItems).nodes = [projectOrderSizeLine({ ...lines(source)[0], ...raw })];
  return source;
}
const map = (source = sized(), p = sizedPolicy) =>
  mapShopifyAnalyticsOrder(source.commerce, { ...p, sourceEvidenceRef: "synthetic:retained" }, pub);
const record = (source = sized(), p = sizedPolicy) => ({ source, policy: p, evidenceRef: "synthetic:retained" });
const response = (order: SourceObject) => Response.json({ data: { order } },
  { headers: { "X-Shopify-API-Version": "2026-07" } });
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
let network: ReturnType<typeof vi.fn>;
beforeEach(() => { network = vi.fn(() => { throw new Error("network_forbidden"); }); vi.stubGlobal("fetch", network); });
afterEach(() => { expect(network).not.toHaveBeenCalled(); vi.unstubAllGlobals(); });

describe("explicit sanitized order-time size evidence", () => {
  it("leaves the financial query and legacy candidate byte output unchanged", async () => {
    expect(SHOPIFY_FINANCIAL_ORDER_QUERY).not.toMatch(/customAttributes|variantTitle|customer|Address|selectedOptions/);
    expect(SHOPIFY_FINANCIAL_ORDER_SIZE_QUERY).not.toMatch(/customer|Address|selectedOptions|customAttributes\(/);
    const source = fixture(), fetcher = vi.fn<typeof fetch>(async (_, init) => {
      expect(JSON.parse(String(init?.body)).query).toBe(SHOPIFY_FINANCIAL_ORDER_QUERY);
      return response(source.commerce.order);
    });
    const read = await readShopifyAnalyticsOrder({ shop, accessToken: "synthetic", fetcher,
      projection: "financial_no_geo" }, String(source.commerce.order.id));
    expect(JSON.stringify(read)).toBe(JSON.stringify(source.commerce));
    const baseline = buildCommerceCandidate([record(source, policy)], scope);
    expect(JSON.stringify(buildCommerceCandidate([record(source, policy)], scope, sink))).toBe(JSON.stringify(baseline));
    expect(baseline).not.toHaveProperty("order_item_sizes");
    const enriched = buildCommerceCandidate([record()], scope, sink);
    expect(digest(enriched.facts)).toBe(digest(baseline.facts));
    expect(digest(enriched.reports)).toBe(digest(baseline.reports));
  });
  it("projects every page before retention and never emits unrelated attributes/raw title/current profile", async () => {
    const source = fixture(), raw = lines(source)[0];
    Object.assign(raw, { customAttributes: [{ key: "Top size", value: " xl " },
      { key: "Gift message", value: "PRIVATE-GIFT" }, { key: "Email", value: "PRIVATE-EMAIL" }],
    variantTitle: "PRIVATE-TITLE", variant: { selectedOptions: "PRIVATE-CURRENT" } });
    const first = structuredClone(source.commerce.order), second = structuredClone(first);
    first.lineItems = { nodes: [raw], pageInfo: { hasNextPage: true, endCursor: "page2" } };
    second.lineItems = connection([{ ...raw, id: "gid://shopify/LineItem/5" }]);
    const pages = [first, second, first];
    const fetcher = vi.fn<typeof fetch>(async () => response(pages.shift()!));
    const document = await readShopifyAnalyticsOrder({ shop, accessToken: "synthetic", fetcher,
      projection: "financial_no_geo_order_size" }, String(first.id));
    expect(JSON.stringify(document)).not.toMatch(/PRIVATE-|customAttributes|selectedOptions/);
    expect((sourceObject(document.order.lineItems).nodes as SourceObject[])).toHaveLength(2);
    for (const line of sourceObject(document.order.lineItems).nodes as SourceObject[])
      expect(line.orderSize).toEqual({ topSize: { value: "XL", status: "known" },
        variantTitle: { value: null, status: "unsupported" } });
  });
  it("drops unsolicited fields at the root and every financial nesting depth without losing required evidence", async () => {
    const source = fixture(), order = source.commerce.order;
    const transaction = (order.transactions as SourceObject[])[0];
    order.transactions = [
      { ...transaction, id: "gid://shopify/OrderTransaction/5", kind: "AUTHORIZATION" },
      { ...transaction, kind: "CAPTURE", parentTransaction: {
        id: "gid://shopify/OrderTransaction/5", gateway: "synthetic",
      } },
    ];
    order.transactionsCount = { count: 2, precision: "EXACT" };
    Object.assign(lines(source)[0], { customAttributes: [{ key: "Top size", value: " m " }], variantTitle: null });
    // Poison every object: line/product, both money layers, allocation, transaction,
    // parent transaction, count, connection and pageInfo as well as the root.
    function poison(value: unknown) {
      if (Array.isArray(value)) { value.forEach(poison); return; }
      if (value && typeof value === "object") {
        Object.values(value).forEach(poison);
        Object.assign(value, { unsolicited: "PRIVATE-NESTED" });
      }
    }
    poison(order);
    Object.assign(order, { email: "PRIVATE-EMAIL", phone: "PRIVATE-PHONE", note: "PRIVATE-NOTE",
      customAttributes: [{ key: "Email", value: "PRIVATE-ROOT-ATTRIBUTE" }] });
    const fetcher = vi.fn<typeof fetch>(async () => response(order));
    const commerce = await readShopifyAnalyticsOrder({ shop, accessToken: "synthetic", fetcher,
      projection: "financial_no_geo_order_size" }, String(order.id));
    expect(JSON.stringify(commerce)).not.toMatch(/PRIVATE-|unsolicited|customAttributes|email|phone|note/);
    expect(sourceObject(commerce.order.lineItems).pageInfo).toEqual({ hasNextPage: false, endCursor: null });
    expect(commerce.order.transactionsCount).toEqual({ count: 2, precision: "EXACT" });
    expect((commerce.order.transactions as SourceObject[])[1].parentTransaction)
      .toEqual({ id: "gid://shopify/OrderTransaction/5", gateway: "synthetic" });
    const result = map({ ...source, commerce });
    expect(result.order_items[0]).toMatchObject({ source_line_id: "2", quantity: "2.000000",
      unit_price_usd: "10.000000", purchase_discount_usd: "2.000000", purchase_net_usd: "18.000000" });
    expect(result.payments.map(row => row.source_amount)).toEqual(["22.000000", "22.000000"]);
    expect(result.order_item_sizes?.[0]).toMatchObject({ size_value: "M", size_status: "known" });
  });
  it("rejects nested payloads disguised as selected scalars with a sanitized error", async () => {
    const source = fixture();
    sourceObject(sourceObject(lines(source)[0].originalTotalSet).shopMoney).amount = { email: "PRIVATE-AMOUNT" };
    const fetcher = vi.fn<typeof fetch>(async () => response(source.commerce.order));
    await expect(readShopifyAnalyticsOrder({ shop, accessToken: "synthetic", fetcher,
      projection: "financial_no_geo_order_size" }, String(source.commerce.order.id)))
      .rejects.toThrow(/^shopify_schema_drift$/);
  });
  it.each(ORDER_SIZES)("normalizes only canonical %s, distinguishing box request from purchased variant", value => {
    expect(map(sized({ customAttributes: [{ key: "Top size", value: value.toLowerCase() }], variantTitle: null }))
      .order_item_sizes?.[0]).toMatchObject({ size_value: value, size_status: "known",
        size_semantics: "requested_box_top_size", size_source: "custom_attribute_top_size" });
    const shirt = { ...sizedPolicy, orderSize: { policyRef: "synthetic:shirt",
      productSemantics: { "3": "purchased_shirt_variant" as const } } };
    expect(map(sized({ customAttributes: [], variantTitle: value }), shirt).order_item_sizes?.[0])
      .toMatchObject({ size_value: value, size_semantics: "purchased_shirt_variant", size_source: "variant_title_snapshot" });
    expect(map(sized({ customAttributes: [{ key: "Top size", value }], variantTitle: null }), shirt)
      .order_item_sizes?.[0]).toMatchObject({ size_value: null, size_status: "missing" });
  });
  it.each([
    [[], "missing"], [[{ key: "top size", value: "M" }], "missing"],
    [[{ key: "Top size", value: "medium" }], "invalid"],
    [[{ key: "Top size", value: "M" }, { key: "Top size", value: "L" }], "conflict"],
    [[{ key: "Top size", value: "M" }, { key: "Top size", value: "PRIVATE" }], "invalid"],
    [null, "invalid"], [undefined, "projection_absent"],
  ])("nulls unusable approved attributes (%j)", (customAttributes, status) => {
    const source = sized({ customAttributes, variantTitle: null });
    expect(JSON.stringify(source)).not.toContain("PRIVATE");
    expect(map(source).order_item_sizes?.[0]).toMatchObject({ size_value: null, size_status: status });
  });
  it("handles duplicate agreement, cross-signal conflict, composite title and absent/unsupported product explicitly", () => {
    expect(map(sized({ customAttributes: [{ key: "Top size", value: "M" }, { key: "Top size", value: "m" }],
      variantTitle: null })).order_item_sizes?.[0].size_value).toBe("M");
    expect(map(sized({ customAttributes: [{ key: "Top size", value: "M" }], variantTitle: "L" }))
      .order_item_sizes?.[0]).toMatchObject({ size_value: null, size_status: "conflict" });
    const shirt = { ...sizedPolicy, orderSize: { policyRef: "synthetic:shirt",
      productSemantics: { "3": "purchased_shirt_variant" as const } } };
    expect(map(sized({ customAttributes: [], variantTitle: "Blue / XL" }), shirt).order_item_sizes?.[0])
      .toMatchObject({ size_value: null, size_status: "unsupported" });
    expect(map(fixture()).order_item_sizes?.[0]).toMatchObject({ size_status: "projection_absent", size_source: "none" });
    expect(map(sized(), { ...sizedPolicy, orderSize: { policyRef: "synthetic:empty", productSemantics: {} } })
      .order_item_sizes?.[0]).toMatchObject({ size_status: "unsupported", size_semantics: "unsupported" });
    const deletedProduct = sized(); lines(deletedProduct)[0].product = null;
    expect(map(deletedProduct).order_item_sizes?.[0].size_status).toBe("unsupported");
  });
  it("fails closed for unsanitized projections, missing product policy and ordinary hosted writer sinks", () => {
    const raw = sized(); lines(raw)[0].customAttributes = [];
    expect(() => map(raw)).toThrow("shopify_unsanitized_size_projection");
    expect(() => map(sized(), policy)).toThrow("shopify_size_policy_required");
    expect(() => mapPilotSource(sized(), sizedPolicy, pub, "synthetic:retained")).toThrow("size_sidecar_sink_required");
    expect(() => buildCommerceCandidate([record()], scope)).toThrow("size_sidecar_sink_required");
  });
  it("carries only the latest revision sidecar, detects same-revision/policy conflicts and never backfills from old size", () => {
    const older = sized(), latest = sized({ customAttributes: [], variantTitle: null });
    latest.commerce.order.updatedAt = latest.financial.updatedAt = "2026-01-03T00:00:00Z";
    const result = buildCommerceCandidate([record(older), record(latest)], scope, sink);
    expect(result.selectedOrders).toBe(1);
    expect(result.order_item_sizes).toHaveLength(1);
    expect(result.order_item_sizes?.[0]).toMatchObject({ size_value: null, size_status: "missing" });
    expect(() => buildCommerceCandidate([record(older), record(sized({ customAttributes: [], variantTitle: null }))],
      scope, sink)).toThrow("commerce_candidate_revision_conflict");
    expect(() => buildCommerceCandidate([record(older), record(latest, policy)], scope, sink))
      .toThrow("commerce_candidate_policy_conflict");
  });
});

const sql = (name: string) => readFileSync(`sql/analytics/${name}.sql`, "utf8");
async function database() {
  const db = new PGlite();
  await db.exec(`create role anon;create role authenticated;create role service_role;
    alter default privileges grant all on tables to anon,authenticated,service_role;
    alter default privileges grant execute on functions to anon,authenticated,service_role;`);
  for (const name of ["001_staging", "013_release", "014_reporting_views"]) await db.exec(sql(name));
  return db;
}
const tableNames = async (db: PGlite) => (await db.query<{ tablename: string }>(
  "select tablename from pg_tables where schemaname='lean_private' order by 1")).rows.map(r => r.tablename);
describe("optional 046 owner-only companion persistence", () => {
  it("keeps the exact21 legacy schema separate from the explicit22 optional schema", async () => {
    const db = await database();
    try {
      const legacy = await tableNames(db); expect(legacy).toHaveLength(21);
      await db.exec(sql("046_order_item_sizes"));
      const extended = await tableNames(db); expect(extended).toHaveLength(22);
      expect(extended.filter(name => name !== "order_item_sizes")).toEqual(legacy);
      expect(extended).not.toEqual(legacy); // Old exact allowlist MUST reject the optional schema.
      expect((await db.query("select relrowsecurity from pg_class where oid='lean_private.order_item_sizes'::regclass")).rows)
        .toEqual([{ relrowsecurity: true }]);
      for (const role of ["anon", "authenticated", "service_role"])
        expect((await db.query(`select has_table_privilege($1,'lean_private.order_item_sizes','SELECT') r,
          has_table_privilege($1,'lean_private.order_item_sizes','INSERT') w,
          has_function_privilege($1,'lean_private.write_order_item_sizes(text,jsonb)','EXECUTE') x`, [role])).rows)
          .toEqual([{ r: false, w: false, x: false }]);
    } finally { await db.close(); }
  }, 30000);
  it("roundtrips sanitized reader -> candidate -> existing016 writer + companion atomically; preserves saved044 hash", async () => {
    const db = await database();
    try {
      await db.exec(sql("016_shopify_pilot")); await db.exec(sql("044_selected_order_delivery"));
      const legacy = fixture(), old = mapPilotSource(legacy, policy, pub, "synthetic:retained");
      await db.query("insert into lean_private.pilot_environment(project_ref,approval_ref) values($1,'synthetic:test')", [project]);
      await db.query("select public.lean_pilot_register($1,$2,$3,$4,'synthetic:test','synthetic:owner')",
        [run, shop, legacy.commerce.order.id, JSON.stringify(policy)]);
      await db.query("select public.lean_pilot_claim($1,$2,$3)", [run, token, project]);
      await db.query("select public.lean_pilot_retain($1,$2,$3)", [run, token, JSON.stringify(legacy)]);
      await db.query("select public.lean_pilot_finish($1,$2,$3,$4)", [run, token, JSON.stringify(old.facts), JSON.stringify(old.reports)]);
      const extract = async () => (await db.query<{ input: { inputHash: string } }>(
        "select public.lean_selected_order_input($1) input", [run])).rows[0].input;
      const before = await extract();
      await db.exec(sql("046_order_item_sizes"));
      expect(await extract()).toEqual(before);
      const upstream = fixture();
      Object.assign(lines(upstream)[0], { customAttributes: [{ key: "Top size", value: " m " },
        { key: "Gift message", value: "PRIVATE-GIFT" }], variantTitle: null });
      const fetcher = vi.fn<typeof fetch>(async (_, init) => {
        const query = JSON.parse(String(init?.body)).query;
        expect([PILOT_FINANCIAL_QUERY, SHOPIFY_FINANCIAL_ORDER_SIZE_QUERY]).toContain(query);
        return response(query === PILOT_FINANCIAL_QUERY ? upstream.financial : upstream.commerce.order);
      });
      const source = await readPilotSource({ shop, accessToken: "synthetic", fetcher,
        signal: AbortSignal.timeout(30000), projection: "financial_no_geo_order_size" }, String(upstream.commerce.order.id));
      expect(JSON.stringify(source)).not.toContain("PRIVATE-GIFT");
      const candidate = buildCommerceCandidate([record(source)], scope, sink);
      expect(candidate.facts).toEqual(old.facts);
      const write = (rows: unknown) => db.query("select lean_private.write_order_item_sizes($1,$2)", [pub, JSON.stringify(rows)]);
      const row = candidate.order_item_sizes![0];
      for (const change of [{ publication_id: "other" }, { order_item_id: "orphan" }, { size_value: "free text" },
        { size_status: "conflict" }, { policy_ref: "" }, { source_evidence_ref: "" }, { mapping_version: "unknown" },
        { size_source: "variant_title_snapshot" }, { extra: "PRIVATE" }, { size_value: 1 }])
        await expect(write([{ ...row, ...change }])).rejects.toThrow();
      await write(candidate.order_item_sizes);
      expect((await db.query("select * from lean_private.order_item_sizes")).rows).toEqual(candidate.order_item_sizes);
      expect(await extract()).toEqual(before); // Real 044 digest unchanged even WITH companion rows.
      await expect(write(candidate.order_item_sizes)).rejects.toThrow(); // No silent rewrite.
      // A second publication demonstrates rollback of both facts and sidecar on failure.
      await db.exec("begin");
      await db.query("insert into lean_private.publications(publication_id,contract_version) values('synthetic:atomic','v1')");
      const atomic = buildCommerceCandidate([record(source)], { ...scope, publication: "synthetic:atomic" }, sink);
      for (const table of ["orders", "order_items"])
        await db.query(`insert into lean_private.${table} select * from
          jsonb_populate_recordset(null::lean_private.${table},$1)`, [JSON.stringify(atomic.facts[table])]);
      await expect(db.query("select lean_private.write_order_item_sizes($1,$2)",
        ["synthetic:atomic", JSON.stringify([{ ...atomic.order_item_sizes![0], size_value: "invalid" }])])).rejects.toThrow();
      await db.exec("rollback");
      expect((await db.query("select * from lean_private.publications where publication_id='synthetic:atomic'")).rows).toEqual([]);
      // Successful combined transaction uses precisely the same dynamic existing fact persistence.
      await db.transaction(async tx => {
        await tx.query("insert into lean_private.publications(publication_id,contract_version) values('synthetic:atomic','v1')");
        for (const table of ["orders", "order_items"])
          await tx.query(`insert into lean_private.${table} select * from
            jsonb_populate_recordset(null::lean_private.${table},$1)`, [JSON.stringify(atomic.facts[table])]);
        await tx.query("select lean_private.write_order_item_sizes($1,$2)",
          ["synthetic:atomic", JSON.stringify(atomic.order_item_sizes)]);
      });
      expect((await db.query("select * from lean_private.order_item_sizes where publication_id='synthetic:atomic'")).rows)
        .toEqual(atomic.order_item_sizes);
    } finally { await db.close(); }
  }, 30000);
});
