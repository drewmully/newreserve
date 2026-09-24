/** Source -> preparation -> ordinary/partition real consumers, synthetic transport only. */
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { collectRefresh, type CollectRefreshInput } from "@/lib/analytics/collectRefresh";
import { collectPartitionRefresh, preparePartitionRefresh } from "@/lib/analytics/partitionRefresh";
import { prepareRefresh } from "@/lib/analytics/refreshPlan";
import { evidenceDigest } from "@/lib/analytics/evidenceIntake";
import { runObservedReportJob } from "@/lib/analytics/observedReportJob";
import { runFullReportJob } from "@/lib/analytics/fullReportJob";
import type { PartitionPage } from "@/lib/analytics/partitionInventory";
import type { PilotSource } from "@/lib/analytics/shopifyPilotSource";
import { discoveryInput, discoveryEnv, discoveryStart } from "../fixtures/analyticsDiscovery";
import { partitionInput, partitionEnv } from "../fixtures/analyticsPartition";
import { offerSource, offerTransport } from "../fixtures/offer-collection-source.mjs";
const finish = "2026-09-24T19:00:02.000Z";
const registry = { shop: discoveryEnv.LEAN_SHOPIFY_SHOP_DOMAIN, attributeKey: "bundle",
  mappingVersion: "fixture-offers-v1", approvalRef: "fixture:taxonomy",
  values: { fixture: { offerId: "fixture-bundle", evidenceRef: "fixture:bundle-rule" } } };
function input(): CollectRefreshInput {
  const f = discoveryInput();
  delete f.collection.discover;
  f.collection.orderIds = ["gid://shopify/Order/2"];
  f.collection.offers = {};
  f.collection.binding = { sourceId: "fixture:fresh-offers", schemaVersion: "fixture-offers-v1", maxAgeSeconds: 3600 };
  f.refresh.policy.behaviorMode = "excluded";
  for (const p of f.refresh.intake.packets) {
    if (["offers", "replacements", "settlements"].includes(p.section)) p.payload = [];
    if (p.section === "identity") Object.assign((p.payload as object[])[0], { namespace: "shopify_customer", identifier: "7" });
    p.sha256 = evidenceDigest(p.payload);
  }
  return f;
}
function partition() {
  const f = partitionInput();
  delete f.collection.partitions[0].originalPurchases;
  f.collection.offers = {};
  return f;
}
const clock = () => vi.fn().mockReturnValueOnce(discoveryStart).mockReturnValue(finish);
const transport = () => vi.fn<typeof fetch>(offerTransport());
let network: ReturnType<typeof vi.fn>;
beforeEach(() => {
  network = vi.fn(() => { throw new Error("external_network_forbidden"); });
  vi.stubGlobal("fetch", network);
});
afterEach(() => { expect(network).not.toHaveBeenCalled(); vi.unstubAllGlobals(); });

