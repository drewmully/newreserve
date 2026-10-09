import { afterEach, describe, expect, it, vi } from "vitest";
import { decideOrderProvider, sellingPlanProvider } from "@/lib/lifecycle/sellingPlans";
import { deriveCustomerHistory, paidCyclesFor, readCustomerOrderHistory } from "@/lib/lifecycle/orderHistory";
import { buildNativeEvidence, latestCompleteSnapshot, parseFlowEvent, verifyFlowSecret, type FlowEvent } from "@/lib/lifecycle/flowBridge";
import { enqueueCandidate, readDispatchConfig, runDispatchBatch, type OutboxRepo, type OutboxRow, type Finish } from "@/lib/lifecycle/dispatch";

const now = new Date("2026-10-09T15:00:00Z");
const ago = (h: number) => new Date(now.getTime() - h * 3_600_000).toISOString();
const line = (id: number, plan: string | null, extra: Record<string, unknown> = {}) => ({
  id: `gid://shopify/LineItem/${id}`, sku: "X", quantity: 1, requiresShipping: true, isGiftCard: false,
  variant: { id: `gid://shopify/ProductVariant/${id + 500}` }, sellingPlan: plan ? { sellingPlanId: `gid://shopify/SellingPlan/${plan}` } : null, ...extra,
});
const order = (id: number, o: Record<string, unknown> = {}) => ({
  id: `gid://shopify/Order/${id}`, createdAt: ago(100 - id), processedAt: ago(100 - id), test: false, cancelledAt: null,
  displayFinancialStatus: "PAID", sourceName: "channel:7831744", app: { id: "gid://shopify/App/12875497473" },
  customer: { id: "gid://shopify/Customer/100" }, currentTotalPriceSet: { shopMoney: { amount: "299.95", currencyCode: "USD" } },
  refunds: [], lineItems: { nodes: [line(id, "6627721408")], pageInfo: { hasNextPage: false } },
  fulfillments: [], ...o,
});

describe("selling plan ownership", () => {
  it("maps verified plans and refuses unknown ones", () => {
    expect(sellingPlanProvider("gid://shopify/SellingPlan/3241476288")).toBe("loop");
    expect(sellingPlanProvider("6627721408")).toBe("shopify_native");
    expect(sellingPlanProvider("3654713536")).toBeNull(); // Swing Box owner unverified
  });
  it("treats Loop-app renewals as Loop even with unregistered plans", () => {
    expect(decideOrderProvider({ sourceName: "subscription_contract_checkout_one", appId: "gid://shopify/App/5284869", sellingPlanIds: ["gid://shopify/SellingPlan/999"] }))
      .toEqual({ kind: "subscription", provider: "loop", renewal: true });
  });
  it("holds non-Loop renewals unless every plan is positively native", () => {
    expect(decideOrderProvider({ sourceName: "subscription_contract_checkout_one", appId: "77", sellingPlanIds: [] }).kind).toBe("hold");
    expect(decideOrderProvider({ sourceName: "subscription_contract_checkout_one", appId: "77", sellingPlanIds: ["6627721408"] }))
      .toEqual({ kind: "subscription", provider: "shopify_native", renewal: true });
    expect(decideOrderProvider({ sourceName: "subscription_contract_checkout_one", appId: "5284869", sellingPlanIds: ["6627721408"] }).kind).toBe("hold");
  });
  it("holds unknown first-order plans and mixed providers; plain orders are one-time", () => {
    expect(decideOrderProvider({ sourceName: "web", appId: null, sellingPlanIds: ["3654713536"] })).toEqual({ kind: "hold", reason: "unknown_selling_plan" });
    expect(decideOrderProvider({ sourceName: "web", appId: null, sellingPlanIds: ["3241476288", "6627721408"] }).kind).toBe("hold");
    expect(decideOrderProvider({ sourceName: "web", appId: null, sellingPlanIds: [null] })).toEqual({ kind: "one_time" });
  });
});

