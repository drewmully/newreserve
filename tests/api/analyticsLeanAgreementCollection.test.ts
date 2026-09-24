/** Synthetic collection through real adapters/preparation/consumers; no network. */
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync, readdirSync, existsSync, rmSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { collectRefresh, type CollectRefreshInput } from "@/lib/analytics/collectRefresh";
import { prepareRefresh } from "@/lib/analytics/refreshPlan";
import { evidenceDigest } from "@/lib/analytics/evidenceIntake";
import { normalizeCommerce } from "@/lib/analytics/commerce";
import { normalizeLedger } from "@/lib/analytics/financial";
import { runObservedReportJob } from "@/lib/analytics/observedReportJob";
import { runFullReportJob } from "@/lib/analytics/fullReportJob";
import type { AgreementPolicy } from "@/lib/analytics/shopifyAgreements";
import { discoveryInput, discoveryEnv, discoveryStart } from "../fixtures/analyticsDiscovery";
import { agreementCollectionSource, agreementCollectionTransport } from "../fixtures/agreement-collection-source.mjs";
const env = { ...discoveryEnv, LEAN_SHOPIFY_AGREEMENTS_READ_APPROVED: "true" };
const finish = "2026-09-24T19:00:02.000Z";
function input(discover = false): CollectRefreshInput {
  const f = discoveryInput();
  if (!discover) { delete f.collection.discover; f.collection.orderIds = ["gid://shopify/Order/1"]; }
  f.collection.binding = { sourceId: "fixture:fresh-agreements", schemaVersion: "fixture-agreements-v1", maxAgeSeconds: 3600 };
  f.collection.originalPurchases = { maxRequestsPerOrder: 3,
    orders: [{ orderGid: "gid://shopify/Order/1",
      policy: agreementCollectionSource().policy as Omit<AgreementPolicy, "sourceEvidenceRef"> }] };
  // These empty packets are explicitly supplied synthetic source evidence, not
  // invented by the collector. Every retained packet must still validate.
  for (const p of f.refresh.intake.packets) if (["replacements", "offers", "settlements"].includes(p.section)) {
    p.payload = []; p.sha256 = evidenceDigest(p.payload);
  }
  f.refresh.policy.behaviorMode = "excluded";
  return f;
}
const clock = () => vi.fn().mockReturnValueOnce(discoveryStart).mockReturnValue(finish);
const transport = (mode = "normal", source = agreementCollectionSource()) =>
  vi.fn<typeof fetch>(agreementCollectionTransport(source, mode));
let network: ReturnType<typeof vi.fn>;
beforeEach(() => {
  network = vi.fn(() => { throw new Error("external_network_forbidden"); });
  vi.stubGlobal("fetch", network);
});
afterEach(() => { expect(network).not.toHaveBeenCalled(); vi.unstubAllGlobals(); });

it.each([false, true])("collects original purchase + refunds with retained controls (discovery=%s)", async discover => {
  const f = input(discover), before = structuredClone(f), request = transport();
  const r = await collectRefresh(f, env, request, clock());
  expect(f).toEqual(before);
  expect(r.bundle.full.evidence.replacements).toHaveLength(1);
  const replacement = r.bundle.full.evidence.replacements[0];
  expect(normalizeCommerce(replacement.snapshot, replacement.decision, "fixture").order_items[0])
    .toMatchObject({ quantity: "2.000000", purchase_gross_usd: "20.000000", purchase_net_usd: "18.000000" });
  expect(replacement.movements.flatMap(m => normalizeLedger(m, "fixture")).map(r => r.source_amount))
    .toEqual(["20.000000", "-2.000000", "2.000000", "-9.000000", "-1.000000"]);
  expect(r.sources.originalPurchases[0].document.capturedAt).toBe(finish);
  expect(r.bundle.base.policy.deferredOrders).toEqual([{ orderGid: "gid://shopify/Order/1",
    sourceUpdatedAt: "2026-01-03T12:00:00Z", evidenceRef: r.sources.originalPurchases[0].policy.sourceEvidenceRef }]);
  expect(r.sources.originalPurchases[0].policy.sourceEvidenceRef)
    .toBe(`collected-agreements:sha256:${evidenceDigest({ order: r.sources.orders[0],
      document: r.sources.originalPurchases[0].document })}`);
  const packet = r.refresh.intake.packets.find(p => p.section === "replacements")!;
  expect(packet).toMatchObject({ sourceId: f.collection.binding.sourceId, schemaVersion: f.collection.binding.schemaVersion,
    capturedAt: finish, sourceRecordRef: `shopify-agreements:sha256:${evidenceDigest(r.sources.originalPurchases.map(p => p.document))}` });
  expect(r.refresh.intake.bindings.find(b => b.sourceId === packet.sourceId))
    .toMatchObject({ approvalRef: f.collection.approvalRef, independentControlSource: false,
      sections: ["orderIdentities", "replacements"] });
  for (const p of before.refresh.intake.packets.filter(p => !["orderIdentities", "replacements"].includes(p.section))) {
    expect(r.refresh.intake.packets.find(q => q.section === p.section)).toEqual(p);
    const binding = r.refresh.intake.bindings.find(b => b.sourceId === p.sourceId)!;
    expect(binding.independentControlSource).toBe(true);
    expect(binding.approvalRef).toBe("fixture:binding");
  }
  expect(r.bundle.full.evidence.orderIdentities).toEqual([]);
  expect(r.audit).toMatchObject({ independentlyReconciled: false, completePurchaseHistory: false,
    registered: false, enabled: false });
  expect(request).toHaveBeenCalledTimes(discover ? 7 : 5);
  expect(prepareRefresh(JSON.parse(JSON.stringify(r.refresh)))).toEqual(r.bundle);
});

