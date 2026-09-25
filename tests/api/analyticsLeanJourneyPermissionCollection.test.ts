import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { collectRefresh, type CollectRefreshInput } from "@/lib/analytics/collectRefresh";
import { collectPartitionRefresh, preparePartitionRefresh } from "@/lib/analytics/partitionRefresh";
import { prepareRefresh, type RefreshInput } from "@/lib/analytics/refreshPlan";
import { evidenceDigest } from "@/lib/analytics/evidenceIntake";
import { runObservedReportJob } from "@/lib/analytics/observedReportJob";
import { runFullReportJob } from "@/lib/analytics/fullReportJob";
import type { PartitionPage } from "@/lib/analytics/partitionInventory";
import type { PilotSource } from "@/lib/analytics/shopifyPilotSource";
import { planJourneyPermissionCollection, composeCollectedJourneyPermissions } from "@/lib/analytics/journeyPermissionCollection";
import { discoveryInput, discoveryEnv, discoveryStart } from "../fixtures/analyticsDiscovery";
import { partitionInput, partitionEnv } from "../fixtures/analyticsPartition";
import { offerSource } from "../fixtures/offer-collection-source.mjs";
import { permissionTransport, collectedGrants } from "../fixtures/journey-permission-collection-source.mjs";
const env = { ...discoveryEnv, LEAN_POSTHOG_PROJECT_ID: "353503" };
const parentEnv = { ...partitionEnv, ...env };
const finish = "2026-09-24T19:00:03.000Z";
const now = () => vi.fn().mockReturnValueOnce(discoveryStart).mockReturnValue(finish);
function reviewedOption(refresh: RefreshInput) {
  const packet = refresh.intake.packets.find(p => p.section === "identity")!;
  const binding = refresh.intake.bindings.find(b => b.sourceId === packet.sourceId)!;
  return { retainedIdentityDigest: evidenceDigest({ packet, binding }), binding: {
    sourceId: "fixture:composite-identity", schemaVersion: "fixture-composite-v1",
    approvalRef: "fixture:reviewed-composition", maxAgeSeconds: 3600,
  } };
}
function configure(refresh: RefreshInput) {
  refresh.policy.behaviorMode = "required";
  refresh.policy.stages = { reserve: "lean_reserve_started" };
  refresh.behavior.families = { lean_reserve_started: { producer: "web", schemaVersion: "lean-v1",
    identityNamespace: "lean_subject", actionProperty: "event_id", sessionProperty: "session_id",
    identityProperty: "mully_anon_id", consentProperty: "analytics_permitted" } };
  for (const p of refresh.intake.packets) {
    if (["offers", "settlements", "replacements", "checkout"].includes(p.section)) p.payload = [];
    if (p.section === "identity") {
      Object.assign((p.payload as object[])[0], { namespace: "shopify_customer", identifier: "7" });
      p.capturedAt = new Date(Date.parse(p.capturedAt) - 60000).toISOString();
    }
    p.sha256 = evidenceDigest(p.payload);
  }
}
function input(): CollectRefreshInput {
  const f = discoveryInput(); delete f.collection.discover;
  f.collection.orderIds = ["gid://shopify/Order/2"]; configure(f.refresh);
  f.collection.journeyPermissions = reviewedOption(f.refresh);
  return f;
}
function partition() {
  const f = partitionInput(); delete f.collection.partitions[0].originalPurchases;
  configure(f.refresh); f.collection.journeyPermissions = reviewedOption(f.refresh); return f;
}
const request = (revoked = false) => vi.fn<typeof fetch>(permissionTransport(collectedGrants(revoked)));
const permissionsOnly = (url: unknown) => String(url).endsWith("/lean_journey_permissions_read");
let network: ReturnType<typeof vi.fn>;
beforeEach(() => { network = vi.fn(() => { throw new Error("external_network_forbidden"); }); vi.stubGlobal("fetch", network); });
afterEach(() => { expect(network).not.toHaveBeenCalled(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it.each([false, true])("composes recorded anonymous grants with exact historical lineage (revoked=%s)", async revoked => {
  const f = input(), before = structuredClone(f), transport = request(revoked);
  const r = await collectRefresh(f, env, transport, now());
  expect(f).toEqual(before);
  const prior = before.refresh.intake.packets.find(p => p.section === "identity")!;
  const priorBinding = before.refresh.intake.bindings.find(b => b.sourceId === prior.sourceId)!;
  const packet = r.refresh.intake.packets.find(p => p.section === "identity")!;
  expect(packet).toMatchObject({ sourceId: f.collection.journeyPermissions!.binding.sourceId,
    capturedAt: prior.capturedAt, sha256: evidenceDigest(packet.payload),
    sourceRecordRef: `journey-composite:sha256:${evidenceDigest({
      retained: { packet: prior, binding: priorBinding }, snapshot: r.sources.journeyPermissions,
    })}` });
  expect(r.bundle.full.evidence.identity.slice(0, 1)).toEqual(prior.payload);
  expect(r.bundle.full.evidence.identity[1]).toMatchObject({ namespace: "lean_subject", customerId: null,
    consent: revoked ? "denied" : "permitted", removal: revoked ? "removed" : "active" });
  expect(r.sources.journeyPermissions?.capturedAt).toBe(finish);
  expect(r.refresh.intake.bindings.find(b => b.sourceId === packet.sourceId)).toMatchObject({
    ...f.collection.journeyPermissions!.binding, independentControlSource: false, sections: ["identity"],
  });
  for (const p of before.refresh.intake.packets.filter(p => !["orderIdentities", "identity"].includes(p.section)))
    expect(r.refresh.intake.packets.find(q => q.section === p.section)).toEqual(p);
  expect(r.refresh.expiresAt).toBe(before.refresh.expiresAt);
  expect(r.audit).toMatchObject({ registered: false, enabled: false, independentlyReconciled: false, completePurchaseHistory: false });
  expect(transport).toHaveBeenCalledTimes(4);
  expect(transport.mock.calls.filter(([url]) => permissionsOnly(url))).toHaveLength(1);
  expect(prepareRefresh(JSON.parse(JSON.stringify(r.refresh)))).toEqual(r.bundle);
});
it("leaves reviewed identity untouched with no grant read when opt-in is absent", async () => {
  const f = input(); delete f.collection.journeyPermissions;
  const transport = request(), r = await collectRefresh(f, env, transport, now());
  expect(r.refresh.intake.packets.find(p => p.section === "identity")).toEqual(f.refresh.intake.packets.find(p => p.section === "identity"));
  expect(transport.mock.calls.some(([url]) => permissionsOnly(url))).toBe(false);
});
const invalid: [string, (f: CollectRefreshInput) => void][] = [
  ["missing retained approval digest", f => { f.collection.journeyPermissions!.retainedIdentityDigest = ""; }],
  ["old capture changed", f => { f.refresh.intake.packets.find(p => p.section === "identity")!.capturedAt = discoveryStart; }],
  ["old binding approval changed", f => { f.refresh.intake.bindings[0].approvalRef = "other-approval"; }],
  ["old source/schema mismatch", f => { f.refresh.intake.packets.find(p => p.section === "identity")!.schemaVersion = "unknown"; }],
  ["tampered old payload", f => { (f.refresh.intake.packets.find(p => p.section === "identity")!.payload as object[]).push({}); }],
  ["old evidence stale", f => { f.refresh.intake.packets.find(p => p.section === "identity")!.capturedAt = "2026-01-01T00:00:00Z"; }],
  ["new source reuses old source", f => { f.collection.journeyPermissions!.binding.sourceId = "fixture:export"; }],
  ["new source reuses collected source", f => { f.collection.journeyPermissions!.binding.sourceId = f.collection.binding.sourceId; }],
  ["new source schema missing", f => { f.collection.journeyPermissions!.binding.schemaVersion = ""; }],
  ["new approval missing", f => { f.collection.journeyPermissions!.binding.approvalRef = ""; }],
  ["new age cannot cover old capture through expiry", f => { f.collection.journeyPermissions!.binding.maxAgeSeconds = 1800; }],
  ["new approval cannot extend original authority expiry", f => {
    f.collection.journeyPermissions!.binding.maxAgeSeconds = 604800; f.refresh.expiresAt = "2026-09-24T19:59:50Z";
  }],
  ["existing anonymous namespace", f => { const p = f.refresh.intake.packets.find(p => p.section === "identity")!;
    Object.assign((p.payload as object[])[0], { namespace: "lean_subject" }); p.sha256 = evidenceDigest(p.payload);
    f.collection.journeyPermissions = reviewedOption(f.refresh); }],
  ["behavior project mismatch", f => { f.refresh.behavior.project = "99"; }],
  ["future window", f => { f.refresh.behavior.until = "2027-01-01T00:00:00Z"; }],
  ["wide window", f => { f.refresh.behavior.from = "2025-01-01T00:00:00Z"; }],
  ["unknown option", f => { Object.assign(f.collection.journeyPermissions!, { inferCustomer: true }); }],
  ["unreserved extra RPC", f => { f.collection.maxRequests = 4; }],
  ["missing independent controls", f => { f.refresh.intake.packets = f.refresh.intake.packets.filter(p => p.section !== "proofs"); }],
];
it.each(invalid)("rejects %s before source reads", async (_label, change) => {
  const f = input(), transport = request(); change(f);
  await expect(collectRefresh(f, env, transport, now())).rejects.toThrow();
  expect(transport).not.toHaveBeenCalled();
});
it("requires the expected PostHog project and dedicated source credential", async () => {
  for (const key of ["LEAN_POSTHOG_PROJECT_ID", "LEAN_MULLY_SOURCE_READ_KEY"]) {
    const transport = request();
    await expect(collectRefresh(input(), { ...env, [key]: "" }, transport, now())).rejects.toThrow();
    expect(transport).not.toHaveBeenCalled();
  }
});
it.each(["duplicate", "future-revocation", "overlong", "overflow"])("rejects invalid grants (%s), no invented fallback", async mode => {
  const grants = collectedGrants();
  if (mode === "duplicate") grants.push(grants[0]);
  if (mode === "future-revocation") grants[0].revokedAt = "2027-01-01T00:00:00Z";
  if (mode === "overlong") grants[0].expiresAt = "2026-01-03T00:00:00Z";
  const rows = mode === "overflow" ? Array.from({ length: 10001 }, () => grants[0]) : grants;
  await expect(collectRefresh(input(), env, permissionTransport(rows), now())).rejects.toThrow();
});
it("validates snapshot scope/hash and retained inputs again at the actual composition boundary", async () => {
  const f = input(), r = await collectRefresh(f, env, request(), now());
  const plan = planJourneyPermissionCollection(f.refresh, f.collection.journeyPermissions!, f.collection.binding.sourceId, env, discoveryStart);
  const fresh = structuredClone(f.refresh); fresh.intake.asOf = fresh.policy.asOf = finish;
  expect(composeCollectedJourneyPermissions(structuredClone(fresh), plan, r.sources.journeyPermissions!).payload)
    .toEqual(r.bundle.full.evidence.identity);
  for (const field of ["shop", "posthogProject", "from", "until", "digest"] as const) {
    const snapshot = structuredClone(r.sources.journeyPermissions!);
    snapshot[field] = ["from", "until"].includes(field) ? "2026-01-01T00:00:00Z" : "wrong";
    if (field !== "digest") {
      const { digest: ignored, ...body } = snapshot; void ignored;
      snapshot.digest = evidenceDigest(body); // A valid hash cannot authorize a different scope.
    }
    await expect(Promise.resolve().then(() => composeCollectedJourneyPermissions(fresh, plan, snapshot))).rejects.toThrow();
  }
  const changed = structuredClone(f.refresh);
  changed.intake.packets.find(p => p.section === "identity")!.sourceRecordRef = "changed";
  expect(() => composeCollectedJourneyPermissions(changed, plan, r.sources.journeyPermissions!))
    .toThrow("journey_collection_retained_changed");
});
it("handles an authentic empty grant response without dropping any reviewed identity", async () => {
  const f = input(), r = await collectRefresh(f, env, permissionTransport([]), now());
  expect(r.bundle.full.evidence.identity).toEqual(f.refresh.intake.packets.find(p => p.section === "identity")!.payload);
  expect(r.sources.journeyPermissions?.grants).toEqual([]);
});
it("counts grant UTF-8 bytes in the ordinary aggregate budget", async () => {
  const f = input(); f.collection.maxBytes = 5000;
  const grants = collectedGrants(); grants[0].permissionEvidenceRef = "é".repeat(3000);
  await expect(collectRefresh(f, env, permissionTransport(grants), now())).rejects.toThrow("refresh_collection_byte_budget");
});
it.each(["ordinary", "partition"])("aborts the grant RPC using the original active %s deadline", async mode => {
  const f = mode === "ordinary" ? input() : partition();
  const timers: AbortController[] = [], realTimeout = AbortSignal.timeout.bind(AbortSignal);
  vi.spyOn(AbortSignal, "timeout").mockImplementation(ms => {
    if (ms !== f.collection.timeoutMs) return realTimeout(ms);
    const controller = new AbortController(); timers.push(controller); return controller.signal;
  });
  const source = request(), blocked = vi.fn<typeof fetch>(async (url, init) => {
    if (!permissionsOnly(url)) return source(url, init);
    return new Promise<Response>((_resolve, reject) => {
      if (init?.signal?.aborted) { reject(new Error("aborted")); return; }
      init?.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
      // The parent is timer[0]; aborting only it must reach this final RPC,
      // regardless of the number of child-specific timers created afterward.
      queueMicrotask(() => timers[0].abort());
    });
  });
  const run = f.kind === "mully-collect-v1" ? collectRefresh(f, env, blocked, now())
    : collectPartitionRefresh(f, parentEnv, blocked);
  await expect(run).rejects.toThrow("aborted");
  expect(blocked.mock.calls.filter(([url]) => permissionsOnly(url))).toHaveLength(1);
}, 30000);
it("rejects late completion or a snapshot capture outside the read interval", async () => {
  for (const ticks of [
    [discoveryStart, finish, "2026-09-24T19:00:12Z"],
    [discoveryStart, "2026-09-24T19:00:00Z", finish],
    [discoveryStart, finish, "2026-09-24T19:00:02Z"],
  ]) {
    const clock = vi.fn(); ticks.forEach(t => clock.mockReturnValueOnce(t));
    await expect(collectRefresh(input(), env, request(), clock)).rejects.toThrow("refresh_collection_timeout");
  }
});

async function consume(bundle: Awaited<ReturnType<typeof collectRefresh>>["bundle"], pages: PartitionPage[] = []) {
  const args = { projectRef: env.LEAN_MULLY_SOURCE_PROJECT_REF,
    databaseUrl: `https://${env.LEAN_MULLY_SOURCE_PROJECT_REF}.supabase.co`, runId: bundle.runId };
  const observed = { state: "ready", ...bundle.base, publication: "fixture:base", inputHash: "fixture:hash", spend: [],
    history: pages.length ? [] : [{ source: offerSource() as PilotSource, evidenceRef: "fixture:source" }] };
  const baseRpc = vi.fn(async (name: string, p?: Record<string, unknown>) => ({ data: name === "lean_report_inputs" ? observed :
    name === "lean_partition_page" ? { ...pages.find(page => page.child === p?.p_child && page.number === p?.p_number), inputHash: "fixture:hash" } : true, error: null }));
  await expect(runObservedReportJob({ ...args, client: { rpc: baseRpc } })).resolves.toMatchObject({ state: "complete" });
  const full = { state: "ready", ...bundle.full, shop: bundle.base.shop, publication: "fixture:full", inputHash: "fixture:hash",
    fromDate: bundle.base.fromDate, throughDate: bundle.base.throughDate,
    facts: baseRpc.mock.calls.find(([name]) => name === "lean_report_finish")![1]!.p_facts };
  const behaviorRequest = vi.fn<typeof fetch>(async (url, init) => {
    expect(String(url)).toBe("https://us.posthog.com/api/projects/353503/query/");
    expect(init?.method).toBe("POST");
    return new Response(JSON.stringify({ columns: ["uuid", "event", "timestamp", "event_id",
      "session_id", "analytics_permitted", "mully_anon_id"],
    results: [["aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", "lean_reserve_started", "2026-01-01T11:00:00Z",
      "event1", "session1", true, "fixture-subject"]] }));
  });
  const run = async () => {
    const rpc = vi.fn(async (name: string, p?: Record<string, unknown>) => {
      void p; return { data: name === "lean_full_inputs" ? full : true, error: null };
    });
    await expect(runFullReportJob({ ...args, posthogKey: "synthetic", request: behaviorRequest, client: { rpc } }))
      .resolves.toMatchObject({ state: "complete" });
    return rpc.mock.calls.find(([name]) => name === "lean_full_finish")![1]!;
  };
  const first = await run(), replay = await run();
  expect(replay.p_facts).toEqual(first.p_facts); expect(replay.p_reports).toEqual(first.p_reports);
  return first.p_facts as Record<string, Record<string, unknown>[]>;
}
it.each([false, true])("real full consumer applies anonymous permission/revocation without customer inference (%s)", async revoked => {
  const r = await collectRefresh(input(), env, request(revoked), now());
  const facts = await consume(r.bundle);
  expect(facts.sessions).toHaveLength(revoked ? 0 : 1);
  if (!revoked) expect(facts.sessions[0].customer_id).toBeNull();
  expect(facts.customers).toHaveLength(1); expect(facts.identity_map).toHaveLength(2);
});
it("reads grants once for 101 orders, preserves identity once outside order scope, seals and consumes global evidence", async () => {
  const f = partition(), transport = request(), r = await collectPartitionRefresh(f, parentEnv, transport);
  expect(transport.mock.calls.filter(([url]) => permissionsOnly(url))).toHaveLength(1);
  expect(r.bundle.full.evidence.identity).toHaveLength(2);
  expect(r.bundle.full.evidence.identity[0]).toEqual((f.refresh.intake.packets.find(p => p.section === "identity")!.payload as object[])[0]);
  for (const p of f.refresh.intake.packets.filter(p => !["identity", "orderIdentities"].includes(p.section)))
    expect(r.refresh.refresh.intake.packets.find(q => q.section === p.section)).toEqual(p);
  expect(preparePartitionRefresh(JSON.parse(JSON.stringify(r.refresh)))).toEqual(r.bundle);
  const tampered = structuredClone(r.refresh), identity = tampered.refresh.intake.packets.find(p => p.section === "identity")!;
  (identity.payload as { evidenceRef: string }[])[1].evidenceRef = "changed-authority";
  identity.sha256 = evidenceDigest(identity.payload);
  expect(() => preparePartitionRefresh(tampered)).toThrow("partition_evidence_binding");
  const facts = await consume(r.bundle, r.sources.pages);
  expect(facts.orders).toHaveLength(101); expect(facts.identity_map).toHaveLength(2);
  expect(facts.customers).toHaveLength(1); expect(facts.sessions[0].customer_id).toBeNull();
}, 30000);
it("reserves the extra parent RPC globally and preflights parent identity before any child reads", async () => {
  const f = partition(), transport = request();
  f.collection.maxRequests = f.collection.partitions.reduce((total, child) => total +
    child.history.reduce((n, h) => n + h.maxPages + 1, 0) +
    Math.min(100, child.history.reduce((n, h) => n + h.pageSize * h.maxPages, 0)) * (f.collection.maxLinePages + 1 + 8) + 1, 0);
  await expect(collectPartitionRefresh(f, parentEnv, transport)).rejects.toThrow("partition_request_reservation");
  const g = partition(); g.collection.journeyPermissions!.retainedIdentityDigest = "wrong";
  await expect(collectPartitionRefresh(g, parentEnv, transport)).rejects.toThrow("journey_collection_retained_mismatch");
  expect(transport).not.toHaveBeenCalled();
});
it("rejects unknown parent options and preserves reviewed identity outside the selected customer inventory", async () => {
  const f = partition(), transport = request();
  Object.assign(f.collection, { permissionFallback: true });
  await expect(collectPartitionRefresh(f, parentEnv, transport)).rejects.toThrow("unsupported_collection_option");
  expect(transport).not.toHaveBeenCalled();
  const g = partition(), packet = g.refresh.intake.packets.find(p => p.section === "identity")!;
  const original = packet.payload as Record<string, unknown>[];
  original.push({ ...original[0], identifier: "999", customerId: "reviewed-outside-inventory" });
  packet.sha256 = evidenceDigest(packet.payload); g.collection.journeyPermissions = reviewedOption(g.refresh);
  const r = await collectPartitionRefresh(g, parentEnv, request());
  expect(r.bundle.full.evidence.identity.slice(0, 2)).toEqual(original);
  expect(r.bundle.full.evidence.identity).toHaveLength(3);
}, 30000);
it("rejects a late parent grant response and counts its bytes after all children", async () => {
  const f = partition(), baseline = await collectPartitionRefresh(f, parentEnv, request());
  const g = partition(); g.collection.maxBytes = baseline.audit.bytes + 1024;
  const grants = collectedGrants(); grants[0].permissionEvidenceRef = "é".repeat(2000);
  const oversized = vi.fn<typeof fetch>(permissionTransport(grants));
  await expect(collectPartitionRefresh(g, parentEnv, oversized)).rejects.toThrow("partition_read_budget");
  expect(oversized.mock.calls.filter(([url]) => permissionsOnly(url))).toHaveLength(1);
  const h = partition(), start = h.refresh.intake.asOf;
  let late = false;
  const source = request(), clock = () => late ? new Date(Date.parse(start) + 120001).toISOString() : start;
  const transport: typeof fetch = async (url, init) => {
    const response = await source(url, init); if (permissionsOnly(url)) late = true; return response;
  };
  await expect(collectPartitionRefresh(h, parentEnv, transport, clock)).rejects.toThrow("partition_read_budget");
}, 30000);
it.each(["ordinary", "partition", "old-binding", "new-binding"])("actual CLI + offline replay (%s)", mode => {
  const root = mkdtempSync(join(tmpdir(), "journey-permission-")), path = join(root, "input.json"), out = join(root, "out");
  try {
    const f = mode === "partition" ? partition() : input(), clock = new Date().toISOString();
    f.refresh.intake.asOf = f.refresh.policy.asOf = f.refresh.readyAt = clock;
    f.refresh.expiresAt = new Date(Date.parse(clock) + 1800000).toISOString();
    f.refresh.intake.packets.forEach(p => { p.capturedAt = new Date(Date.parse(clock) - 60000).toISOString(); });
    f.collection.journeyPermissions = reviewedOption(f.refresh);
    if (mode === "old-binding") f.refresh.intake.bindings[0].approvalRef = "changed";
    if (mode === "new-binding") f.collection.journeyPermissions.binding.sourceId = f.collection.binding.sourceId;
    writeFileSync(path, JSON.stringify(f));
    const result = spawnSync(process.execPath, ["--import", resolve("tests/fixtures/journey-permission-cli-preload.mjs"),
      resolve("scripts/analytics/prepare-refresh.mjs"), "--collect-sources", path, out],
    { env: { ...process.env, ...parentEnv, NODE_ENV: "test" }, encoding: "utf8", timeout: 30000 });
    if (mode.endsWith("binding")) { expect(result.status).not.toBe(0); expect(existsSync(out)).toBe(false); return; }
    expect(result.status, result.stderr).toBe(0);
    const bundle = JSON.parse(readFileSync(join(out, "refresh-bundle.json"), "utf8"));
    expect(bundle.full.evidence.identity).toHaveLength(2);
    const offline = spawnSync(process.execPath, [resolve("scripts/analytics/prepare-refresh.mjs"),
      join(out, "refresh-input.json"), join(root, "offline")],
    { env: { PATH: process.env.PATH, NODE_ENV: "test" }, encoding: "utf8", timeout: 30000 });
    expect(offline.status, offline.stderr).toBe(0);
    expect(JSON.parse(readFileSync(join(root, "offline", "refresh-bundle.json"), "utf8"))).toEqual(bundle);
  } finally { rmSync(root, { recursive: true, force: true }); }
}, 60000);
