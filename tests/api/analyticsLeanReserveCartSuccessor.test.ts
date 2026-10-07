import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
const ports = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@/lib/analytics/serverClient", () => ({
  getAnalyticsSupabase: () => ({ rpc: (name: string, args: unknown) => ({
    abortSignal: () => ports.rpc(name, args),
  }) }),
}));
vi.mock("@/lib/firebase-admin", () => ({ adminAuth: { verifyIdToken: vi.fn(async () => ({ uid: "fixture-user" })) } }));
vi.mock("@/lib/rateLimit", () => ({ checkRateLimit: () => ({ allowed: true }) }));
import { decideJourney } from "@/lib/analytics/journeyDecision";
import { attachJourneyCart, attachJourneyDraft, captureJourney, journeyGrant, type JourneyRuntime } from "@/lib/analytics/journeyRuntime";
import { reserveRuntime as target } from "@/lib/analytics/journeyPolicyRuntime";
import { resolveJourneyRuntime, reserveCartPolicy as version } from "@/lib/analytics/journeyCheckoutPolicy";
import { verifyCheckoutContext } from "@/lib/analytics/checkout-context";
import { recordJourneyCart } from "@/lib/analytics/journeyClient";
import { POST as decisionRoute } from "@/app/api/analytics/journey/decision/route";
import { POST as cartRoute } from "@/app/api/analytics/journey/cart/route";
import PreferencesClient from "@/app/analytics-preferences/PreferencesClient";

const captureKey = "fixture-only-no-provider-key";
const fingerprint = createHash("sha256").update(captureKey).digest("hex");
const secret = "fixture-only-signing-secret".repeat(2);
const cart = "gid://shopify/Cart/fixture_cart?key=fixture_private_key";
const sql = readFileSync("sql/analytics/proposed_journey_checkout_policy.sql", "utf8");
const bodies = `select oid::regprocedure::text signature,md5(prosrc) body,prosecdef,proacl::text acl
  from pg_proc where proname like '%journey%' or proname in ('lean_checkout_receipt','lean_draft_receipt') order by 1`;
