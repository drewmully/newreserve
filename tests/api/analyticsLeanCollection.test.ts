import { expect, it, vi } from "vitest";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { collectRefresh, type CollectRefreshInput } from "@/lib/analytics/collectRefresh";
import { evidenceDigest, evidenceSections } from "@/lib/analytics/evidenceIntake";
import { signCheckoutContext } from "@/lib/analytics/checkout-context";
import { prepareRefresh } from "@/lib/analytics/refreshPlan";
import { refreshFixture } from "../fixtures/analyticsRefresh";
import { prepareCollectedFile, prepareFile } from "../../scripts/analytics/prepare-refresh.mjs";

const startedAt = "2026-09-24T19:00:01.000Z", finishedAt = "2026-09-24T19:00:02.000Z";
const env = { NODE_ENV: "test" as const, LEAN_REFRESH_SOURCE_COLLECTION_APPROVED: "true",
  LEAN_MULLY_SOURCE_READ_APPROVED: "true", LEAN_MULLY_SOURCE_PROJECT_REF: "a".repeat(20),
  LEAN_SHOPIFY_SHOP_DOMAIN: "fixture.myshopify.com", LEAN_MULLY_SOURCE_READ_KEY: "scoped-supabase-key",
  LEAN_SHOPIFY_ANALYTICS_READ_TOKEN: "scoped-shopify-key",
  LEAN_CHECKOUT_CONTEXT_SECRET: "local-fixture-secret".repeat(3), LEAN_POSTHOG_PROJECT_ID: "353503" };
const clock = () => vi.fn<() => string>().mockReturnValueOnce(startedAt).mockReturnValue(finishedAt);
function input(): CollectRefreshInput {
  const refresh = refreshFixture(), asOf = "2026-09-24T19:00:00.000Z";
  refresh.policy.asOf = refresh.intake.asOf = refresh.readyAt = asOf;
  refresh.expiresAt = "2026-09-24T19:30:00.000Z";
  refresh.intake.packets.forEach(p => { p.capturedAt = asOf; });
  return { kind: "mully-collect-v1", refresh,
    collection: { approvalRef: "fixture:read-approval", projectRef: env.LEAN_MULLY_SOURCE_PROJECT_REF,
      shop: env.LEAN_SHOPIFY_SHOP_DOMAIN, orderIds: ["gid://shopify/Order/1"], entities: ["mully"],
      checkout: true, maxOrders: 10, maxLinePages: 2, maxRequests: 8, maxBytes: 1000000, timeoutMs: 10000,
      binding: { sourceId: "fresh-source", schemaVersion: "collected-v1", maxAgeSeconds: 3600 } } };
}
const order = () => ({ id: "gid://shopify/Order/1", customer: { id: "gid://shopify/Customer/123" },
  cartToken: "cart_fixture", createdAt: "2026-01-01T11:10:00Z", updatedAt: "2026-01-01T12:00:00Z",
  lineItems: { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } } });
