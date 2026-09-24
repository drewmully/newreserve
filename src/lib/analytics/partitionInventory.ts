import { canonicalJson, evidenceDigest } from "./evidenceIntake";
import { assertInventorySources, inventoryOrder, validateHistoryInventory, type HistoryInventory } from "./historyInventory";
import { sourceArray, sourceObject, sourceString } from "./shopifySource";
import type { PilotSource } from "./shopifyPilotSource";
import { nyDate } from "./primitives";

export type PartitionRow = { source: PilotSource; evidenceRef: string; capturedAt: string };
export type PartitionPage = { child: string; number: number; payload: string };
export type PartitionInventory = {
  version: 1; projectRef: string; shop: string; approvalRef: string; capturedAt: string;
  expiresAt: string; maxBytes: number; evidenceDigest: string; owners: Record<string, string>;
  children: { id: string; inventory: HistoryInventory;
    pages: { number: number; rows: number; bytes: number; digest: string }[] }[];
  digest: string;
};
/** Each child retains the existing <=100/25 gates; a parent never certifies coverage. */
export function validatePartitionInventory(value: unknown, scope: { projectRef: string; shop: string; asOf?: string }) {
  const raw = sourceObject(value), { digest, ...body } = raw;
  if (raw.version !== 1 || raw.projectRef !== scope.projectRef || raw.shop !== scope.shop ||
      typeof raw.approvalRef !== "string" || !raw.approvalRef.trim() || digest !== evidenceDigest(body) ||
      !/^[a-f0-9]{64}$/.test(String(raw.evidenceDigest)) ||
      !Number.isSafeInteger(raw.maxBytes) || Number(raw.maxBytes) < 1024 || Number(raw.maxBytes) > 32000000)
    throw new Error("partition_manifest_scope");
  nyDate(sourceString(raw.capturedAt)); nyDate(sourceString(raw.expiresAt));
  if (Date.parse(String(raw.expiresAt)) <= Date.parse(String(raw.capturedAt)) ||
      scope.asOf && Date.parse(String(raw.capturedAt)) > Date.parse(scope.asOf))
    throw new Error("partition_manifest_clock");
  const children = sourceArray(raw.children), ids = new Set<string>(), global = new Map<string, unknown>();
  if (!children.length || children.length > 10) throw new Error("partition_child_budget");
  let rows = 0, bytes = 0;
  for (const value of children) {
    const child = sourceObject(value), id = sourceString(child.id);
    if (!/^[a-zA-Z0-9_-]{1,32}$/.test(id) || ids.has(id)) throw new Error("partition_child_identity");
    ids.add(id);
    const inventory = validateHistoryInventory(child.inventory, { ...scope, asOf: String(raw.capturedAt) });
    const pages = sourceArray(child.pages);
    if (!pages.length || pages.length > 20) throw new Error("partition_page_budget");
    let childRows = 0;
    for (const [index, value] of pages.entries()) {
      const page = sourceObject(value);
      if (page.number !== index || !Number.isSafeInteger(page.rows) || Number(page.rows) < 0 || Number(page.rows) > 5 ||
          !Number.isSafeInteger(page.bytes) || Number(page.bytes) < 2 || Number(page.bytes) > 4000000 ||
          !/^[a-f0-9]{64}$/.test(String(page.digest))) throw new Error("partition_page_manifest");
      childRows += Number(page.rows); bytes += Number(page.bytes);
    }
    if (childRows !== inventory.orders.length) throw new Error("partition_child_rows");
    rows += childRows;
    for (const order of inventory.orders) {
      const prior = global.get(order.id);
      if (prior && evidenceDigest(prior) !== evidenceDigest(order)) throw new Error("partition_inventory_conflict");
      global.set(order.id, order);
    }
  }
  if (rows > 1000 || bytes > Number(raw.maxBytes)) throw new Error("partition_parent_budget");
  const owners = sourceObject(raw.owners);
  if (Object.keys(owners).length !== global.size || [...global.keys()].some(id =>
    !children.some(c => sourceObject(c).id === owners[id] &&
      (sourceObject(sourceObject(c).inventory).orders as { id: string }[]).some(o => o.id === id))))
    throw new Error("partition_order_ownership");
  return raw as PartitionInventory;
}
export function makePartitionPages(child: string, rows: PartitionRow[]) {
  const pages: PartitionPage[] = [];
  for (let i = 0; i < Math.max(1, rows.length); i += 5)
    pages.push({ child, number: pages.length, payload: canonicalJson(rows.slice(i, i + 5)) });
  return pages;
}
/** Validate every child, then dedupe globally by full source content, not just ID.
 * Equal overlap is replay; a different revision or body is never last-write-wins. */
export function assemblePartitionPages(manifest: PartitionInventory, pages: PartitionPage[]) {
  validatePartitionInventory(manifest, manifest);
  if (pages.length !== manifest.children.reduce((n, c) => n + c.pages.length, 0))
    throw new Error("partition_missing_or_extra_page");
  const seen = new Set<string>(), selected = new Map<string, PartitionRow>();
  for (const child of manifest.children) {
    const rows: PartitionRow[] = [];
    for (const expected of child.pages) {
      const matching = pages.filter(p => p.child === child.id && p.number === expected.number);
      if (matching.length !== 1) throw new Error("partition_missing_or_extra_page");
      const page = matching[0], payload = sourceArray(JSON.parse(page.payload)) as PartitionRow[];
      if (Buffer.byteLength(page.payload) !== expected.bytes || payload.length !== expected.rows ||
          canonicalJson(payload) !== page.payload || evidenceDigest(payload) !== expected.digest)
        throw new Error("partition_page_digest");
      rows.push(...payload);
    }
    if (new Set(rows.map(r => r.source.commerce.order.id)).size !== rows.length)
      throw new Error("partition_duplicate_child_order");
    assertInventorySources(child.inventory, rows, manifest);
    for (const row of rows) {
      nyDate(row.capturedAt);
      if (!row.evidenceRef.trim() || row.evidenceRef !== `partition-source:sha256:${evidenceDigest(row.source)}` ||
          Date.parse(row.capturedAt) > Date.parse(manifest.capturedAt) ||
          Date.parse(row.capturedAt) < Date.parse(child.inventory.capturedAt))
        throw new Error("partition_source_capture");
      const id = inventoryOrder(row.source.commerce.order).id, prior = selected.get(id);
      if (prior && evidenceDigest(prior.source) !== evidenceDigest(row.source)) throw new Error("partition_source_conflict");
      if (!seen.has(id) || manifest.owners[id] === child.id) { selected.set(id, row); seen.add(id); }
    }
  }
  return [...selected.values()].sort((a, b) => String(a.source.commerce.order.id).localeCompare(String(b.source.commerce.order.id)));
}
