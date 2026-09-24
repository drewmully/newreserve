import { evidenceDigest } from "@/lib/analytics/evidenceIntake";
import { inventoryOrder, type HistoryInventory } from "@/lib/analytics/historyInventory";
import type { CollectRefreshInput } from "@/lib/analytics/collectRefresh";
import { refreshFixture } from "./analyticsRefresh";

export const discoveryStart = "2026-09-24T19:00:01.000Z";
export const discoveryEnv = { NODE_ENV: "test" as const, LEAN_REFRESH_SOURCE_COLLECTION_APPROVED: "true",
  LEAN_MULLY_SOURCE_READ_APPROVED: "true", LEAN_MULLY_SOURCE_PROJECT_REF: "a".repeat(20),
  LEAN_SHOPIFY_SHOP_DOMAIN: "fixture.myshopify.com", LEAN_MULLY_SOURCE_READ_KEY: "synthetic-source",
  LEAN_SHOPIFY_ANALYTICS_READ_TOKEN: "synthetic-shopify" };
export function discoveryInput(): CollectRefreshInput {
  const refresh = refreshFixture();
  refresh.policy.asOf = refresh.intake.asOf = refresh.readyAt = discoveryStart;
  refresh.expiresAt = "2026-09-24T19:30:00.000Z";
  refresh.intake.packets.forEach(p => { p.capturedAt = discoveryStart; });
  refresh.history = [{ from: "2026-01-01T00:00:00Z", until: "2026-02-01T00:00:00Z", pageSize: 1, maxPages: 2 }];
  return { kind: "mully-collect-v1", refresh, collection: {
    approvalRef: "fixture:discovery", projectRef: discoveryEnv.LEAN_MULLY_SOURCE_PROJECT_REF,
    shop: discoveryEnv.LEAN_SHOPIFY_SHOP_DOMAIN, discover: true, entities: ["mully"], checkout: false,
    maxOrders: 4, maxLinePages: 2, maxRequests: 20, maxBytes: 1000000, timeoutMs: 10000,
    binding: { sourceId: "fresh-discovery", schemaVersion: "inventory-v1", maxAgeSeconds: 3600 },
  } };
}
export const discoveryOrder = (id = "1") => ({ id: `gid://shopify/Order/${id}`,
  createdAt: "2026-01-01T12:00:00Z", updatedAt: "2026-01-02T12:00:00Z",
  customer: null, cartToken: null, lineItems: { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } } });
export function inventoryFixture(rawOrders: unknown[] = [discoveryOrder()]): HistoryInventory {
  const orders = rawOrders.map(inventoryOrder).sort((a, b) => a.id.localeCompare(b.id));
  const payload = { version: 1 as const, projectRef: discoveryEnv.LEAN_MULLY_SOURCE_PROJECT_REF,
    shop: discoveryEnv.LEAN_SHOPIFY_SHOP_DOMAIN, approvalRef: "fixture:discovery", capturedAt: discoveryStart,
    windows: [{ from: "2026-01-01T00:00:00Z", until: "2026-02-01T00:00:00Z", pageSize: 5, maxPages: 1,
      pages: [{ cursor: null, nextCursor: null, orders }] }], orders };
  return { ...payload, digest: evidenceDigest(payload) };
}
