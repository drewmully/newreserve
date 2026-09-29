import { afterEach, expect, it, vi } from "vitest";
import { collectSubscriptionSnapshot, type SubscriptionCollectionOptions } from "@/lib/analytics/subscriptionCollection";
import type { SubscriptionPolicy } from "@/lib/analytics/subscriptions";

const policy = (): SubscriptionPolicy => ({
  definitionRef: "fixture:count", countedStatuses: ["ACTIVE"],
  excludedStatuses: ["PAUSED", "CANCELLED", "EXPIRED"],
  deduplication: "identical_normalized_contract", subscriberBasis: "shopify_customer_id",
  renewalDays: 30, recurringValue: null,
});
const options = (): SubscriptionCollectionOptions => ({
  enabled: true, shop: "fixture.myshopify.com", asOf: "2026-09-01T00:00:00Z",
  evidenceRef: "fixture:collection", maxPages: 2, maxRows: 10, maxBytes: 100000,
  pageSize: 10, status: null,
});
const row = (id = "123456789") => ({
  id, status: "ACTIVE", customer: { shopifyId: "888888888", email: "private@example.invalid", phone: "secret-phone" },
  updatedAt: "2026-08-31T10:00:00Z", currencyCode: "USD", isPrepaid: false,
  billingPolicy: { interval: "MONTH", intervalCount: 1, anchorDay: 2 },
  nextBillingDateEpoch: 1788307200,
  lines: [{ price: "10.25", quantity: 2, attributes: [{ key: "name", value: "secret-name" }] }],
  shippingAddress: { address1: "secret-address" }, paymentMethod: { secret: "secret-payment" },
});
const page = (rows: unknown[], hasNextPage = false, nextCursor: unknown = null) => ({
  success: true, code: "SUCCESS", data: rows, pageInfo: { hasNextPage, nextCursor },
});
const response = (body: unknown) => new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it("is off without explicit enablement, has no default transport, and does not touch global fetch", async () => {
  const fetch = vi.fn(() => { throw new Error("forbidden_network"); });
  vi.stubGlobal("fetch", fetch);
  const read = vi.fn();
  expect(await collectSubscriptionSnapshot({ ...options(), enabled: undefined }, policy(), read)).toEqual({ state: "disabled" });
  expect(read).not.toHaveBeenCalled();
  expect(fetch).not.toHaveBeenCalled();
  await expect(collectSubscriptionSnapshot(options(), policy())).rejects.toThrow("configuration");
});
it("uses documented cursor pages and returns only private projection and finite evidence, never completeness", async () => {
  const read = vi.fn().mockResolvedValueOnce(response(page([row()], true, "cursor+/=opaque")))
    .mockResolvedValueOnce(response(page([{ ...row("987654321"), status: "PAUSED" }])));
  const out = await collectSubscriptionSnapshot(options(), policy(), read);
  expect(read.mock.calls.map(([r]) => [r.method, r.path, r.redirect])).toEqual([
    ["GET", "/admin/2026-04/subscription?pageSize=10", "error"],
    ["GET", "/admin/2026-04/subscription?pageSize=9&afterCursor=cursor%2B%2F%3Dopaque", "error"],
  ]);
  expect(out.state).toBe("pagination_ended");
  if (out.state === "disabled") throw new Error("unexpected disabled");
  expect(out.collection).toMatchObject({ requests: 2, rawRows: 2, apiVersion: "2026-04", consistency: "unverified" });
  expect(out.collection.pages).toHaveLength(2);
  expect(out.collection.pages[1].requestCursorDigest).toMatch(/^[a-f0-9]{64}$/);
  expect(out.collection.revisions[0].sourceUpdatedAt).toBe("2026-08-31T10:00:00Z");
  expect(out.snapshot.rows[0].lines).toEqual([{ unitPrice: "10.250000", quantity: 2 }]);
  expect(out.snapshot.scope).toMatchObject({ paginationComplete: true, scopeComplete: false });
  for (const m of Object.values(out.snapshot.metrics)) expect(m.value).toBeNull();
  for (const privateValue of ["private@", "secret-", "888888888", "123456789", "987654321", "cursor+/="])
    expect(JSON.stringify(out)).not.toContain(privateValue);
});
it("stops at a hard page budget without claiming completion", async () => {
  const read = vi.fn().mockResolvedValue(response(page([row()], true, "more")));
  const out = await collectSubscriptionSnapshot({ ...options(), maxPages: 1 }, policy(), read);
  expect(read).toHaveBeenCalledTimes(1);
  expect(out.state).toBe("page_limit");
  if (out.state === "disabled") throw new Error("unexpected disabled");
  expect(out.snapshot.scope.paginationComplete).toBe(false);
});
it("supports an explicit documented filter but refuses a policy wider than that filter", async () => {
  const read = vi.fn().mockResolvedValue(response(page([row()])));
  await collectSubscriptionSnapshot({ ...options(), status: "ACTIVE" }, policy(), read);
  expect(read.mock.calls[0][0].path).toBe("/admin/2026-04/subscription?pageSize=10&status=ACTIVE");
  read.mockClear();
  const p = policy(); p.countedStatuses.push("PAUSED"); p.excludedStatuses = ["CANCELLED", "EXPIRED"];
  await expect(collectSubscriptionSnapshot({ ...options(), status: "ACTIVE" }, p, read)).rejects.toThrow("policy");
  expect(read).not.toHaveBeenCalled();
});
it.each([
  { success: true, code: "SUCCESS", data: [], pageInfo: {} },
  { success: "true", code: "SUCCESS", data: [], pageInfo: { hasNextPage: false } },
  { ...page([]), code: "FAILURE" },
  { ...page([]), errors: ["secret-error"] },
  page([], true, "more"),
  page([row()], true, null),
])("fails closed on malformed or partial page metadata", async body => {
  await expect(collectSubscriptionSnapshot(options(), policy(), async () => response(body))).rejects.toThrow("subscription_collection_");
});
it("rejects repeated cursors and duplicate revision conflicts instead of inferring a stable snapshot", async () => {
  const read = vi.fn(async () => response(page([row()], true, "same")));
  await expect(collectSubscriptionSnapshot(options(), policy(), read)).rejects.toThrow("cursor");
  const revised = vi.fn().mockResolvedValueOnce(response(page([row()], true, "next")))
    .mockResolvedValueOnce(response(page([{ ...row(), updatedAt: "2026-08-31T11:00:00Z" }])));
  await expect(collectSubscriptionSnapshot(options(), policy(), revised)).rejects.toThrow("revision_conflict");
});
it("caps page size, total rows and bytes without silently truncating", async () => {
  await expect(collectSubscriptionSnapshot({ ...options(), pageSize: 1 }, policy(),
    async () => response(page([row(), row("2")])))).rejects.toThrow("page");
  await expect(collectSubscriptionSnapshot({ ...options(), maxRows: 1 }, policy(),
    async () => response(page([row(), row("2")])))).rejects.toThrow("page");
  await expect(collectSubscriptionSnapshot({ ...options(), maxBytes: 10 }, policy(),
    async () => response(page([row()])))).rejects.toThrow("response");
});
it("reduces the requested page size to the remaining approved row budget and makes no extra read", async () => {
  const read = vi.fn().mockImplementation(async () => response(page([row()], true, "more")));
  const out = await collectSubscriptionSnapshot({ ...options(), maxRows: 1 }, policy(), read);
  expect(read).toHaveBeenCalledTimes(1);
  expect(read.mock.calls[0]?.[0]).toMatchObject({ path: "/admin/2026-04/subscription?pageSize=1" });
  expect(out.state).toBe("row_limit");
});
it("redacts HTTP, transport, parsing and stream exceptions without logs or returned raw payload", async () => {
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  const reads = [
    async () => { throw new Error("private-token-person"); },
    async () => new Response("private-token-person", { status: 401 }),
    async () => new Response("private-token-person", { headers: { "content-type": "application/json" } }),
    async () => new Response(new ReadableStream({ start(c) { c.error(new Error("private-token-person")); } }),
      { headers: { "content-type": "application/json" } }),
  ];
  for (const read of reads) {
    const error = await collectSubscriptionSnapshot(options(), policy(), read).catch(e => e);
    expect(error.message).toMatch(/^subscription_collection_(transport|response)$/);
    expect(JSON.stringify(error)).not.toContain("private-token-person");
    expect(error.cause).toBeUndefined();
  }
  expect(log).not.toHaveBeenCalled();
});
it("aborts before calling a transport and bounds a transport that ignores cancellation", async () => {
  const pre = new AbortController(); pre.abort();
  const read = vi.fn();
  await expect(collectSubscriptionSnapshot({ ...options(), signal: pre.signal }, policy(), read)).rejects.toThrow("aborted");
  expect(read).not.toHaveBeenCalled();
  const controller = new AbortController();
  const pending = collectSubscriptionSnapshot({ ...options(), signal: controller.signal }, policy(), async () => {
    queueMicrotask(() => controller.abort());
    return new Promise<Response>(() => {});
  });
  await expect(pending).rejects.toThrow("aborted");
});
it("rejects unsupported money/schema/ID drift and ignores no unsafe numeric identity", async () => {
  for (const change of [{ id: 9007199254740992 }, { lines: [{ price: 10.25, quantity: 2 }] },
    { customer: { shopifyId: 9007199254740992 } }, { updatedAt: "not-a-time" }]) {
    await expect(collectSubscriptionSnapshot(options(), policy(), async () => response(page([{ ...row(), ...change }]))))
      .rejects.toThrow("subscription_collection_");
  }
});