function receipt(cartToken = "cart_fixture") {
  const capturedAt = "2026-01-01T11:00:00Z", sessionId = "11111111-1111-4111-8111-111111111111";
  return { cartToken, capturedAt, subjectId: "subject_fixture", sessionId,
    posthogProject: env.LEAN_POSTHOG_PROJECT_ID, validFrom: "2026-01-01T10:00:00Z",
    expiresAt: "2026-01-01T12:00:00Z", revokedAt: null, permissionEvidenceRef: "fixture:authority",
    contextToken: signCheckoutContext({ project: env.LEAN_POSTHOG_PROJECT_ID, shop: env.LEAN_SHOPIFY_SHOP_DOMAIN,
      checkoutId: cartToken, sessionId, serverSubject: "subject_fixture", analyticsPermitted: true,
      now: Date.parse(capturedAt) / 1000, ttlSeconds: 3600 }, env.LEAN_CHECKOUT_CONTEXT_SECRET)! };
}
function transport(options: { doc?: ReturnType<typeof order>; carts?: unknown[]; drafts?: unknown[] } = {}) {
  return vi.fn<typeof fetch>(async (url, init) => {
    const u = new URL(String(url));
    expect(init?.redirect).toBe("error");
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    if (u.hostname.endsWith(".myshopify.com")) {
      expect(init?.headers).toMatchObject({ "X-Shopify-Access-Token": env.LEAN_SHOPIFY_ANALYTICS_READ_TOKEN });
      const query = JSON.parse(String(init?.body)).query;
      expect(query).not.toMatch(/\bmutation\b/);
      return Response.json({ data: query.includes("LeanDraftRelations") ? {
        nodes: [{ __typename: "DraftOrder", id: "gid://shopify/DraftOrder/100", status: "COMPLETED",
          completedAt: "2026-01-01T11:10:00Z", order: { id: "gid://shopify/Order/1" } }],
      } : { order: options.doc ?? order() } }, { headers: { "X-Shopify-API-Version": "2026-07" } });
    }
    expect(init?.headers).toMatchObject({ apikey: env.LEAN_MULLY_SOURCE_READ_KEY });
    if (u.pathname.endsWith("/customers"))
      return Response.json([{ id: "123", firebase_uid: "current_uid", entity: "mully",
        created_at: "2025-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z" }],
      { headers: { "Content-Range": "0-0/1" } });
    if (u.pathname.endsWith("lean_checkout_receipts_read")) return Response.json(options.carts ?? []);
    if (u.pathname.endsWith("lean_draft_receipts_read")) return Response.json(options.drafts ?? []);
    throw new Error("unexpected_network_target");
  });
}
it("collects through existing adapters into the real refresh graph without inventing independent evidence", async () => {
  const i = input(), prior = structuredClone(i), request = transport({ carts: [receipt()] });
  const out = await collectRefresh(i, env, request, clock());
  expect(request).toHaveBeenCalledTimes(4); // order page, revision recheck, customers, receipts
  expect(out.audit).toMatchObject({ calls: 4, collectedSections: ["orderIdentities", "checkout"],
    completePurchaseHistory: false, independentlyReconciled: false, registered: false, enabled: false });
  expect(out.audit.bytes).toBeGreaterThan(0);
  expect(out.bundle.full.evidence.orderIdentities).toHaveLength(1);
  expect(out.bundle.full.evidence.checkout).toHaveLength(1);
  expect(out.sources.snapshot.customers[0].firebaseUid).toBe("current_uid");
  for (const packet of prior.refresh.intake.packets.filter(p => !out.audit.collectedSections.includes(p.section)))
    expect(out.refresh.intake.packets.find(p => p.section === packet.section)).toEqual(packet);
  expect(out.bundle.full.evidence.identity).not.toEqual(expect.arrayContaining([
    expect.objectContaining({ identifier: "current_uid" }),
  ]));
  expect(out.refresh.intake.asOf).toBe(finishedAt);
  expect(out.refresh.readyAt).toBe(finishedAt);
  expect(out.refresh.expiresAt).toBe(prior.refresh.expiresAt);
  expect(out.refresh.intake.packets.find(p => p.section === "orderIdentities")?.capturedAt).toBe(startedAt);
  expect(prepareRefresh(out.refresh)).toEqual(out.bundle);
  expect(i).toEqual(prior);
  expect(JSON.stringify(out)).not.toMatch(/scoped-supabase-key|scoped-shopify-key|local-fixture-secret/);
});
it("fills absent adapter-owned sections while requiring every retained section", async () => {
  const i = input();
  i.refresh.intake.packets = i.refresh.intake.packets.filter(p => !["orderIdentities", "checkout"].includes(p.section));
  const out = await collectRefresh(i, env, transport(), clock());
  expect(out.refresh.intake.packets).toHaveLength(evidenceSections.length);
  expect(out.bundle.full.evidence.checkout).toEqual([]); // absence remains missing, not inferred
});
it("leaves checkout evidence untouched when the checkout read is explicitly off", async () => {
  const i = input(); i.collection.checkout = false;
  const request = transport(), out = await collectRefresh(i, env, request, clock());
  expect(request).toHaveBeenCalledTimes(3);
  expect(out.refresh.intake.packets.find(p => p.section === "checkout"))
    .toEqual(i.refresh.intake.packets.find(p => p.section === "checkout"));
});
it("assembles explicit draft-to-order relations via the existing read-only Shopify query", async () => {
  const i = input(); i.collection.checkout = false;
  i.collection.draftJourney = { from: "2026-01-01T00:00:00Z", until: "2026-01-02T00:00:00Z" };
  const request = transport({ drafts: [{ ...receipt("draft_100"), draftId: "100" }] });
  const out = await collectRefresh(i, env, request, clock());
  expect(request).toHaveBeenCalledTimes(5);
  expect(out.bundle.full.evidence.checkout[0].evidenceRef).toMatch(/^draft-relation:sha256:/);
});
it.each([
  ["collection approval", { LEAN_REFRESH_SOURCE_COLLECTION_APPROVED: "false" }, "disabled"],
  ["source approval", { LEAN_MULLY_SOURCE_READ_APPROVED: "false" }, "disabled"],
  ["project", { LEAN_MULLY_SOURCE_PROJECT_REF: "b".repeat(20) }, "target"],
  ["shop", { LEAN_SHOPIFY_SHOP_DOMAIN: "another.myshopify.com" }, "target"],
  ["source key", { LEAN_MULLY_SOURCE_READ_KEY: "", SUPABASE_SERVICE_ROLE_KEY: "no-fallback" }, "credentials"],
  ["shopify key", { LEAN_SHOPIFY_ANALYTICS_READ_TOKEN: "", SHOPIFY_ADMIN_ACCESS_TOKEN: "no-fallback" }, "credentials"],
  ["checkout key", { LEAN_CHECKOUT_CONTEXT_SECRET: "" }, "configuration"],
  ["posthog target", { LEAN_POSTHOG_PROJECT_ID: "1234" }, "configuration"],
])("rejects unapproved %s without any request", async (_, changed, error) => {
  const request = transport();
  await expect(collectRefresh(input(), { ...env, ...changed }, request, clock())).rejects.toThrow(error);
  expect(request).not.toHaveBeenCalled();
});
it.each([
  ["max orders", { maxOrders: 0 }], ["line pages", { maxLinePages: 21 }],
  ["read count", { maxRequests: 2 }], ["byte count", { maxBytes: 8000001 }],
  ["deadline", { timeoutMs: 120001 }], ["implicit checkout", { checkout: undefined }],
  ["duplicates", { orderIds: ["gid://shopify/Order/1", "gid://shopify/Order/1"] }],
  ["empty inventory", { orderIds: [] }],
  ["entity", { entities: ["mully)"] }],
])("requires a bounded plan for %s before any request", async (_, changed) => {
  const i = input(); Object.assign(i.collection, changed);
  const request = transport();
  await expect(collectRefresh(i, env, request, clock())).rejects.toThrow("budget");
  expect(request).not.toHaveBeenCalled();
});
it.each(["proofs", "externalControls", "dateCoverage", "cohortCoverage", "identity", "currentlyPermitted",
  "removedCustomers", "customerHistory", "sessionCoverage"] as const)("cannot manufacture missing %s", async section => {
  const i = input(); i.refresh.intake.packets = i.refresh.intake.packets.filter(p => p.section !== section);
  const request = transport();
  await expect(collectRefresh(i, env, request, clock())).rejects.toThrow("missing_evidence_section");
  expect(request).not.toHaveBeenCalled();
});
it.each(["stale", "future", "tampered", "same-source-control", "outlives"])(
  "rejects %s retained evidence before any source calls", async issue => {
    const i = input(), packet = i.refresh.intake.packets.find(p => p.section === "proofs")!;
    if (issue === "stale") packet.capturedAt = "2026-09-23T19:00:00Z";
    if (issue === "future") packet.capturedAt = "2026-09-25T19:00:00Z";
    if (issue === "tampered") packet.sha256 = "changed";
    if (issue === "same-source-control") i.refresh.intake.bindings[0].independentControlSource = false;
    if (issue === "outlives") packet.capturedAt = "2026-09-24T18:00:02Z";
    const request = transport();
    await expect(collectRefresh(i, env, request, clock())).rejects.toThrow();
    expect(request).not.toHaveBeenCalled();
  });
