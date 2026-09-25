import { describe, expect, it } from "vitest";
import { normalizeIdentity, resolveTemporalIdentity, buildCustomer, type IdentityEvidence } from "@/lib/analytics/identity";
const evidence: IdentityEvidence = {
  namespace: "shopify:s", identifier: "123", customerId: "customer_opaque",
  from: "2020-01-01T00:00:00Z", to: null, type: "authenticated_source_join", evidenceRef: "e",
  mappingVersion: "v1", resolution: "resolved", consent: "permitted", removal: "active",
};
const input = () => ({
  namespace: evidence.namespace, identifier: evidence.identifier, occurredAt: "2026-01-01T00:00:00Z",
  version: "v1", publication: "p", mappings: [normalizeIdentity(evidence, "p")],
  currentlyPermitted: new Set(["customer_opaque"]), removedCustomers: new Set<string>(),
});
describe("evidence-only temporal identity", () => {
  it("joins only the selected version and publication", () => {
    expect(resolveTemporalIdentity(input()).customerId).toBe("customer_opaque");
    expect(resolveTemporalIdentity({ ...input(), version: "v2" }).customerId).toBeNull();
    expect(resolveTemporalIdentity({ ...input(), publication: "other" }).customerId).toBeNull();
  });
  it("rejects ambiguous overlap rather than choosing an arbitrary customer", () => {
    const x = input();
    x.mappings.push(normalizeIdentity({ ...evidence, customerId: "customer_other" }, "p"));
    expect(resolveTemporalIdentity(x).status).toBe("conflicting");
  });
  it("uses a half-open validity interval including microsecond boundaries", () => {
    const x = input(); x.mappings = [normalizeIdentity({ ...evidence, to: "2026-01-01T00:00:00.000001Z" }, "p")];
    expect(resolveTemporalIdentity(x).status).toBe("resolved");
    expect(resolveTemporalIdentity({ ...x, occurredAt: "2026-01-01T00:00:00.000001Z" }).status).toBe("unresolved");
  });
  it("honors current removals and permission even for old events", () => {
    expect(resolveTemporalIdentity({ ...input(), removedCustomers: new Set(["customer_opaque"]) }).status).toBe("removed");
    expect(resolveTemporalIdentity({ ...input(), currentlyPermitted: new Set() }).status).toBe("not_permitted");
  });
  it.each(["denied", "unknown"] as const)("does not bypass anonymous %s permission", consent => {
    const x = input();
    x.mappings = [normalizeIdentity({ ...evidence, customerId: null, resolution: "unresolved", consent }, "p")];
    expect(resolveTemporalIdentity(x)).toEqual({ customerId: null, status: "not_permitted" });
  });
  it("does not treat a disabled source account as a removal without evidence", () => {
    expect(normalizeIdentity(evidence, "p").removal_status).toBe("active");
  });
  it("rejects personal identifiers as canonical customer IDs", () => {
    expect(() => normalizeIdentity({ ...evidence, customerId: "person@example.com" }, "p")).toThrow();
    expect(() => normalizeIdentity({ ...evidence, customerId: "14155550123" }, "p")).toThrow();
  });
  const history = { expectedSources: ["shopify", "legacy"], completeSources: ["shopify", "legacy"], approvalRef: "approved", migrationsReconciled: true };
  const orders = [
    { order_id: "renewal", customer_id: "customer_opaque", paid_at: "2026-01-01T12:00:00Z", eligibility_status: "eligible", publication_id: "p" },
    { order_id: "original", customer_id: "customer_opaque", paid_at: "2021-01-01T12:00:00Z", eligibility_status: "eligible", publication_id: "p" },
  ];
  it("finds the true historical first order, not the first recent renewal", () => {
    expect(buildCustomer("customer_opaque", "resolved", true, history, orders, "p").first_eligible_order_id).toBe("original");
  });
  it("withholds first-order anchors when any expected history or migration is missing", () => {
    expect(buildCustomer("customer_opaque", "resolved", true, { ...history, completeSources: ["shopify"] }, orders, "p").first_eligible_order_id).toBeNull();
    expect(buildCustomer("customer_opaque", "resolved", true, { ...history, migrationsReconciled: false }, orders, "p").history_complete).toBe(false);
    expect(buildCustomer("customer_opaque", "removed", false, history, orders, "p").first_eligible_order_id).toBeNull();
  });
});
