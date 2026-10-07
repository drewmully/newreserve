import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { customerHistoryPost } from "@/lib/analytics/customerHistoryRuntime";
import { POST } from "@/app/api/analytics/customers/process/route";
import { key } from "@/lib/analytics/primitives";
import type { HistoryCustomerInput } from "@/lib/analytics/historyCustomerSource";

const project = "aaaaaaaaaaaaaaaaaaaa", shop = "fixture.myshopify.com", run = "fixture-customer-run";
const secret = "s".repeat(40), now = "2026-09-30T12:00:00Z";
const env = { LEAN_ANALYTICS_CUSTOMER_HISTORY_ENABLED: "true",
  LEAN_ANALYTICS_CUSTOMER_HISTORY_SECRET: secret, LEAN_ANALYTICS_CUSTOMER_HISTORY_RUN_ID: run,
  LEAN_ANALYTICS_PIPELINE_PROJECT_REF: project, LEAN_ANALYTICS_SUPABASE_URL: `https://${project}.supabase.co`,
  LEAN_ANALYTICS_SUPABASE_SERVICE_ROLE_KEY: "fixture-service-key" };
const req = (suffix = "", init: RequestInit = {}) => new Request(
  `https://fixture.invalid/api/analytics/customers/process${suffix}`,
  { method: "POST", headers: { authorization: `Bearer ${secret}` }, ...init });
beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(now); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

