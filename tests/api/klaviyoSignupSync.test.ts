/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/firebase-admin", () => ({ adminDb: { collection: vi.fn() } }));
vi.mock("@/lib/events/alert", () => ({ raiseAlert: vi.fn(async () => undefined) }));
vi.mock("@/lib/klaviyo/config", async (orig) => ({
  ...(await orig<typeof import("@/lib/klaviyo/config")>()),
  KLAVIYO_SIGNUP_LIST_ID: "LIST01",
}));

const EMAIL = "drew+synctest1@mullybox.com";
const PHONE = "+13135550123";

type Call = { path: string; body: any };

function mockKlaviyo(handler?: (path: string, body: any, n: number) => Response | Promise<Response> | undefined) {
  const calls: Call[] = [];
  const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
    const path = String(url).replace("https://a.klaviyo.com", "");
    const body = init.body ? JSON.parse(String(init.body)) : null;
    calls.push({ path, body });
    const custom = await handler?.(path, body, calls.length);
    if (custom) return custom;
    if (path === "/api/profile-import") {
      return new Response(JSON.stringify({ data: { id: "PROF1", attributes: { properties: { mully_first_signup_source: "x" } } } }), { status: 200 });
    }
    return new Response("", { status: 202 });
  });
  vi.stubGlobal("fetch", fetchMock);
  return { calls, fetchMock };
}

const subscribeCalls = (calls: Call[]) => calls.filter((c) => c.path === "/api/profile-subscription-bulk-create-jobs");
const eventCalls = (calls: Call[]) => calls.filter((c) => c.path === "/api/events");

beforeEach(() => {
  process.env.KLAVIYO_PRIVATE_API_KEY = "pk_test";
  process.env.KLAVIYO_SYNC_ENABLED = "true";
  vi.unstubAllGlobals();
});

function fakeRef(id: string, data: Record<string, any>) {
  const state = { data: structuredClone(data) as Record<string, any> };
  const merge = (target: any, src: any) => {
    for (const [k, v] of Object.entries(src)) {
      if (v && typeof v === "object" && !Array.isArray(v) && !(v instanceof Date) && v.constructor === Object) {
        target[k] = merge(target[k] && typeof target[k] === "object" ? target[k] : {}, v);
      } else target[k] = v;
    }
    return target;
  };
  return {
    id,
    state,
    get: vi.fn(async () => ({ exists: true, data: () => state.data })),
    set: vi.fn(async (u: Record<string, any>) => { merge(state.data, u); }),
  };
}

const popupLead = (extra: Record<string, any> = {}) => ({
  email: EMAIL,
  interest: "tops",
  emailConsent: { granted: true, capturedAt: new Date("2026-10-04T12:00:00Z") },
  klaviyoSync: { attempts: 0, stages: { email: "pending" } },
  sendingStatus: "not_synced",
  ...extra,
});