describe("order history", () => {
  it("derives first paid member order and refuses refunded or truncated history", () => {
    const h = deriveCustomerHistory("100", [order(2), order(1, { displayFinancialStatus: "REFUNDED", refunds: [{ id: "r" }] })], true, now.toISOString());
    expect(h.complete).toBe(true);
    expect(h.history.firstPaidMemberOrderId).toBe("2");
    const t = deriveCustomerHistory("100", [order(3, { lineItems: { nodes: [line(3, null)], pageInfo: { hasNextPage: true } } })], true, now.toISOString());
    expect(t.complete).toBe(false);
    expect(t.holds).toContain("order_connection_truncated");
  });
  it("holds first orders whose selling plan was deleted instead of treating them as shop orders", () => {
    const h = deriveCustomerHistory("100", [order(11, { lineItems: { nodes: [line(11, null, { sellingPlan: { sellingPlanId: null } })], pageInfo: { hasNextPage: false } } })], true, now.toISOString());
    expect(h.complete).toBe(false);
    expect(h.holds).toContain("unknown_selling_plan");
  });
  it("treats Recharge-era orders as past membership but never as current cycles", () => {
    const recharge = order(12, { createdAt: "2024-05-01T00:00:00Z", processedAt: "2024-05-01T00:00:00Z", sourceName: "subscription_contract",
      app: { id: "gid://shopify/App/294517" }, lineItems: { nodes: [line(12, null, { sellingPlan: { sellingPlanId: null } })], pageInfo: { hasNextPage: false } } });
    const h = deriveCustomerHistory("100", [recharge, order(13)], true, now.toISOString());
    expect(h.complete).toBe(true);
    expect(h.history.firstPaidMemberOrderId).toBe("12");
    expect(h.history.firstDeliveredMemberOrderId).toBeNull();
    expect(paidCyclesFor(h, "shopify_native", () => "55").cycles.map((c) => c.orderId)).toEqual(["13"]);
  });
  it("keeps pre-cutover deleted plans legacy but holds unknown live plans and post-cutover deletions", () => {
    const base = { sourceName: "web", appId: "580111" };
    expect(decideOrderProvider({ ...base, sellingPlanIds: ["unidentified_plan"], createdAt: "2024-01-01T00:00:00Z" }).kind).toBe("legacy_subscription");
    expect(decideOrderProvider({ ...base, sellingPlanIds: ["unidentified_plan"], createdAt: "2025-06-01T00:00:00Z" }).kind).toBe("hold");
    expect(decideOrderProvider({ ...base, sellingPlanIds: ["3654713536"], createdAt: "2024-01-01T00:00:00Z" }).kind).toBe("hold");
  });
  it("counts Loop renewals with deleted plans and the older subscription_contract source", () => {
    const r = order(14, { sourceName: "subscription_contract", app: { id: "gid://shopify/App/5284869" },
      lineItems: { nodes: [line(14, null, { sellingPlan: { sellingPlanId: null } })], pageInfo: { hasNextPage: false } } });
    const h = deriveCustomerHistory("100", [r], true, now.toISOString());
    expect(h.complete).toBe(true);
    expect(h.subscriptionOrders[0]).toMatchObject({ provider: "loop", renewal: true, qualifiesAsPaidCycle: true });
  });
  it("registers renewal-proven legacy Loop plans", () => {
    for (const p of ["2609447104", "2700312768", "2902098112", "3004956864"]) expect(sellingPlanProvider(p)).toBe("loop");
    expect(sellingPlanProvider("3259433152")).toBeNull();
  });
  it("first delivery must be the first paid order itself", () => {
    const delivered = { fulfillments: [{ id: "gid://shopify/Fulfillment/9", status: "SUCCESS", displayStatus: "DELIVERED", updatedAt: ago(1),
      fulfillmentLineItems: { nodes: [{ quantity: 1, lineItem: { id: "gid://shopify/LineItem/5" } }], pageInfo: { hasNextPage: false } } }] };
    const h = deriveCustomerHistory("100", [order(4), order(5, delivered)], true, now.toISOString());
    expect(h.history.firstPaidMemberOrderId).toBe("4");
    expect(h.history.firstDeliveredMemberOrderId).toBeNull();
  });
  it("rejects other customers' orders and incomplete reads", () => {
    expect(deriveCustomerHistory("100", [order(6, { customer: { id: "gid://shopify/Customer/101" } })], true, now.toISOString()).holds).toContain("order_identity_mismatch");
    expect(deriveCustomerHistory("100", [], false, now.toISOString()).complete).toBe(false);
  });
  it("paginates fully and fails closed on errors", async () => {
    const pages = [
      { orders: { nodes: [order(7)], pageInfo: { hasNextPage: true, endCursor: "c1" } } },
      { orders: { nodes: [order(8)], pageInfo: { hasNextPage: false, endCursor: null } } },
    ];
    const gql = vi.fn(async () => pages.shift());
    const h = await readCustomerOrderHistory("100", gql, () => now);
    expect(h.complete).toBe(true);
    expect(h.orders).toHaveLength(2);
    expect(gql).toHaveBeenLastCalledWith(expect.any(String), { query: "customer_id:100", after: "c1" });
    const bad = await readCustomerOrderHistory("100", async () => { throw new Error("boom customer@example.com"); }, () => now);
    expect(bad.complete).toBe(false);
    expect(JSON.stringify(bad)).not.toContain("example.com");
  });
  it("paid cycles need a resolved contract", () => {
    const h = deriveCustomerHistory("100", [order(9)], true, now.toISOString());
    expect(paidCyclesFor(h, "shopify_native", () => null).holds).toEqual(["cycle_contract_unresolved"]);
    expect(paidCyclesFor(h, "shopify_native", () => "55").cycles[0]).toMatchObject({ contractId: "55", orderId: "9", paidAmountMinor: 29995 });
  });
});

