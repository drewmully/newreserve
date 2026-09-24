import { expect, it, vi } from "vitest";
import { readSmsMetadata } from "@/lib/analytics/smsSource";
import { evidenceDigest } from "@/lib/analytics/evidenceIntake";

const scope = { projectRef: "a".repeat(20), shop: "fixture.myshopify.com",
  from: "2026-03-01T00:00:00Z", until: "2026-03-02T00:00:00Z",
  capturedAt: "2026-03-02T01:00:00Z", maxRows: 100 };
const row = { id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
  contact_id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
  direction: "inbound", service: "SMS", created_at: "2026-03-01T12:00:00+00:00" };
const response = (rows: unknown = [row], range = "0-0/1") =>
  Response.json(rows, { headers: { "Content-Range": range } });

it("reads a fixed metadata projection from only the approved SMS project and time window", async () => {
  const request = vi.fn<typeof fetch>(async () => response());
  const snapshot = await readSmsMetadata(scope, "fixture", request);
  const url = new URL(String(request.mock.calls[0][0]));
  expect(url.origin).toBe(`https://${scope.projectRef}.supabase.co`);
  expect(url.pathname).toBe("/rest/v1/messages");
  expect(url.searchParams.get("select")).toBe("id,contact_id,direction,service,created_at");
  expect(url.searchParams.getAll("created_at")).toEqual([`gte.${scope.from}`, `lt.${scope.until}`]);
  expect(url.searchParams.get("direction")).toBe("eq.inbound");
  expect(url.searchParams.get("limit")).toBe("101");
  expect(request.mock.calls[0][1]).toMatchObject({ method: "GET", redirect: "error" });
  expect(snapshot.messages).toEqual([{ messageId: row.id, contactId: row.contact_id,
    service: "SMS", recordedAt: "2026-03-01T12:00:00Z" }]);
  expect(snapshot).toMatchObject({ timestampBasis: "database_created_at",
    sourceCompleteness: "not_verified", sessionLinkage: "not_verified", analyticsPermission: "not_verified" });
  const { digest, ...payload } = snapshot;
  expect(digest).toBe(evidenceDigest(payload));
  expect(snapshot).not.toHaveProperty("events");
  expect(snapshot).not.toHaveProperty("currentlyPermitted");
});
it("keeps a complete empty response distinct from historical or activation completeness", async () => {
  const snapshot = await readSmsMetadata(scope, "fixture", async () => response([], "*/0"));
  expect(snapshot.messages).toEqual([]);
  expect(snapshot.sourceCompleteness).toBe("not_verified");
});
it.each([
  ["row cap", [row], "0-0/2", "truncated"],
  ["unknown total", [row], "0-0/*", "truncated"],
  ["empty partial", [], "*/3", "truncated"],
  ["outbound", [{ ...row, direction: "outbound" }], "0-0/1", "shape"],
  ["message content returned", [{ ...row, content: "private" }], "0-0/1", "shape"],
  ["missing contact", [{ ...row, contact_id: null }], "0-0/1", "shape"],
  ["invalid id", [{ ...row, id: "invalid" }], "0-0/1", "shape"],
  ["invalid service", [{ ...row, service: "email" }], "0-0/1", "shape"],
  ["bad timestamp", [{ ...row, created_at: "bad" }], "0-0/1", "timestamp"],
  ["outside window", [{ ...row, created_at: scope.until }], "0-0/1", "window"],
  ["duplicate", [row, row], "0-1/2", "duplicate"],
  ["case duplicate", [row, { ...row, id: row.id.toUpperCase() }], "0-1/2", "duplicate"],
])("rejects %s", async (_, rows, range, error) => {
  await expect(readSmsMetadata(scope, "fixture", async () => response(rows, String(range))))
    .rejects.toThrow(String(error));
});
it("rejects invalid targets, windows, budgets and credentials before I/O", async () => {
  const request = vi.fn();
  for (const override of [{ maxRows: 0 }, { maxRows: 1001 }, { projectRef: "bad" },
    { shop: "evil.example" }, { from: scope.until }, { until: "2027-01-01T00:00:00Z" },
    { from: "2025-01-01T00:00:00Z" }])
    await expect(readSmsMetadata({ ...scope, ...override }, "fixture", request)).rejects.toThrow();
  await expect(readSmsMetadata(scope, "", request)).rejects.toThrow();
  expect(request).not.toHaveBeenCalled();
});
it("rejects over-budget rows and response bytes without returning partial snapshots", async () => {
  await expect(readSmsMetadata({ ...scope, maxRows: 1 }, "fixture",
    async () => response([row, row], "0-1/2"))).rejects.toThrow("row_budget");
  await expect(readSmsMetadata(scope, "fixture", async () => new Response("x".repeat(500001))))
    .rejects.toThrow("byte_budget");
});
it("does not retry or disclose vendor/network failures", async () => {
  for (const request of [
    vi.fn(async () => new Response("private error", { status: 403 })),
    vi.fn(async () => { throw new Error("private transport"); }),
    vi.fn(async () => new Response(new ReadableStream({
      start(controller) { controller.error(new Error("private stream")); },
    }))),
  ]) {
    await expect(readSmsMetadata(scope, "fixture", request)).rejects.toThrow("sms_source_unavailable");
    expect(request).toHaveBeenCalledTimes(1);
  }
});
it("does not preserve unknown configuration fields in a snapshot", async () => {
  const input = { ...scope, phone: "must-not-persist" };
  const snapshot = await readSmsMetadata(input, "fixture", async () => response());
  expect(JSON.stringify(snapshot)).not.toContain("must-not-persist");
});