const invalid: [string, (f: CollectRefreshInput) => void][] = [
  ["legacy array config", f => { Object.assign(f.collection, { originalPurchases: [] }); }],
  ["duplicate targets", f => { f.collection.originalPurchases!.orders.push(f.collection.originalPurchases!.orders[0]); }],
  ["out of scope ID", f => { f.collection.originalPurchases!.orders[0].orderGid = "gid://shopify/Order/9"; }],
  ["under-reserved global requests", f => { f.collection.maxRequests = 6; }],
  ["missing final recheck budget", f => { f.collection.originalPurchases!.maxRequestsPerOrder = 1; }],
  ["missing finance approval", f => { f.collection.originalPurchases!.orders[0].policy.financialApprovalRef = ""; }],
  ["missing old line classifications", f => { f.collection.originalPurchases!.orders[0].policy.lineClasses = {}; }],
  ["caller evidence ref injection", f => { Object.assign(f.collection.originalPurchases!.orders[0].policy, { sourceEvidenceRef: "invented" }); }],
  ["missing replacements packet", f => { f.refresh.intake.packets = f.refresh.intake.packets.filter(p => p.section !== "replacements"); }],
  ["nonempty reviewed packet", f => { const p = f.refresh.intake.packets.find(p => p.section === "replacements")!;
    p.payload = [{}] as typeof p.payload; p.sha256 = evidenceDigest(p.payload); }],
  ["prior deferred order", f => { f.refresh.commercePolicy.deferredOrders = [{ orderGid: "gid://shopify/Order/1",
    sourceUpdatedAt: "2026-01-03T12:00:00Z", evidenceRef: "reviewed" }]; }],
  ["tampered empty packet digest", f => { f.refresh.intake.packets.find(p => p.section === "replacements")!.sha256 = "0".repeat(64); }],
  ["stale empty packet", f => { f.refresh.intake.packets.find(p => p.section === "replacements")!.capturedAt = "2026-01-04T00:00:00Z"; }],
  ["old-source schema mismatch", f => { f.refresh.intake.packets.find(p => p.section === "replacements")!.schemaVersion = "unapproved"; }],
  ["old-source ID mismatch", f => { f.refresh.intake.packets.find(p => p.section === "replacements")!.sourceId = "unbound"; }],
  ["new source reuses old identity", f => { f.collection.binding.sourceId = "fixture:export"; }],
  ["new source missing schema", f => { f.collection.binding.schemaVersion = ""; }],
  ["new source missing approval", f => { f.collection.approvalRef = ""; }],
  ["missing independent controls", f => { f.refresh.intake.packets = f.refresh.intake.packets.filter(p => p.section !== "proofs"); }],
];
it.each(invalid)("rejects %s before source reads", async (_name, change) => {
  const f = input(), request = transport(); change(f);
  await expect(collectRefresh(f, env, request, clock())).rejects.toThrow();
  expect(request).not.toHaveBeenCalled();
});
it("requires the additional agreements approval and dedicated Shopify credential before reads", async () => {
  for (const key of ["LEAN_SHOPIFY_AGREEMENTS_READ_APPROVED", "LEAN_SHOPIFY_ANALYTICS_READ_TOKEN"]) {
    const denied = { ...env, [key]: "" }, request = transport();
    await expect(collectRefresh(input(), denied, request, clock())).rejects.toThrow();
    expect(request).not.toHaveBeenCalled();
  }
});
it("does not auto-enable agreements because an order was edited", async () => {
  const f = input(); delete f.collection.originalPurchases;
  const request = transport(), r = await collectRefresh(f, env, request, clock());
  expect(request).toHaveBeenCalledTimes(2);
  expect(r.bundle.full.evidence.replacements).toEqual([]);
  expect(r.bundle.base.policy.deferredOrders).toBeUndefined();
});
it("rejects an approved ID missing from bounded discovery before hydration", async () => {
  const f = input(true); f.collection.originalPurchases!.orders[0].orderGid = "gid://shopify/Order/9";
  const request = transport();
  await expect(collectRefresh(f, env, request, clock())).rejects.toThrow("collection_original_purchase_target");
  expect(request).toHaveBeenCalledTimes(2);
});
it("counts nested sale pages and the final revision recheck against the per-order budget", async () => {
  const f = input(), request = transport("nested");
  await expect(collectRefresh(f, env, request, clock())).rejects.toThrow("agreement_read_budget");
  expect(request).toHaveBeenCalledTimes(5); // Two hydration reads; three agreement pages; no final recheck.
  f.collection.originalPurchases!.maxRequestsPerOrder = 4;
  const r = await collectRefresh(f, env, transport("nested"), clock());
  expect(r.audit.calls).toBe(6);
  expect(r.bundle.full.evidence.replacements).toHaveLength(1);
});
it("fails closed when the source revision changes at the final agreement read", async () => {
  await expect(collectRefresh(input(), env, transport("revised"), clock())).rejects.toThrow("agreement_order_revision_changed");
});
it("cannot map a missing historical line authority using current product classes", async () => {
  const f = input(); f.collection.originalPurchases!.orders[0].policy.lineClasses = { "99": "merchandise" };
  await expect(collectRefresh(f, env, transport(), clock())).rejects.toThrow("agreement_line_class_required");
});
it("enforces the global byte budget while reading agreement responses", async () => {
  const f = input(), source = agreementCollectionSource();
  f.collection.maxBytes = 4000;
  Object.assign(source.agreements[0], { irrelevant: "x".repeat(5000) });
  const request = transport("normal", source);
  await expect(collectRefresh(f, env, request, clock())).rejects.toThrow("agreement_transport_failed");
  expect(request).toHaveBeenCalledTimes(3);
});
it("rejects late success and capture-clock reversal rather than publishing a bundle", async () => {
  for (const times of [
    [discoveryStart, "2026-09-24T19:00:12Z", "2026-09-24T19:00:12Z"],
    [discoveryStart, "2026-09-24T19:00:03Z", finish],
    [discoveryStart, finish, finish, "2026-09-24T19:00:12Z"],
  ]) {
    const now = vi.fn(); times.forEach(t => now.mockReturnValueOnce(t));
    await expect(collectRefresh(input(), env, transport(), now)).rejects.toThrow("refresh_collection_timeout");
  }
});
it("propagates the active global deadline into agreement reads with no retry/fallback", async () => {
  const f = input(); f.collection.timeoutMs = 50;
  const source = transport(), request = vi.fn<typeof fetch>(async (url, init) => {
    if (String(init?.body).includes("AnalyticsAgreements")) return new Promise<Response>((_resolve, reject) => {
      if (init?.signal?.aborted) { reject(new Error("aborted")); return; }
      init?.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
    });
    return source(url, init);
  });
  await expect(collectRefresh(f, env, request, clock())).rejects.toThrow("agreement_transport_failed");
  expect(request).toHaveBeenCalledTimes(3);
});