const ev = (body: Record<string, unknown>) => {
  const r = parseFlowEvent({ version: 1, occurredAt: ago(1), ...body }, now);
  if (!r.ok) throw new Error(r.reason);
  return r.event;
};

describe("Flow bridge", () => {
  it("verifies the shared secret in constant time and refuses short secrets", () => {
    const s = "s".repeat(40);
    expect(verifyFlowSecret(s, s)).toBe(true);
    expect(verifyFlowSecret("x".repeat(40), s)).toBe(false);
    expect(verifyFlowSecret("short", "short")).toBe(false);
    expect(verifyFlowSecret(null, s)).toBe(false);
  });
  it("accepts IDs-only bodies and rejects extra fields, bad ids and stale timestamps", () => {
    expect(ev({ kind: "contract_created", contractId: "gid://shopify/SubscriptionContract/55", customerId: "gid://shopify/Customer/100", orderId: "gid://shopify/Order/9", status: "ACTIVE" }))
      .toMatchObject({ contractId: "55", customerId: "100", orderId: "9", status: "active" });
    expect(parseFlowEvent({ version: 1, kind: "contract_updated", occurredAt: ago(1), contractId: "55", customerId: "100", status: "ACTIVE", email: "a@b.co" }, now))
      .toEqual({ ok: false, reason: "unexpected_field" });
    expect(parseFlowEvent({ version: 1, kind: "contract_updated", occurredAt: ago(1), contractId: "gid://shopify/Order/55", customerId: "100", status: "ACTIVE" }, now))
      .toEqual({ ok: false, reason: "id_invalid" });
    expect(parseFlowEvent({ version: 1, kind: "contract_updated", occurredAt: ago(24 * 9), contractId: "55", customerId: "100", status: "ACTIVE" }, now))
      .toEqual({ ok: false, reason: "occurred_at_invalid" });
    expect(parseFlowEvent({ version: 1, kind: "billing_success", occurredAt: ago(1), contractId: "55", customerId: "100" }, now))
      .toEqual({ ok: false, reason: "order_required" });
  });
  it("gives identical deliveries the same idempotency key", () => {
    const body = { kind: "contract_updated", contractId: "55", customerId: "100", status: "PAUSED" };
    expect(ev(body).idempotencyKey).toBe(ev(body).idempotencyKey);
  });
  it("only trusts complete, fresh, untruncated snapshot runs", () => {
    const snap = (c: string) => ev({ kind: "contract_snapshot", runId: "run-00000001", contractId: c, customerId: "100", status: "ACTIVE" });
    const run = (count: number) => ev({ kind: "snapshot_run", runId: "run-00000001", count });
    expect(latestCompleteSnapshot([run(2), snap("55")], now)).toBeNull();
    expect(latestCompleteSnapshot([run(2), snap("55"), snap("56")], now)?.rows).toHaveLength(2);
    expect(latestCompleteSnapshot([run(100)], now)).toBeNull();
  });
  it("native coverage requires a snapshot and a contract event for every native order", () => {
    const history = deriveCustomerHistory("100", [order(9)], true, now.toISOString());
    const run = ev({ kind: "snapshot_run", runId: "run-00000002", count: 0 });
    const missing = buildNativeEvidence("100", [run], history, now);
    expect(missing.coverage[0].complete).toBe(false);
    expect(missing.holds).toContain("native_order_without_contract_event");
    const created = ev({ kind: "contract_created", contractId: "55", customerId: "100", orderId: "9", status: "ACTIVE" });
    const snap = ev({ kind: "contract_snapshot", runId: "run-00000003", contractId: "55", customerId: "100", status: "ACTIVE" });
    const run1 = ev({ kind: "snapshot_run", runId: "run-00000003", count: 1 });
    const ok = buildNativeEvidence("100", [created, snap, run1], history, now);
    expect(ok.holds).toEqual([]);
    expect(ok.coverage[0]).toMatchObject({ complete: true, scope: "all_customer_contracts" });
    expect(ok.cycles).toHaveLength(1);
    const noSnapshot = buildNativeEvidence("100", [created], history, now);
    expect(noSnapshot.holds).toContain("native_snapshot_unavailable");
  });
  it("flags one contract claimed by two customers", () => {
    const a: FlowEvent = ev({ kind: "contract_updated", contractId: "55", customerId: "100", status: "ACTIVE" });
    const b: FlowEvent = ev({ kind: "contract_updated", contractId: "55", customerId: "101", status: "ACTIVE" });
    expect(buildNativeEvidence("100", [a, b], deriveCustomerHistory("100", [], true, now.toISOString()), now).holds).toContain("native_contract_identity_conflict");
  });
});