it.each([false, true])("collects fresh membership with retained independent evidence (registry=%s)", async taxonomy => {
  const f = input(); if (taxonomy) f.collection.offers!.registry = registry;
  const before = structuredClone(f), request = transport();
  const r = await collectRefresh(f, discoveryEnv, request, clock());
  expect(f).toEqual(before);
  expect(r.bundle.full.evidence.offers).toHaveLength(taxonomy ? 2 : 1);
  expect(r.bundle.full.evidence.offers[0]).toMatchObject({ membershipBasis: "source_line_discount" });
  const packet = r.refresh.intake.packets.find(p => p.section === "offers")!;
  expect(packet).toMatchObject({ sourceId: f.collection.binding.sourceId, schemaVersion: f.collection.binding.schemaVersion,
    capturedAt: discoveryStart, sha256: evidenceDigest(packet.payload),
    sourceRecordRef: `collected-offers:sha256:${evidenceDigest({ orders: r.sources.orders, registry: taxonomy ? registry : null })}` });
  expect(r.refresh.intake.bindings.find(b => b.sourceId === packet.sourceId))
    .toMatchObject({ approvalRef: f.collection.approvalRef, independentControlSource: false, sections: ["orderIdentities", "offers"] });
  for (const p of before.refresh.intake.packets.filter(p => !["orderIdentities", "offers"].includes(p.section))) {
    expect(r.refresh.intake.packets.find(q => q.section === p.section)).toEqual(p);
    expect(r.refresh.intake.bindings.find(b => b.sourceId === p.sourceId))
      .toMatchObject({ approvalRef: "fixture:binding", independentControlSource: true });
  }
  expect(r.audit).toMatchObject({ independentlyReconciled: false, completePurchaseHistory: false, registered: false, enabled: false });
  expect(request).toHaveBeenCalledTimes(3); // Hydration + revision recheck + one customer read, no new offer read.
  expect(prepareRefresh(JSON.parse(JSON.stringify(r.refresh)))).toEqual(r.bundle);
  expect(JSON.stringify(r.bundle.full.evidence.offers)).not.toContain("FIXTURE-OFFER");
});
it("keeps reviewed offers exactly when collection is not opted in", async () => {
  const f = input(); delete f.collection.offers;
  const prior = discoveryInput().refresh.intake.packets.find(p => p.section === "offers")!;
  f.refresh.intake.packets = f.refresh.intake.packets.map(p => p.section === "offers" ? prior : p);
  const r = await collectRefresh(f, discoveryEnv, transport(), clock());
  expect(r.refresh.intake.packets.find(p => p.section === "offers")).toEqual(prior);
  expect(r.audit.collectedSections).not.toContain("offers");
});
const invalid: [string, (f: CollectRefreshInput) => void][] = [
  ["array option", f => { Object.assign(f.collection, { offers: [] }); }],
  ["unknown option", f => { Object.assign(f.collection.offers!, { inferEdited: true }); }],
  ["missing prior packet", f => { f.refresh.intake.packets = f.refresh.intake.packets.filter(p => p.section !== "offers"); }],
  ["duplicate prior packet", f => { f.refresh.intake.packets.push(f.refresh.intake.packets.find(p => p.section === "offers")!); }],
  ["nonempty reviewed packet", f => { const p = f.refresh.intake.packets.find(p => p.section === "offers")!;
    p.payload = [{}] as typeof p.payload; p.sha256 = evidenceDigest(p.payload); }],
  ["tampered empty hash", f => { f.refresh.intake.packets.find(p => p.section === "offers")!.sha256 = "0".repeat(64); }],
  ["stale empty packet", f => { f.refresh.intake.packets.find(p => p.section === "offers")!.capturedAt = "2026-01-01T00:00:00Z"; }],
  ["old source mismatch", f => { f.refresh.intake.packets.find(p => p.section === "offers")!.sourceId = "unbound"; }],
  ["old schema mismatch", f => { f.refresh.intake.packets.find(p => p.section === "offers")!.schemaVersion = "unapproved"; }],
  ["new source reused", f => { f.collection.binding.sourceId = "fixture:export"; }],
  ["new source missing schema", f => { f.collection.binding.schemaVersion = ""; }],
  ["missing approval", f => { f.collection.approvalRef = ""; }],
  ["registry shop mismatch", f => { f.collection.offers!.registry = { ...registry, shop: "other.myshopify.com" }; }],
  ["registry missing approval", f => { f.collection.offers!.registry = { ...registry, approvalRef: "" }; }],
  ["missing independent proof", f => { f.refresh.intake.packets = f.refresh.intake.packets.filter(p => p.section !== "proofs"); }],
  ["missing independent flag", f => { f.refresh.intake.bindings[0].independentControlSource = false; }],
  ["under-reserved requests", f => { f.collection.maxRequests = 3; }],
];
it.each(invalid)("rejects %s before any source read", async (_name, change) => {
  const f = input(), request = transport(); change(f);
  await expect(collectRefresh(f, discoveryEnv, request, clock())).rejects.toThrow();
  expect(request).not.toHaveBeenCalled();
});
it.each([true, undefined])("rejects edited or unknown original status (%s), never infers original membership", async edited => {
  await expect(collectRefresh(input(), discoveryEnv, offerTransport(source => {
    source.commerce.order.edited = edited; return source;
  }), clock())).rejects.toThrow("collection_offers_require_unedited_orders");
});
it("requires actual selected allocations and rejects unmapped reviewed taxonomy", async () => {
  await expect(collectRefresh(input(), discoveryEnv, offerTransport(source => {
    delete source.commerce.order.lineItems.nodes[0].discountAllocations; return source;
  }), clock())).rejects.toThrow("offer_allocations_not_selected");
  const f = input(); f.collection.offers!.registry = { ...registry, values: {} };
  await expect(collectRefresh(f, discoveryEnv, transport(), clock())).rejects.toThrow("offer_unmapped_value");
});
it("distinguishes authentic empty native membership from missing allocation data", async () => {
  const r = await collectRefresh(input(), discoveryEnv, offerTransport(source => {
    source.commerce.order.lineItems.nodes[0].discountAllocations = []; return source;
  }), clock());
  expect(r.bundle.full.evidence.offers).toEqual([]);
  expect(r.audit.collectedSections).toContain("offers");
});
it("retains the global byte and active deadline limits", async () => {
  const f = input(); f.collection.maxBytes = 1024;
  await expect(collectRefresh(f, discoveryEnv, transport(), clock())).rejects.toThrow("shopify_transport_failed");
  const late = vi.fn().mockReturnValueOnce(discoveryStart).mockReturnValue("2026-09-24T19:00:12Z");
  await expect(collectRefresh(input(), discoveryEnv, transport(), late)).rejects.toThrow("refresh_collection_timeout");
});
it("aborts an in-flight source read rather than returning late offers", async () => {
  const f = input(); f.collection.timeoutMs = 100;
  const request = vi.fn<typeof fetch>(async (_url, init) => new Promise<Response>((_resolve, reject) => {
    if (init?.signal?.aborted) { reject(new Error("aborted")); return; }
    init?.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
  }));
  await expect(collectRefresh(f, discoveryEnv, request, clock())).rejects.toThrow("shopify_transport_failed");
  expect(request).toHaveBeenCalledTimes(1);
});