it("feeds the real observed/full consumers; equal replay preserves original facts, not current mutable lines", async () => {
  const r = await collectRefresh(input(), env, transport(), clock());
  const args = { projectRef: env.LEAN_MULLY_SOURCE_PROJECT_REF,
    databaseUrl: `https://${env.LEAN_MULLY_SOURCE_PROJECT_REF}.supabase.co`, runId: r.bundle.runId };
  const history = [{ source: { commerce: r.sources.orders[0] }, evidenceRef: "fixture:retained-order" }];
  const observedInput = { state: "ready", ...r.bundle.base, publication: "fixture:base",
    inputHash: "fixture:hash", history, spend: [] };
  const observedRpc = vi.fn(async (name: string, params?: Record<string, unknown>) => {
    void params; return { data: name === "lean_report_inputs" ? observedInput : true, error: null };
  });
  await expect(runObservedReportJob({ ...args, client: { rpc: observedRpc } })).resolves.toMatchObject({ state: "complete" });
  const base = observedRpc.mock.calls.find(([name]) => name === "lean_report_finish")![1]!.p_facts;
  expect(base).toMatchObject({ orders: [], order_items: [] }); // Explicitly deferred until full replacement.
  for (const mismatch of ["missing", "revision"]) {
    const bad = structuredClone(observedInput);
    if (mismatch === "missing") bad.history = [];
    else bad.history[0].source.commerce.order.updatedAt = "2026-01-04T12:00:00Z";
    const rpc = vi.fn(async () => ({ data: bad, error: null }));
    await expect(runObservedReportJob({ ...args, client: { rpc } })).rejects.toThrow();
    expect(rpc).toHaveBeenCalledTimes(1);
  }
  const fullInput = { state: "ready", ...r.bundle.full, shop: r.bundle.base.shop, publication: "fixture:full",
    fromDate: r.bundle.base.fromDate, throughDate: r.bundle.base.throughDate, inputHash: "fixture:hash",
    deferredOrders: r.bundle.base.policy.deferredOrders, facts: base };
  const run = async () => {
    const rpc = vi.fn(async (name: string, params?: Record<string, unknown>) => {
      void params; return { data: name === "lean_full_inputs" ? fullInput : true, error: null };
    });
    await expect(runFullReportJob({ ...args, client: { rpc }, posthogKey: "" })).resolves.toMatchObject({ state: "complete" });
    return rpc.mock.calls.find(([name]) => name === "lean_full_finish")![1]!.p_facts;
  };
  const first = await run();
  expect(first).toMatchObject({ order_items: [expect.objectContaining({ purchase_gross_usd: "20.000000" })] });
  expect(await run()).toEqual(first);
  for (const change of ["missing", "revision", "ref"]) {
    const broken = structuredClone(fullInput);
    if (change === "missing") broken.evidence.replacements = [];
    else if (change === "revision") broken.evidence.replacements[0].snapshot.updatedAt = "2026-01-04T12:00:00Z";
    else broken.evidence.replacements[0].evidenceRef = "other-source";
    const rpc = vi.fn(async () => ({ data: broken, error: null }));
    await expect(runFullReportJob({ ...args, client: { rpc }, posthogKey: "" })).rejects.toThrow();
    expect(rpc).toHaveBeenCalledTimes(1); // Rejects before claiming/finishing publication.
  }
});