const key = `mully-lifecycle-v1:${"a".repeat(64)}`;
const rowOf = (o: Partial<OutboxRow> = {}): OutboxRow => ({ id: 1, dedupe_key: key, program: "shop_purchase",
  shopify_customer_id: "100", shopify_order_id: "9", attempts: 1, lease_token: "t", ...o });
function repo(rows: OutboxRow[], keep = true) {
  const finished: Finish[] = [];
  const r: OutboxRepo & { finished: Finish[]; claim: ReturnType<typeof vi.fn> } = {
    finished, enqueue: vi.fn(async () => "inserted" as const),
    claim: vi.fn(async () => rows), finish: vi.fn(async (_i, _t, f) => { finished.push(f); return keep; }),
  };
  return r;
}
const on = { enabled: true, programs: new Set(["shop_purchase" as const]) };

describe("dispatch outbox", () => {
  it("is off by default and claims nothing", async () => {
    expect(readDispatchConfig({}).enabled).toBe(false);
    expect(readDispatchConfig({ LIFECYCLE_DISPATCH_ENABLED: "true" }).enabled).toBe(false); // empty allowlist
    expect(readDispatchConfig({ LIFECYCLE_DISPATCH_ENABLED: "1", LIFECYCLE_DISPATCH_PROGRAMS: "shop_purchase" }).enabled).toBe(false);
    const r = repo([rowOf()]), send = vi.fn();
    expect(await runDispatchBatch({ repo: r, recheck: vi.fn(), send, config: readDispatchConfig({}) })).toMatchObject({ enabled: false, claimed: 0 });
    expect(r.claim).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });
  it("holds non-allowlisted programs and failed rechecks without sending", async () => {
    const send = vi.fn();
    const r = repo([rowOf({ program: "member_start" }), rowOf({ id: 2 })]);
    await runDispatchBatch({ repo: r, send, config: on, recheck: async () => ({ eligible: false, holds: ["unresolved_service_issue"], email: "a@b.co" }) });
    expect(send).not.toHaveBeenCalled();
    expect(r.finished).toEqual([{ state: "held", holds: ["program_not_enabled"] }, { state: "held", holds: ["unresolved_service_issue"] }]);
  });
  it("sends once with the dedupe key as unique_id and IDs-only properties", async () => {
    const send = vi.fn(async () => undefined);
    const r = repo([rowOf()]);
    const s = await runDispatchBatch({ repo: r, send, config: on, now: () => now, recheck: async () => ({ eligible: true, holds: [], email: "a@b.co" }) });
    expect(s.sent).toBe(1);
    const body = (send.mock.calls[0] as unknown[])[0] as { data: { attributes: { unique_id: string; properties: Record<string, unknown> } } };
    expect(body.data.attributes.unique_id).toBe(key);
    expect(JSON.stringify(body.data.attributes.properties)).not.toContain("@");
  });
  it("retries retryable failures with backoff, dead-letters the rest, and respects lost leases", async () => {
    const recheck = async () => ({ eligible: true, holds: [], email: "a@b.co" });
    const r1 = repo([rowOf()]);
    await runDispatchBatch({ repo: r1, config: on, now: () => now, recheck, send: async () => { throw { retryable: true, code: "rate_limited" }; } });
    expect(r1.finished[0]).toMatchObject({ state: "failed", error: "rate_limited" });
    const r2 = repo([rowOf({ attempts: 5 })]);
    await runDispatchBatch({ repo: r2, config: on, recheck, send: async () => { throw { retryable: true, code: "server_error" }; } });
    expect(r2.finished[0].state).toBe("dead");
    const r3 = repo([rowOf()]);
    await runDispatchBatch({ repo: r3, config: on, recheck, send: async () => { throw { retryable: false, code: "bad_request" }; } });
    expect(r3.finished[0]).toEqual({ state: "dead", error: "bad_request" });
    const r4 = repo([rowOf()], false);
    expect((await runDispatchBatch({ repo: r4, config: on, recheck, send: async () => undefined })).lost_lease).toBe(1);
  });
  it("treats a thrown recheck as retryable and never sends", async () => {
    const send = vi.fn(), r = repo([rowOf()]);
    await runDispatchBatch({ repo: r, send, config: on, now: () => now, recheck: async () => { throw new Error("x"); } });
    expect(send).not.toHaveBeenCalled();
    expect(r.finished[0]).toMatchObject({ state: "failed", error: "recheck_failed" });
  });
  it("enqueues only verified candidates with a well-formed key", async () => {
    const r = repo([]);
    expect(await enqueueCandidate(r, { auditCandidate: false, dedupeKey: key, orderId: "9", kind: "shop_purchase" }, "100")).toBe("not_candidate");
    expect(await enqueueCandidate(r, { auditCandidate: true, dedupeKey: "bad", orderId: "9", kind: "shop_purchase" }, "100")).toBe("not_candidate");
    expect(await enqueueCandidate(r, { auditCandidate: true, dedupeKey: key, orderId: "9", kind: "shop_purchase" }, "100")).toBe("inserted");
  });
});

