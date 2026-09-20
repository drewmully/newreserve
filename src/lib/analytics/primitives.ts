import { createHash } from "node:crypto";
import { validateRowShape } from "./validate-contract";
export type Row = Record<string, unknown>;
export function key(...parts: string[]): string {
  if (parts.some(p => !p)) throw new Error("missing_key_component");
  return createHash("sha256").update(JSON.stringify(parts)).digest("hex");
}
export function micros(value: string): bigint {
  if (!/^-?(0|[1-9]\d{0,13})(\.\d{1,6})?$/.test(value)) throw new Error("invalid_decimal");
  const negative = value.startsWith("-");
  const [whole, fraction = ""] = value.replace(/^-/, "").split(".");
  const amount = BigInt(whole) * BigInt(1000000) + BigInt(fraction.padEnd(6, "0"));
  return negative ? -amount : amount;
}
export function decimal(value: bigint): string {
  const abs = value < BigInt(0) ? -value : value;
  const s = `${value < BigInt(0) ? "-" : ""}${abs / BigInt(1000000)}.${String(abs % BigInt(1000000)).padStart(6, "0")}`;
  micros(s); // overflow is not silently rounded
  return s;
}
export function nyDate(timestamp: string): string {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?Z$/.test(timestamp) ||
      !Number.isFinite(Date.parse(timestamp)) ||
      new Date(timestamp).toISOString().slice(0, 10) !== timestamp.slice(0, 10)) throw new Error("invalid_timestamp");
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(timestamp));
}
export function checked(table: string, row: Row): Row {
  if (validateRowShape(table, row).length) throw new Error(`invalid_${table}_shape`);
  return row;
}
export type Page<T> = { rows: T[]; hasNextPage: boolean; endCursor: string | null };
export async function collectPages<T>(fetchPage: (cursor: string | null) => Promise<Page<T>>, maxPages: number): Promise<T[]> {
  if (!Number.isSafeInteger(maxPages) || maxPages < 1 || maxPages > 10000) throw new Error("invalid_page_bound");
  const seen = new Set<string>();
  const rows: T[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < maxPages; page++) {
    const result = await fetchPage(cursor);
    if (!Array.isArray(result.rows) || typeof result.hasNextPage !== "boolean") throw new Error("schema_drift");
    rows.push(...result.rows);
    if (!result.hasNextPage) return rows;
    if (!result.endCursor || seen.has(result.endCursor)) throw new Error("invalid_pagination");
    seen.add(result.endCursor); cursor = result.endCursor;
  }
  throw new Error("incomplete_pagination");
}