it.each(["success", "old-schema", "new-binding", "revised", "nested"])(
  "runs the actual CLI with agreement sources (%s), atomically publishing only valid replayable outputs", mode => {
    const dir = mkdtempSync(join(tmpdir(), "agreement-collection-cli-"));
    try {
      const f = input(true), now = new Date().toISOString();
      f.refresh.policy.asOf = f.refresh.intake.asOf = f.refresh.readyAt = now;
      f.refresh.expiresAt = new Date(Date.parse(now) + 1800000).toISOString();
      f.refresh.intake.packets.forEach(p => { p.capturedAt = now; });
      if (mode === "old-schema") f.refresh.intake.packets.find(p => p.section === "replacements")!.schemaVersion = "unbound";
      if (mode === "new-binding") f.collection.binding.sourceId = "fixture:export";
      const path = join(dir, "input.json"), output = join(dir, "collected");
      writeFileSync(path, JSON.stringify(f));
      const child = spawnSync(process.execPath, ["--import", resolve("tests/fixtures/agreement-collection-cli-preload.mjs"),
        resolve("scripts/analytics/prepare-refresh.mjs"), "--collect-sources", path, output],
      { env: { PATH: process.env.PATH, ...env, SYNTHETIC_AGREEMENT_MODE: mode }, encoding: "utf8", timeout: 30000 });
      expect(child.error).toBeUndefined();
      if (mode !== "success") {
        expect(child.status).toBe(1); expect(existsSync(output)).toBe(false);
        expect(readdirSync(dir)).toEqual(["input.json"]);
      } else {
        expect(child.status, child.stderr).toBe(0);
        expect(JSON.parse(child.stdout)).toMatchObject({ state: "prepared_only", registered: false, enabled: false });
        expect(readdirSync(output)).toHaveLength(5);
        expect(statSync(output).mode & 0o777).toBe(0o700);
        for (const file of readdirSync(output)) expect(statSync(join(output, file)).mode & 0o777).toBe(0o600);
        const refreshed = JSON.parse(readFileSync(join(output, "refresh-input.json"), "utf8"));
        const bundle = JSON.parse(readFileSync(join(output, "refresh-bundle.json"), "utf8"));
        expect(prepareRefresh(refreshed)).toEqual(bundle);
        const offline = spawnSync(process.execPath, [resolve("scripts/analytics/prepare-refresh.mjs"),
          join(output, "refresh-input.json"), join(dir, "offline")],
        { env: { PATH: process.env.PATH, NODE_ENV: "test" }, encoding: "utf8", timeout: 30000 });
        expect(offline.status, offline.stderr).toBe(0);
        expect(JSON.parse(readFileSync(join(dir, "offline", "refresh-bundle.json"), "utf8"))).toEqual(bundle);
        expect(bundle.full.evidence.replacements).toHaveLength(1);
      }
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }, 60000);