describe("Flow intake route", () => {
  afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); });
  it("returns 404 unless explicitly enabled, and 401 without the secret", async () => {
    vi.stubEnv("LIFECYCLE_NATIVE_FLOW_INGEST_ENABLED", "");
    const { POST } = await import("@/app/api/lifecycle/shopify-flow/route");
    expect((await POST(new Request("https://x/api", { method: "POST", body: "{}" }))).status).toBe(404);
    vi.stubEnv("LIFECYCLE_NATIVE_FLOW_INGEST_ENABLED", "true");
    vi.stubEnv("LIFECYCLE_FLOW_SHARED_SECRET", "s".repeat(40));
    expect((await POST(new Request("https://x/api", { method: "POST", body: "{}", headers: { "x-mully-flow-secret": "nope" } }))).status).toBe(401);
    expect((await POST(new Request("https://x/api", { method: "POST", body: "{\"version\":2}", headers: { "x-mully-flow-secret": "s".repeat(40) } }))).status).toBe(422);
  });
  it("dispatch route claims nothing while disabled", async () => {
    vi.stubEnv("CRON_SECRET", "c".repeat(40));
    vi.stubEnv("LIFECYCLE_DISPATCH_ENABLED", "");
    const { GET } = await import("@/app/api/admin/cron/lifecycle-dispatch/route");
    const res = await GET(new Request("https://x/api", { headers: { authorization: `Bearer ${"c".repeat(40)}` } }));
    expect(await res.json()).toEqual({ ok: true, enabled: false });
  });
});