// Same real worker contract as the retained-customer SQL fixture, one complete
// synthetic member. No source I/O, substituted normalizer or generated authority.
function claimed(): HistoryCustomerInput {
  const gid = (kind: string, id: string) => `gid://shopify/${kind}/${id}`;
  const money = (amount: string) => ({ shopMoney: { amount, currencyCode: "USD" } });
  const updated = "2026-01-02T12:00:00Z", completeThrough = "2026-09-25T08:04:00Z";
  const decision = { eligibility: "eligible" as const, commerceSource: "other" as const,
    acquisitionEligible: true, approvalRef: "fixture:classification" };
  const proof = (table: string, keyFields: string[], keys: unknown[][]) => ({
    table, keyFields, expectedKeys: keys.map(v => JSON.stringify(v)), amountChecks: [],
    complete: true, independentlyExtracted: true, evidenceRef: `fixture:control:${table}`,
  });
  return { version: 1, state: "claimed", runId: run, memberId: "member1",
    projectRef: project, shop, publication: `customer-history:${run}`,
    inputHash: "a".repeat(64), generationHash: "b".repeat(64),
    asOf: now, expiresAt: "2026-09-30T12:02:00Z", mappingVersion: "identity-v1",
    sourceOrigin: "2020-01-01T00:00:00Z", completeThrough, customerId: "customer_fixture",
    authority: { authorityId: "fixture-authority", revision: "1", fingerprint: "d".repeat(64),
      sourceId: "fixture:authority", schemaVersion: "fixture-v1", scopeRef: "fixture:history",
      evidenceRef: "fixture:receipt", capturedAt: "2026-09-30T11:59:00Z",
      validUntil: "2026-09-30T12:03:00Z", maxAgeSeconds: 300 },
    reporting: { definition: "fixture-customers", fromDate: "2026-01-01", throughDate: "2026-01-03",
      cohorts: [], cohortCoverage: [] },
    policy: { productClasses: { "3": "merchandise" }, decision, financialApprovalRef: "fixture:finance",
      saleClock: "paid_at", refundClock: "refund_created_at" },
    evidence: { ref: "fixture:evidence", identity: [{
      namespace: "shopify_customer", identifier: "90", customerId: "customer_fixture",
      from: "2020-01-01T00:00:00Z", to: null, type: "fixture:history",
      evidenceRef: "fixture:identity", mappingVersion: "identity-v1", resolution: "resolved",
      consent: "permitted", removal: "active",
    }], currentlyPermitted: ["customer_fixture"], removedCustomers: [],
      customerHistory: { customer_fixture: { expectedSources: ["shopify"], completeSources: ["shopify"],
        approvalRef: "fixture:history", migrationsReconciled: true, completeThrough } },
      orderIdentities: [{ orderId: key(shop, "1"), namespace: "shopify_customer", identifier: "90",
        evidenceRef: "fixture:owner" }],
      proofs: [proof("orders", ["order_id"], [[key(shop, "1")]]),
        proof("order_items", ["order_item_id"], [[key(shop, "1", "1")]]),
        proof("customers", ["customer_id"], [["customer_fixture"]]),
        proof("identity_map", ["source_namespace", "source_identifier", "valid_from", "mapping_version"],
          [["shopify_customer", "90", "2020-01-01T00:00:00Z", "identity-v1"]])],
      externalControls: { temporal_identity_intervals: { passed: true, evidenceRef: "fixture:temporal" } },
      cohortCoverage: [] },
    orders: [{ id: gid("Order", "1"), updatedAt: updated, sourceHash: "c".repeat(64), decision, source: {
      commerce: { shop, apiVersion: "2026-07", projection: "financial_customer_id", order: {
        id: gid("Order", "1"), customer: { id: gid("Customer", "90") },
        createdAt: "2026-01-01T12:00:00Z", updatedAt: updated, currencyCode: "USD", edited: false,
        taxesIncluded: false, test: false, cancelledAt: null, originalTotalPriceSet: money("10"),
        subtotalPriceSet: money("10"), transactionsCount: { count: 1, precision: "EXACT" },
        transactions: [{ id: gid("OrderTransaction", "1"), kind: "SALE", status: "SUCCESS", gateway: "fixture",
          test: false, createdAt: "2026-01-01T12:00:00Z", processedAt: "2026-01-01T12:01:00Z",
          amountSet: money("10"), parentTransaction: null }],
        lineItems: { nodes: [{ id: gid("LineItem", "1"), sku: "FIXTURE", quantity: 1, isGiftCard: false,
          product: { id: gid("Product", "3") }, originalUnitPriceSet: money("10"),
          originalTotalSet: money("10"), discountAllocations: [] }], pageInfo: { hasNextPage: false, endCursor: null } },
      } }, financial: { id: gid("Order", "1"), updatedAt: updated, currencyCode: "USD",
        originalTotalPriceSet: money("10"), totalTaxSet: money("0"), originalTotalDutiesSet: null,
        originalTotalAdditionalFeesSet: null, totalTipReceivedSet: money("0"),
        shippingLines: { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } }, refunds: [] }, refunds: [],
    } }],
  };
}
function wire(value: unknown = { state: "complete" }, finish: unknown = true) {
  return vi.fn<typeof fetch>(async (url, init) => {
    expect(String(url)).toMatch(new RegExp(`^https://${project}\\.supabase\\.co/rest/v1/rpc/lean_history_customer_(claim|finish)$`));
    expect(init?.redirect).toBe("error");
    const args = JSON.parse(String(init?.body));
    expect(args.p_run).toBe(run); expect(args.p_project).toBe(project);
    return Response.json(String(url).endsWith("_claim") ? value : finish);
  });
}
it("is disabled by default without storage or provider calls", async () => {
  const fetcher = wire();
  expect((await customerHistoryPost(req(), {}, fetcher)).status).toBe(404);
  expect(fetcher).not.toHaveBeenCalled();
});
it("requires a dedicated bearer without accepting other cron/user-agent credentials", async () => {
  const fetcher = wire();
  expect((await customerHistoryPost(req("", { headers: { "user-agent": "vercel-cron" } }), env, fetcher)).status).toBe(401);
  expect((await customerHistoryPost(req("", { headers: { authorization: "Bearer wrong" } }), env, fetcher)).status).toBe(401);
  expect(fetcher).not.toHaveBeenCalled();
});
it.each([
  { LEAN_ANALYTICS_CUSTOMER_HISTORY_SECRET: "short" },
  { LEAN_ANALYTICS_CUSTOMER_HISTORY_RUN_ID: "" },
  { LEAN_ANALYTICS_CUSTOMER_HISTORY_RUN_ID: "run\n" },
  { LEAN_ANALYTICS_PIPELINE_PROJECT_REF: "" },
  { LEAN_ANALYTICS_SUPABASE_URL: "https://other.supabase.co" },
  { LEAN_ANALYTICS_SUPABASE_SERVICE_ROLE_KEY: "" },
])("fails closed for invalid config %s", async change => {
  const fetcher = wire();
  expect((await customerHistoryPost(req(), { ...env, ...change }, fetcher)).status).toBe(503);
  expect(fetcher).not.toHaveBeenCalled();
});
it("refuses request-selected scope, bodies and transfer encoding before storage", async () => {
  const fetcher = wire();
  expect((await customerHistoryPost(req("?run=other"), env, fetcher)).status).toBe(400);
  expect((await customerHistoryPost(req("", { body: "{}" }), env, fetcher)).status).toBe(400);
  expect((await customerHistoryPost(req("", { headers: { authorization: `Bearer ${secret}`,
    "transfer-encoding": "chunked" } }), env, fetcher)).status).toBe(400);
  expect(fetcher).not.toHaveBeenCalled();
});
it.each(["complete", "disabled", "busy", "expired"])("preserves SQL %s without a finish or acceptance claim", async state => {
  const fetcher = wire({ state }), response = await customerHistoryPost(req(), env, fetcher);
  expect(await response.json()).toEqual({ state, providerRequests: 0, certification: "unverified" });
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(fetcher).toHaveBeenCalledTimes(1);
});
it("invokes the real worker for one member and returns no customer data or run-complete claim", async () => {
  const fetcher = wire(claimed()), response = await customerHistoryPost(req(), env, fetcher);
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ state: "member_written", providerRequests: 0, certification: "unverified" });
  expect(fetcher).toHaveBeenCalledTimes(2);
  const saved = JSON.parse(String(fetcher.mock.calls[1][1]?.body));
  expect(saved.p_result.facts.customers).toHaveLength(1);
  expect(saved.p_result.customerComplete).toBe(true);
  expect(saved.p_token).toBe(JSON.parse(String(fetcher.mock.calls[0][1]?.body)).p_token);
});
it("preserves a false finish as changed, never complete", async () => {
  expect(await (await customerHistoryPost(req(), env, wire(claimed(), false))).json())
    .toEqual({ state: "changed", providerRequests: 0, certification: "unverified" });
});
it.each(["run", "project", "authority", "101 orders", "permission"] as const)("refuses changed %s before finish", async kind => {
  const value = claimed();
  if (kind === "run") value.runId = "different";
  if (kind === "project") value.projectRef = "bbbbbbbbbbbbbbbbbbbb";
  if (kind === "authority") value.authority.validUntil = now;
  if (kind === "101 orders") value.orders = Array.from({ length: 101 }, () => value.orders[0]);
  if (kind === "permission") value.evidence.currentlyPermitted = [];
  const fetcher = wire(value);
  expect((await customerHistoryPost(req(), env, fetcher)).status).toBe(503);
  expect(fetcher).toHaveBeenCalledTimes(1);
});
it("does not retry or leak an ambiguous finish failure", async () => {
  const source = wire(claimed()), fetcher = vi.fn<typeof fetch>(async (url, init) => {
    if (String(url).endsWith("_finish")) throw new Error("sensitive source/customer payload");
    return source(url, init);
  });
  const response = await customerHistoryPost(req(), env, fetcher);
  expect(response.status).toBe(503); expect(await response.json()).toEqual({ state: "unavailable" });
  expect(fetcher).toHaveBeenCalledTimes(2);
});
it("rejects malformed finish responses and excessive source bytes", async () => {
  expect((await customerHistoryPost(req(), env, wire(claimed(), "true"))).status).toBe(503);
  expect((await customerHistoryPost(req(), env, async () => new Response("x".repeat(8 * 1024 * 1024 + 1)))).status).toBe(503);
});
it("wires the actual route and accepts a genuinely empty streamed POST", async () => {
  for (const [name, value] of Object.entries(env)) vi.stubEnv(name, value);
  const fetcher = wire(); vi.stubGlobal("fetch", fetcher);
  const stream = new ReadableStream<Uint8Array>({ start(controller) { controller.close(); } });
  const response = await POST(req("", { body: stream, duplex: "half" } as RequestInit));
  expect(response.status).toBe(200); expect(fetcher).toHaveBeenCalledTimes(1);
});
