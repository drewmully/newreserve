import { describe, expect, it, vi } from "vitest";
import { evidenceDigest } from "@/lib/analytics/evidenceIntake";
import { mapMullySource, mullyCustomerId, mullySourcePackets, orderCustomerIds, readMullyCustomers,
  type MullyPermission } from "@/lib/analytics/mymullySource";
import { normalizeIdentity, resolveTemporalIdentity } from "@/lib/analytics/identity";
import { readPosthogBehavior } from "@/lib/analytics/posthogSource";
import { behaviorDiagnosticView } from "@/lib/analytics/behaviorView";
import { fullFixture } from "../fixtures/analyticsFull";
import { refreshFixture } from "../fixtures/analyticsRefresh";
import { prepareMullyRefresh } from "@/lib/analytics/mymullyRefresh";
import type { ShopifyOrderDocument } from "@/lib/analytics/shopifySource";

const projectRef = "a".repeat(20), shop = "fixture.myshopify.com", capturedAt = "2026-03-02T00:00:00Z";
const rows = [{ id: "123", firebase_uid: "uid_fixture", entity: "mully",
  created_at: "2025-01-01T00:00:00+00:00", updated_at: "2026-01-01T00:00:00+00:00" }];
const scope = { projectRef, shop, customerIds: ["123"], capturedAt, entities: ["mully", "shopify"] };
const orders: ShopifyOrderDocument[] = [{ shop, apiVersion: "2026-07",
  order: { id: "gid://shopify/Order/1", customer: { id: "gid://shopify/Customer/123" } } }];
const permission: MullyPermission = { customerId: "123", from: "2025-02-01T00:00:00Z", to: null,
  permitted: true, removed: false, evidenceRef: "fixture:analytics-authority" };
const response = (value: unknown = rows, range = "0-0/1") =>
  Response.json(value, { headers: { "Content-Range": range } });
