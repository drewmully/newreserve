import { expect, it } from "vitest";
import { evidenceDigest } from "@/lib/analytics/evidenceIntake";
import { mapShopifyOffers } from "@/lib/analytics/shopifyOffers";
import { prepareMullyRefresh, type MullyRefreshInput } from "@/lib/analytics/mymullyRefresh";
import { readMullyCustomers, mullyCustomerId } from "@/lib/analytics/mymullySource";
import { orderCartTokens, readJourneyReceipts } from "@/lib/analytics/journeySource";
import { key } from "@/lib/analytics/primitives";
import { refreshFixture } from "../fixtures/analyticsRefresh";
import { fullFixture } from "../fixtures/analyticsFull";
import { buildFullReports } from "@/lib/analytics/fullReportBuild";
import { mapJourneyPermissions, readJourneyPermissions } from "@/lib/analytics/journeyPermissions";
const shop = "fixture.myshopify.com", project = "a".repeat(20);
const registry = { shop, attributeKey: "_offer_id", mappingVersion: "offer-v1", approvalRef: "fixture:approved",
  values: { "founding-box": { offerId: "offer_1", evidenceRef: "fixture:catalog" } } };
const order = () => ({ shop, apiVersion: "2026-07" as const, order: { id: "gid://shopify/Order/1", cartToken: null,
  customer: { id: "gid://shopify/Customer/123" },
  lineItems: { nodes: [{ id: "gid://shopify/LineItem/2", sku: "NO_INFERRED_OFFER",
    customAttributes: [{ key: "_offer_id", value: "founding-box" }] }], pageInfo: { hasNextPage: false } } } });
