import { PGlite } from "@electric-sql/pglite";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { attachJourneyCart, attachJourneyDraft, captureJourney, journeyGrant, type JourneyRuntime } from "@/lib/analytics/journeyRuntime";
import { mapDraftJourney, readDraftJourney } from "@/lib/analytics/draftJourneySource";
import { evidenceDigest } from "@/lib/analytics/evidenceIntake";
import { mapJourneyCheckout, readJourneyReceipts } from "@/lib/analytics/journeySource";
import { mapJourneyPermissions, readJourneyPermissions } from "@/lib/analytics/journeyPermissions";
import { key } from "@/lib/analytics/primitives";
const project = "a".repeat(20), shop = "fixture.myshopify.com", token = "b".repeat(64);
const hash = createHash("sha256").update(token).digest("hex");
const session = "11111111-1111-4111-8111-111111111111";
const action = "22222222-2222-4222-8222-222222222222";
const secret = "fixture-context-secret".repeat(3);
const cart = "gid://shopify/Cart/cart_fixture?key=private_cart_key";
let db: PGlite, now: number;
const req = (extra: Record<string, string> = {}) => new Request("https://fixture.invalid/checkout", {
  headers: { cookie: `__Host-mully_analytics=${token}`, ...extra },
});
const rpc: JourneyRuntime["rpc"] = async (name, args) => {
  if (!["lean_journey_grant", "lean_journey_action", "lean_checkout_receipt", "lean_checkout_receipts_read",
    "lean_journey_permissions_read", "lean_draft_receipt", "lean_draft_receipts_read"].includes(name))
    throw new Error("unexpected_rpc");
  try {
    const pairs = Object.entries(args);
    const result = await db.query<{ value: unknown }>(
      `select public.${name}(${pairs.map(([key], i) => `${key}=>$${i + 1}`).join(",")}) value`,
      pairs.map(([, value]) => value));
    return { data: JSON.parse(JSON.stringify(result.rows[0].value)), error: null };
  } catch (error) { return { data: null, error }; }
};
const runtime = (): JourneyRuntime => ({
  env: { LEAN_ANALYTICS_JOURNEYS_ENABLED: "true", LEAN_ANALYTICS_PIPELINE_PROJECT_REF: project,
    LEAN_ANALYTICS_SUPABASE_URL: `https://${project}.supabase.co`,
    LEAN_SHOPIFY_SHOP_DOMAIN: shop, LEAN_POSTHOG_PROJECT_ID: "353503",
    LEAN_POSTHOG_CAPTURE_ORIGIN: "https://us.i.posthog.com", LEAN_POSTHOG_CAPTURE_KEY: "fixture",
    LEAN_CHECKOUT_CONTEXT_SECRET: secret, LEAN_SHOPIFY_STOREFRONT_TOKEN: "fixture" },
  now: Date.now, rpc,
  request: vi.fn(async url => String(url).includes("posthog") ? Response.json({ status: 1 })
    : Response.json({ data: { cart: { id: cart } } })),
});
beforeAll(async () => {
  db = new PGlite();
  await db.exec(`create schema lean_private; create role anon; create role authenticated; create role service_role; create role lean_posthog_reader;
    alter default privileges in schema public grant execute on functions to anon,authenticated,service_role;
    alter default privileges in schema lean_private grant all on tables to anon,authenticated,service_role;`);
  await db.exec(readFileSync("sql/analytics/026_journey_authority.sql", "utf8"));
  await db.exec(readFileSync("sql/analytics/031_draft_receipts.sql", "utf8"));
}, 30000);
beforeEach(async () => {
  now = Date.now();
  await db.exec("truncate lean_private.journey_grants cascade");
  await db.query(`insert into lean_private.journey_grants
    (token_hash,project_ref,posthog_project,shop,subject_id,session_id,valid_from,expires_at,permission_evidence_ref,approval_ref)
    values($1,$2,'353503',$3,'subject_fixture',$4,$5,$6,'fixture:permission','fixture:approved')`,
  [hash, project, shop, session, new Date(now - 10000).toISOString(), new Date(now + 3600000).toISOString()]);
});
afterAll(async () => db?.close());
it("looks up only an opaque authority token, with no client consent inference", async () => {
  expect(await journeyGrant(req(), undefined, runtime())).toMatchObject({ sessionId: session, subjectId: "subject_fixture" });
  const r = runtime(); r.rpc = vi.fn(r.rpc);
  expect(await journeyGrant(new Request("https://fixture.invalid", {
    headers: { cookie: "analytics_permitted=true; firebase_uid=subject_fixture" },
  }), undefined, r)).toBeNull();
  expect(r.rpc).not.toHaveBeenCalled();
});
it("links draft checkouts only through the vendor's explicit completed order relation", async () => {
  const r = runtime();
  expect(await attachJourneyDraft(req(), "100", shop, "verified_uid", r)).toBe(true);
  expect(r.request).not.toHaveBeenCalled();
  const at = new Date(Date.now() + 1000).toISOString(), created = new Date(now + 500).toISOString();
  // The DB uses real server time; use a past-bound read upper limit after capture.
  const until = new Date().toISOString();
  const transport: typeof fetch = vi.fn(async (url, init) => {
    if (String(url).includes("supabase")) {
      const result = await rpc("lean_draft_receipts_read", JSON.parse(String(init?.body)));
      expect(result.error).toBeNull(); return Response.json(result.data);
    }
    const query = JSON.parse(String(init?.body));
    expect(query.query).not.toContain("mutation");
    expect(query.variables.ids).toEqual(["gid://shopify/DraftOrder/100"]);
    return Response.json({ data: { nodes: [{ __typename: "DraftOrder", id: "gid://shopify/DraftOrder/100",
      status: "COMPLETED", completedAt: created, order: { id: "gid://shopify/Order/1" } }] } },
    { headers: { "X-Shopify-API-Version": "2026-07" } });
  });
  const snapshot = await readDraftJourney({ projectRef: project, shop, from: new Date(now - 10000).toISOString(),
    until, capturedAt: at }, "fixture", "fixture", transport);
  const orders = [{ shop, apiVersion: "2026-07" as const, order: {
    id: "gid://shopify/Order/1", createdAt: created, cartToken: null,
  } }];
  const config = { projectRef: project, shop, posthogProject: "353503", sessionVersion: "v1", asOf: at };
  expect(mapDraftJourney(orders, snapshot, config, secret)).toMatchObject([{
    orderId: key(shop, "1"), sessionKey: key("353503", "v1", session),
    evidenceRef: expect.stringMatching(/^draft-relation:sha256:/),
  }]);
  expect(mapDraftJourney([], snapshot, config, secret)).toEqual([]);
  expect(() => mapDraftJourney(orders, snapshot, config, "wrong".repeat(10))).toThrow("invalid_context");
  expect(() => mapDraftJourney(orders, { ...snapshot, shop: "wrong.myshopify.com" }, config, secret)).toThrow();
  const { digest: _digest, ...revoked } = snapshot;
  void _digest;
  revoked.receipts = revoked.receipts.map(row => ({ ...row, revokedAt: at }));
  expect(mapDraftJourney(orders, { ...revoked, digest: evidenceDigest(revoked) }, config, secret)).toEqual([]);
});
it("refuses guessed draft identities and permanently fences a draft reused across grants", async () => {
  const r = runtime();
  expect(await attachJourneyDraft(req(), "gid://shopify/DraftOrder/100", shop, "uid", r)).toBe(false);
  expect(await attachJourneyDraft(req(), "100", "wrong.myshopify.com", "uid", r)).toBe(false);
  expect(await attachJourneyDraft(req(), "100", shop, "", r)).toBe(false);
  expect((await db.query("select * from lean_private.draft_receipts")).rows).toHaveLength(0);
  expect(await attachJourneyDraft(req(), "100", shop, "uid", r)).toBe(true);
  await db.query(`insert into lean_private.journey_grants select $1,project_ref,posthog_project,shop,
    'different_subject',$2,firebase_uid,valid_from,expires_at,revoked_at,permission_evidence_ref,approval_ref
    from lean_private.journey_grants`, ["f".repeat(64), action]);
  expect((await rpc("lean_draft_receipt", { p_project: project, p_shop: shop, p_token_hash: "f".repeat(64),
    p_draft: "100", p_context: "x".repeat(60) })).data).toBe(false);
  expect(await attachJourneyDraft(req(), "100", shop, "uid", r)).toBe(false);
  expect((await db.query<{ conflicted_at: string | null }>("select conflicted_at from lean_private.draft_receipts")).rows[0].conflicted_at).not.toBeNull();
});
it("rejects oversized draft receipt reads, requires scoped credentials and skips Shopify for an empty receipt set", async () => {
  const config = { projectRef: project, shop, from: new Date(now - 10000).toISOString(),
    until: new Date(now).toISOString(), capturedAt: new Date(now + 1000).toISOString() };
  const overflow = vi.fn(async () => Response.json(Array(101).fill({})));
  await expect(readDraftJourney(config, "fixture", "fixture", overflow)).rejects.toThrow("budget");
  expect(overflow).toHaveBeenCalledTimes(1);
  const noRead = vi.fn(async () => Response.json([]));
  await expect(readDraftJourney(config, "fixture", "", noRead)).rejects.toThrow("credentials");
  expect(noRead).not.toHaveBeenCalled();
  const empty = await readDraftJourney(config, "fixture", "fixture", noRead);
  expect(empty.links).toEqual([]); expect(noRead).toHaveBeenCalledTimes(1);
});
it.each(["wrong-version", "missing-node", "wrong-draft", "partial-response", "future-relation", "inconsistent-open"])(
  "rejects an invalid Shopify draft relation without retrying: %s", async failure => {
    const config = { projectRef: project, shop, from: new Date(now - 10000).toISOString(),
      until: new Date(now).toISOString(), capturedAt: new Date(now + 1000).toISOString() };
    const receipt = { draftId: "100", cartToken: "draft_100", contextToken: "x".repeat(60),
      capturedAt: new Date(now - 1000).toISOString(), subjectId: "subject_fixture", sessionId: session,
      posthogProject: "353503", validFrom: new Date(now - 10000).toISOString(),
      expiresAt: new Date(now + 3600000).toISOString(), revokedAt: null, permissionEvidenceRef: "fixture:permission" };
    const node = { __typename: "DraftOrder", id: "gid://shopify/DraftOrder/100", status: "COMPLETED",
      completedAt: new Date(now).toISOString(), order: { id: "gid://shopify/Order/1" } };
    if (failure === "wrong-draft") node.id = "gid://shopify/DraftOrder/999";
    if (failure === "future-relation") node.completedAt = new Date(now + 5000).toISOString();
    if (failure === "inconsistent-open") node.status = "OPEN";
    const request = vi.fn(async (url: RequestInfo | URL) => String(url).includes("supabase")
      ? Response.json([receipt])
      : Response.json({ data: { nodes: failure === "partial-response" ? [] :
        [failure === "missing-node" ? null : node] } }, {
        headers: { "X-Shopify-API-Version": failure === "wrong-version" ? "2026-10" : "2026-07" },
      }));
    await expect(readDraftJourney(config, "fixture", "fixture", request)).rejects.toThrow();
    expect(request).toHaveBeenCalledTimes(2);
  });
