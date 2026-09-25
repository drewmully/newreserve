/** Synthetic transport -> actual preparation -> real full-report consumer.
 * No hosted data, guessed policy, activation or additional payment source read. */
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { collectRefresh, type CollectRefreshInput } from "@/lib/analytics/collectRefresh";
import { collectPartitionRefresh } from "@/lib/analytics/partitionRefresh";
import { evidenceDigest, type EvidencePacket } from "@/lib/analytics/evidenceIntake";
import { mapApprovedShopifyCash } from "@/lib/analytics/shopifyCash";
import { prepareRefresh } from "@/lib/analytics/refreshPlan";
import { runFullReportJob } from "@/lib/analytics/fullReportJob";
import type { Row } from "@/lib/analytics/primitives";
import type { ShopifyOrderDocument } from "@/lib/analytics/shopifySource";
import { discoveryInput, discoveryEnv, discoveryStart } from "../fixtures/analyticsDiscovery";
import { fullFixture } from "../fixtures/analyticsFull";
import { partitionInput, partitionEnv } from "../fixtures/analyticsPartition";
import { offerSource, offerTransport } from "../fixtures/offer-collection-source.mjs";

const finish = "2026-09-24T19:00:02.000Z";
const policy = { clock: "approved_successful_transaction_processed_at" as const,
  approvalRef: "fixture:explicit-customer-payment-clock", version: "cash-v1", gateways: ["fixture"] };
const clock = () => vi.fn().mockReturnValueOnce(discoveryStart).mockReturnValue(finish);
const settlements = (f: CollectRefreshInput) =>
  f.refresh.intake.packets.find(p => p.section === "settlements")! as EvidencePacket<"settlements">;
function input() {
  const f = discoveryInput(); delete f.collection.discover;
  f.collection.orderIds = ["gid://shopify/Order/1"];
  f.collection.cash = { ...policy, gateways: [...policy.gateways] };
  f.refresh.policy.behaviorMode = "excluded";
  const p = settlements(f); p.payload = []; p.sha256 = evidenceDigest([]);
  return f;
}
function source() {
  const s = offerSource(1);
  Object.assign(s.commerce.order.transactions[0], { id: "gid://shopify/OrderTransaction/4",
    processedAt: "2026-01-01T14:00:00Z", amountSet: { shopMoney: { amount: "20", currencyCode: "USD" } } });
  return s;
}
const transport = (change: (s: ReturnType<typeof source>) => void = () => {}) =>
  vi.fn<typeof fetch>(offerTransport(() => { const s = source(); change(s); return s; }));
let external: ReturnType<typeof vi.fn>;
beforeEach(() => {
  external = vi.fn(() => { throw new Error("external_network_forbidden"); });
  vi.stubGlobal("fetch", external);
});
afterEach(() => { expect(external).not.toHaveBeenCalled(); vi.unstubAllGlobals(); });

