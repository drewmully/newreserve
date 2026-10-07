import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { createHmac, randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
const ports = vi.hoisted(() => ({ rpc: vi.fn(), filters: vi.fn(), sdk: { __loaded: true, get_session_id: vi.fn() } }));
vi.mock("@/lib/analytics/serverClient", () => ({ getAnalyticsSupabase: () => ({ rpc: (name: string, args: unknown) => ({ abortSignal: () => ports.rpc(name, args) }) }) }));
vi.mock("@/lib/rateLimit", () => ({ checkRateLimit: () => ({ allowed: true }) }));
vi.mock("posthog-js", () => ({ default: ports.sdk }));
// Public behavior fixtures never embed the private actual rule values. Only
// this test mock supplies a synthetic rule set; production has one fixed pin.
vi.mock("@/lib/analytics/journeyNativeFilterConfig", async importOriginal => ({
  ...await importOriginal<typeof import("@/lib/analytics/journeyNativeFilterConfig")>(),
  nativeFilterRules: (env:NodeJS.ProcessEnv) => ports.filters(env),
}));
import { attachSourceSessionCart, bindSourceSession, decideSourceSession, sourceSessionConfig,
  sourceSessionCookie, sourceSessionDigest, sourceSessionVersion } from "@/lib/analytics/journeySourceSessionRuntime";
import { recordSourceSessionPaid } from "@/lib/analytics/journeySourceSessionPaid";
import { sourceSessionRoute } from "@/lib/analytics/journeySourceSessionRoute";
import { recordSourceSessionNavigation, recordSourceSessionCart } from "@/lib/analytics/journeySourceSessionClient";
import { admitSourceSessionReceipt, sourceSessionPaidEvidence, type SourcePaidReceipt } from "@/lib/analytics/journeySourceSessionEvidence";
import { reserveRuntime as target } from "@/lib/analytics/journeyPolicyRuntime";
import { type JourneyGrant, type JourneyRuntime } from "@/lib/analytics/journeyRuntime";
import { signCheckoutContext, verifyCheckoutContext } from "@/lib/analytics/checkout-context";
import { key } from "@/lib/analytics/primitives";
import { nativeEntryFilterSha256, readNativeSessionForBinding } from "@/lib/analytics/journeyNativeSessionRead";
import PreferencesClient from "@/app/analytics-session-preferences/PreferencesClient";

const webhookSecret = "fixture-webhook-secret-not-live", readKey = "fixture-query-key-not-live", secret = "fixture-signing-secret-not-live".repeat(2);
const cart = "gid://shopify/Cart/fixture_cart?key=fixture_private_key";
const native = "10000000-0000-4000-8000-000000000001";
const bodyQuery = `select oid::regprocedure::text signature,md5(prosrc) body,prosecdef,proacl::text acl
 from pg_proc where proname like '%journey%' or proname in ('lean_checkout_receipt','lean_draft_receipt') order by 1`;
let db: PGlite, oldBodies: unknown;
const rpc: JourneyRuntime["rpc"] = async (name, args) => {
  if (!/^lean_(source_session_(config|issue|grant|existing|bind|cart|paid|paid_read|receipts_read)|journey_(withdraw|action))$/.test(name)) throw new Error("unexpected_rpc");
  const pairs = Object.entries(args);
  try {
    await db.exec("set role service_role");
    const result = await db.query<{ value: unknown }>(`select public.${name}(${pairs.map(([k], i) => `${k}=>$${i + 1}`).join(",")}) value`, pairs.map(([, v]) => v));
    return { data: JSON.parse(JSON.stringify(result.rows[0].value)), error: null };
  } catch (error) { return { data: null, error }; }
  finally { await db.exec("reset role"); }
};
function runtime(): JourneyRuntime {
  let nativeAt: string | undefined;
  return { env: { NODE_ENV: "test", VERCEL_ENV: "production", VERCEL_GIT_COMMIT_REF: "main",
    LEAN_ANALYTICS_PIPELINE_PROJECT_REF: target.project, LEAN_ANALYTICS_SUPABASE_URL: `https://${target.project}.supabase.co`,
    LEAN_ANALYTICS_SUPABASE_SERVICE_ROLE_KEY: "fixture-role", LEAN_ANALYTICS_SOURCE_SESSIONS_ENABLED: "true",
    LEAN_SHOPIFY_STOREFRONT_TOKEN: "fixture-token", LEAN_CHECKOUT_CONTEXT_SECRET: secret, LEAN_SHOPIFY_WEBHOOK_SECRET: webhookSecret,
    LEAN_POSTHOG_QUERY_READ_KEY:readKey },
    rpc, now: Date.now, request: vi.fn(async url => {
      if (String(url).includes("posthog")) {
        await new Promise(resolve=>setTimeout(resolve,5));
        nativeAt ??= new Date(Date.now()-1).toISOString();
        return Response.json({columns:["native_session_id","started_at","ended_at","entry_matches","entry_uuid","filter_0","filter_1","filter_2","filter_3","filter_4","filter_5"],
          results:[[native,nativeAt,nativeAt,1,"20000000-0000-4000-8000-000000000001",true,true,true,true,true,true]]});
      }
      return Response.json({ data: { cart: { id: cart } } });
    }) };
}
const request = (opaque?: string, extra: Record<string, string> = {}) => new Request(`${target.origin}/api/analytics/source-session/bind`, {
  headers: { origin: target.origin, ...(opaque ? { cookie: `${sourceSessionCookie}=${opaque}` } : {}), ...extra } });
async function enable(ttl = 3600) {
  await db.query(`insert into lean_private.journey_policies(project_ref,shop,posthog_project,policy_version,approval_ref,ttl_seconds,
    enabled,source_session_enabled,source_session_valid_until,source_session_webhook_sha256,source_session_read_sha256)
    values($1,$2,$3,$4,'fixture:prospective-only',$5,true,true,clock_timestamp()+interval '2 hours',$6,$7)`,
  [target.project,target.shop,target.posthog,sourceSessionVersion,ttl,sourceSessionDigest(webhookSecret),sourceSessionDigest(readKey)]);
}
async function allow(r = runtime()) {
  const decision = await decideSourceSession(request(), "allow", sourceSessionVersion, r);
  return { r, token: decision.token, hash: sourceSessionDigest(decision.token), req: request(decision.token) };
}
const count = async (table: string) => (await db.query<{ n: number }>(`select count(*)::int n from lean_private.${table}`)).rows[0].n;
function paid(order: Record<string, unknown> = {}) {
  const at = new Date(Date.now() - 1000).toISOString();
  const raw = JSON.stringify({ id: 123, admin_graphql_api_id: "gid://shopify/Order/123", cart_token: "fixture_cart",
    financial_status: "paid", created_at: at, processed_at: at, updated_at: at,
    email: "synthetic-contact@example.invalid", customer: { phone: "synthetic" }, ...order });
  const headers = new Headers({ "x-shopify-webhook-id": randomUUID(), "x-shopify-shop-domain": target.shop,
    "x-shopify-topic": "orders/paid", "x-shopify-hmac-sha256": createHmac("sha256",webhookSecret).update(raw).digest("base64") });
  return { raw, headers };
}
beforeAll(async () => {
  db = new PGlite();
  await db.exec(`create schema lean_private; create schema lean_export; create role anon; create role authenticated;
    create role service_role; create role lean_posthog_reader; create table lean_private.selected_publications(publication_id text);
    create table lean_private.export_audit(publication_id text); alter default privileges in schema public grant execute on functions to anon,authenticated,service_role;`);
  for (const table of ["store_daily","product_daily","acquisition_daily","customer_cohorts","funnel_daily"])
    await db.exec(`create table lean_export.${table}(publication_id text)`);
  for (const file of ["026_journey_authority","029_journey_decisions","031_draft_receipts","037_canonical_journey_timestamps",
    "proposed_journey_runtime_policy","proposed_journey_checkout_policy"])
    await db.exec(readFileSync(`sql/analytics/${file}.sql`,"utf8"));
  oldBodies = (await db.query(bodyQuery)).rows;
  await db.exec(readFileSync("sql/analytics/proposed_journey_source_session_policy.sql","utf8"));
  await db.exec(readFileSync("sql/analytics/proposed_source_session_paid_receipts.sql","utf8"));
},30000);
beforeEach(async () => {
  await db.exec("truncate lean_private.journey_grants,lean_private.journey_policies cascade");
  ports.rpc.mockImplementation(rpc); ports.sdk.__loaded = true; ports.sdk.get_session_id.mockReturnValue(native);
  ports.filters.mockReturnValue({hostRegex:"^(localhost|127\\.0\\.0\\.1)($|:)",
    negativeEmailValues:["synthetic_a","synthetic_b","synthetic_c","synthetic_d","synthetic_e"]});
});
afterEach(() => { vi.unstubAllGlobals(); });
afterAll(async () => { await db.close(); });

it("installs no activation or authority and preserves all prior function bodies/ACLs", async () => {
  expect(await count("journey_policies")).toBe(0);
  expect((await db.query(bodyQuery)).rows).toEqual(oldBodies);
  expect(await sourceSessionConfig(runtime())).toBeNull();
  const denied = await db.query<{ allowed: boolean }>(`select has_function_privilege('anon','public.lean_source_session_bind(text,text,uuid,uuid,timestamptz,timestamptz,text,jsonb)','EXECUTE') allowed`);
  expect(denied.rows[0].allowed).toBe(false);
});
it("requires new explicit v3 Allow, rejecting absent/v2 policy and old-cookie upgrade", async () => {
  await enable();
  for (const policy of [undefined,"reserve-cart-runtime-v2"])
    await expect(decideSourceSession(request(),"allow",policy,runtime())).rejects.toThrow("source_choice_declined");
  expect(await bindSourceSession(request(undefined,{cookie:`__Host-mully_analytics=${"a".repeat(64)}`}),native,runtime())).toBe(false);
  const a = await allow();
  expect(await count("journey_grants")).toBe(1);
  expect((await decideSourceSession(a.req,"allow",sourceSessionVersion,a.r)).token).toBe(a.token);
  expect(await count("source_session_receipts")).toBe(0); // Allow is not entry or binding.
});
it.each(["foreign", "gpc", "dnt", "wrong-key", "flag-off"])("fails closed on %s", async failure => {
  await enable(); const a = await allow();
  if (failure === "wrong-key") a.r.env.LEAN_SHOPIFY_WEBHOOK_SECRET = "other";
  if (failure === "flag-off") a.r.env.LEAN_ANALYTICS_SOURCE_SESSIONS_ENABLED = "false";
  const req = failure === "foreign" ? request(a.token,{origin:"https://foreign.invalid"}) :
    failure === "gpc" ? request(a.token,{"sec-gpc":"1"}) : failure === "dnt" ? request(a.token,{dnt:"1"}) : a.req;
  expect(await bindSourceSession(req,native,a.r)).toBe(false);
  expect(await count("source_session_receipts")).toBe(0);
});
it("records zero-Reserve-action navigation, retries idempotently, never writes journey_actions", async () => {
  await enable(); const a = await allow();
  expect(await bindSourceSession(a.req,native,a.r)).toBe(true);
  expect(a.r.request).toHaveBeenCalledTimes(1);
  const first = (await db.query("select captured_at from lean_private.source_session_receipts")).rows;
  expect(await bindSourceSession(a.req,native,a.r)).toBe(true);
  expect(a.r.request).toHaveBeenCalledTimes(1); // Retained verified source, no second provider query.
  expect((await db.query("select captured_at from lean_private.source_session_receipts")).rows).toEqual(first);
  expect(await count("journey_actions")).toBe(0);
  const legacy = await rpc("lean_journey_action",{p_project:target.project,p_shop:target.shop,p_token_hash:a.hash,p_action:randomUUID(),p_family:"lean_reserve_started"});
  expect(legacy.error).not.toBeNull();
});
it("quarantines a native ID claimed by a different grant", async () => {
  await enable(); const a = await allow(), b = await allow();
  expect(await bindSourceSession(a.req,native,a.r)).toBe(true);
  expect(await bindSourceSession(b.req,native,b.r)).toBe(false);
  expect(await bindSourceSession(a.req,native,a.r)).toBe(false);
  expect((await db.query("select conflicted_at is not null conflicted from lean_private.source_session_receipts")).rows[0]).toEqual({conflicted:true});
});
it.each(["removed", "expired"])("rejects %s grants and keeps withdrawal available when disabled", async reason => {
  await enable(); const a = await allow();
  if (reason === "removed") await decideSourceSession(a.req,"withdraw",sourceSessionVersion,a.r);
  else await db.query("update lean_private.journey_grants set valid_from=clock_timestamp()-interval '2 hours',expires_at=clock_timestamp()-interval '1 hour' where token_hash=$1",[a.hash]);
  expect(await bindSourceSession(a.req,native,a.r)).toBe(false);
  a.r.env.LEAN_ANALYTICS_SOURCE_SESSIONS_ENABLED = "false";
  expect((await decideSourceSession(a.req,"withdraw",sourceSessionVersion,a.r)).maxAge).toBe(0);
});
it("requires real verified cart and native binding and signs the native, not grant, session", async () => {
  await enable(); const a = await allow();
  expect(await attachSourceSessionCart(a.req,native,cart,a.r)).toBe(false);
  await bindSourceSession(a.req,native,a.r);
  expect(await attachSourceSessionCart(a.req,native,cart,a.r)).toBe(true);
  expect(await count("checkout_receipts")).toBe(0);
  const row = (await db.query<{context_token:string;subject_id:string}>(`select c.context_token,g.subject_id from lean_private.source_session_cart_receipts c join lean_private.journey_grants g on g.token_hash=c.grant_hash`)).rows[0];
  const verified = verifyCheckoutContext(row.context_token,{project:target.posthog,shop:target.shop,checkoutId:"fixture_cart",serverSubject:row.subject_id,analyticsPermitted:true,now:Math.floor(Date.now()/1000)},secret);
  expect(verified?.sessionId).toBe(native);
  a.r.request = vi.fn(async () => Response.json({data:{cart:{id:"wrong"}}}));
  expect(await attachSourceSessionCart(a.req,native,cart,a.r)).toBe(false);
});
it("rechecks withdrawal after Storefront I/O", async () => {
  await enable(); const a = await allow(); await bindSourceSession(a.req,native,a.r);
  a.r.request = vi.fn(async () => { await decideSourceSession(a.req,"withdraw",sourceSessionVersion,a.r); return Response.json({data:{cart:{id:cart}}}); });
  expect(await attachSourceSessionCart(a.req,native,cart,a.r)).toBe(false);
  expect(await count("source_session_cart_receipts")).toBe(0);
});
it("records minimized paid-root evidence and identical retries without any paid_at invention", async () => {
  await enable(); const a = await allow(); await bindSourceSession(a.req,native,a.r); await attachSourceSessionCart(a.req,native,cart,a.r);
  const event = paid();
  expect(await recordSourceSessionPaid(event.headers,event.raw,a.r)).toBe("retained");
  expect(await recordSourceSessionPaid(event.headers,event.raw,a.r)).toBe("retained");
  expect(await count("source_session_paid_receipts")).toBe(1);
  const row = (await db.query<Record<string,unknown>>("select * from lean_private.source_session_paid_receipts")).rows[0];
  expect(row.payload_sha256).toBe(sourceSessionDigest(event.raw));
  expect(row).not.toHaveProperty("paid_at"); expect(row).not.toHaveProperty("email"); expect(row).not.toHaveProperty("payload");
  expect(JSON.stringify(row)).not.toContain("synthetic-contact");
});
it.each(["signature","shop","topic","numeric","gid","unpaid","unknown-cart","unsafe-id"])("rejects prospective paid-root %s", async failure => {
  await enable(); const a = await allow(); await bindSourceSession(a.req,native,a.r); await attachSourceSessionCart(a.req,native,cart,a.r);
  const overrides: Record<string,unknown> = failure === "numeric" ? {id:124} : failure === "gid" ? {admin_graphql_api_id:"gid://shopify/Order/124"} :
    failure === "unpaid" ? {financial_status:"pending"} : failure === "unknown-cart" ? {cart_token:"unknown"} : failure === "unsafe-id" ? {id:9007199254740992} : {};
  const event = paid(overrides);
  if (failure === "signature") event.headers.set("x-shopify-hmac-sha256","invalid");
  if (failure === "shop") event.headers.set("x-shopify-shop-domain","foreign.myshopify.com");
  if (failure === "topic") event.headers.set("x-shopify-topic","orders/create");
  expect(await recordSourceSessionPaid(event.headers,event.raw,a.r)).toBe("unconfirmed");
  expect(await count("source_session_paid_receipts")).toBe(0);
});
it("quarantines conflicting paid retry bodies and returns unconfirmed on auxiliary failure", async () => {
  await enable(); const a = await allow(); await bindSourceSession(a.req,native,a.r); await attachSourceSessionCart(a.req,native,cart,a.r);
  const first = paid(); expect(await recordSourceSessionPaid(first.headers,first.raw,a.r)).toBe("retained");
  const changed = paid({email:"another-synthetic@example.invalid"});
  expect(await recordSourceSessionPaid(changed.headers,changed.raw,a.r)).toBe("unconfirmed");
  expect((await db.query("select conflicted_at is not null conflicted from lean_private.source_session_paid_receipts")).rows[0]).toEqual({conflicted:true});
  a.r.rpc = async () => { throw new Error("synthetic-provider-secret-must-not-escape"); };
  await expect(recordSourceSessionPaid(first.headers,first.raw,a.r)).resolves.toBe("unconfirmed");
});
it("does not record a paid root after current withdrawal", async () => {
  await enable(); const a = await allow(); await bindSourceSession(a.req,native,a.r); await attachSourceSessionCart(a.req,native,cart,a.r);
  await decideSourceSession(a.req,"withdraw",sourceSessionVersion,a.r);
  const event = paid(); expect(await recordSourceSessionPaid(event.headers,event.raw,a.r)).toBe("unconfirmed");
  expect(await count("source_session_paid_receipts")).toBe(0);
});
it("real route rejects extra browser clocks, foreign origin, and oversize bodies", async () => {
  const req = (body:string,origin:string=target.origin) => new NextRequest(`${target.origin}/api/analytics/source-session/bind`,{method:"POST",headers:{origin},body});
  expect((await sourceSessionRoute(req(JSON.stringify({nativeSessionId:native,startedAt:"forged"})),"bind")).status).toBe(400);
  expect((await sourceSessionRoute(req("{}","https://foreign.invalid"),"bind")).status).toBe(403);
  expect((await sourceSessionRoute(req("x".repeat(1025)),"bind")).status).toBe(413);
});
it("does not call source endpoints when public flag is off or SDK is unknown", async () => {
  vi.stubGlobal("window",{}); const fetcher = vi.fn(); vi.stubGlobal("fetch",fetcher);
  delete process.env.NEXT_PUBLIC_LEAN_SOURCE_SESSIONS_ENABLED;
  await recordSourceSessionNavigation(); await recordSourceSessionCart(cart);
  process.env.NEXT_PUBLIC_LEAN_SOURCE_SESSIONS_ENABLED = "true"; ports.sdk.__loaded = false;
  await recordSourceSessionNavigation();
  expect(fetcher).not.toHaveBeenCalled();
});
it("binds only initialized SDK ID after active choice, without browser clocks or quiz actions", async () => {
  process.env.NEXT_PUBLIC_LEAN_SOURCE_SESSIONS_ENABLED = "true"; vi.stubGlobal("window",{});
  ports.sdk.get_session_id.mockReturnValue(randomUUID());
  const fetcher = vi.fn(async (url:string) => url.endsWith("status") ? Response.json({active:true,expiresAt:new Date(Date.now()+60000).toISOString()}) : new Response(null,{status:204}));
  vi.stubGlobal("fetch",fetcher); await recordSourceSessionNavigation();
  const call = fetcher.mock.calls.find(c => c[0].endsWith("bind"));
  expect(call).toBeDefined();
  const init = (call as unknown as [string,RequestInit])[1];
  expect(Object.keys(JSON.parse(String(init.body)))).toEqual(["nativeSessionId"]);
  expect(ports.sdk.get_session_id).toHaveBeenCalled();
});
it("does not create a navigation binding during cart capture and swallows transport errors", async () => {
  process.env.NEXT_PUBLIC_LEAN_SOURCE_SESSIONS_ENABLED = "true"; vi.stubGlobal("window",{});
  const fetcher = vi.fn(async (url:string) => url.endsWith("status") ? Response.json({active:true,expiresAt:new Date(Date.now()+60000).toISOString()}) : Promise.reject(new Error("offline")));
  vi.stubGlobal("fetch",fetcher); await expect(recordSourceSessionCart(cart)).resolves.toBeUndefined();
  expect(fetcher.mock.calls.some(c => c[0].endsWith("bind"))).toBe(false);
});
it("renders bounded later-visit permission without claiming the first visit qualifies", () => {
  const html = renderToStaticMarkup(createElement(PreferencesClient,{allowEnabled:false}));
  expect(html).toContain("no longer than 24 hours"); expect(html).toContain("later visit");
  expect(html).toContain("current visit will usually have begun already"); expect(html).toContain("disabled");
  const source = readFileSync("src/app/analytics-session-preferences/PreferencesClient.tsx","utf8");
  expect(source).not.toMatch(/recordSourceSessionNavigation\(/);
  const hook = readFileSync("src/app/api/webhooks/shopify/orders-paid/route.ts","utf8");
  expect(hook.indexOf("if (await recordSourceSessionPaid")).toBeGreaterThan(hook.indexOf("const isValid = verifyShopifyHmac"));
  expect(hook.indexOf("if (await recordSourceSessionPaid")).toBeLessThan(hook.indexOf("const isDuplicate ="));
});

function admissionFixture() {
  const receipt = {nativeSessionId:native,capturedAt:"2026-10-08T06:00:01Z",conflicted:false,subjectId:"a".repeat(64),
    entryUuid:"20000000-0000-4000-8000-000000000001",sourceStartedAt:"2026-10-08T06:00:00Z",sourceReadSha256:"c".repeat(64),paidLinkUntil:"2026-10-17T06:00:00Z",
    filterSha256:nativeEntryFilterSha256,filterResults:Array(6).fill(true),
    permissionEvidenceRef:`explicit-browser-choice:${sourceSessionVersion}:${"a".repeat(64)}`,approvalRef:"fixture",
    validFrom:"2026-10-08T05:00:00Z",expiresAt:"2026-10-08T07:00:00Z",removed:false};
  const entry = {project:target.posthog,nativeSessionId:native,startedAt:"2026-10-08T06:00:00Z",endedAt:"2026-10-08T06:30:00Z",
    entryUuid:String(receipt.entryUuid),entryTimestamp:"2026-10-08T06:00:00Z",entryNativeSessionId:native,entryMatches:1,
    filterSha256:nativeEntryFilterSha256,filterResults:Array(6).fill(true)};
  const scope = {project:target.posthog,mappingVersion:"fixture",actionNamespace:"native-fixture",nativeReadRef:"fixture:native",
    authorityReadRef:"fixture:authority",capturedAt:"2026-10-08T08:00:00Z",asOf:"2026-10-08T08:00:00Z",maxReadAgeSeconds:60};
  return {receipt,entry,scope};
}
it("requires actual independently read native start/UUID and never manufactures a customer", () => {
  const f=admissionFixture(), result=admitSourceSessionReceipt(f.receipt,f.entry,f.scope);
  expect(result.state).toBe("eligible");
  if (result.state === "eligible") { expect(result.permission.customerId).toBeNull(); expect(result.entry.startedAt).toBe(f.entry.startedAt); }
  f.entry.entryUuid=""; expect(admitSourceSessionReceipt(f.receipt,f.entry,f.scope).state).toBe("unavailable");
});
it("withholds changed or malformed entry predicates instead of upgrading unknown to pass", () => {
  const f=admissionFixture(); f.receipt.filterResults[0]=null;
  expect(admitSourceSessionReceipt(f.receipt,f.entry,f.scope).state).toBe("unavailable");
  f.receipt.filterResults=Array(6).fill("true"); f.entry.filterResults=Array(6).fill("true");
  expect(admitSourceSessionReceipt(f.receipt,f.entry,f.scope).state).toBe("unavailable");
});
it.each([0,2])("withholds %i matching native entries", count => {
  const f=admissionFixture(); f.entry.entryMatches=count;
  expect(admitSourceSessionReceipt(f.receipt,f.entry,f.scope).state).toBe("unavailable");
});
it("leaves an already-started first visit unavailable after Allow and rejects a short TTL's next visit", () => {
  const f=admissionFixture(); f.receipt.validFrom="2026-10-08T06:00:00.000001Z";
  expect(admitSourceSessionReceipt(f.receipt,f.entry,f.scope)).toEqual({state:"unavailable",reason:"entry_outside_permission"});
  f.receipt.validFrom="2026-10-08T05:00:00Z"; f.receipt.expiresAt="2026-10-08T05:01:00Z";
  f.receipt.capturedAt="2026-10-08T05:00:30Z";
  expect(admitSourceSessionReceipt(f.receipt,f.entry,f.scope)).toEqual({state:"unavailable",reason:"entry_outside_permission"});
});
it.each(["removed","conflicted"] as const)("withholds %s receipt despite a genuine native start", field => {
  const f=admissionFixture(); f.receipt[field]=true;
  expect(admitSourceSessionReceipt(f.receipt,f.entry,f.scope).state).toBe("unavailable");
});
it("does not derive payment time from webhook root clocks", () => {
  const f=admissionFixture(), a=admitSourceSessionReceipt(f.receipt,f.entry,f.scope);
  const receipt = { orderGid:"gid://shopify/Order/123",shop:target.shop,topic:"orders/paid",verificationVersion:"shopify-hmac-sha256:source-session-v3",
    payloadSha256:"a".repeat(64),deliveryId:randomUUID(),webhookKeySha256:"b".repeat(64),removed:false,conflicted:false,
    nativeSessionId:native,subjectId:f.receipt.subjectId,permissionEvidenceRef:f.receipt.permissionEvidenceRef } as SourcePaidReceipt;
  const order = {order_id:key(target.shop,"123"),shop_id:target.shop,eligibility_status:"eligible",created_at:"2026-10-08T06:01:00Z",paid_at:null};
  expect(sourceSessionPaidEvidence(receipt,a,order,{project:target.posthog,sessionVersion:"fixture",receiptReadRef:"fixture:receipt",orderEvidenceRef:"fixture:transaction",
    capturedAt:f.scope.capturedAt,asOf:f.scope.asOf,maxReadAgeSeconds:60,webhookKeySha256:"b".repeat(64)},secret)).toBeNull();
});
it("joins an exact signed native cart and paid-root receipt only with independent actual payment evidence", () => {
  const f=admissionFixture(), a=admitSourceSessionReceipt(f.receipt,f.entry,f.scope);
  const cartCapturedAt="2026-10-08T06:05:00Z";
  const contextToken=signCheckoutContext({project:target.posthog,shop:target.shop,checkoutId:"fixture_cart",sessionId:native,
    serverSubject:f.receipt.subjectId,analyticsPermitted:true,now:Date.parse(cartCapturedAt)/1000,ttlSeconds:3600},secret)!;
  const receipt:SourcePaidReceipt={orderGid:"gid://shopify/Order/123",cartToken:"fixture_cart",nativeSessionId:native,
    payloadSha256:"a".repeat(64),deliveryId:randomUUID(),shop:target.shop,topic:"orders/paid",verificationVersion:"shopify-hmac-sha256:source-session-v3",
    webhookKeySha256:"b".repeat(64),orderCreatedAt:"2026-10-08T06:06:00Z",orderProcessedAt:"2026-10-08T06:06:01Z",
    orderUpdatedAt:"2026-10-08T06:07:02Z",receivedAt:"2026-10-08T06:08:00Z",cartCapturedAt,contextToken,
    paidLinkUntil:f.receipt.paidLinkUntil,
    subjectId:f.receipt.subjectId,permissionEvidenceRef:f.receipt.permissionEvidenceRef,removed:false,conflicted:false};
  const order={order_id:key(target.shop,"123"),shop_id:target.shop,eligibility_status:"eligible",created_at:receipt.orderCreatedAt,paid_at:"2026-10-08T06:07:00Z"};
  const scope={project:target.posthog,sessionVersion:"native-v3-fixture",receiptReadRef:"fixture:receipt",orderEvidenceRef:"fixture:transaction",
    capturedAt:f.scope.capturedAt,asOf:f.scope.asOf,maxReadAgeSeconds:60,webhookKeySha256:"b".repeat(64)};
  expect(sourceSessionPaidEvidence(receipt,a,order,scope,secret)).toMatchObject({orderId:order.order_id,
    sessionKey:key(target.posthog,scope.sessionVersion,native),method:"verified_first_party_context"});
  // A successful transaction can precede the native order-created clock.
  // Preserve both genuine source clocks; do not invent an extra exclusion.
  expect(sourceSessionPaidEvidence(receipt,a,{...order,paid_at:"2026-10-08T06:05:57Z"},scope,secret)).not.toBeNull();
  expect(sourceSessionPaidEvidence(receipt,a,{...order,paid_at:null},scope,secret)).toBeNull();
  expect(sourceSessionPaidEvidence(receipt,a,{...order,paid_at:"2026-10-08T06:04:00Z"},scope,secret)).toBeNull();
  expect(sourceSessionPaidEvidence({...receipt,removed:true},a,order,scope,secret)).toBeNull();
  expect(sourceSessionPaidEvidence({...receipt,contextToken:contextToken+"x"},a,order,scope,secret)).toBeNull();
  expect(sourceSessionPaidEvidence(receipt,a,{...order,order_id:"other"},scope,secret)).toBeNull();
  const lateScope={...scope,capturedAt:"2026-10-17T05:59:59Z",asOf:"2026-10-17T05:59:59Z"};
  const lateAdmission=admitSourceSessionReceipt(f.receipt,f.entry,{...f.scope,capturedAt:lateScope.capturedAt,asOf:lateScope.asOf});
  const arrivedLate={...receipt,receivedAt:"2026-10-17T05:59:00Z"};
  expect(sourceSessionPaidEvidence(arrivedLate,lateAdmission,{...order,paid_at:"2026-10-15T05:59:00Z"},lateScope,secret)).not.toBeNull();
  expect(sourceSessionPaidEvidence(arrivedLate,lateAdmission,{...order,paid_at:"2026-10-15T06:00:00Z"},lateScope,secret)).toBeNull();
  expect(sourceSessionPaidEvidence({...arrivedLate,receivedAt:receipt.paidLinkUntil},lateAdmission,order,
    {...lateScope,capturedAt:receipt.paidLinkUntil,asOf:receipt.paidLinkUntil},secret)).toBeNull();
});
it("keeps client native identifiers local without an active choice", async () => {
  process.env.NEXT_PUBLIC_LEAN_SOURCE_SESSIONS_ENABLED="true"; vi.stubGlobal("window",{});
  const fetcher=vi.fn(async () => Response.json({active:false,expiresAt:null})); vi.stubGlobal("fetch",fetcher);
  await recordSourceSessionNavigation();
  expect(fetcher).toHaveBeenCalledTimes(1); expect(ports.sdk.get_session_id).not.toHaveBeenCalled();
});
it("retries an unconfirmed bind but caches confirmed native/expiry pairs", async () => {
  process.env.NEXT_PUBLIC_LEAN_SOURCE_SESSIONS_ENABLED="true"; vi.stubGlobal("window",{});
  ports.sdk.get_session_id.mockReturnValue(randomUUID());
  const expiresAt=new Date(Date.now()+60000).toISOString(); let bindings=0;
  vi.stubGlobal("fetch",vi.fn(async (url:string) => url.endsWith("status") ? Response.json({active:true,expiresAt})
    : new Response(null,{status:++bindings === 1 ? 202 : 204})));
  await recordSourceSessionNavigation(); await recordSourceSessionNavigation(); await recordSourceSessionNavigation();
  expect(bindings).toBe(2);
});

it("keeps later matching withdrawable after capture expiry and revokes the old choice before replacing it", async () => {
  await enable(); const a=await allow();
  const choice=await decideSourceSession(a.req,"allow",sourceSessionVersion,a.r);
  expect(choice.maxAge).toBeGreaterThan(9*86400);
  expect(choice.maxAge).toBeLessThanOrEqual(9*86400+3600);
  const oldNow=a.r.now;
  a.r.now=()=>Date.parse(choice.expiresAt!)-1000.25;
  expect((await decideSourceSession(a.req,"allow",sourceSessionVersion,a.r)).maxAge).toBe(9*86400+2);
  a.r.now=oldNow;
  await db.query("update lean_private.journey_grants set valid_from=clock_timestamp()-interval '2 hours',expires_at=clock_timestamp()-interval '1 hour' where token_hash=$1",[a.hash]);
  const replacement=await decideSourceSession(a.req,"allow",sourceSessionVersion,a.r);
  expect(replacement.token).not.toBe(a.token);
  expect((await db.query("select revoked_at is not null revoked from lean_private.journey_grants where token_hash=$1",[a.hash])).rows[0]).toEqual({revoked:true});
});
it.each(["LEAN_SHOPIFY_WEBHOOK_SECRET","LEAN_POSTHOG_QUERY_READ_KEY"])("does not fall back to a generic secret for %s", async field => {
  await enable(); const r=runtime();
  r.env.SHOPIFY_WEBHOOK_SECRET=webhookSecret; r.env.POSTHOG_PERSONAL_API_KEY=readKey;
  delete r.env[field]; expect(await sourceSessionConfig(r)).toBeNull();
});
it.each([2,240])("later-order receipt at %ih requires the immutable deadline, not extended capture permission", async hours => {
  await enable(); const a=await allow(); await bindSourceSession(a.req,native,a.r); await attachSourceSessionCart(a.req,native,cart,a.r);
  await expect(db.exec("update lean_private.source_session_receipts set paid_link_until=paid_link_until+interval '1 hour'")).rejects.toThrow();
  // Local synthetic clock fixture only. Production code has no such operation.
  // Shift the entire already-verified graph coherently, then restore all guards.
  await db.exec("set session_replication_role=replica");
  try {
    await db.query("update lean_private.journey_grants set valid_from=valid_from-$1*interval '1 hour',expires_at=expires_at-$1*interval '1 hour'",[hours]);
    await db.query("update lean_private.source_session_receipts set source_started_at=source_started_at-$1*interval '1 hour',source_ended_at=source_ended_at-$1*interval '1 hour',paid_link_until=paid_link_until-$1*interval '1 hour',captured_at=captured_at-$1*interval '1 hour'",[hours]);
    await db.query("update lean_private.source_session_cart_receipts set captured_at=captured_at-$1*interval '1 hour'",[hours]);
  } finally { await db.exec("set session_replication_role=origin"); }
  expect(await bindSourceSession(a.req,native,a.r)).toBe(false);
  expect(await attachSourceSessionCart(a.req,native,cart,a.r)).toBe(false);
  const event=paid();
  expect(await recordSourceSessionPaid(event.headers,event.raw,a.r)).toBe(hours===2 ? "retained" : "unconfirmed");
  await decideSourceSession(a.req,"withdraw",sourceSessionVersion,a.r);
  expect(await recordSourceSessionPaid(event.headers,event.raw,a.r)).toBe("unconfirmed");
});
function nativeReadFixture() {
  const g={validFrom:"2026-10-08T05:00:00Z",expiresAt:"2026-10-08T07:00:00Z"} as JourneyGrant;
  const columns=["native_session_id","started_at","ended_at","entry_matches","entry_uuid","filter_0","filter_1","filter_2","filter_3","filter_4","filter_5"];
  const row: unknown[]=[native,"2026-10-08T06:00:00Z","2026-10-08T06:01:00Z",1,"20000000-0000-4000-8000-000000000001",true,1,0,false,null,true];
  const r=runtime(); r.now=()=>Date.parse("2026-10-08T08:00:00Z");
  r.request=vi.fn(async()=>Response.json({columns,results:[row]}));
  return {g,columns,row,r};
}
it("bounds one native UUID read and retains only exact entry flags, never raw contacts or read key", async () => {
  const f=nativeReadFixture(); const result=await readNativeSessionForBinding(native,f.g,f.r);
  expect(result?.filterResults).toEqual([true,true,false,false,null,true]);
  expect(JSON.stringify(result)).not.toContain(readKey);
  const call=vi.mocked(f.r.request).mock.calls[0];
  expect(call[0]).toBe("https://us.posthog.com/api/projects/353503/query/");
  const init=call[1]!; expect(init.redirect).toBe("error"); expect(init.signal).toBeInstanceOf(AbortSignal);
  const query=JSON.parse(String(init.body)).query.query;
  expect(query).toContain("e.$session_id = s.session_id AND e.timestamp = s.$start_timestamp");
  expect(query).not.toContain("properties.$session_id"); expect(query).toContain("LIMIT 2");
  expect(query).not.toContain(readKey);
  expect(await readNativeSessionForBinding("' OR 1=1",f.g,f.r)).toBeNull();
  expect(f.r.request).toHaveBeenCalledTimes(1);
});
it.each(["rows","ties","none","boolean-string","pre-Allow","future","overflow","columns","incomplete","key-absent"])("rejects native read %s", async failure => {
  const f=nativeReadFixture();
  if (failure==="ties") f.row[3]=2;
  if (failure==="none") f.row[3]=0;
  if (failure==="boolean-string") f.row[6]="true";
  if (failure==="pre-Allow") f.row[1]="2026-10-08T04:59:59Z";
  if (failure==="future") f.row[2]="2026-10-08T08:00:01Z";
  if (failure==="key-absent") delete f.r.env.LEAN_POSTHOG_QUERY_READ_KEY;
  f.r.request=vi.fn(async()=>failure==="overflow" ? new Response("x".repeat(65537)) : Response.json({
    columns:failure==="columns" ? ["unexpected"] : f.columns,
    results:failure==="rows" ? [f.row,f.row] : [f.row],...(failure==="incomplete" ? {query_status:{complete:false}} : {})}));
  expect(await readNativeSessionForBinding(native,f.g,f.r)).toBeNull();
});
it("rechecks revocation after native source I/O before binding", async () => {
  await enable(); const a=await allow(), original=a.r.request;
  a.r.request=vi.fn(async (...args:Parameters<typeof fetch>)=>{
    const result=await original(...args); await decideSourceSession(a.req,"withdraw",sourceSessionVersion,a.r); return result;
  });
  expect(await bindSourceSession(a.req,native,a.r)).toBe(false);
  expect(await count("source_session_receipts")).toBe(0);
});

it("publication hygiene: missing config disables Allow and native reads without fallback or reflection", async () => {
  ports.filters.mockReturnValue(null);
  const r=runtime(); r.env.POSTHOG_TEST_ACCOUNT_FILTERS="unreviewed-generic-value";
  expect(await sourceSessionConfig(r)).toBeNull();
  await expect(decideSourceSession(request(),"allow",sourceSessionVersion,r)).rejects.toThrow("source_choice_unavailable");
  expect(await readNativeSessionForBinding(native,nativeReadFixture().g,r)).toBeNull();
  expect(r.request).not.toHaveBeenCalled(); expect(await count("journey_grants")).toBe(0);
});
it.each(["absent","malformed","length","operator","extra","order","digest"])("publication hygiene: exact parser refuses %s configuration", async failure => {
  const {nativeFilterRules}=await vi.importActual<typeof import("@/lib/analytics/journeyNativeFilterConfig")>("@/lib/analytics/journeyNativeFilterConfig");
  const rules=[{key:"$host",type:"event",value:"^(localhost|127\\.0\\.0\\.1)($|:)",operator:"not_regex"},
    ...["synthetic_a","synthetic_b","synthetic_c","synthetic_d","synthetic_e"].map(value=>({key:"email",type:"person",value,operator:"not_icontains"}))];
  if(failure==="length") rules.pop();
  if(failure==="operator") rules[1].operator="icontains";
  if(failure==="extra") Object.assign(rules[1],{extra:true});
  if(failure==="order") rules.reverse();
  const env:NodeJS.ProcessEnv={NODE_ENV:"test",LEAN_POSTHOG_TEST_ACCOUNT_FILTERS:failure==="malformed" ? "private-invalid-fixture{" : JSON.stringify(rules)};
  if(failure==="absent") delete env.LEAN_POSTHOG_TEST_ACCOUNT_FILTERS;
  // Even a structurally valid synthetic set is not the fixed reviewed digest.
  expect(nativeFilterRules(env)).toBeNull();
});
it("publication hygiene: parser refuses browser context before reading configuration", async () => {
  const {nativeFilterRules}=await vi.importActual<typeof import("@/lib/analytics/journeyNativeFilterConfig")>("@/lib/analytics/journeyNativeFilterConfig");
  vi.stubGlobal("window",{});
  const env=new Proxy({NODE_ENV:"test"} as NodeJS.ProcessEnv, {get:()=>{throw Error("must_not_read_browser_config");}});
  expect(nativeFilterRules(env)).toBeNull();
});
it("publication hygiene: synthetic query fixture remains server-side and absent from returned projection", async () => {
  const f=nativeReadFixture(), result=await readNativeSessionForBinding(native,f.g,f.r);
  expect(result).not.toBeNull(); expect(JSON.stringify(result)).not.toContain("synthetic_");
  const body=String(vi.mocked(f.r.request).mock.calls[0][1]?.body);
  expect(body).toContain("synthetic_a"); expect(body).toContain("synthetic_e");
});
