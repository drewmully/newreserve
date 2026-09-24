import { afterEach, expect, it, vi } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { refreshFixture } from "../fixtures/analyticsRefresh";
import { prepareFile } from "../../scripts/analytics/prepare-refresh.mjs";
import { dispatchRefresh, refreshDispatchConfig } from "../../scripts/analytics/dispatch-refresh.mjs";
import { readSourceFile } from "../../scripts/analytics/read-mully-source.mjs";
afterEach(() => vi.unstubAllGlobals());
it("prepares a private bundle and diagnostic view entirely offline", () => {
  vi.stubGlobal("fetch", () => { throw new Error("network_forbidden"); });
  const dir = mkdtempSync(join(tmpdir(), "refresh-fixture-"));
  try {
    const input = join(dir, "input.json"), out = join(dir, "output");
    writeFileSync(input, JSON.stringify(refreshFixture()));
    expect(prepareFile(input, out)).toMatchObject({ state: "prepared_only", registered: false, enabled: false });
    expect(JSON.parse(readFileSync(join(out, "refresh-bundle.json"), "utf8")).history).toHaveLength(1);
    expect(JSON.parse(readFileSync(join(out, "analytics-events-view.json"), "utf8")).materialize).toBe(false);
    expect(() => prepareFile(input, out)).toThrow();
  } finally { rmSync(dir, { recursive: true, force: true }); }
}, 30000);
it("extracts only scoped checkout receipts through the real source command", async () => {
  const dir = mkdtempSync(join(tmpdir(), "journey-cli-fixture-"));
  const projectRef = "a".repeat(20), shop = "fixture.myshopify.com";
  const env = { LEAN_MULLY_SOURCE_READ_APPROVED: "true", LEAN_MULLY_SOURCE_READ_KEY: "fixture-key",
    LEAN_MULLY_SOURCE_PROJECT_REF: projectRef, LEAN_SHOPIFY_SHOP_DOMAIN: shop };
  const request = vi.fn<typeof fetch>(async () => Response.json([]));
  try {
    const input = join(dir, "input.json"), output = join(dir, "receipts.json");
    writeFileSync(input, JSON.stringify({ kind: "journey-receipts-v1", projectRef, shop,
      approvalRef: "fixture:read", orders: [{ shop, apiVersion: "2026-07",
        order: { id: "gid://shopify/Order/1", cartToken: "fixture_cart" } }] }));
    expect(await readSourceFile(input, output, env, request)).toMatchObject({
      state: "snapshot_only", receipts: 0, registered: false, enabled: false,
    });
    expect(request).toHaveBeenCalledTimes(1);
    expect(request.mock.calls[0][0]).toBe(`https://${projectRef}.supabase.co/rest/v1/rpc/lean_checkout_receipts_read`);
    expect(JSON.parse(String(request.mock.calls[0][1]?.body))).toEqual({
      p_project: projectRef, p_shop: shop, p_carts: ["fixture_cart"],
    });
    expect(statSync(output).mode & 0o777).toBe(0o600);
    expect(readFileSync(output, "utf8")).not.toContain("fixture-key");
  } finally { rmSync(dir, { recursive: true, force: true }); }
}, 30000);
it("extracts the exact permission window and refuses a different PostHog project before any read", async () => {
  const dir = mkdtempSync(join(tmpdir(), "permission-cli-fixture-"));
  const projectRef = "a".repeat(20), shop = "fixture.myshopify.com";
  const env = { LEAN_MULLY_SOURCE_READ_APPROVED: "true", LEAN_MULLY_SOURCE_READ_KEY: "fixture-key",
    LEAN_MULLY_SOURCE_PROJECT_REF: projectRef, LEAN_SHOPIFY_SHOP_DOMAIN: shop, LEAN_POSTHOG_PROJECT_ID: "353503" };
  const request = vi.fn<typeof fetch>(async () => Response.json([]));
  try {
    const input = join(dir, "input.json"), output = join(dir, "permissions.json");
    const scope = { kind: "journey-permissions-v1", projectRef, shop, approvalRef: "fixture:read",
      posthogProject: "353503", from: "2026-01-01T00:00:00Z", until: "2026-01-02T00:00:00Z" };
    writeFileSync(input, JSON.stringify({ ...scope, posthogProject: "999" }));
    await expect(readSourceFile(input, output, env, request)).rejects.toThrow("permission_project");
    expect(request).not.toHaveBeenCalled();
    writeFileSync(input, JSON.stringify(scope));
    expect(await readSourceFile(input, output, env, request)).toMatchObject({
      state: "snapshot_only", grants: 0, registered: false, enabled: false,
    });
    expect(request).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(request.mock.calls[0][1]?.body))).toEqual({
      p_project: projectRef, p_shop: shop, p_posthog: "353503", p_from: scope.from, p_until: scope.until,
    });
    expect(statSync(output).mode & 0o777).toBe(0o600);
  } finally { rmSync(dir, { recursive: true, force: true }); }
}, 30000);
it("keeps dispatch disabled and rejects invalid origins and call budgets", () => {
  expect(() => refreshDispatchConfig({})).toThrow("disabled");
  const env = { LEAN_ANALYTICS_REFRESH_DISPATCH_ENABLED: "true",
    LEAN_ANALYTICS_RUNNER_ORIGIN: "https://fixture.invalid", LEAN_ANALYTICS_REFRESH_SECRET: "x".repeat(32) };
  expect(refreshDispatchConfig(env).maxCalls).toBe(5);
  expect(() => refreshDispatchConfig({ ...env, LEAN_ANALYTICS_REFRESH_MAX_CALLS: "129" })).toThrow("budget");
  expect(() => refreshDispatchConfig({ ...env, LEAN_ANALYTICS_RUNNER_ORIGIN: "http://fixture.invalid" })).toThrow("origin");
});
it("dispatches only successful checkpoints and never retries failed or ambiguous calls", async () => {
  const config = { origin: "https://fixture.invalid", secret: "fixture", maxCalls: 3 };
  const request = vi.fn().mockResolvedValueOnce(Response.json({ state: "partial" }))
    .mockResolvedValueOnce(Response.json({ state: "complete" }));
  expect(await dispatchRefresh(config, request)).toMatchObject({ state: "complete", calls: 2 });
  expect(request.mock.calls[0][0].pathname).toBe("/api/analytics/ingest/refresh");
  const ambiguous = vi.fn().mockRejectedValue(new Error("lost"));
  await expect(dispatchRefresh(config, ambiguous)).rejects.toThrow("lost");
  expect(ambiguous).toHaveBeenCalledTimes(1);
  const blocked = vi.fn().mockResolvedValue(Response.json({ state: "ambiguous" }));
  expect(await dispatchRefresh(config, blocked)).toEqual({ state: "stopped", calls: 1 });
});
it("extracts an explicitly approved source snapshot and prepares its bundle without activating anything", async () => {
  const dir = mkdtempSync(join(tmpdir(), "mully-source-fixture-"));
  const projectRef = "a".repeat(20), shop = "fixture.myshopify.com";
  const orders = [{ shop, apiVersion: "2026-07",
    order: { id: "gid://shopify/Order/1", customer: { id: "gid://shopify/Customer/123" } } }];
  const request = vi.fn(async () => Response.json([{ id: "123", entity: "shopify", firebase_uid: null,
    created_at: "2025-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z" }],
  { headers: { "Content-Range": "0-0/1" } }));
  try {
    const input = join(dir, "input.json"), output = join(dir, "snapshot.json");
    writeFileSync(input, JSON.stringify({ projectRef, shop, orders, entities: ["shopify"], approvalRef: "fixture:read" }));
    await expect(readSourceFile(input, output, {}, request)).rejects.toThrow("disabled");
    expect(request).not.toHaveBeenCalled();
    const env = { LEAN_MULLY_SOURCE_READ_APPROVED: "true", LEAN_MULLY_SOURCE_READ_KEY: "fixture-key",
      LEAN_MULLY_SOURCE_PROJECT_REF: projectRef, LEAN_SHOPIFY_SHOP_DOMAIN: shop };
    expect(await readSourceFile(input, output, env, request)).toMatchObject({ state: "snapshot_only", enabled: false, customers: 1 });
    expect(statSync(output).mode & 0o777).toBe(0o600);
    expect(readFileSync(output, "utf8")).not.toContain("fixture-key");
    const snapshot = JSON.parse(readFileSync(output, "utf8"));
    const preparedInput = join(dir, "refresh.json");
    writeFileSync(preparedInput, JSON.stringify({ kind: "mully-source-v1", refresh: refreshFixture(),
      source: { snapshot, orders, mappingVersion: "identity-v1", permissions: [] },
      binding: { sourceId: "mully-source", schemaVersion: "mully-v1", approvalRef: "fixture:source", maxAgeSeconds: 86400 } }));
    vi.stubGlobal("fetch", () => { throw new Error("network_forbidden"); });
    expect(prepareFile(preparedInput, join(dir, "prepared"))).toMatchObject({ state: "prepared_only", registered: false });
    await expect(readSourceFile(input, output, env, request)).rejects.toThrow("file_budget");
    expect(request).toHaveBeenCalledTimes(1);
  } finally { rmSync(dir, { recursive: true, force: true }); }
}, 30000);