it("feeds existing settlements with no additional reads and preserves all controls and authority", async () => {
  const f = input(), before = structuredClone(f), request = transport();
  const out = await collectRefresh(f, discoveryEnv, request, clock());
  expect(request).toHaveBeenCalledTimes(3); // order, revision recheck, existing customer read
  expect(f).toEqual(before);
  expect(out.bundle.full.evidence.settlements).toMatchObject([{ id: "4", signedAmount: "20.000000",
    settledAt: "2026-01-01T14:00:00Z", gateway: "fixture" }]);
  const packet = settlements({ ...f, refresh: out.refresh });
  expect(packet).toMatchObject({ capturedAt: discoveryStart, sha256: evidenceDigest(packet.payload) });
  expect(packet.sourceRecordRef).toMatch(/^collected-cash:sha256:/);
  expect(out.sources.cash?.retained.packet).toEqual(settlements(before));
  expect(out.refresh.intake.bindings.find(b => b.sourceId === packet.sourceId)?.independentControlSource).toBe(false);
  for (const p of before.refresh.intake.packets.filter(p => !["orderIdentities", "settlements"].includes(p.section)))
    expect(out.refresh.intake.packets.find(q => q.section === p.section)).toEqual(p);
  expect(out.audit).toMatchObject({ independentlyReconciled: false, completePurchaseHistory: false,
    enabled: false, registered: false });
  expect(prepareRefresh(JSON.parse(JSON.stringify(out.refresh)))).toEqual(out.bundle);
  expect(JSON.stringify(out)).not.toMatch(/synthetic-source|synthetic-shopify/);
});
it("leaves absent-option behavior and existing settlements unchanged", async () => {
  const f = input(); delete f.collection.cash;
  const old = fullFixture().evidence.settlements;
  settlements(f).payload = old; settlements(f).sha256 = evidenceDigest(old);
  const request = transport(), out = await collectRefresh(f, discoveryEnv, request, clock());
  expect(settlements({ ...f, refresh: out.refresh })).toEqual(settlements(f));
  expect(request).toHaveBeenCalledTimes(3);
  expect(out.audit.collectedSections).not.toContain("settlements");
  expect(out.sources).not.toHaveProperty("cash");
});
it("deduplicates economically equal transactions without overwriting the prior settlement authority", async () => {
  const f = input(), prior = fullFixture().evidence.settlements;
  settlements(f).payload = prior; settlements(f).sha256 = evidenceDigest(prior);
  const out = await collectRefresh(f, discoveryEnv, transport(), clock());
  expect(out.bundle.full.evidence.settlements).toEqual(prior);
});
it.each(["settledAt", "signedAmount", "parentId", "status"] as const)(
  "rejects conflicting %s instead of replacing retained evidence", async field => {
    const f = input(), p = settlements(f);
    p.payload = fullFixture().evidence.settlements;
    Object.assign(p.payload[0], { [field]: { settledAt: "2026-01-01T15:00:00Z",
      signedAmount: "21", parentId: "99", status: "pending" }[field] });
    p.sha256 = evidenceDigest(p.payload);
    await expect(collectRefresh(f, discoveryEnv, transport(), clock())).rejects.toThrow("conflicting_settlement");
  });
it.each([
  ["missing clock", { clock: undefined }], ["automatic alias", { clock: "processedAt" }],
  ["missing approval", { approvalRef: "" }], ["missing version", { version: "" }],
  ["missing gateways", { gateways: [] }], ["duplicate gateways", { gateways: ["fixture", "fixture"] }],
  ["injected time", { asOf: finish }], ["injected coverage", { cashComplete: true }],
])("rejects %s before source reads", async (_name, change) => {
  const f = input(), request = transport(); Object.assign(f.collection.cash!, change);
  await expect(collectRefresh(f, discoveryEnv, request, clock())).rejects.toThrow();
  expect(request).not.toHaveBeenCalled();
});
it.each(["missing", "stale", "tampered", "outlives", "foreign-shop", "duplicate"])(
  "rejects %s retained cash evidence before source reads", async mode => {
    const f = input(), p = settlements(f), request = transport();
    if (mode === "missing") f.refresh.intake.packets = f.refresh.intake.packets.filter(p => p.section !== "settlements");
    if (mode === "stale") p.capturedAt = "2026-01-01T00:00:00Z";
    if (mode === "tampered") p.sha256 = "0".repeat(64);
    if (mode === "outlives") f.collection.binding.maxAgeSeconds = 1700;
    if (["foreign-shop", "duplicate"].includes(mode)) {
      p.payload = fullFixture().evidence.settlements;
      if (mode === "foreign-shop") p.payload[0].shop = "other.myshopify.com";
      else p.payload.push(structuredClone(p.payload[0]));
      p.sha256 = evidenceDigest(p.payload);
    }
    await expect(collectRefresh(f, discoveryEnv, request, clock())).rejects.toThrow();
    expect(request).not.toHaveBeenCalled();
  });
it("does not recapture older retained evidence or discard nonoverlapping authority", async () => {
  const f = input(), p = settlements(f);
  p.capturedAt = "2026-09-24T18:59:00.000Z";
  p.payload = fullFixture().evidence.settlements; p.payload[0].id = "99"; p.sha256 = evidenceDigest(p.payload);
  const out = await collectRefresh(f, discoveryEnv, transport(), clock());
  expect(out.bundle.full.evidence.settlements).toHaveLength(2);
  expect(out.bundle.full.evidence.settlements[0]).toEqual(p.payload[0]);
  expect(settlements({ ...f, refresh: out.refresh }).capturedAt).toBe(p.capturedAt);
});
it.each(["gateway", "clock", "incomplete", "future"])(
  "fails actual %s transaction evidence, not a passed control", async mode => {
    const request = transport(s => {
      const t = s.commerce.order.transactions[0];
      if (mode === "gateway") t.gateway = "unapproved";
      if (mode === "clock") Object.assign(t, { processedAt: null });
      if (mode === "incomplete") s.commerce.order.transactionsCount.count++;
      if (mode === "future") t.processedAt = "2026-09-25T00:00:00Z";
    });
    await expect(collectRefresh(input(), discoveryEnv, request, clock())).rejects.toThrow();
    expect(request).toHaveBeenCalledTimes(3);
  });