it("maps only approved line-level offer values and preserves the exact item key", () => {
  expect(mapShopifyOffers([order()], registry)).toEqual([{ orderItemId: key(shop, "1", "2"), offerId: "offer_1",
    evidenceRef: "fixture:catalog", mappingVersion: "offer-v1" }]);
  const doc = order(); doc.order.lineItems.nodes[0].customAttributes = [];
  expect(mapShopifyOffers([doc], registry)).toEqual([]);
});
it("blocks unknown/duplicated offer evidence and partial line pages", () => {
  expect(() => mapShopifyOffers([order()], { ...registry, values: {} })).toThrow("unmapped");
  const doc = order(); doc.order.lineItems.nodes[0].customAttributes.push({ key: "_offer_id", value: "other" });
  expect(() => mapShopifyOffers([doc], registry)).toThrow("conflicting");
  doc.order.lineItems.pageInfo.hasNextPage = true;
  expect(() => mapShopifyOffers([doc], registry)).toThrow("incomplete");
  expect(() => mapShopifyOffers([order(), order()], registry)).toThrow("duplicate");
});
async function input(): Promise<MullyRefreshInput> {
  const refresh = refreshFixture();
  const snapshot = await readMullyCustomers({ projectRef: project, shop, capturedAt: refresh.intake.asOf,
    customerIds: ["123"], entities: ["shopify"] }, "fixture",
  async () => Response.json([{ id: "123", firebase_uid: null, entity: "shopify",
    created_at: "2025-01-01T00:00:00Z", updated_at: "2025-01-01T00:00:00Z" }],
  { headers: { "Content-Range": "0-0/1" } }));
  return { refresh, source: { snapshot, orders: [order()], mappingVersion: refresh.policy.mappingVersion, permissions: [] },
    binding: { sourceId: "mully", schemaVersion: "mully-v1", approvalRef: "fixture:source", maxAgeSeconds: 86400 } };
}
it("preserves reviewed original history without manufacturing freshness or overriding withdrawals", async () => {
  const i = await input(), canonical = mullyCustomerId(project, shop, "123");
  const history = i.refresh.intake.packets.find(p => p.section === "customerHistory")!;
  history.payload = { [canonical]: { expectedSources: ["shopify"], completeSources: ["shopify"],
    approvalRef: "fixture:reviewed-history", migrationsReconciled: true } };
  history.sha256 = evidenceDigest(history.payload);
  i.retainReviewed = { customerHistory: history.sourceId };
  i.source.permissions = [{ customerId: "123", from: "2025-01-01T00:00:00Z", to: null,
    permitted: false, removed: true, evidenceRef: "fixture:withdrawal" }];
  const out = prepareMullyRefresh(i);
  expect(out.bundle.full.evidence.customerHistory).toEqual(history.payload);
  expect(out.refresh.intake.packets.find(p => p.section === "customerHistory")).toEqual(history);
  expect(out.bundle.full.evidence.currentlyPermitted).toEqual([]);
  expect(out.bundle.full.evidence.removedCustomers).toEqual([canonical]);
});
it("rejects stale, tampered, missing or wrong-customer reviewed history", async () => {
  const i = await input(), canonical = mullyCustomerId(project, shop, "123");
  const history = i.refresh.intake.packets.find(p => p.section === "customerHistory")!;
  i.retainReviewed = { customerHistory: "nonexistent" };
  expect(() => prepareMullyRefresh(i)).toThrow("missing_reviewed");
  i.retainReviewed = { customerHistory: history.sourceId };
  expect(() => prepareMullyRefresh(i)).toThrow("customer_scope");
  history.payload = { [canonical]: { expectedSources: ["shopify"], completeSources: ["shopify"],
    approvalRef: "fixture:history", migrationsReconciled: true } };
  expect(() => prepareMullyRefresh(i)).toThrow("digest_mismatch");
  history.sha256 = evidenceDigest(history.payload); history.capturedAt = "2025-01-01T00:00:00Z";
  expect(() => prepareMullyRefresh(i)).toThrow("stale_or_future");
});
it("connects approved offers into the actual refresh graph, leaving independent controls untouched", async () => {
  const i = await input(); i.offers = registry;
  const out = prepareMullyRefresh(i);
  expect(out.bundle.full.evidence.offers[0].offerId).toBe("offer_1");
  expect(out.bundle.full.evidence.proofs).toEqual(i.refresh.intake.packets.find(p => p.section === "proofs")?.payload);
  const full = fullFixture(); full.evidence.offers = out.bundle.full.evidence.offers;
  expect(buildFullReports(full).facts.order_item_offers[0].order_item_id).toBe(full.base.order_items[0].order_item_id);
});
function permissions() {
  const f = fullFixture();
  const payload = { projectRef: project, shop, posthogProject: f.policy.project,
    from: f.behavior.from, until: f.behavior.until, capturedAt: f.policy.asOf,
    grants: [{ subjectId: "subject_fixture", validFrom: "2026-01-01T10:00:00Z",
      expiresAt: "2026-01-01T20:00:00Z", revokedAt: null as string | null, permissionEvidenceRef: "fixture:authority" }] };
  return { ...payload, digest: evidenceDigest(payload) };
}
it("requires current authority evidence for new anonymous events and propagates withdrawal", () => {
  const f = fullFixture();
  f.events[0] = { ...f.events[0], family: "lean_reserve_started", identityNamespace: "lean_subject",
    distinctId: "subject_fixture" };
  f.policy.stages = { started: "lean_reserve_started" };
  expect(buildFullReports(f).facts.sessions).toEqual([]);
  const snapshot = permissions();
  const config = { ...snapshot, asOf: f.policy.asOf, mappingVersion: f.policy.mappingVersion };
  f.evidence.identity.push(...mapJourneyPermissions(snapshot, config));
  expect(buildFullReports(f).facts.sessions).toHaveLength(1);
  const anonymous = f.evidence.identity.find(row => row.namespace === "lean_subject")!;
  anonymous.consent = "denied";
  expect(buildFullReports(f).facts.sessions).toEqual([]);
  anonymous.consent = "permitted"; anonymous.removal = "removed"; anonymous.resolution = "removed";
  expect(buildFullReports(f).facts.sessions).toEqual([]);
});
it("reads bounded permission snapshots with no bearer material and rejects overflow", async () => {
  const snapshot = permissions();
  const result = await readJourneyPermissions(snapshot, "fixture", async () => Response.json(
    snapshot.grants.map(g => ({ ...g, validFrom: g.validFrom.replace("Z", "+00:00"),
      token_hash: "private_bearer_hash" }))));
  expect(result.grants).toEqual(snapshot.grants);
  expect(JSON.stringify(result)).not.toContain("private_bearer");
  await expect(readJourneyPermissions(snapshot, "fixture", async () => Response.json(
    Array.from({ length: 10001 }, () => snapshot.grants[0])))).rejects.toThrow("overflow");
});
it("wires anonymous permission snapshots into the real refresh intake with preserved lineage", async () => {
  const i = await input(), p = permissions();
  const { digest: _digest, ...payload } = { ...p, capturedAt: i.refresh.intake.asOf }; void _digest;
  i.journeyPermissions = { ...payload, digest: evidenceDigest(payload) };
  const out = prepareMullyRefresh(i);
  expect(out.bundle.full.evidence.identity.find(row => row.namespace === "lean_subject")).toMatchObject({
    customerId: null, consent: "permitted", resolution: "unresolved",
  });
  expect(out.bundle.full.evidence.currentlyPermitted).toEqual([]);
  const packet = out.refresh.intake.packets.find(p => p.section === "identity")!;
  expect(packet.sourceRecordRef).toMatch(/^composite:sha256:/);
});
it("distinguishes guest/draft orders from old snapshots missing the selected cart field", () => {
  expect(orderCartTokens([order()])).toEqual([]);
  expect(() => orderCartTokens([{ shop, apiVersion: "2026-07", order: { id: "gid://shopify/Order/1" } }]))
    .toThrow("not_selected");
});
it("rejects cross-target receipt rows and overlarge responses, without accepting private extra columns", async () => {
  const config = { projectRef: project, shop, capturedAt: "2026-01-01T00:00:00Z", requestedCarts: ["c"] };
  await expect(readJourneyReceipts(config, "fixture", async () => Response.json([{ cartToken: "elsewhere" }])))
    .rejects.toThrow("shape");
  await expect(readJourneyReceipts(config, "fixture", async () => new Response("x".repeat(500001))))
    .rejects.toThrow("budget");
});