let db: PGlite, oldBodies: unknown;
const req = (token?: string, headers: Record<string, string> = {}) => new Request(`${target.origin}/api/analytics/track`, {
  headers: { origin: target.origin, ...(token ? { cookie: `__Host-mully_analytics=${token}` } : {}), ...headers },
});
const rpc: JourneyRuntime["rpc"] = async (name, args) => {
  if (!/^lean_(journey_(checkout_(config|issue|grant|action|receipt)|runtime_(config|issue|grant|action)|issue|grant|action|withdraw)|checkout_receipt|draft_receipt)$/.test(name))
    throw new Error("unexpected_rpc");
  const pairs = Object.entries(args);
  try {
    await db.exec("set role service_role");
    const result = await db.query<{ value: unknown }>(`select public.${name}(${
      pairs.map(([k], i) => `${k}=>$${i + 1}`).join(",")}) value`, pairs.map(([, v]) => v));
    return { data: JSON.parse(JSON.stringify(result.rows[0].value)), error: null };
  } catch (error) { return { data: null, error }; }
  finally { await db.exec("reset role"); }
};
function runtime(): JourneyRuntime {
  return { env: { NODE_ENV: "test", VERCEL_ENV: "production", VERCEL_GIT_COMMIT_REF: "main",
    LEAN_ANALYTICS_PIPELINE_PROJECT_REF: target.project,
    LEAN_ANALYTICS_SUPABASE_URL: `https://${target.project}.supabase.co`,
    LEAN_ANALYTICS_SUPABASE_SERVICE_ROLE_KEY: "fixture-service-key",
    LEAN_SHOPIFY_STOREFRONT_TOKEN: "fixture-storefront", LEAN_CHECKOUT_CONTEXT_SECRET: secret },
  now: Date.now, captureKeyCandidates: [captureKey], rpc,
  request: vi.fn(async url => String(url).includes("posthog")
    ? new Response(null, { status: 204 }) : Response.json({ data: { cart: { id: cart } } })) };
}
async function enable(policy = version) {
  await db.query(`insert into lean_private.journey_policies
    (project_ref,shop,posthog_project,policy_version,approval_ref,ttl_seconds,enabled,
      ${policy === version ? "checkout_enabled,checkout_capture_key_sha256,checkout_valid_until" :
        "runtime_capture_key_sha256,runtime_valid_until"})
    values($1,$2,$3,$4,'fixture:prospective-only',3600,true,${policy === version ? "true," : ""}
      $5,clock_timestamp()+interval '2 hours')`,
  [target.project, target.shop, target.posthog, policy, fingerprint]);
}
async function allow(r = runtime(), uid?: string) {
  const d = await decideJourney(req(), "allow", uid, r, version);
  return { r, token: d.token, req: req(d.token), hash: createHash("sha256").update(d.token).digest("hex") };
}
const count = async (table: string) => (await db.query<{ n: number }>(
  `select count(*)::int n from lean_private.${table}`)).rows[0].n;

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`create schema lean_private; create schema lean_export;
    create role anon; create role authenticated; create role service_role; create role lean_posthog_reader;
    create table lean_private.selected_publications(publication_id text);
    create table lean_private.export_audit(publication_id text);
    alter default privileges in schema public grant execute on functions to anon,authenticated,service_role;`);
  for (const table of ["store_daily", "product_daily", "acquisition_daily", "customer_cohorts", "funnel_daily"])
    await db.exec(`create table lean_export.${table}(publication_id text)`);
  for (const path of ["026_journey_authority", "029_journey_decisions", "031_draft_receipts",
    "037_canonical_journey_timestamps", "proposed_journey_runtime_policy"])
    await db.exec(readFileSync(`sql/analytics/${path}.sql`, "utf8"));
  oldBodies = (await db.query(bodies)).rows;
  await db.exec(sql);
}, 30000);
beforeEach(async () => {
  await db.exec("truncate lean_private.journey_grants cascade; delete from lean_private.journey_policies");
  ports.rpc.mockImplementation(rpc);
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
afterAll(async () => db?.close());

it("installs no authority, preserves every old function/ACL and exposes no policy-write privilege", async () => {
  const old = oldBodies as { signature: string }[];
  const current = (await db.query(bodies)).rows as { signature: string }[];
  expect(current.filter(row => old.some(o => o.signature === row.signature))).toEqual(old);
  expect((await resolveJourneyRuntime(runtime())).policy).toBeUndefined();
  await expect(allow()).rejects.toThrow("permission_unavailable");
  expect(await count("journey_grants")).toBe(0);
  expect((await db.query(`select has_any_column_privilege('service_role','lean_private.journey_policies','INSERT,UPDATE') edit,
    has_function_privilege('anon','public.lean_journey_checkout_issue(text,text,text,uuid,text)','execute') anon,
    has_function_privilege('service_role','lean_private.journey_checkout_policy(text)','execute') helper`)).rows)
    .toEqual([{ edit: false, anon: false, helper: false }]);
  await expect(db.exec(sql)).rejects.toThrow("footprint");
  await db.exec("rollback");
});

it("requires owner-bound production capability and matching capture fingerprint", async () => {
  await enable();
  for (const change of [{ VERCEL_ENV: "preview" }, { VERCEL_GIT_COMMIT_REF: "other" },
    { LEAN_ANALYTICS_SUPABASE_SERVICE_ROLE_KEY: "" }, { LEAN_ANALYTICS_SUPABASE_URL: "https://wrong.invalid" }]) {
    const r = runtime(); Object.assign(r.env, change);
    expect((await resolveJourneyRuntime(r)).policy).toBeUndefined();
  }
  const r = runtime(); r.captureKeyCandidates = ["wrong"];
  expect((await resolveJourneyRuntime(r)).policy).toBeUndefined();
  await db.exec("update lean_private.journey_policies set checkout_enabled=false");
  expect((await resolveJourneyRuntime(runtime())).policy).toBeUndefined();
  expect(await count("journey_grants")).toBe(0);
});

it("requires a fresh explicit successor choice, not v1 consent or a stale page", async () => {
  await enable(target.policy);
  const old = await decideJourney(req(), "allow", undefined, runtime());
  await db.exec("update lean_private.journey_policies set enabled=false");
  await enable();
  expect(await journeyGrant(req(old.token), undefined, runtime())).toBeNull();
  await expect(decideJourney(req(old.token), "allow", undefined, runtime())).rejects.toThrow("permission_policy_changed");
  const successor = await decideJourney(req(old.token), "allow", undefined, runtime(), version);
  expect(successor.token).not.toBe(old.token);
  expect(await count("journey_grants")).toBe(2);
  await db.exec(`update lean_private.journey_policies set enabled=(policy_version='${target.policy}')`);
  await expect(decideJourney(req(), "allow", undefined, runtime(), version)).rejects.toThrow("permission_policy_changed");
});

it("keeps no-cookie, GPC/DNT, origin, optional verified-principal and withdrawal boundaries", async () => {
  await enable(); const r = runtime();
  expect(await captureJourney(req(), "quiz_started", randomUUID(), undefined, r)).toBe(false);
  for (const h of [{ dnt: "1" }, { "sec-gpc": "1" }] as Record<string, string>[])
    await expect(decideJourney(req(undefined, h), "allow", undefined, r, version)).rejects.toThrow("permission_declined");
  for (const origin of ["https://attacker.invalid", "https://mymully.com", ""])
    await expect(decideJourney(req(undefined, { origin }), "allow", undefined, r, version)).rejects.toThrow("permission_unavailable");
  const bound = await allow(r, "fixture-user");
  expect(await attachJourneyCart(bound.req, cart, undefined, r)).toBe(false);
  expect(await attachJourneyCart(bound.req, cart, "wrong", r)).toBe(false);
  expect(await attachJourneyCart(req(bound.token, { dnt: "1" }), cart, "fixture-user", r)).toBe(false);
  expect(await attachJourneyCart(req(bound.token, { origin: "https://attacker.invalid" }), cart, "fixture-user", r)).toBe(false);
  expect(r.request).not.toHaveBeenCalled();
  await decideJourney(bound.req, "withdraw", undefined, r);
  expect(await count("journey_removals")).toBe(1);
  expect(await journeyGrant(bound.req, "fixture-user", r)).toBeNull();
});

it("emits only three narrow Reserve families with exact dedup lineage and no campaign/PII extension", async () => {
  await enable(); const { r, req: request } = await allow();
  const id = randomUUID();
  for (const name of ["sg_begin", "sg_played", "sg_checkout_start", "lp_text_mully_view", "shop_outfit_reserve_clicked"])
    expect(await captureJourney(request, name, id, undefined, r)).toBe(false);
  for (const context of [undefined, { source: "shop" }, { source: "choose_plan", plan: "access" }])
    expect(await captureJourney(request, "checkout_clicked", id, undefined, r, context)).toBe(false);
  expect(await captureJourney(request, "quiz_started", id, undefined, r)).toBe(true);
  expect(await captureJourney(request, "quiz_started", id, undefined, r)).toBe(true);
  expect(await captureJourney(request, "reveal_viewed", randomUUID(), undefined, r)).toBe(true);
  for (const context of [{ source: "choose_plan", plan: "member" },
    { source: "reserve_founders_lp", plan: "member", method: "shopify_checkout" }])
    expect(await captureJourney(request, "checkout_clicked", randomUUID(), undefined, r, context)).toBe(true);
  const calls = vi.mocked(r.request).mock.calls;
  const first = JSON.parse(String(calls[0][1]?.body));
  expect(JSON.parse(String(calls[1][1]?.body))).toEqual(first);
  expect(Object.keys(first.properties).sort()).toEqual(["$insert_id", "$process_person_profile", "$session_id",
    "analytics_permitted", "collection_version", "distinct_id", "journey", "step"]);
  expect(await count("journey_actions")).toBe(4);
});

it("verifies the real cart endpoint response, signs the grant/session binding and stores no secret cart key", async () => {
  await enable(); const { r, req: request } = await allow();
  expect(await attachJourneyCart(request, cart, undefined, r)).toBe(true);
  const call = vi.mocked(r.request).mock.calls[0];
  expect(call[0]).toBe(`https://${target.shop}/api/2026-07/graphql.json`);
  expect(JSON.parse(String(call[1]?.body))).toEqual({
    query: "query LeanCartContext($cartId: ID!) { cart(id: $cartId) { id } }", variables: { cartId: cart },
  });
  const rows = (await db.query<{ cart_token: string; context_token: string; subject_id: string; session_id: string; captured_at: Date }>(
    `select r.cart_token,r.context_token,g.subject_id,g.session_id,r.captured_at
      from lean_private.checkout_receipts r join lean_private.journey_grants g on r.grant_hash=g.token_hash`)).rows;
  expect(rows).toHaveLength(1);
  expect(rows[0].cart_token).toBe("fixture_cart");
  const verified = verifyCheckoutContext(rows[0].context_token, { project: target.posthog, shop: target.shop,
    checkoutId: "fixture_cart", serverSubject: rows[0].subject_id, analyticsPermitted: true,
    now: Math.floor(new Date(rows[0].captured_at).getTime() / 1000) }, secret);
  expect(verified?.sessionId).toBe(rows[0].session_id);
  expect(verified!.expiresAt - verified!.issuedAt).toBeLessThanOrEqual(3600);
  expect(verifyCheckoutContext(rows[0].context_token, { project: target.posthog, shop: target.shop,
    checkoutId: "other", serverSubject: rows[0].subject_id, analyticsPermitted: true, now: verified!.issuedAt }, secret)).toBeNull();
  expect(rows[0].context_token).not.toContain("fixture_private_key");
});

it.each(["missing-secret", "missing-storefront", "wrong-cart", "vendor-error", "bad-format"])(
  "fails closed without a receipt for %s", async mode => {
    await enable(); const { r, req: request } = await allow();
    if (mode === "missing-secret") delete r.env.LEAN_CHECKOUT_CONTEXT_SECRET;
    if (mode === "missing-storefront") delete r.env.LEAN_SHOPIFY_STOREFRONT_TOKEN;
    if (mode === "wrong-cart") r.request = vi.fn(async () => Response.json({ data: { cart: { id: "other" } } }));
    if (mode === "vendor-error") r.request = vi.fn(async () => Response.json({ errors: [{ message: "fixture failure" }] }));
    expect(await attachJourneyCart(request, mode === "bad-format" ? "invented" : cart, undefined, r)).toBe(false);
    expect(await count("checkout_receipts")).toBe(0);
  });

it.each(["withdrawal", "disable", "policy-change", "clock-expiry"])(
  "rechecks authority after Storefront I/O: %s", async mode => {
    await enable(); const { r, req: request } = await allow();
    let clock = Date.now();
    r.now = () => clock;
    r.request = vi.fn(async () => {
      if (mode === "withdrawal") await decideJourney(request, "withdraw", undefined, r);
      if (mode === "disable") await db.exec("update lean_private.journey_policies set checkout_enabled=false");
      if (mode === "policy-change") await db.exec("update lean_private.journey_policies set approval_ref='fixture:changed'");
      if (mode === "clock-expiry") clock += 3700000;
      return Response.json({ data: { cart: { id: cart } } });
    });
    expect(await attachJourneyCart(request, cart, undefined, r)).toBe(false);
    expect(await count("checkout_receipts")).toBe(0);
  });

it("rejects expired grants/policy, current removals and stale owner configuration", async () => {
  await enable(); const { r, req: request, hash } = await allow();
  await db.query("insert into lean_private.journey_removals(token_hash) values($1)", [hash]);
  expect(await attachJourneyCart(request, cart, undefined, r)).toBe(false);
  expect(await captureJourney(request, "quiz_started", randomUUID(), undefined, r)).toBe(false);
  await db.exec("delete from lean_private.journey_removals; update lean_private.journey_grants set valid_from=now()-interval '2 hours',expires_at=now()-interval '1 hour'");
  expect(await attachJourneyCart(request, cart, undefined, r)).toBe(false);
  await db.exec("update lean_private.journey_policies set checkout_valid_until=now()-interval '1 second'");
  expect((await resolveJourneyRuntime(r)).policy).toBeUndefined();
  expect(r.request).not.toHaveBeenCalled();
});

it("never upgrades a reused cart to another grant and SQL guards old RPC bypasses", async () => {
  await enable(); const first = await allow(), second = await allow();
  expect(await attachJourneyCart(first.req, cart, undefined, first.r)).toBe(true);
  expect(await attachJourneyCart(second.req, cart, undefined, second.r)).toBe(false);
  expect(await count("checkout_receipts")).toBe(1);
  const action = await rpc("lean_journey_action", { p_project: target.project, p_shop: target.shop,
    p_token_hash: second.hash, p_action: randomUUID(), p_family: "lean_style_game_started" });
  expect(action.error).toBeTruthy();
  const draft = await rpc("lean_draft_receipt", { p_project: target.project, p_shop: target.shop,
    p_token_hash: second.hash, p_draft: "123", p_context: "fixture".repeat(12) });
  expect(draft.error).toBeTruthy();
  expect(await attachJourneyDraft(second.req, "123", target.shop, "fixture-user", second.r)).toBe(false);
});

it("preserves v1 selection/action behavior and denies its carts even with the new public flag", async () => {
  await enable(target.policy); await enable();
  const r = runtime();
  expect((await resolveJourneyRuntime(r)).policy?.policyVersion).toBe(target.policy);
  const old = await decideJourney(req(), "allow", undefined, r);
  expect(await captureJourney(req(old.token), "quiz_started", randomUUID(), undefined, r)).toBe(true);
  expect(await attachJourneyCart(req(old.token), cart, undefined, r)).toBe(false);
  expect(await count("checkout_receipts")).toBe(0);
});

it("does not let the successor escape into a legacy-enabled runtime", async () => {
  await enable(); const { r, req: request } = await allow();
  Object.assign(r.env, { LEAN_ANALYTICS_JOURNEYS_ENABLED: "true", LEAN_ANALYTICS_PERMISSION_POLICY: version,
    LEAN_SHOPIFY_SHOP_DOMAIN: target.shop, LEAN_POSTHOG_PROJECT_ID: target.posthog });
  expect((await resolveJourneyRuntime(r)).policy).toBeUndefined();
  expect(await journeyGrant(request, undefined, r)).toBeNull();
  expect(await attachJourneyCart(request, cart, undefined, r)).toBe(false);
  expect(r.request).not.toHaveBeenCalled();
});

it("uses actual decision/cart routes with explicit successor wording and preserves opaque responses", async () => {
  await enable(); const r = runtime();
  for (const [k, v] of Object.entries(r.env)) vi.stubEnv(k, v);
  vi.stubEnv("POSTHOG_PROJECT_API_KEY", captureKey);
  vi.stubGlobal("fetch", r.request);
  const next = (body: unknown, token?: string, headers: Record<string, string> = {}) =>
    new NextRequest(`${target.origin}/api/analytics/journey/cart`, { method: "POST",
      headers: { origin: target.origin, ...(token ? { cookie: `__Host-mully_analytics=${token}` } : {}), ...headers },
      body: JSON.stringify(body) });
  expect((await decisionRoute(next({ decision: "allow" }))).status).toBe(503);
  const chosen = await decisionRoute(next({ decision: "allow", policyVersion: version }));
  expect(chosen.status).toBe(204);
  const cookie = chosen.headers.get("set-cookie")!;
  expect(cookie).toContain("HttpOnly"); expect(cookie).toContain("SameSite=strict");
  const token = cookie.match(/__Host-mully_analytics=([a-f0-9]{64})/)![1];
  expect((await cartRoute(next({ cartId: cart, analytics_permitted: true }, token))).status).toBe(400);
  expect((await cartRoute(next({ cartId: cart }, token, { origin: "https://other.invalid" }))).status).toBe(403);
  expect((await cartRoute(next({ cartId: cart }, token))).status).toBe(204);
  expect(await count("checkout_receipts")).toBe(1);
  const markup = renderToStaticMarkup(createElement(PreferencesClient, { allowEnabled: true, checkoutLinking: true }));
  expect(markup).toContain("verified Shopify cart"); expect(markup).toContain("If you later place an order");
  await db.exec("update lean_private.journey_policies set enabled=false");
  expect((await cartRoute(next({ cartId: cart }, token))).status).toBe(404);
  expect((await decisionRoute(next({ decision: "withdraw" }, token))).status).toBe(204);
  expect(await count("journey_removals")).toBe(1);
});

it("keeps browser cart handoff default-off and uses only the existing cart payload when enabled", async () => {
  vi.stubGlobal("window", {});
  const request = vi.fn(async () => new Response(null, { status: 204 }));
  vi.stubGlobal("fetch", request);
  await recordJourneyCart(cart, "fixture-auth");
  expect(request).not.toHaveBeenCalled();
  vi.stubEnv("NEXT_PUBLIC_LEAN_RESERVE_CART_ENABLED", "true");
  await recordJourneyCart(cart, "fixture-auth");
  expect(request).toHaveBeenCalledWith("/api/analytics/journey/cart", expect.objectContaining({
    credentials: "same-origin", body: JSON.stringify({ cartId: cart }),
  }));
});