it("does not refresh a stale purchase history by recapturing a current customer row", async () => {
  const i = input(), h = i.refresh.intake.packets.find(p => p.section === "customerHistory")!;
  h.capturedAt = "2025-01-01T00:00:00Z";
  const request = transport();
  await expect(collectRefresh(i, env, request, clock())).rejects.toThrow("stale");
  expect(request).not.toHaveBeenCalled();
});
it.each(["envelope", "collection", "refresh"])("rejects unsupported originalPurchases in %s before reads", async place => {
  const i = input();
  Object.assign(place === "envelope" ? i : place === "collection" ? i.collection : i.refresh,
    { originalPurchases: [] });
  const request = transport();
  await expect(collectRefresh(i, env, request, clock())).rejects.toThrow("reviewed_replacement_packet");
  expect(request).not.toHaveBeenCalled();
});
it("rejects unknown collection options and injected draft capture time instead of ignoring or relabeling", async () => {
  for (const extra of [{ url: "https://forbidden.invalid" },
    { draftJourney: { from: "2026-01-01T00:00:00Z", until: "2026-01-02T00:00:00Z", capturedAt: "2025-01-01T00:00:00Z" } }]) {
    const i = input(); Object.assign(i.collection, extra);
    const request = transport();
    await expect(collectRefresh(i, env, request, clock())).rejects.toThrow("unsupported_collection_option");
    expect(request).not.toHaveBeenCalled();
  }
});
it("fails the total byte budget without retrying or using the prior order packet", async () => {
  const i = input(); i.collection.maxBytes = 1024;
  const request = vi.fn<typeof fetch>(async () => new Response("x".repeat(1025), {
    headers: { "X-Shopify-API-Version": "2026-07" },
  }));
  await expect(collectRefresh(i, env, request, clock())).rejects.toThrow();
  expect(request).toHaveBeenCalledTimes(1);
});
it("rejects changed orders, throttling and network failures without fallback or retry", async () => {
  for (const mode of ["changed", "throttled", "network"]) {
    const good = transport(); let calls = 0;
    const request = vi.fn<typeof fetch>(async (url, init) => {
      calls++;
      if (mode === "network") throw new Error("synthetic failure");
      if (mode === "throttled") return new Response("", { status: 429 });
      if (calls === 2) return Response.json({ data: { order: { ...order(), updatedAt: "2026-02-01T00:00:00Z" } } },
        { headers: { "X-Shopify-API-Version": "2026-07" } });
      return good(url, init);
    });
    await expect(collectRefresh(input(), env, request, clock())).rejects.toThrow();
    expect(request).toHaveBeenCalledTimes(mode === "changed" ? 2 : 1);
  }
});
it("rejects an expired, exhausted or backwards capture clock rather than relabeling source time", async () => {
  for (const finish of ["2026-09-24T19:31:00Z", "2026-09-24T19:00:30Z", "2026-09-24T18:59:59Z"])
    await expect(collectRefresh(input(), env, transport(), vi.fn<() => string>()
      .mockReturnValueOnce(startedAt).mockReturnValue(finish))).rejects.toThrow("timeout");
});
it("passes a live cumulative deadline to the transport and stops after an abort", async () => {
  const i = input(); i.collection.timeoutMs = 10;
  const request = vi.fn<typeof fetch>(async (_, init) => new Promise((_, reject) => {
    init!.signal!.addEventListener("abort", () => reject(new Error("synthetic_abort")), { once: true });
  }));
  await expect(collectRefresh(i, env, request, clock())).rejects.toThrow("transport_failed");
  expect(request).toHaveBeenCalledTimes(1);
});
it("uses cumulative bytes across responses, not only a per-request allowance", async () => {
  const i = input(), carts = [receipt()], request = transport({ carts });
  const measured = await collectRefresh(i, env, request, clock());
  i.collection.maxBytes = Math.max(1024, measured.audit.bytes - 1);
  expect(measured.audit.bytes).toBeGreaterThan(1024);
  await expect(collectRefresh(i, env, transport({ carts }), clock())).rejects.toThrow("byte_budget");
});
it("validates withdrawal conflicts without treating a fresh customer as permission", async () => {
  const i = input();
  for (const section of ["currentlyPermitted", "removedCustomers"]) {
    const p = i.refresh.intake.packets.find(p => p.section === section)!;
    p.payload = ["same-customer"]; p.sha256 = evidenceDigest(p.payload);
  }
  const request = transport();
  await expect(collectRefresh(i, env, request, clock())).rejects.toThrow("permission_removal_conflict");
  expect(request).not.toHaveBeenCalled();
});
it("runs the real preparation command with synthetic reads and private replayable output only", async () => {
  const dir = mkdtempSync(join(tmpdir(), "collection-cli-"));
  try {
    const path = join(dir, "input.json"), output = join(dir, "prepared"), request = transport();
    writeFileSync(path, JSON.stringify(input()));
    expect(() => prepareFile(path, output)).toThrow("explicit_flag");
    await expect(prepareCollectedFile(path, output, { NODE_ENV: "test" }, request, clock())).rejects.toThrow("disabled");
    expect(request).not.toHaveBeenCalled();
    expect(await prepareCollectedFile(path, output, env, request, clock())).toMatchObject({
      state: "prepared_only", calls: 4, enabled: false, registered: false,
    });
    expect(statSync(output).mode & 0o777).toBe(0o700);
    expect(readdirSync(output)).toHaveLength(5);
    for (const name of readdirSync(output)) {
      expect(statSync(join(output, name)).mode & 0o777).toBe(0o600);
      expect(readFileSync(join(output, name), "utf8")).not.toMatch(/scoped-supabase-key|scoped-shopify-key/);
    }
    const replay = JSON.parse(readFileSync(join(output, "refresh-input.json"), "utf8"));
    expect(prepareRefresh(replay)).toEqual(JSON.parse(readFileSync(join(output, "refresh-bundle.json"), "utf8")));
    await expect(prepareCollectedFile(path, output, env, request, clock())).rejects.toThrow("file_budget");
    expect(request).toHaveBeenCalledTimes(4);
  } finally { rmSync(dir, { recursive: true, force: true }); }
}, 30000);
it("publishes no output directory or partial bundle when collection fails", async () => {
  const dir = mkdtempSync(join(tmpdir(), "collection-cli-fail-"));
  try {
    const path = join(dir, "input.json"), output = join(dir, "prepared");
    writeFileSync(path, JSON.stringify(input()));
    const request = vi.fn<typeof fetch>(async () => new Response("", { status: 403 }));
    await expect(prepareCollectedFile(path, output, env, request, clock())).rejects.toThrow();
    expect(existsSync(output)).toBe(false);
    expect(readdirSync(dir)).toEqual(["input.json"]);
    expect(request).toHaveBeenCalledTimes(1);
  } finally { rmSync(dir, { recursive: true, force: true }); }
}, 30000);