async function consume(bundle: Awaited<ReturnType<typeof collectRefresh>>["bundle"],
  history: { source: PilotSource; evidenceRef: string }[], pages: PartitionPage[] = []) {
  const args = { projectRef: discoveryEnv.LEAN_MULLY_SOURCE_PROJECT_REF,
    databaseUrl: `https://${discoveryEnv.LEAN_MULLY_SOURCE_PROJECT_REF}.supabase.co`, runId: bundle.runId };
  const observedInput = { state: "ready", ...bundle.base, publication: "fixture:base",
    inputHash: "fixture:hash", history, spend: [] };
  const observedRpc = vi.fn(async (name: string, params?: Record<string, unknown>) => {
    const page = pages.find(p => p.child === params?.p_child && p.number === params?.p_number);
    return { data: name === "lean_report_inputs" ? observedInput : name === "lean_partition_page"
      ? { ...page, inputHash: "fixture:hash" } : true, error: null };
  });
  await expect(runObservedReportJob({ ...args, client: { rpc: observedRpc } })).resolves.toMatchObject({ state: "complete" });
  const base = observedRpc.mock.calls.find(([name]) => name === "lean_report_finish")![1]!.p_facts;
  const fullInput = { state: "ready", ...bundle.full, shop: bundle.base.shop, publication: "fixture:full",
    fromDate: bundle.base.fromDate, throughDate: bundle.base.throughDate, inputHash: "fixture:hash", facts: base };
  const run = async () => {
    const rpc = vi.fn(async (name: string, params?: Record<string, unknown>) => {
      void params; return { data: name === "lean_full_inputs" ? fullInput : true, error: null };
    });
    await expect(runFullReportJob({ ...args, posthogKey: "", client: { rpc } })).resolves.toMatchObject({ state: "complete" });
    return rpc.mock.calls.find(([name]) => name === "lean_full_finish")![1]!;
  };
  const result = await run(), replay = await run();
  expect(replay.p_facts).toEqual(result.p_facts);
  expect(replay.p_reports).toEqual(result.p_reports);
  expect(replay.p_manifest).toEqual(result.p_manifest);
  return result;
}
it("runs real observed/full consumers and equal replay without assigning revenue to offers", async () => {
  const f = input(); f.collection.offers!.registry = registry;
  const r = await collectRefresh(f, discoveryEnv, transport(), clock());
  const history = [{ source: offerSource() as PilotSource, evidenceRef: "fixture:source" }];
  const withOffers = await consume(r.bundle, history);
  const without = structuredClone(r.bundle); without.full.evidence.offers = [];
  const baseline = await consume(without, history);
  const facts = withOffers.p_facts as Record<string, unknown[]>, base = baseline.p_facts as Record<string, unknown[]>;
  expect(facts.order_item_offers).toHaveLength(2);
  expect(facts.orders).toEqual(base.orders); expect(facts.order_items).toEqual(base.order_items);
  expect(facts.sales_ledger).toEqual(base.sales_ledger);
  expect(withOffers.p_reports).toEqual(baseline.p_reports);
});
it("does not finish the full consumer when collected offer references do not match retained line facts", async () => {
  const r = await collectRefresh(input(), discoveryEnv, transport(), clock());
  // Use real consumer facts then remove the referenced line through a different
  // source order. A valid offer packet alone cannot make that graph publishable.
  const other = await consume({ ...r.bundle, full: { ...r.bundle.full,
    evidence: { ...r.bundle.full.evidence, offers: [] } } },
  [{ source: offerSource(3) as PilotSource, evidenceRef: "fixture:other-source" }]);
  const fullInput = { state: "ready", ...r.bundle.full, shop: r.bundle.base.shop, publication: "fixture:full",
    fromDate: r.bundle.base.fromDate, throughDate: r.bundle.base.throughDate,
    inputHash: "fixture:hash", facts: other.p_facts };
  const rpc = vi.fn(async (name: string) => ({ data: name === "lean_full_inputs" ? fullInput : true, error: null }));
  await expect(runFullReportJob({ projectRef: discoveryEnv.LEAN_MULLY_SOURCE_PROJECT_REF,
    databaseUrl: `https://${discoveryEnv.LEAN_MULLY_SOURCE_PROJECT_REF}.supabase.co`,
    runId: r.bundle.runId, posthogKey: "", client: { rpc } })).rejects.toThrow("full_transform_unavailable");
  expect(rpc.mock.calls.map(([name]) => name)).toEqual(["lean_full_inputs", "lean_full_claim", "lean_full_fail"]);
});
it("composes 101 unedited orders across partition children and consumes ONE global offers set", async () => {
  const f = partition(), request = transport();
  const r = await collectPartitionRefresh(f, partitionEnv, request);
  expect(r.bundle.full.evidence.offers).toHaveLength(101);
  expect(new Set(r.bundle.full.evidence.offers.map(o => o.orderItemId)).size).toBe(101);
  expect(new Set(r.bundle.full.evidence.offers.map(o => o.offerId)).size).toBe(1);
  expect(preparePartitionRefresh(JSON.parse(JSON.stringify(r.refresh)))).toEqual(r.bundle);
  for (const p of f.refresh.intake.packets.filter(p => !["orderIdentities", "offers"].includes(p.section)))
    expect(r.refresh.refresh.intake.packets.find(q => q.section === p.section)).toEqual(p);
  const result = await consume(r.bundle, [], r.sources.pages);
  const facts = result.p_facts as Record<string, unknown[]>;
  expect(facts.orders).toHaveLength(101); expect(facts.order_item_offers).toHaveLength(101);
  expect(facts.customers).toHaveLength(1);
  expect(r.audit).toMatchObject({ enabled: false, registered: false });
}, 30000);
it("fails the whole partition when even a later child has edited lines", async () => {
  await expect(collectPartitionRefresh(partition(), partitionEnv, offerTransport(source => {
    if (source.commerce.order.id.endsWith("/101")) source.commerce.order.edited = true;
    return source;
  }))).rejects.toThrow("collection_offers_require_unedited_orders");
}, 30000);
it.each(["success", "old-source", "new-source"])("actual CLI + offline replay (%s)", mode => {
  const root = mkdtempSync(join(tmpdir(), "offer-collection-")), path = join(root, "input.json"), out = join(root, "out");
  try {
    const f = input(), now = new Date().toISOString();
    f.refresh.readyAt = f.refresh.policy.asOf = f.refresh.intake.asOf = now;
    f.refresh.expiresAt = new Date(Date.parse(now) + 1800000).toISOString();
    f.refresh.intake.packets.forEach(p => { p.capturedAt = now; });
    if (mode === "old-source") f.refresh.intake.packets.find(p => p.section === "offers")!.sourceId = "unbound";
    if (mode === "new-source") f.collection.binding.sourceId = "fixture:export";
    writeFileSync(path, JSON.stringify(f));
    const result = spawnSync(process.execPath, ["--import", resolve("tests/fixtures/offer-cli-preload.mjs"),
      resolve("scripts/analytics/prepare-refresh.mjs"), "--collect-sources", path, out],
    { env: { ...process.env, ...discoveryEnv, NODE_ENV: "test" }, encoding: "utf8", timeout: 30000 });
    if (mode !== "success") { expect(result.status).not.toBe(0); expect(existsSync(out)).toBe(false); return; }
    expect(result.status, result.stderr).toBe(0);
    const bundle = JSON.parse(readFileSync(join(out, "refresh-bundle.json"), "utf8"));
    expect(bundle.full.evidence.offers).toHaveLength(1);
    const offline = spawnSync(process.execPath, [resolve("scripts/analytics/prepare-refresh.mjs"),
      join(out, "refresh-input.json"), join(root, "offline")],
    { env: { PATH: process.env.PATH, NODE_ENV: "test" }, encoding: "utf8", timeout: 30000 });
    expect(offline.status, offline.stderr).toBe(0);
    expect(JSON.parse(readFileSync(join(root, "offline", "refresh-bundle.json"), "utf8"))).toEqual(bundle);
  } finally { rmSync(root, { recursive: true, force: true }); }
}, 60000);