describe("support clearance (Intercom only, 14 days)", () => {
  type Res = { data: unknown[] | null; error: unknown };
  const fakeSb = (threads: Res, heartbeat: Res, recent: Res, calls: string[] = []) => ({
    from(table: string) {
      const filters: string[] = [];
      const q: Record<string, unknown> = {};
      const chain = new Proxy(q, { get(_t, prop: string) {
        if (prop === "then") {
          const res = table === "hub_thread" ? threads : filters.includes("in:thread_id") ? recent : heartbeat;
          calls.push(`${table}|${filters.join(",")}`);
          return (resolve: (v: Res) => void) => resolve(res);
        }
        return (...args: unknown[]) => { filters.push(`${prop}:${String(args[0])}${args[1] !== undefined && typeof args[1] !== "object" ? "=" + String(args[1]) : ""}`); return chain; };
      } });
      return chain;
    },
  });
  const fresh = { data: [{ created_at: ago(1) }], error: null };
  it("pauses only for open threads with a recent Intercom message", async () => {
    const { readServiceEvidence } = await import("@/lib/lifecycle/sources");
    const calls: string[] = [];
    const sb = fakeSb({ data: [{ id: 1 }, { id: 2 }], error: null }, fresh, { data: [{ thread_id: 2 }, { thread_id: 2 }], error: null }, calls);
    const ev = await readServiceEvidence(sb as never, "100", now);
    expect(ev).toMatchObject({ complete: true, allChannels: true, unresolvedCount: 1, reviewOwner: "junip" });
    const msgCall = calls.find((c) => c.includes("in:thread_id"))!;
    expect(msgCall).toContain("eq:channel=intercom");
    expect(msgCall).toContain(`gte:sent_at=${ago(24 * 14)}`);
  });
  it("is clear with no open threads, and fails closed when the Intercom mirror is stale or errors", async () => {
    const { readServiceEvidence } = await import("@/lib/lifecycle/sources");
    expect(await readServiceEvidence(fakeSb({ data: [], error: null }, fresh, { data: [], error: null }) as never, "100", now))
      .toMatchObject({ complete: true, unresolvedCount: 0 });
    expect((await readServiceEvidence(fakeSb({ data: [], error: null }, { data: [{ created_at: ago(30) }], error: null }, { data: [], error: null }) as never, "100", now)).complete).toBe(false);
    expect((await readServiceEvidence(fakeSb({ data: null, error: { m: 1 } }, fresh, { data: [], error: null }) as never, "100", now)).complete).toBe(false);
  });
});