it.each(["PENDING", "FAILURE"])("does not make %s transactions cash", async status => {
  const out = await collectRefresh(input(), discoveryEnv, transport(s => {
    s.commerce.order.transactions[0].status = status;
  }), clock());
  expect(out.bundle.full.evidence.settlements).toEqual([]);
});
it.each(["PENDING", "FAILURE", "TEST"])("does not hide a conflicting %s source behind retained cash", async state => {
  const f = input(), p = settlements(f);
  p.payload = fullFixture().evidence.settlements; p.sha256 = evidenceDigest(p.payload);
  await expect(collectRefresh(f, discoveryEnv, transport(s => {
    if (state === "TEST") {
      s.commerce.order.test = true; s.commerce.order.transactions[0].test = true;
    } else s.commerce.order.transactions[0].status = state;
  }), clock())).rejects.toThrow("collection_cash_conflicting_settlement");
});
it("fails closed rather than copying retained settlements into every partition child", async () => {
  const f = partitionInput(), request = transport(); Object.assign(f.collection, { cash: policy });
  await expect(collectPartitionRefresh(f, partitionEnv, request)).rejects.toThrow("partition_cash_collection_not_supported");
  expect(request).not.toHaveBeenCalled();
});

it("uses the actual full consumer for cash facts/report, equal replay and metric-specific withholding", async () => {
  const collected = await collectRefresh(input(), discoveryEnv, transport(), clock());
  const base = fullFixture().base, b = collected.bundle;
  const consume = async (cashCoverage: boolean) => {
    const evidence = structuredClone(b.full.evidence);
    evidence.dateCoverage[0].gates.cash = cashCoverage;
    const args = { state: "ready", ...b.full, evidence, shop: b.base.shop, publication: "fixture:cash",
      fromDate: b.base.fromDate, throughDate: b.base.throughDate, inputHash: "fixture:hash", facts: base };
    const rpc = vi.fn(async (name: string, params?: Record<string, unknown>) => {
      void params; return { data: name === "lean_full_inputs" ? args : true, error: null };
    });
    await expect(runFullReportJob({ projectRef: discoveryEnv.LEAN_MULLY_SOURCE_PROJECT_REF,
      databaseUrl: `https://${discoveryEnv.LEAN_MULLY_SOURCE_PROJECT_REF}.supabase.co`,
      runId: b.runId, posthogKey: "", client: { rpc } })).resolves.toMatchObject({ state: "complete" });
    return rpc.mock.calls.find(([name]) => name === "lean_full_finish")![1]!;
  };
  const ready = await consume(true), replay = await consume(true), withheld = await consume(false);
  expect(replay.p_facts).toEqual(ready.p_facts);
  expect(replay.p_reports).toEqual(ready.p_reports);
  expect(replay.p_manifest).toEqual(ready.p_manifest);
  const facts = ready.p_facts as Record<string, Row[]>;
  expect(facts.payments[0]).toMatchObject({ cash_eligible: true, cash_amount_usd: "20.000000",
    settled_at: "2026-01-01T14:00:00Z" });
  const report = (result: typeof ready) => (result.p_reports as Record<string, Row[]>).store_daily[0];
  expect(report(ready)).toMatchObject({ collected_cash_usd: "20.000000",
    readiness: { collected_cash_usd: "observed_unverified" } });
  expect(report(withheld)).toMatchObject({ collected_cash_usd: null, readiness: { collected_cash_usd: "withheld" } });
  expect(withheld.p_facts).toEqual(ready.p_facts);
  expect(mapApprovedShopifyCash([source().commerce as ShopifyOrderDocument], { ...policy, asOf: finish }))
    .toEqual(b.full.evidence.settlements);
});
