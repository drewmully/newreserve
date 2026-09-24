import { evidenceDigest } from "./evidenceIntake";
import { nyDate } from "./primitives";
import { shopifyId, sourceArray, sourceObject, sourceString } from "./shopifySource";
import type { HistoryOrder } from "./shopifyHistory";

export type InventoryWindow = { from: string; until: string; pageSize: number; maxPages: number;
  scanBasis?: "created_at" | "updated_at" };
export type HistoryInventory = {
  version: 1; projectRef: string; shop: string; approvalRef: string; capturedAt: string;
  windows: (InventoryWindow & { pages: { cursor: string | null; nextCursor: string | null; orders: HistoryOrder[] }[] })[];
  orders: HistoryOrder[]; digest: string;
};
const normalizedWindow = (w: InventoryWindow) => ({ from: new Date(w.from).toISOString(),
  until: new Date(w.until).toISOString(), pageSize: w.pageSize, maxPages: w.maxPages,
  scanBasis: w.scanBasis ?? "created_at" });
export function inventoryOrder(value: unknown): HistoryOrder {
  const row = sourceObject(value), id = sourceString(row.id); shopifyId(id, "Order");
  const created = sourceString(row.createdAt), updated = sourceString(row.updatedAt);
  nyDate(created); nyDate(updated);
  if (Date.parse(updated) < Date.parse(created)) throw new Error("inventory_revision_invalid");
  return { id, createdAt: new Date(created).toISOString(), updatedAt: new Date(updated).toISOString() };
}
/** A digest seals observed inventory, NOT completeness or independent authority. */
export function validateHistoryInventory(value: unknown, scope: {
  projectRef: string; shop: string; asOf?: string; history?: InventoryWindow[];
}): HistoryInventory {
  const raw = sourceObject(value), { digest, ...payload } = raw;
  if (raw.version !== 1 || raw.projectRef !== scope.projectRef || raw.shop !== scope.shop ||
      typeof raw.approvalRef !== "string" || !raw.approvalRef.trim() ||
      digest !== evidenceDigest(payload)) throw new Error("inventory_scope_or_digest");
  nyDate(sourceString(raw.capturedAt));
  if (scope.asOf && Date.parse(String(raw.capturedAt)) > Date.parse(scope.asOf))
    throw new Error("inventory_capture_future");
  const windows = sourceArray(raw.windows);
  if (!windows.length || windows.length > 5) throw new Error("inventory_window_budget");
  let reservedPages = 0, reservedRows = 0, rows = 0;
  const selected = new Map<string, HistoryOrder>();
  for (const value of windows) {
    const w = sourceObject(value) as HistoryInventory["windows"][number];
    nyDate(w.from); nyDate(w.until);
    if (Date.parse(w.from) >= Date.parse(w.until) || Date.parse(w.until) > Date.parse(String(raw.capturedAt)) ||
        !Number.isSafeInteger(w.pageSize) || w.pageSize < 1 || w.pageSize > 5 ||
        !Number.isSafeInteger(w.maxPages) || w.maxPages < 1 ||
        !["created_at", "updated_at"].includes(w.scanBasis ?? "created_at"))
      throw new Error("inventory_window_invalid");
    reservedPages += w.maxPages; reservedRows += w.maxPages * w.pageSize;
    const pages = sourceArray(w.pages), cursors = new Set<string>(), ids = new Set<string>();
    if (!pages.length || pages.length > w.maxPages) throw new Error("inventory_page_budget");
    let cursor: string | null = null, previous = -Infinity;
    for (let i = 0; i < pages.length; i++) {
      const page = sourceObject(pages[i]), orders = sourceArray(page.orders), next = page.nextCursor;
      if (page.cursor !== cursor || orders.length > w.pageSize ||
          (i === pages.length - 1 ? next !== null :
            typeof next !== "string" || !next || next.length > 4096 || cursors.has(next) || !orders.length))
        throw new Error("inventory_incomplete_or_cursor");
      if (typeof next === "string") cursors.add(next);
      cursor = next as string | null;
      for (const value of orders) {
        const order = inventoryOrder(value);
        const t = Date.parse(w.scanBasis === "updated_at" ? order.updatedAt : order.createdAt);
        if (ids.has(order.id) || t < previous || t < Date.parse(w.from) || t >= Date.parse(w.until) ||
            Date.parse(order.updatedAt) > Date.parse(String(raw.capturedAt)))
          throw new Error("inventory_order_scope");
        ids.add(order.id); previous = t; rows++;
        const prior = selected.get(order.id);
        if (prior && evidenceDigest(prior) !== evidenceDigest(order)) throw new Error("inventory_revision_conflict");
        selected.set(order.id, order);
      }
    }
  }
  const expected = [...selected.values()].sort((a, b) => a.id.localeCompare(b.id));
  if (reservedPages > 25 || reservedRows > 100 || rows > 100 ||
      evidenceDigest(raw.orders) !== evidenceDigest(expected)) throw new Error("inventory_rows_or_budget");
  const scopes = windows.map(w => normalizedWindow(w as InventoryWindow));
  if (scope.history && evidenceDigest(scopes) !== evidenceDigest(scope.history.map(normalizedWindow)))
    throw new Error("inventory_history_mismatch");
  return raw as HistoryInventory;
}

/** Consumer fence runs before mapping or any publication write, including deferred orders. */
export function assertInventorySources(value: unknown, sources: unknown[], scope: { projectRef: string; shop: string }) {
  const inventory = validateHistoryInventory(value, scope), actual = new Map<string, HistoryOrder>();
  for (const item of sources) {
    const commerce = sourceObject(sourceObject(sourceObject(item).source).commerce);
    if (commerce.shop !== scope.shop) throw new Error("inventory_consumer_target");
    const order = inventoryOrder(commerce.order), prior = actual.get(order.id);
    if (prior && evidenceDigest(prior) !== evidenceDigest(order)) throw new Error("inventory_consumer_revision");
    actual.set(order.id, order);
  }
  if (evidenceDigest([...actual.values()].sort((a, b) => a.id.localeCompare(b.id))) !== evidenceDigest(inventory.orders))
    throw new Error("inventory_consumer_mismatch");
}