async function mapped(permissions: MullyPermission[] = []) {
  const snapshot = await readMullyCustomers(scope, "fixture", async () => response());
  return { snapshot, orders, permissions, mappingVersion: "identity-v1" };
}
it("reads only the scoped existing customer fields and never marketing/PII or arbitrary tables", async () => {
  const request = vi.fn<typeof fetch>(async () => response());
  const snapshot = await readMullyCustomers(scope, "fixture", request);
  expect(snapshot.customers[0]).toMatchObject({ id: "123", firebaseUid: "uid_fixture" });
  const url = new URL(String(request.mock.calls[0][0]));
  expect(url.origin).toBe(`https://${projectRef}.supabase.co`);
  expect(url.pathname).toBe("/rest/v1/customers");
  expect(url.searchParams.get("select")).toBe("id,firebase_uid,created_at,updated_at,entity");
  expect(url.searchParams.get("id")).toBe("in.(123)");
  expect(url.searchParams.get("limit")).toBe("2");
  expect(request.mock.calls[0][1]).toMatchObject({ method: "GET", redirect: "error" });
});
it("derives IDs from Shopify source customer links, not email or order ID guesses", () => {
  expect(orderCustomerIds(orders)).toEqual(["123"]);
  expect(orderCustomerIds([{ ...orders[0], order: { customer: null } }])).toEqual([]);
  expect(() => orderCustomerIds([{ ...orders[0], order: {} }])).toThrow("not_selected");
});
it("does not query any customers for a guest-only source inventory", async () => {
  const request = vi.fn();
  expect((await readMullyCustomers({ ...scope, customerIds: [] }, "fixture", request)).customers).toEqual([]);
  expect(request).not.toHaveBeenCalled();
});
it.each([
  ["missing rows", [], "*/0", "incomplete"],
  ["server row cap", rows, "0-0/2", "incomplete"],
  ["wrong brand", [{ ...rows[0], entity: "other" }], "0-0/1", "mismatch"],
  ["wrong id", [{ ...rows[0], id: "456" }], "0-0/1", "mismatch"],
  ["rounded bigint", [{ ...rows[0], id: 9007199254740992 }], "0-0/1", "unsafe"],
  ["future row", [{ ...rows[0], updated_at: "2027-01-01T00:00:00Z" }], "0-0/1", "future"],
])("rejects %s without returning partial evidence", async (_, value, range, error) => {
  await expect(readMullyCustomers(scope, "fixture", async () => response(value, String(range))))
    .rejects.toThrow(String(error));
});
it("rejects unbounded, invalid, duplicate and synthetic IDs before I/O", async () => {
  const request = vi.fn();
  for (const customerIds of [["123", "123"], ["x)"], ["9000000000000000"], Array(101).fill("123")])
    await expect(readMullyCustomers({ ...scope, customerIds }, "fixture", request)).rejects.toThrow();
  await expect(readMullyCustomers({ ...scope, projectRef: "bad" }, "fixture", request)).rejects.toThrow();
  expect(request).not.toHaveBeenCalled();
});
it("does not retry failures or reflect source error bodies", async () => {
  const request = vi.fn(async () => new Response("private vendor error", { status: 403 }));
  await expect(readMullyCustomers(scope, "fixture", request)).rejects.toThrow("mully_source_unavailable");
  expect(request).toHaveBeenCalledTimes(1);
});
it("bounds streamed bytes even if content length is absent", async () => {
  await expect(readMullyCustomers(scope, "fixture", async () => new Response("x".repeat(250001))))
    .rejects.toThrow("response_budget");
});
it("maps stable shop-scoped surrogates and never invents history or analytics permission", async () => {
  const source = await mapped(), result = mapMullySource(source);
  const canonical = mullyCustomerId(projectRef, shop, "123");
  expect(canonical).not.toBe("123");
  expect(mullyCustomerId(projectRef, "other.myshopify.com", "123")).not.toBe(canonical);
  expect(result.currentlyPermitted).toEqual([]);
  expect(result.customerHistory[canonical].migrationsReconciled).toBe(false);
  expect(result.identity.every(i => i.consent === "unknown")).toBe(true);
  expect(result.identity.find(i => i.namespace === "firebase")?.from).toBe(capturedAt);
  expect(result.orderIdentities[0]).toMatchObject({ namespace: "shopify_customer", identifier: "123" });
});
it("applies real permission intervals without backdating a grant or Firebase association", async () => {
  const result = mapMullySource(await mapped([permission]));
  const mappings = result.identity.map(row => normalizeIdentity(row, "fixture"));
  const resolve = (namespace: string, identifier: string, occurredAt: string) => resolveTemporalIdentity({
    namespace, identifier, occurredAt, version: "identity-v1", publication: "fixture", mappings,
    currentlyPermitted: new Set(result.currentlyPermitted), removedCustomers: new Set(result.removedCustomers),
  });
  expect(resolve("shopify_customer", "123", "2025-01-15T00:00:00Z").status).toBe("not_permitted");
  expect(resolve("shopify_customer", "123", "2026-01-01T00:00:00Z").status).toBe("resolved");
  expect(resolve("firebase", "uid_fixture", "2026-01-01T00:00:00Z").status).toBe("unresolved");
  expect(resolve("firebase", "uid_fixture", capturedAt).status).toBe("resolved");
});
it("keeps gaps in permission unknown and applies current removals", async () => {
  const result = mapMullySource(await mapped([
    { ...permission, to: "2025-03-01T00:00:00Z" },
    { ...permission, from: "2026-01-01T00:00:00Z", permitted: false, removed: true },
  ]));
  expect(result.currentlyPermitted).toEqual([]);
  expect(result.removedCustomers).toHaveLength(1);
  expect(result.identity.find(i => i.from === "2025-03-01T00:00:00Z")?.consent).toBe("unknown");
});
it("rejects overlapping permission, forged digests, and duplicate orders", async () => {
  const input = await mapped([permission, permission]);
  expect(() => mapMullySource(input)).toThrow("overlapping");
  input.permissions = [];
  expect(() => mapMullySource({ ...input, orders: [...orders, ...orders] })).toThrow("duplicate_order");
  input.snapshot.customers[0].firebaseUid = "changed";
  expect(() => mapMullySource(input)).toThrow("snapshot_mismatch");
});
it("marks duplicate Firebase claims conflicting, rather than choosing one customer", async () => {
  const snapshot = await readMullyCustomers({ ...scope, customerIds: ["123", "456"] }, "fixture",
    async () => response([...rows, { ...rows[0], id: "456" }], "0-1/2"));
  const result = mapMullySource({ snapshot, mappingVersion: "identity-v1", permissions: [],
    orders: [...orders, { ...orders[0], order: { id: "gid://shopify/Order/2", customer: { id: "gid://shopify/Customer/456" } } }] });
  expect(result.identity.filter(i => i.namespace === "firebase").every(i => i.resolution === "conflicting")).toBe(true);
});
it("produces intake packets with exact payload hashes and no passed control packets", async () => {
  const input = await mapped();
  const packets = mullySourcePackets(input, { scope: { projectRef, shop, fromDate: "2026-01-01", throughDate: "2026-01-01" },
    sourceId: "mully", schemaVersion: "mully-v1" });
  expect(packets).toHaveLength(5);
  expect(packets.every(p => p.sha256 === evidenceDigest(p.payload))).toBe(true);
  expect(packets.some(p => p.section === "proofs")).toBe(false);
});
it("wires the customer packets into a disabled immutable refresh bundle offline", async () => {
  const refresh = refreshFixture();
  const source = await mapped();
  source.snapshot.capturedAt = refresh.intake.asOf;
  const { digest: _digest, ...payload } = source.snapshot; void _digest;
  source.snapshot.digest = evidenceDigest(payload);
  const result = prepareMullyRefresh({ refresh, source, binding: {
    sourceId: "mully", schemaVersion: "mully-v1", approvalRef: "fixture:source", maxAgeSeconds: 86400,
  } });
  expect(result.bundle.full.evidence.identity[0].namespace).toBe("shopify_customer");
  expect(result.bundle.full.evidence.currentlyPermitted).toEqual([]);
  expect(result.bundle.full.evidence.proofs).toEqual(refresh.intake.packets.find(p => p.section === "proofs")!.payload);
});
describe("actual PostHog identifier fields", () => {
  it.each(["reserve_user_id", "shopify_customer_id", "mully_anon_id"] as const)(
    "reads %s only when explicitly configured", async field => {
      const f = fullFixture();
      f.behavior.families.page_view.identityProperty = field;
      const wire = { columns: [...f.wire.columns, field], results: [[...f.wire.results[0], "actual-id"]] };
      const request = vi.fn<typeof fetch>(async () => Response.json(wire));
      const [event] = await readPosthogBehavior(f.behavior, "fixture", request);
      expect(event.distinctId).toBe("actual-id");
      expect(JSON.parse(String(request.mock.calls[0][1]?.body)).query.query).toContain(`properties.${field} AS ${field}`);
      expect(behaviorDiagnosticView(f.behavior).query).toContain(`toString(properties.${field})`);
    });
});
it("supports the actual nullable timestamps without inventing historical validity", async () => {
  const snapshot = await readMullyCustomers(scope, "fixture", async () =>
    response([{ ...rows[0], entity: "shopify", created_at: null, updated_at: null }]));
  const result = mapMullySource({ snapshot, orders, mappingVersion: "v1", permissions: [] });
  expect(result.identity.every(i => i.from === capturedAt)).toBe(true);
});