describe("consent mapping (A6)", () => {
  it("popup email stage subscribes email into the signup list, live (not historical)", async () => {
    const { buildStageInputs } = await import("@/lib/klaviyo/syncState");
    const { syncSignupToKlaviyo } = await import("@/lib/klaviyo/syncSignup");
    const { calls } = mockKlaviyo();
    const input = buildStageInputs("shop_marketing_leads", "lead1", popupLead()).email;
    const res = await syncSignupToKlaviyo(input);
    expect(res.status).toBe("synced");
    const sub = subscribeCalls(calls);
    expect(sub).toHaveLength(1);
    const attrs = sub[0].body.data.attributes;
    expect(attrs.historical_import).toBe(false);
    expect(attrs.custom_source).toBe("shop-edit-popup");
    expect(sub[0].body.data.relationships.list.data.id).toBe("LIST01");
    const p = attrs.profiles.data[0].attributes;
    expect(p.subscriptions).toEqual({ email: { marketing: { consent: "SUBSCRIBED" } } });
    expect(JSON.stringify(sub[0].body)).not.toContain("consented_at");
    const profile = calls.find((c) => c.path === "/api/profile-import")!.body.data.attributes;
    expect(profile.properties).toMatchObject({
      mully_last_signup_source: "shop-edit-popup",
      mully_interest: "tops",
      mully_reward_percent: 10,
      mully_reward_code: "MULLYEDIT10",
      mully_email_consent_captured: true,
    });
  });

  it("popup SMS stage subscribes SMS only and never re-sends email; resolves email from the lead doc", async () => {
    const { buildStageInputs } = await import("@/lib/klaviyo/syncState");
    const { syncSignupToKlaviyo } = await import("@/lib/klaviyo/syncSignup");
    const { calls } = mockKlaviyo();
    const lead = popupLead({ phone: PHONE, smsConsent: { granted: true, capturedAt: new Date() } });
    const input = buildStageInputs("shop_marketing_leads", "lead1", lead).sms;
    expect(input.email).toBe(EMAIL);
    await syncSignupToKlaviyo(input);
    const sub = subscribeCalls(calls)[0].body.data.attributes.profiles.data[0].attributes;
    expect(sub.subscriptions).toEqual({ sms: { marketing: { consent: "SUBSCRIBED" } } });
    expect(sub.email).toBeUndefined();
    expect(sub.phone_number).toBe(PHONE);
  });

  it("shop-newsletter subscribes only with consent in this submission", async () => {
    const { buildStageInputs } = await import("@/lib/klaviyo/syncState");
    const yes = buildStageInputs("editorial_drop_list", EMAIL, { email: EMAIL, source: "shop-newsletter", lastSubmissionConsent: true });
    expect(yes.email.subscribe).toEqual({ email: true });
  });

  it("editorial drop bar: no checkbox means contact only, even if an older submission consented", async () => {
    const { buildStageInputs } = await import("@/lib/klaviyo/syncState");
    const stale = buildStageInputs("editorial_drop_list", EMAIL, {
      email: EMAIL, source: "editorial-drop-bar", emailMarketingConsent: true, lastSubmissionConsent: false,
    });
    expect(stale.email.subscribe).toEqual({ email: false });
    const ticked = buildStageInputs("editorial_drop_list", EMAIL, { email: EMAIL, source: "editorial-drop-bar", lastSubmissionConsent: true });
    expect(ticked.email.subscribe).toEqual({ email: true });
  });

  it("stylist phone is never SMS consent", async () => {
    const { buildStageInputs } = await import("@/lib/klaviyo/syncState");
    const out = buildStageInputs("editorial_drop_list", EMAIL, { email: EMAIL, stylistOptIn: true, phone: "313-555-0123" });
    expect(out.stylist.subscribe).toBeUndefined();
  });

  it("back-in-stock, account start and application forms are profile + event only", async () => {
    const { buildStageInputs } = await import("@/lib/klaviyo/syncState");
    const { syncSignupToKlaviyo } = await import("@/lib/klaviyo/syncSignup");
    const { calls } = mockKlaviyo();
    const bis = buildStageInputs("back_in_stock_requests", "b1", { email: EMAIL, productSlug: "polo", variantId: "v1", size: "L" }).request;
    const job = buildStageInputs("klaviyo_sync_jobs", "account-start:abc", { email: EMAIL, source: "account-start" }).contact;
    await syncSignupToKlaviyo(bis);
    await syncSignupToKlaviyo(job);
    expect(subscribeCalls(calls)).toHaveLength(0);
    expect(eventCalls(calls)[0].body.data.attributes.properties).toMatchObject({ product_slug: "polo", variant_id: "v1", size: "L" });
  });
});

