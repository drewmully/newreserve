import { expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { collectRefresh, type CollectRefreshInput } from "@/lib/analytics/collectRefresh";
import { evidenceDigest } from "@/lib/analytics/evidenceIntake";
import { prepareRefresh } from "@/lib/analytics/refreshPlan";
import { validateHistoryInventory } from "@/lib/analytics/historyInventory";
import { HISTORY_ACCESS_QUERY, HISTORY_ORDERS_QUERY, HISTORY_UPDATED_ORDERS_QUERY } from "@/lib/analytics/shopifyHistory";
import { SHOPIFY_ANALYTICS_ORDER_QUERY } from "@/lib/analytics/shopifySource";
import { discoveryEnv as env, discoveryStart as now, discoveryInput, discoveryOrder,
  inventoryFixture } from "../fixtures/analyticsDiscovery";
const clock = () => now;
type Page = { nodes: unknown[]; next: string | null };
function transport(pages: Page[] = [{ nodes: [discoveryOrder()], next: "cursor1" },
  { nodes: [discoveryOrder("2")], next: null }], change?: string) {
  let index = 0;
  return vi.fn<typeof fetch>(async (url, init) => {
    expect(String(url)).toBe(`https://${env.LEAN_SHOPIFY_SHOP_DOMAIN}/admin/api/2026-07/graphql.json`);
    expect(init?.redirect).toBe("error");
    expect(init?.headers).toMatchObject({ "X-Shopify-Access-Token": "synthetic-shopify" });
    const { query, variables } = JSON.parse(String(init?.body));
    let data;
    if (query === HISTORY_ACCESS_QUERY) data = { currentAppInstallation: { accessScopes:
      (change === "scopes" ? ["read_orders"] : ["read_orders", "read_all_orders"]).map(handle => ({ handle })) } };
    else if ([HISTORY_ORDERS_QUERY, HISTORY_UPDATED_ORDERS_QUERY].includes(query)) {
      expect(variables.search).toMatch(/^(created|updated)_at:>='2026-01-01T00:00:00Z'/);
      const p = pages[index++];
      if (!p) throw new Error("unexpected_extra_page");
      data = { orders: { nodes: p.nodes, pageInfo: { hasNextPage: p.next !== null, endCursor: p.next } } };
    } else {
      expect(query).toBe(SHOPIFY_ANALYTICS_ORDER_QUERY);
      const order = discoveryOrder(variables.id.split("/").at(-1));
      if (change === "revision") order.updatedAt = "2026-01-03T12:00:00Z";
      data = { order };
    }
    return Response.json({ data }, { headers: { "X-Shopify-API-Version": "2026-07" } });
  });
}
it("discovers all pages inside approved windows, seals the inventory and preserves independent evidence", async () => {
  const input = discoveryInput(), request = transport(), original = structuredClone(input);
  const out = await collectRefresh(input, env, request, clock);
  expect(request).toHaveBeenCalledTimes(7);
  expect(out.sources.inventory?.orders).toHaveLength(2);
  expect(out.sources.inventory?.windows[0].pages).toHaveLength(2);
  expect(out.bundle.base.policy.sourceInventory).toEqual(out.sources.inventory);
  expect(out.audit).toMatchObject({ independentlyReconciled: false, completePurchaseHistory: false,
    collectedSections: ["orderIdentities"], inventoryDigest: out.sources.inventory?.digest });
  for (const p of original.refresh.intake.packets.filter(p => p.section !== "orderIdentities"))
    expect(out.refresh.intake.packets.find(r => r.section === p.section)).toEqual(p);
  expect(out.refresh.intake.bindings.find(b => b.independentControlSource)?.approvalRef)
    .toBe(original.refresh.intake.bindings[0].approvalRef);
  expect(prepareRefresh(out.refresh)).toEqual(out.bundle);
  expect(input).toEqual(original);
  expect((await collectRefresh(input, env, transport(), clock)).bundle).toEqual(out.bundle);
});
it("accepts a terminal empty inventory without asserting zero-sales or complete history", async () => {
  const request = transport([{ nodes: [], next: null }]);
  const out = await collectRefresh(discoveryInput(), env, request, clock);
  expect(request).toHaveBeenCalledTimes(2);
  expect(out.sources.inventory?.orders).toEqual([]);
  expect(out.audit.completePurchaseHistory).toBe(false);
  expect(out.bundle.full.evidence.dateCoverage).toEqual(discoveryInput().refresh.intake.packets
    .find(p => p.section === "dateCoverage")?.payload);
});
it.each(["created_at", "updated_at"] as const)("requires actual full-history token scope for this %s window", async scanBasis => {
  const i = discoveryInput(); i.refresh.history[0].scanBasis = scanBasis;
  const request = transport(undefined, "scopes");
  await expect(collectRefresh(i, env, request, clock)).rejects.toThrow("missing_full_history_access");
  expect(request).toHaveBeenCalledTimes(1);
});
it.each([
  ["nonterminal budget", [{ nodes: [discoveryOrder()], next: "a" }, { nodes: [discoveryOrder("2")], next: "b" }], "page_budget"],
  ["cursor cycle", [{ nodes: [discoveryOrder()], next: "a" }, { nodes: [discoveryOrder("2")], next: "a" }], "invalid_page"],
  ["cross-page duplicate", [{ nodes: [discoveryOrder()], next: "a" }, { nodes: [discoveryOrder()], next: null }], "order_scope"],
  ["cross-page sort", [{ nodes: [{ ...discoveryOrder(), createdAt: "2026-01-02T01:00:00Z" }], next: "a" },
    { nodes: [discoveryOrder("2")], next: null }], "order_scope"],
  ["outside window", [{ nodes: [{ ...discoveryOrder(), createdAt: "2025-01-01T00:00:00Z" }], next: null }], "scope_mismatch"],
])("rejects %s before hydrating or falling back", async (_, pages, error) => {
  const request = transport(pages as Page[]);
  await expect(collectRefresh(discoveryInput(), env, request, clock)).rejects.toThrow(String(error));
  expect(request.mock.calls.every(([, init]) => JSON.parse(String(init?.body)).query !== SHOPIFY_ANALYTICS_ORDER_QUERY)).toBe(true);
});
it("rejects hydration revision drift before creating new evidence", async () => {
  await expect(collectRefresh(discoveryInput(), env, transport(undefined, "revision"), clock))
    .rejects.toThrow("inventory_hydration_changed");
});
it.each([
  ["mixed mode", (i: CollectRefreshInput) => { i.collection.orderIds = ["gid://shopify/Order/1"]; }],
  ["false discovery", (i: CollectRefreshInput) => { Object.assign(i.collection, { discover: false }); }],
  ["request reservation", (i: CollectRefreshInput) => { i.collection.maxRequests = 9; }],
  ["25-page cap", (i: CollectRefreshInput) => { i.refresh.history[0].maxPages = 26; }],
  ["100-row cap", (i: CollectRefreshInput) => { Object.assign(i.refresh.history[0], { pageSize: 5, maxPages: 21 }); }],
  ["future window", (i: CollectRefreshInput) => { i.refresh.history[0].until = "2027-01-01T00:00:00Z"; }],
  ["overlap", (i: CollectRefreshInput) => { i.refresh.history.push(i.refresh.history[0]); }],
  ["injected inventory", (i: CollectRefreshInput) => { i.refresh.commercePolicy.sourceInventory = inventoryFixture(); }],
])("preflights %s without reads", async (_, mutate) => {
  const i = discoveryInput(), request = transport(); mutate(i);
  await expect(collectRefresh(i, env, request, clock)).rejects.toThrow();
  expect(request).not.toHaveBeenCalled();
});
it("enforces cumulative order, byte and clock budgets on discovery", async () => {
  const i = discoveryInput(); i.collection.maxOrders = 1;
  await expect(collectRefresh(i, env, transport(), clock)).rejects.toThrow("order_budget");
  const bytes = discoveryInput(); bytes.collection.maxBytes = 1024;
  await expect(collectRefresh(bytes, env, transport(), clock)).rejects.toThrow();
  const expired = vi.fn<() => string>().mockReturnValueOnce(now).mockReturnValue("2026-09-24T19:30:01Z");
  await expect(collectRefresh(discoveryInput(), env, transport(), expired)).rejects.toThrow("timeout");
});
it("accepts the 100-row boundary without raising report budgets", async () => {
  const i = discoveryInput();
  Object.assign(i.refresh.history[0], { pageSize: 5, maxPages: 20 });
  i.refresh.maxSteps = 23;
  Object.assign(i.collection, { maxOrders: 100, maxLinePages: 1, maxRequests: 222 });
  const pages = Array.from({ length: 20 }, (_, p) => ({
    nodes: Array.from({ length: 5 }, (_, row) => discoveryOrder(String(p * 5 + row + 1))),
    next: p === 19 ? null : `cursor-${p}`,
  }));
  const out = await collectRefresh(i, env, transport(pages), clock);
  expect(out.sources.inventory?.orders).toHaveLength(100);
  expect(out.bundle.history[0]).toMatchObject({ pageSize: 5, maxPages: 20 });
  expect(out.audit.calls).toBe(221); // scope + 20 pages + 100 paired reads; no customer IDs
});
it("deduplicates equal creation/update inventory without widening approved windows", async () => {
  const i = discoveryInput(); i.refresh.history[0].maxPages = 1;
  i.refresh.history.push({ ...i.refresh.history[0], scanBasis: "updated_at" });
  const request = transport([{ nodes: [discoveryOrder()], next: null }, { nodes: [discoveryOrder()], next: null }]);
  const out = await collectRefresh(i, env, request, clock);
  expect(out.sources.inventory?.orders).toHaveLength(1);
  expect(out.sources.inventory?.windows).toHaveLength(2);
  expect(request).toHaveBeenCalledTimes(6);
});
it("refuses inconsistent revisions across overlapping creation/update inventories", async () => {
  const i = discoveryInput(); i.refresh.history[0].maxPages = 1;
  i.refresh.history.push({ ...i.refresh.history[0], scanBasis: "updated_at" });
  const request = transport([{ nodes: [discoveryOrder()], next: null },
    { nodes: [{ ...discoveryOrder(), updatedAt: "2026-01-03T12:00:00Z" }], next: null }]);
  await expect(collectRefresh(i, env, request, clock)).rejects.toThrow("revision_conflict");
  expect(request).toHaveBeenCalledTimes(4);
});
it.each(["digest", "history", "orders", "incomplete", "capture"] as const)("refuses replay with changed %s", async field => {
  const out = await collectRefresh(discoveryInput(), env, transport(), clock);
  const inventory = out.refresh.commercePolicy.sourceInventory!;
  if (field === "digest") inventory.digest = "0".repeat(64);
  if (field === "history") out.refresh.history[0].until = "2026-01-31T00:00:00Z";
  if (field === "orders") inventory.orders = [];
  if (field === "incomplete") inventory.windows[0].pages.at(-1)!.nextCursor = "not-finished";
  if (field === "capture") inventory.capturedAt = "2027-01-01T00:00:00Z";
  if (field !== "digest") {
    const payload = { ...inventory }; delete (payload as Partial<typeof payload>).digest;
    inventory.digest = evidenceDigest(payload);
  }
  expect(() => prepareRefresh(out.refresh)).toThrow();
});
it("validates normalized revision timestamps rather than lexical formatting", () => {
  const value = inventoryFixture();
  expect(validateHistoryInventory(value, { projectRef: env.LEAN_MULLY_SOURCE_PROJECT_REF,
    shop: env.LEAN_SHOPIFY_SHOP_DOMAIN }).orders[0].updatedAt).toBe("2026-01-02T12:00:00.000Z");
});
it.each([false, true])("runs the actual CLI subprocess with synthetic pagination (exhausted=%s)", exhausted => {
  const dir = mkdtempSync(join(tmpdir(), "discovery-cli-"));
  try {
    const i = discoveryInput(), asOf = new Date().toISOString();
    i.refresh.policy.asOf = i.refresh.intake.asOf = i.refresh.readyAt = asOf;
    i.refresh.expiresAt = new Date(Date.parse(asOf) + 1800000).toISOString();
    i.refresh.intake.packets.forEach(p => { p.capturedAt = asOf; });
    writeFileSync(join(dir, "input.json"), JSON.stringify(i));
    const result = spawnSync(process.execPath, ["--import", resolve("tests/fixtures/discovery-cli-preload.mjs"),
      resolve("scripts/analytics/prepare-refresh.mjs"), "--collect-sources", join(dir, "input.json"), join(dir, "out")], {
      env: { PATH: process.env.PATH, ...env, DISCOVERY_TEST_EXHAUSTED: String(exhausted) },
      encoding: "utf8", timeout: 30000,
    });
    expect(result.status, result.stderr).toBe(exhausted ? 1 : 0);
    if (exhausted) expect(readdirSync(dir)).toEqual(["input.json"]);
    else {
      expect(JSON.parse(result.stdout)).toMatchObject({ state: "prepared_only", calls: 7, registered: false });
      const replay = JSON.parse(readFileSync(join(dir, "out/refresh-input.json"), "utf8"));
      expect(prepareRefresh(replay)).toEqual(JSON.parse(readFileSync(join(dir, "out/refresh-bundle.json"), "utf8")));
      expect(readdirSync(join(dir, "out"))).toHaveLength(5);
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
}, 40000);
