import { evidenceDigest } from "./evidenceIntake";
import { nyDate } from "./primitives";
import { shopifyShop } from "./shopifySource";

export type SmsReadScope = {
  projectRef: string; shop: string; from: string; until: string;
  capturedAt: string; maxRows: number;
};
export type SmsMessageMetadata = {
  messageId: string; contactId: string; service: string; recordedAt: string;
};
export type SmsMetadataSnapshot = SmsReadScope & {
  version: "sms-metadata-v1"; messages: SmsMessageMetadata[];
  timestampBasis: "database_created_at";
  sourceCompleteness: "not_verified";
  sessionLinkage: "not_verified"; analyticsPermission: "not_verified";
  digest: string;
};
const columns = "id,contact_id,direction,service,created_at";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Metadata-only acquisition from the existing SMS database. A successful read
 * proves only that this filtered response was not truncated. It does NOT prove
 * webhook completeness, first-ever inbound activation, website session linkage,
 * historical customer identity or analytics permission. Never emit a behavioral
 * event from these rows without those independent authorities.
 */
export async function readSmsMetadata(config: SmsReadScope, readKey: string,
  request: typeof fetch = fetch): Promise<SmsMetadataSnapshot> {
  const { projectRef, shop, from, until, capturedAt, maxRows } = config;
  shopifyShop(shop);
  [from, until, capturedAt].forEach(nyDate);
  if (!/^[a-z]{20}$/.test(projectRef) || !readKey.trim() ||
      !Number.isSafeInteger(maxRows) || maxRows < 1 || maxRows > 1000 ||
      Date.parse(from) >= Date.parse(until) || Date.parse(until) > Date.parse(capturedAt) ||
      Date.parse(until) - Date.parse(from) > 31 * 86400000)
    throw new Error("sms_source_scope");
  const url = new URL(`https://${projectRef}.supabase.co/rest/v1/messages`);
  url.searchParams.set("select", columns);
  url.searchParams.set("direction", "eq.inbound");
  url.searchParams.append("created_at", `gte.${from}`);
  url.searchParams.append("created_at", `lt.${until}`);
  url.searchParams.set("order", "created_at.asc,id.asc");
  url.searchParams.set("limit", String(maxRows + 1));
  let response: Response;
  try {
    response = await request(url.toString(), { method: "GET", redirect: "error",
      headers: { apikey: readKey, Authorization: `Bearer ${readKey}`,
        Prefer: "count=exact", "Accept-Profile": "public" },
      signal: AbortSignal.timeout(15000) });
  } catch { throw new Error("sms_source_unavailable"); }
  if (!response.ok) throw new Error("sms_source_unavailable");
  const stream = response.body?.getReader();
  if (!stream) throw new Error("sms_source_empty_response");
  const parts: Uint8Array[] = []; let bytes = 0;
  try {
    for (;;) {
      const part = await stream.read(); if (part.done) break;
      bytes += part.value.length;
      if (bytes > 500000) { await stream.cancel(); throw new Error("sms_source_byte_budget"); }
      parts.push(part.value);
    }
  } catch (error) {
    if (error instanceof Error && error.message === "sms_source_byte_budget") throw error;
    throw new Error("sms_source_unavailable");
  } finally { stream.releaseLock(); }
  let raw: unknown;
  try { raw = JSON.parse(Buffer.concat(parts).toString("utf8")); }
  catch { throw new Error("sms_source_shape"); }
  if (!Array.isArray(raw) || raw.length > maxRows) throw new Error("sms_source_row_budget");
  const range = response.headers.get("Content-Range");
  if (range !== (raw.length ? `0-${raw.length - 1}/${raw.length}` : "*/0"))
    throw new Error("sms_source_truncated");
  const ids = new Set<string>();
  const messages = raw.map((r): SmsMessageMetadata => {
    if (!r || typeof r !== "object" || Array.isArray(r) ||
        Object.keys(r).sort().join(",") !== columns.split(",").sort().join(",") ||
        typeof r.id !== "string" || !uuid.test(r.id) ||
        typeof r.contact_id !== "string" || !uuid.test(r.contact_id) ||
        r.direction !== "inbound" || !["iMessage", "SMS", "MMS", "RCS"].includes(r.service) ||
        typeof r.created_at !== "string")
      throw new Error("sms_source_shape");
    const messageId = r.id.toLowerCase(), contactId = r.contact_id.toLowerCase();
    if (ids.has(messageId)) throw new Error("sms_source_duplicate");
    ids.add(messageId);
    const recordedAt = r.created_at.replace(/\+00:00$/, "Z");
    nyDate(recordedAt);
    if (Date.parse(recordedAt) < Date.parse(from) || Date.parse(recordedAt) >= Date.parse(until))
      throw new Error("sms_source_window");
    return { messageId, contactId, service: r.service, recordedAt };
  }).sort((a, b) => a.recordedAt.localeCompare(b.recordedAt) || a.messageId.localeCompare(b.messageId));
  const payload = { projectRef, shop, from, until, capturedAt, maxRows,
    version: "sms-metadata-v1" as const, messages, timestampBasis: "database_created_at" as const,
    sourceCompleteness: "not_verified" as const, sessionLinkage: "not_verified" as const,
    analyticsPermission: "not_verified" as const };
  return { ...payload, digest: evidenceDigest(payload) };
}