describe("failures and retries", () => {
  it("flag off: no network calls, doc stays not_synced", async () => {
    process.env.KLAVIYO_SYNC_ENABLED = "false";
    const { syncDocRef } = await import("@/lib/klaviyo/syncState");
    const { fetchMock } = mockKlaviyo();
    const ref = fakeRef("lead1", popupLead());
    const out = await syncDocRef("shop_marketing_leads", ref as any);
    expect(out.status).toBe("skipped");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(ref.state.data.sendingStatus).toBe("not_synced");
  });

  it.each([
    ["500", () => new Response("", { status: 500 })],
    ["429", () => new Response("", { status: 429, headers: { "retry-after": "1" } })],
    ["network", () => { throw new TypeError("fetch failed"); }],
  ])("%s marks the doc failed and schedules nextAttemptAt", async (_label, fail) => {
    const { syncDocRef } = await import("@/lib/klaviyo/syncState");
    mockKlaviyo(() => fail() as Response);
    const ref = fakeRef("lead1", popupLead());
    const now = new Date("2026-10-04T12:00:00Z");
    const out = await syncDocRef("shop_marketing_leads", ref as any, { now });
    expect(out.status).toBe("failed");
    expect(ref.state.data.sendingStatus).toBe("failed");
    expect(ref.state.data.klaviyoSync.attempts).toBe(1);
    expect(ref.state.data.klaviyoSync.nextAttemptAt.toDate().getTime()).toBe(now.getTime() + 60_000);
  }, 20_000);

  it("timeout surfaces as a timeout failure", async () => {
    const { klaviyoRequest, KlaviyoError } = await import("@/lib/klaviyo/client");
    const abortErr = Object.assign(new Error("aborted"), { name: "AbortError" });
    const fetchImpl = vi.fn(async () => { throw abortErr; });
    await expect(klaviyoRequest("/api/events", { body: {} }, { fetchImpl: fetchImpl as any, sleepImpl: async () => {} }))
      .rejects.toMatchObject({ code: "timeout" });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(KlaviyoError).toBeDefined();
  });

  it("honors Retry-After on 429 then succeeds", async () => {
    const { klaviyoRequest } = await import("@/lib/klaviyo/client");
    const waits: number[] = [];
    let n = 0;
    const fetchImpl = vi.fn(async () => (++n === 1 ? new Response("", { status: 429, headers: { "retry-after": "2" } }) : new Response("", { status: 202 })));
    const res = await klaviyoRequest("/api/events", { body: {} }, { fetchImpl: fetchImpl as any, sleepImpl: async (ms) => { waits.push(ms); } });
    expect(res.status).toBe(202);
    expect(waits).toEqual([2000]);
  });

  it("backoff schedule and dead after 8 attempts with an alert", async () => {
    const { syncDocRef, backoffMinutes } = await import("@/lib/klaviyo/syncState");
    const { raiseAlert } = await import("@/lib/events/alert");
    expect([1, 2, 3, 4, 5, 6, 7, 8].map(backoffMinutes)).toEqual([1, 5, 15, 30, 60, 120, 240, 480]);
    mockKlaviyo(() => new Response("", { status: 400 }));
    const ref = fakeRef("lead1", popupLead({ klaviyoSync: { attempts: 7, stages: { email: "failed" } } }));
    const out = await syncDocRef("shop_marketing_leads", ref as any);
    expect(out.status).toBe("dead");
    expect(raiseAlert).toHaveBeenCalledWith(expect.objectContaining({ kind: "klaviyo_sync_failed" }));
    expect(JSON.stringify(vi.mocked(raiseAlert).mock.calls)).not.toContain(EMAIL);
  });

  it("phone conflict retries once without the phone and records phone_conflict", async () => {
    const { syncSignupToKlaviyo } = await import("@/lib/klaviyo/syncSignup");
    const { calls } = mockKlaviyo((path, body) =>
      path === "/api/profile-import" && body.data.attributes.phone_number
        ? new Response(JSON.stringify({ errors: [{ code: "duplicate_profile" }] }), { status: 409 })
        : undefined,
    );
    const res = await syncSignupToKlaviyo({
      source: "shop-edit-popup", stage: "sms", docKey: "lead1", email: EMAIL, phone: PHONE,
      capturedAt: new Date(), subscribe: { sms: true },
    });
    expect(res.status).toBe("synced");
    expect(res.errorCode).toBe("phone_conflict");
    const imports = calls.filter((c) => c.path === "/api/profile-import");
    expect(imports[0].body.data.attributes.phone_number).toBe(PHONE);
    expect(imports[1].body.data.attributes.phone_number).toBeUndefined();
    expect(subscribeCalls(calls)).toHaveLength(0);
  });
});