it("defaults off and respects privacy signals, duplicate cookies and cross-project scope", async () => {
  const r = runtime(); r.env.LEAN_ANALYTICS_JOURNEYS_ENABLED = "false"; r.rpc = vi.fn(r.rpc);
  expect(await captureJourney(req(), "quiz_started", action, undefined, r)).toBe(false);
  expect(await attachJourneyCart(req(), cart, undefined, r)).toBe(false);
  expect(r.rpc).not.toHaveBeenCalled();
  expect(await journeyGrant(req({ "sec-gpc": "1" }), undefined, runtime())).toBeNull();
  expect(await journeyGrant(req({ dnt: "1" }), undefined, runtime())).toBeNull();
  expect(await journeyGrant(req({ cookie: `__Host-mully_analytics=${token}; __Host-mully_analytics=${token}` }),
    undefined, runtime())).toBeNull();
  r.env.LEAN_ANALYTICS_JOURNEYS_ENABLED = "true"; r.env.LEAN_ANALYTICS_PIPELINE_PROJECT_REF = "c".repeat(20);
  expect(await journeyGrant(req(), undefined, r)).toBeNull();
  r.env.LEAN_ANALYTICS_PIPELINE_PROJECT_REF = project;
  r.env.LEAN_ANALYTICS_SUPABASE_URL = "https://wrong.supabase.co";
  expect(await journeyGrant(req(), undefined, r)).toBeNull();
  expect(r.rpc).not.toHaveBeenCalled();
});
it("requires a verified Firebase principal when the grant is bound to one", async () => {
  await db.exec("update lean_private.journey_grants set firebase_uid='fixture_uid'");
  expect(await journeyGrant(req(), undefined, runtime())).toBeNull();
  expect(await journeyGrant(req(), "wrong", runtime())).toBeNull();
  expect(await journeyGrant(req(), "fixture_uid", runtime())).not.toBeNull();
});
it("suppresses revoked or expired grants and never treats SMS clicks as activation", async () => {
  const r = runtime();
  expect(await captureJourney(req(), "sms_click", action, undefined, r)).toBe(false);
  await db.exec("update lean_private.journey_grants set revoked_at=clock_timestamp()");
  expect(await captureJourney(req(), "quiz_started", action, undefined, r)).toBe(false);
  expect(await attachJourneyCart(req(), cart, undefined, r)).toBe(false);
  expect(r.request).not.toHaveBeenCalled();
  await db.exec("update lean_private.journey_grants set revoked_at=null,valid_from=now()-interval '2 hours',expires_at=now()-interval '1 hour'");
  expect(await journeyGrant(req(), undefined, r)).toBeNull();
});
it("keeps retry timestamps and event IDs identical and sends no profile/PII fields", async () => {
  const r = runtime();
  expect(await captureJourney(req(), "quiz_started", `evt-${action}`, undefined, r)).toBe(true);
  expect(await captureJourney(req(), "quiz_started", `evt-${action}`, undefined, r)).toBe(true);
  const calls = vi.mocked(r.request).mock.calls;
  const bodies = calls.map(call => JSON.parse(String(call[1]?.body)));
  expect(bodies[0]).toEqual(bodies[1]);
  expect(bodies[0]).toMatchObject({ event: "lean_reserve_started", properties: {
    distinct_id: "subject_fixture", $session_id: session, $process_person_profile: false, analytics_permitted: true,
  } });
  expect(JSON.stringify(bodies)).not.toMatch(/email|phone|firebase|cookie|private_cart_key/);
  expect((await db.query("select * from lean_private.journey_actions")).rows).toHaveLength(1);
});
it("does not retry an ambiguous capture or write", async () => {
  const r = runtime(); r.request = vi.fn(async () => { throw new Error("lost response"); });
  expect(await captureJourney(req(), "quiz_started", action, undefined, r)).toBe(false);
  expect(r.request).toHaveBeenCalledTimes(1);
});
it("bounds an unresponsive permission transport without breaking checkout", async () => {
  const r = runtime(); r.rpc = async () => new Promise(() => {});
  const start = Date.now();
  expect(await attachJourneyCart(req(), cart, undefined, r)).toBe(false);
  expect(Date.now() - start).toBeLessThan(1800);
  expect(r.request).not.toHaveBeenCalled();
});
it("reads Shopify cart identity without mutating commerce attributes", async () => {
  const r = runtime();
  expect(await attachJourneyCart(req(), cart, undefined, r)).toBe(true);
  const body = JSON.parse(String(vi.mocked(r.request).mock.calls[0][1]?.body));
  expect(body.query).toMatch(/^query /);
  expect(body.query).not.toContain("mutation");
  expect(body.variables.cartId).toBe(cart);
  const rows = (await db.query<{ context_token: string }>("select * from lean_private.checkout_receipts")).rows;
  expect(rows).toHaveLength(1);
  expect(JSON.stringify(rows)).not.toContain("private_cart_key");
  const original = rows[0].context_token;
  expect(await attachJourneyCart(req(), cart, undefined, r)).toBe(true);
  expect((await db.query<{ context_token: string }>("select context_token from lean_private.checkout_receipts")).rows[0].context_token).toBe(original);
});
it("refuses guessed cart IDs, vendor mismatches and signature secrets that are not configured", async () => {
  const r = runtime();
  expect(await attachJourneyCart(req(), "gid://shopify/Cart/cart_fixture", undefined, r)).toBe(false);
  expect(r.request).not.toHaveBeenCalled();
  r.request = vi.fn(async () => Response.json({ data: { cart: { id: "different" } } }));
  expect(await attachJourneyCart(req(), cart, undefined, r)).toBe(false);
  r.env.LEAN_CHECKOUT_CONTEXT_SECRET = "";
  expect(await attachJourneyCart(req(), cart, undefined, r)).toBe(false);
  expect((await db.query("select * from lean_private.checkout_receipts")).rows).toEqual([]);
});
it("does not move a cart receipt to another session", async () => {
  expect(await attachJourneyCart(req(), cart, undefined, runtime())).toBe(true);
  await db.query(`insert into lean_private.journey_grants select $1,project_ref,posthog_project,shop,
    'different_subject',$2,firebase_uid,valid_from,expires_at,revoked_at,permission_evidence_ref,approval_ref
    from lean_private.journey_grants`, ["f".repeat(64), action]);
  expect((await rpc("lean_checkout_receipt", { p_project: project, p_shop: shop, p_token_hash: "f".repeat(64),
    p_cart: "cart_fixture", p_context: "x".repeat(60) })).data).toBe(false);
});
it("connects real SQL receipts to the source reader and corroborated order/session mapping", async () => {
  await db.query("update lean_private.journey_grants set expires_at=$1", [new Date(now + 7200000).toISOString()]);
  expect(await attachJourneyCart(req(), cart, undefined, runtime())).toBe(true);
  const asOf = new Date(now + 60000).toISOString();
  const snapshot = await readJourneyReceipts({ projectRef: project, shop, capturedAt: asOf, requestedCarts: ["cart_fixture"] },
    "fixture", async (_url, init) => {
      const result = await rpc("lean_checkout_receipts_read", JSON.parse(String(init?.body)));
      expect(result.error).toBeNull(); return Response.json(result.data);
    });
  const orders = [{ shop, apiVersion: "2026-07" as const, order: { id: "gid://shopify/Order/1",
    cartToken: "cart_fixture", createdAt: new Date(now + 30000).toISOString() } }];
  const config = { projectRef: project, shop, posthogProject: "353503", sessionVersion: "v1", asOf };
  expect(mapJourneyCheckout(orders, snapshot, config, secret)).toEqual([{
    orderId: key(shop, "1"), sessionKey: key("353503", "v1", session),
    method: "verified_first_party_context", evidenceRef: expect.stringMatching(/^journey-receipt:sha256:/),
  }]);
  expect(() => mapJourneyCheckout(orders, snapshot, config, "wrong".repeat(10))).toThrow("invalid_context");
  const late = [{ ...orders[0], order: { ...orders[0].order, createdAt: new Date(now + 5400000).toISOString() } }];
  expect(mapJourneyCheckout(late, snapshot, { ...config, asOf: new Date(now + 7200000).toISOString() }, secret)).toEqual([]);
  await db.exec("update lean_private.journey_grants set revoked_at=clock_timestamp()");
  const revoked = await readJourneyReceipts({ projectRef: project, shop, capturedAt: asOf, requestedCarts: ["cart_fixture"] },
    "fixture", async (_url, init) => Response.json((await rpc("lean_checkout_receipts_read", JSON.parse(String(init?.body)))).data));
  expect(mapJourneyCheckout(orders, revoked, config, secret)).toEqual([]);
});
it("removes broad hosted default privileges and prevents runtime from minting grants", async () => {
  for (const role of ["anon", "authenticated", "service_role"]) {
    const result = await db.query<{ grants: boolean; actions: boolean; receipts: boolean }>(`select
      has_table_privilege($1,'lean_private.journey_grants','insert') grants,
      has_table_privilege($1,'lean_private.journey_actions','select') actions,
      has_table_privilege($1,'lean_private.checkout_receipts','select') receipts`, [role]);
    expect(result.rows[0]).toEqual({ grants: false, actions: false, receipts: false });
    expect((await db.query<{ allowed: boolean }>(`select has_function_privilege($1,
      'public.lean_checkout_receipts_read(text,text,text[])','execute') allowed`, [role])).rows[0].allowed)
      .toBe(role === "service_role");
  }
});
it("reads actual SQL permission intervals without secrets and carries withdrawal into report evidence", async () => {
  const config = { projectRef: project, shop, posthogProject: "353503",
    from: new Date(now - 60000).toISOString(), until: new Date(now).toISOString(),
    capturedAt: new Date(now + 60000).toISOString() };
  const transport: typeof fetch = async (_url, init) => {
    const result = await rpc("lean_journey_permissions_read", JSON.parse(String(init?.body)));
    expect(result.error).toBeNull();
    return Response.json(result.data);
  };
  const first = await readJourneyPermissions(config, "fixture", transport);
  const expected = { ...config, asOf: config.capturedAt, mappingVersion: "v1" };
  expect(mapJourneyPermissions(first, expected)).toMatchObject([{
    identifier: "subject_fixture", customerId: null, consent: "permitted", removal: "active",
  }]);
  expect(JSON.stringify(first)).not.toContain(hash);
  await db.exec("update lean_private.journey_grants set revoked_at=clock_timestamp()");
  const revoked = await readJourneyPermissions(config, "fixture", transport);
  expect(mapJourneyPermissions(revoked, expected)).toMatchObject([{
    identifier: "subject_fixture", customerId: null, consent: "denied", removal: "removed",
  }]);
  expect((await readJourneyPermissions({ ...config, posthogProject: "999" }, "fixture", transport)).grants).toEqual([]);
  expect((await rpc("lean_journey_permissions_read", { p_project: project, p_shop: shop,
    p_posthog: "353503", p_from: config.from, p_until: new Date(now + 86400000).toISOString() })).error).not.toBeNull();
});
