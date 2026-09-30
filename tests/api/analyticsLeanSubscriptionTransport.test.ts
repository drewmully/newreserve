import { createHash } from "node:crypto";
import { afterEach, expect, it, vi } from "vitest";
import { createSubscriptionTransport, SUBSCRIPTION_SHOP } from "@/lib/analytics/subscriptionTransport";
import type { SubscriptionRead } from "@/lib/analytics/subscriptionCollection";
import { openSubscriptionCursor, sealSubscriptionCursor } from "@/lib/analytics/subscriptionScans";
const token = "fixture-only-read-token-not-real";
const config = () => ({ enabled: true, shop: SUBSCRIPTION_SHOP, token,
  tokenSha256: createHash("sha256").update(token).digest("hex"), bindingRef: "fixture:owner-binding" });
const request = (): SubscriptionRead => ({ method: "GET", path: "/admin/2026-04/subscription?pageSize=1",
  redirect: "error", signal: new AbortController().signal });
afterEach(() => vi.unstubAllGlobals());
it("is server-only and default-off, with zero network calls", async () => {
  const fetcher = vi.fn();
  await expect(createSubscriptionTransport({ ...config(), enabled: undefined }, fetcher)(request())).rejects.toThrow("disabled");
  expect(fetcher).not.toHaveBeenCalled();
  vi.stubGlobal("window", {});
  expect(() => createSubscriptionTransport(config(), fetcher)).toThrow("server_only");
});
it("uses only the approved fingerprint, exact host/version and X-Loop-Token GET header", async () => {
  const fetcher = vi.fn().mockResolvedValue(new Response("{}"));
  const c = config(), transport = createSubscriptionTransport(c, fetcher);
  c.token = "changed-after-construction";
  await transport(request());
  expect(fetcher).toHaveBeenCalledWith("https://api.loopsubscriptions.com/admin/2026-04/subscription?pageSize=1",
    expect.objectContaining({ method: "GET", redirect: "error", cache: "no-store",
      headers: { Accept: "application/json", "X-Loop-Token": token }, signal: expect.any(AbortSignal) }));
  expect(fetcher.mock.calls[0][1].body).toBeUndefined();
});
it.each([
  { shop: "other.myshopify.com" }, { tokenSha256: "a".repeat(64) },
  { token: "bad\r\nheader-value" }, { bindingRef: "" }, { token: "" },
])("rejects an unapproved source binding before network %j", change => {
  const fetcher = vi.fn();
  expect(() => createSubscriptionTransport({ ...config(), ...change }, fetcher)).toThrow("source_binding");
  expect(fetcher).not.toHaveBeenCalled();
});
it.each([
  "/admin/2023-10/subscription?pageSize=1", "/admin/2026-04/subscription/1/cancel",
  "https://api.loopsubscriptions.com/admin/2026-04/subscription?pageSize=1",
  "//evil.invalid/admin/2026-04/subscription?pageSize=1",
  "/admin/2026-04/subscription?pageSize=1&email=private",
  "/admin/2026-04/subscription?pageSize=1&pageSize=2",
  "/admin/2026-04/subscription?pageSize=101", "/admin/2026-04/subscription?pageSize=1#fragment",
  "/admin/2026-04/subscription?pageSize=1&afterCursor=",
])("refuses alternate endpoint, data filters or invalid bounds: %s", async path => {
  const fetcher = vi.fn(), transport = createSubscriptionTransport(config(), fetcher);
  await expect(transport({ ...request(), path })).rejects.toThrow("source_request");
  expect(fetcher).not.toHaveBeenCalled();
});
it("refuses writes/redirects and aborts before calling fetch", async () => {
  const fetcher = vi.fn(), transport = createSubscriptionTransport(config(), fetcher);
  for (const change of [{ method: "POST" }, { redirect: "follow" }])
    await expect(transport({ ...request(), ...change } as SubscriptionRead)).rejects.toThrow("source_request");
  const controller = new AbortController(); controller.abort();
  await expect(transport({ ...request(), signal: controller.signal })).rejects.toThrow("source_aborted");
  expect(fetcher).not.toHaveBeenCalled();
});
it("never forwards credential/provider exception text or causes", async () => {
  const error = await createSubscriptionTransport(config(), async () => { throw new Error(token); })(request()).catch(e => e);
  expect(error.message).toBe("subscription_source_unavailable");
  expect(error.cause).toBeUndefined();
  expect(error.stack).not.toContain(token);
});
it("cancels an error body without reading or retrying it", async () => {
  const cancel = vi.fn();
  const body = new ReadableStream({ cancel }, { highWaterMark: 0 });
  const fetcher = vi.fn(async () => new Response(body, { status: 429 }));
  await expect(createSubscriptionTransport(config(), fetcher)(request())).rejects.toThrow("source_unavailable");
  expect(cancel).toHaveBeenCalledTimes(1);
  expect(fetcher).toHaveBeenCalledTimes(1);
});
it("encrypts cursors with randomized, plan/cycle/page-bound authenticated ciphertext and stable private cycle detection", () => {
  const context = { projectRef: "a".repeat(20), planId: "fixture", cycle: 1, page: 2 }, cursor = "private-cursor";
  const first = sealSubscriptionCursor(token, cursor, context), second = sealSubscriptionCursor(token, cursor, context);
  expect(first.ciphertext).not.toEqual(second.ciphertext);
  expect(first.fingerprint).toEqual(second.fingerprint);
  expect(JSON.stringify(first)).not.toContain(cursor);
  expect(openSubscriptionCursor(token, first.ciphertext, first.fingerprint, context)).toBe(cursor);
  for (const changed of [{ ...context, projectRef: "b".repeat(20) }, { ...context, planId: "other" }, { ...context, cycle: 2 }, { ...context, page: 3 }])
    expect(() => openSubscriptionCursor(token, first.ciphertext, first.fingerprint, changed)).toThrow("cursor_unavailable");
  expect(() => openSubscriptionCursor("wrong-token-value", first.ciphertext, first.fingerprint, context)).toThrow("cursor_unavailable");
});