describe("idempotency", () => {
  it("event unique_id is deterministic per source/doc/stage", async () => {
    const { syncSignupToKlaviyo } = await import("@/lib/klaviyo/syncSignup");
    const { calls } = mockKlaviyo();
    const input = { source: "shop-edit-popup", stage: "email", docKey: "lead1", email: EMAIL, capturedAt: new Date() };
    await syncSignupToKlaviyo(input);
    await syncSignupToKlaviyo(input);
    const ids = eventCalls(calls).map((c) => c.body.data.attributes.unique_id);
    expect(ids).toEqual(["shop-edit-popup:lead1:email", "shop-edit-popup:lead1:email"]);
  });

  it("a synced doc is not re-sent by the cron", async () => {
    const { syncDocRef } = await import("@/lib/klaviyo/syncState");
    const { fetchMock } = mockKlaviyo();
    const ref = fakeRef("lead1", popupLead({ sendingStatus: "synced", klaviyoSync: { attempts: 1, stages: { email: "synced" } } }));
    await syncDocRef("shop_marketing_leads", ref as any);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("first signup source is set only when missing", async () => {
    const { syncSignupToKlaviyo } = await import("@/lib/klaviyo/syncSignup");
    const { calls } = mockKlaviyo((path, _b, n) =>
      path === "/api/profile-import" && n === 1
        ? new Response(JSON.stringify({ data: { id: "P", attributes: { properties: {} } } }), { status: 201 })
        : undefined,
    );
    await syncSignupToKlaviyo({ source: "shop-newsletter", stage: "email", docKey: "d", email: EMAIL, capturedAt: new Date() });
    const imports = calls.filter((c) => c.path === "/api/profile-import");
    expect(imports).toHaveLength(2);
    expect(imports[1].body.data.attributes.properties).toEqual({ mully_first_signup_source: "shop-newsletter" });
  });
});

describe("historical backfill", () => {
  it("uses historical_import with consented_at from the stored consent", async () => {
    const { buildStageInputs } = await import("@/lib/klaviyo/syncState");
    const { syncSignupToKlaviyo } = await import("@/lib/klaviyo/syncSignup");
    const { calls } = mockKlaviyo();
    const input = buildStageInputs("shop_marketing_leads", "lead1", popupLead(), { historical: true }).email;
    await syncSignupToKlaviyo(input);
    const attrs = subscribeCalls(calls)[0].body.data.attributes;
    expect(attrs.historical_import).toBe(true);
    expect(attrs.profiles.data[0].attributes.subscriptions.email.marketing.consented_at).toBe("2026-10-04T12:00:00.000Z");
  });

  it("July editorial docs without consent fields are never subscribed", async () => {
    const { buildStageInputs } = await import("@/lib/klaviyo/syncState");
    const out = buildStageInputs("editorial_drop_list", EMAIL, { email: EMAIL, source: "editorial-drop-bar" }, { historical: true });
    expect(out.email.subscribe).toEqual({ email: false });
    expect(out.email.historical).toBeUndefined();
  });
});

describe("no PII in logs", () => {
  it("never logs email or phone on failure", async () => {
    const spies = (["log", "warn", "error", "info"] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => {}));
    const { syncDocRef } = await import("@/lib/klaviyo/syncState");
    mockKlaviyo(() => new Response(JSON.stringify({ errors: [{ code: "invalid", detail: EMAIL }] }), { status: 400 }));
    const ref = fakeRef("lead1", popupLead({ phone: PHONE, smsConsent: { granted: true, capturedAt: new Date() } }));
    await syncDocRef("shop_marketing_leads", ref as any);
    const logged = JSON.stringify(spies.flatMap((s) => s.mock.calls));
    expect(logged).not.toContain(EMAIL);
    expect(logged).not.toContain(PHONE);
    expect(JSON.stringify(ref.state.data.klaviyoSync)).not.toContain(EMAIL);
  });
});
