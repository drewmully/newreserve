import { afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync, writeFileSync, existsSync, statSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { spawnSync } from "node:child_process";
import { collectPartitionRefresh, preparePartitionRefresh } from "@/lib/analytics/partitionRefresh";
import { assemblePartitionPages, validatePartitionInventory } from "@/lib/analytics/partitionInventory";
import { canonicalJson, evidenceDigest } from "@/lib/analytics/evidenceIntake";
import { partitionEnv, partitionInput } from "../fixtures/analyticsPartition";
import { partitionTransport } from "../fixtures/partition-collection-source.mjs";
type Collected = Awaited<ReturnType<typeof collectPartitionRefresh>>;
let source: Collected;
beforeAll(async () => { source = await collectPartitionRefresh(partitionInput(), partitionEnv, partitionTransport()); });
beforeEach(() => vi.stubGlobal("fetch", () => { throw new Error("external_network_forbidden"); }));
afterEach(() => vi.unstubAllGlobals());
const reseal = (m: Collected["refresh"]["manifest"]) => {
  const { digest: ignored, ...body } = m; void ignored; m.digest = evidenceDigest(body);
};
it("keeps retained independent controls verbatim and binds all 17 evidence sections through expiry", async () => {
  const input = partitionInput(), r = await collectPartitionRefresh(input, partitionEnv, partitionTransport());
  expect(r.bundle.lineage).toHaveLength(17);
  for (const p of input.refresh.intake.packets.filter(p => !["orderIdentities", "replacements"].includes(p.section))) {
    expect(r.refresh.refresh.intake.packets.find(q => q.section === p.section)).toEqual(p);
    const oldBinding = input.refresh.intake.bindings.find(b => b.sourceId === p.sourceId)!;
    const retained = r.refresh.refresh.intake.bindings.find(b => b.sourceId === p.sourceId)!;
    expect(retained).toMatchObject({ approvalRef: oldBinding.approvalRef,
      independentControlSource: oldBinding.independentControlSource, maxAgeSeconds: oldBinding.maxAgeSeconds });
  }
  expect(r.audit).toMatchObject({ completePurchaseHistory: false, independentlyReconciled: false, enabled: false, registered: false });
  const stale = structuredClone(r.refresh);
  stale.refresh.expiresAt = stale.manifest.expiresAt = new Date(Date.parse(stale.refresh.intake.asOf) + 7200000).toISOString();
  reseal(stale.manifest);
  expect(() => preparePartitionRefresh(stale)).toThrow("refresh_outlives_evidence");
});
it.each([
  ["approval", (f: ReturnType<typeof partitionInput>) => f, { ...partitionEnv, LEAN_PARTITION_COLLECTION_APPROVED: "" }],
  ["global request reservation", (f: ReturnType<typeof partitionInput>) => { f.collection.maxRequests = 100; return f; }, partitionEnv],
  ["duplicate child", (f: ReturnType<typeof partitionInput>) => { f.collection.partitions[1].id = "first"; return f; }, partitionEnv],
  ["too many children", (f: ReturnType<typeof partitionInput>) => { f.collection.partitions = Array(11).fill(f.collection.partitions[0]); return f; }, partitionEnv],
] as const)("rejects %s without source calls", async (_name, change, env) => {
  const request = vi.fn(partitionTransport());
  await expect(collectPartitionRefresh(change(partitionInput()), env, request)).rejects.toThrow();
  expect(request).not.toHaveBeenCalled();
});
it.each(["pages", "orders", "bytes"] as const)("rejects exhausted global/child %s budget", async mode => {
  const f = partitionInput();
  if (mode === "pages") f.collection.partitions[0].history[0].maxPages = 1;
  if (mode === "orders") f.collection.maxOrders = 100;
  if (mode === "bytes") f.collection.maxBytes = 1024;
  await expect(collectPartitionRefresh(f, partitionEnv, partitionTransport())).rejects.toThrow();
});
it("propagates one active deadline through later PilotSource reads, with no late success or fallback", async () => {
  const f = partitionInput(); f.collection.timeoutMs = 200;
  const transport = partitionTransport();
  // Control expiry, not runner speed: CI may spend >200ms collecting the first
  // child. Abort the real parent signal only once the later reader is active.
  const timers: AbortController[] = [];
  const timeout = vi.spyOn(AbortSignal, "timeout").mockImplementation(() => {
    const controller = new AbortController(); timers.push(controller);
    return controller.signal;
  });
  const request = vi.fn<typeof fetch>(async (url, init) => {
    if (String(init?.body).includes("AnalyticsFinancial")) return new Promise<Response>((_resolve, reject) => {
      if (init?.signal?.aborted) reject(new Error("aborted"));
      else init?.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
      timers[0].abort(new DOMException("Fixture deadline elapsed", "TimeoutError"));
    });
    return transport(url, init);
  });
  try {
    await expect(collectPartitionRefresh(f, partitionEnv, request)).rejects.toThrow();
    expect(timeout.mock.calls[0]).toEqual([200]);
    expect(request.mock.calls.some(([, init]) => String(init?.body).includes("AnalyticsFinancial"))).toBe(true);
    expect(timers[0].signal.aborted).toBe(true);
  } finally { timeout.mockRestore(); }
  const late = partitionInput(), now = Date.parse(late.refresh.intake.asOf);
  const clock = vi.fn(() => new Date(now).toISOString());
  const lateRequest: typeof fetch = async (url, init) => {
    const response = await transport(url, init);
    if (String(init?.body).includes("AnalyticsFinancial")) clock.mockReturnValue(new Date(now + 130000).toISOString());
    return response;
  };
  await expect(collectPartitionRefresh(late, partitionEnv, lateRequest, clock)).rejects.toThrow();
});
it("rejects a fresh PilotSource commerce revision differing from collected commerce", async () => {
  const transport = partitionTransport(); let financialSeen = false;
  const request: typeof fetch = async (url, init) => {
    const response = await transport(url, init);
    if (String(init?.body).includes("AnalyticsFinancial")) financialSeen = true;
    if (financialSeen && String(init?.body).includes("AnalyticsOrder")) {
      const body = await response.json(); body.data.order.cartToken = "changed-after-collection";
      return new Response(JSON.stringify(body), { headers: response.headers });
    }
    return response;
  };
  await expect(collectPartitionRefresh(partitionInput(), partitionEnv, request)).rejects.toThrow();
});
it.each(["missing", "extra", "duplicate", "content", "header"] as const)("rejects %s saved-page mutation", mode => {
  const r = structuredClone(source), pages = r.sources.pages;
  if (mode === "missing") pages.pop();
  if (mode === "extra") pages.push({ ...pages[0], child: "extra" });
  if (mode === "duplicate") pages[1] = pages[0];
  if (mode === "content") pages[0].payload = pages[0].payload.replace('"SKU"', '"TAMPER"');
  if (mode === "header") r.refresh.manifest.children[0].pages[0].bytes++;
  expect(() => assemblePartitionPages(r.refresh.manifest, pages)).toThrow();
});
it.each(["missing", "new", "revised"] as const)("rejects correctly rehashed page with %s inventory IDs/revisions", mode => {
  const r = structuredClone(source), page = r.sources.pages[0], rows = JSON.parse(page.payload);
  if (mode === "missing") rows[0] = rows[1];
  if (mode === "new") rows[0].source.commerce.order.id = "gid://shopify/Order/999";
  if (mode === "revised") rows[0].source.commerce.order.updatedAt = "2026-01-04T00:00:00Z";
  rows[0].evidenceRef = `partition-source:sha256:${evidenceDigest(rows[0].source)}`;
  page.payload = canonicalJson(rows);
  Object.assign(r.refresh.manifest.children[0].pages[0], { bytes: Buffer.byteLength(page.payload), digest: evidenceDigest(rows) });
  reseal(r.refresh.manifest);
  expect(() => assemblePartitionPages(r.refresh.manifest, r.sources.pages)).toThrow();
});
it("deduplicates exact overlapping child content with explicit owner but rejects conflicts", () => {
  const r = structuredClone(source), m = r.refresh.manifest;
  const child = structuredClone(m.children[1]); child.id = "overlap"; m.children.push(child);
  r.sources.pages.push({ ...r.sources.pages.at(-1)!, child: child.id });
  m.owners["gid://shopify/Order/101"] = "overlap"; reseal(m);
  expect(assemblePartitionPages(m, r.sources.pages)).toHaveLength(101);
  const page = r.sources.pages.at(-1)!, rows = JSON.parse(page.payload);
  rows[0].source.commerce.order.cartToken = "conflicting";
  rows[0].evidenceRef = `partition-source:sha256:${evidenceDigest(rows[0].source)}`;
  page.payload = canonicalJson(rows);
  Object.assign(child.pages[0], { bytes: Buffer.byteLength(page.payload), digest: evidenceDigest(rows) }); reseal(m);
  expect(() => assemblePartitionPages(m, r.sources.pages)).toThrow("partition_source_conflict");
  m.owners["gid://shopify/Order/101"] = "unknown"; reseal(m);
  expect(() => validatePartitionInventory(m, m)).toThrow("partition_order_ownership");
});
it("does not drop reviewed order links outside child scope", async () => {
  const f = partitionInput(), p = f.refresh.intake.packets.find(p => p.section === "orderIdentities")!;
  p.payload = [{ orderId: "outside-inventory", namespace: "shopify_customer", identifier: "7", evidenceRef: "reviewed" }];
  p.sha256 = evidenceDigest(p.payload);
  await expect(collectPartitionRefresh(f, partitionEnv, partitionTransport())).rejects.toThrow();
});
it("runs the actual CLI for >100 orders, preserves private outputs and replays without network or activation", async () => {
  const root = mkdtempSync(join(tmpdir(), "partition-cli-")), file = join(root, "input.json"), output = join(root, "output");
  const cli = resolve("scripts/analytics/prepare-refresh.mjs"), preload = resolve("tests/fixtures/partition-cli-preload.mjs");
  const run = (args: string[]) => spawnSync(process.execPath, ["--import", preload, cli, ...args],
    { encoding: "utf8", env: { ...process.env, ...partitionEnv, NODE_ENV: "test" }, timeout: 120000 });
  try {
    writeFileSync(file, JSON.stringify(partitionInput()));
    expect(run([file, output]).status).toBe(1); expect(existsSync(output)).toBe(false);
    const result = run(["--collect-sources", file, output]);
    expect(result.stderr).toBe(""); expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({ state: "prepared_only", registered: false, enabled: false });
    const pages = JSON.parse(readFileSync(join(output, "collected-sources.json"), "utf8")).pages;
    expect(pages).toHaveLength(21);
    expect(statSync(join(output, "refresh-bundle.json")).mode & 0o777).toBe(0o600);
    const replay = join(root, "replay");
    expect(run([join(output, "refresh-input.json"), replay]).status).toBe(0);
    expect(readFileSync(join(replay, "refresh-bundle.json"), "utf8")).toBe(readFileSync(join(output, "refresh-bundle.json"), "utf8"));
    const invalid = partitionInput(); invalid.collection.maxRequests = 2;
    writeFileSync(file, JSON.stringify(invalid));
    expect(run(["--collect-sources", file, join(root, "rejected")]).status).toBe(1);
    expect(existsSync(join(root, "rejected"))).toBe(false);
  } finally { rmSync(root, { recursive: true, force: true }); }
}, 120000);
