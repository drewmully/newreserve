import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/firebase-admin", () => ({ adminDb: { collection: () => ({ doc: () => ({ get: async () => ({ exists: false }) }) }) } }));

import { createTakeAShotService, COLLECTIONS, type TasStore, type TasTx } from "@/lib/takeAShot/service";
import { buildDiscountInput, codeExpiry, makeCode } from "@/lib/takeAShot/codes";
import { CODE_RULES, FLOOR_PERCENT, MAX_PERCENT, SHOTS, isTakeAShotServerEnabled, percentForResult } from "@/lib/takeAShot/config";
import { isDisposableDomain, leadIdFor, normalizeEmail } from "@/lib/takeAShot/identity";
import { mulberry32, simulateShot, windFrom } from "@/lib/takeAShot/sim";
import { discountGraphQL, getDiscountToken, probeDiscountTokens, resetDiscountTokenCache } from "@/lib/takeAShot/discountToken";
import { GAME_CODE_PATTERN, isGameRewardCode } from "@/lib/shopRewards";
import { buildStageInputs } from "@/lib/klaviyo/syncState";
import { decideGameReward, pickReward } from "@/lib/lifecycle/rewards";

type Data = Record<string, unknown>;

function memoryStore() {
  const db = new Map<string, Map<string, Data>>();
  const col = (c: string) => { if (!db.has(c)) db.set(c, new Map()); return db.get(c)!; };
  const consent: Data[] = [];
  const synced: Array<{ id: string; stages: string[] }> = [];
  const store: TasStore = {
    async transaction(fn) {
      const writes: Array<() => void> = [];
      const tx: TasTx = {
        async get(c, id) { const d = col(c).get(id); return d ? structuredClone(d) : null; },
        set(c, id, data, opts) { writes.push(() => col(c).set(id, opts?.merge ? { ...(col(c).get(id) ?? {}), ...data } : { ...data })); },
        addConsentEvent(leadId, data) { writes.push(() => consent.push({ leadId, ...data })); },
        markForSync(id, stages) { writes.push(() => synced.push({ id, stages })); },
      };
      const out = await fn(tx);
      writes.forEach((w) => w());
      return out;
    },
    async findWhere(c, field, value, limit) {
      const get = (d: Data) => field.split(".").reduce<unknown>((v, k) => (v as Data | undefined)?.[k], d);
      return [...col(c).entries()].filter(([, d]) => get(d) === value).slice(0, limit).map(([id, data]) => ({ id, data }));
    },
  };
  return { store, db, col, consent, synced };
}

function setup(opts: { createFails?: boolean } = {}) {
  const mem = memoryStore();
  let clock = Date.parse("2026-11-11T15:00:00Z");
  let ids = 0, discounts = 0;
  const created: Array<{ code: string; percent: number }> = [];
  const removed: string[] = [];
  const shopify = {
    fail: Boolean(opts.createFails),
    async create(i: { code: string; percent: number }) {
      if (shopify.fail) throw new Error("access_denied");
      created.push(i);
      return { discountId: `gid://shopify/DiscountCodeNode/${++discounts}` };
    },
    async remove(id: string) { removed.push(id); },
  };
  const service = createTakeAShotService({
    store: mem.store, shopify, mxCheck: async (d) => (d === "nomail.example" ? false : true),
    rand: mulberry32(42), newId: () => `sid${++ids}`, now: () => clock,
  });
  const ctx = (visitor = "v-1") => ({ ipHash: "ip", visitor, page: "/shop", userAgent: "test" });
  return { ...mem, service, shopify, created, removed, ctx, tick: (ms: number) => { clock += ms; }, now: () => clock };
}

describe("scoring", () => {
  it("is deterministic for the same inputs", () => {
    const input = { pin: 2, wind: windFrom(9, 120), target: { x: 3, y: -4 }, e: 0.12, noise: { carry: 0.01, lat: -0.02 } };
    expect(simulateShot(input)).toEqual(simulateShot(structuredClone(input)));
    expect(simulateShot(input).result).toEqual(simulateShot(input).result);
  });
  it("pays Drew's ring table and never above the cap", () => {
    expect(percentForResult("green", 2)).toBe(30);
    expect(percentForResult("green", 3)).toBe(30);
    expect(percentForResult("green", 6)).toBe(25);
    expect(percentForResult("green", 12)).toBe(20);
    expect(percentForResult("green", 20)).toBe(15);
    expect(percentForResult("green", 30)).toBe(0);
    expect(percentForResult("water", 1)).toBe(0);
    expect(percentForResult("holed", 0)).toBe(30);
    expect(MAX_PERCENT).toBe(30);
    expect(FLOOR_PERCENT).toEqual({ email: 10, phone: 15 });
    expect(SHOTS).toEqual({ email: 1, phone: 3 });
  });
});

describe("identity", () => {
  it("folds Gmail dots, +tags and googlemail.com", () => {
    const a = normalizeEmail("J.Doe+golf@Gmail.com")!, b = normalizeEmail("jdoe@googlemail.com")!;
    expect(a.key).toBe(b.key);
    expect(a.email).toBe("j.doe+golf@gmail.com");
    expect(normalizeEmail("j.doe+x@example.com")!.key).not.toBe(normalizeEmail("jdoe@example.com")!.key);
    expect(normalizeEmail("not-an-email")).toBeNull();
    expect(leadIdFor(a.key)).toBe(leadIdFor(b.key));
  });
  it("flags disposable domains", () => {
    expect(isDisposableDomain("mailinator.com")).toBe(true);
    expect(isDisposableDomain("gmail.com")).toBe(false);
  });
});

describe("service", () => {
  let t: ReturnType<typeof setup>;
  beforeEach(() => { t = setup(); });

  it("rejects disposable and no-MX inboxes", async () => {
    expect(await t.service.check({ email: "a@mailinator.com" }, t.ctx())).toMatchObject({ status: "error", code: "disposable_email" });
    expect(await t.service.check({ email: "a@nomail.example" }, t.ctx())).toMatchObject({ status: "error", code: "no_mx" });
    expect(await t.service.check({ email: "a@example.com" }, t.ctx())).toEqual({ status: "ok" });
  });

  it("requires email consent, and SMS consent when a phone is given", async () => {
    expect(await t.service.session({ email: "a@example.com" }, t.ctx())).toMatchObject({ code: "consent_required" });
    expect(await t.service.session({ email: "a@example.com", emailConsent: true, phone: "+1 415 555 0134" }, t.ctx()))
      .toMatchObject({ code: "sms_consent_required" });
    expect(t.col(COLLECTIONS.leads).size).toBe(0);
  });

  it("gives 1 shot at 10% for email and 3 shots at 15% with SMS", async () => {
    const e = await t.service.session({ email: "a@example.com", emailConsent: true }, t.ctx("v-a"));
    expect(e).toMatchObject({ status: "new", session: { shots: 1, floor: 10 } });
    const p = await t.service.session({ email: "b@example.com", emailConsent: true, phone: "+14155550134", smsConsent: true }, t.ctx("v-b"));
    expect(p).toMatchObject({ status: "new", session: { shots: 3, floor: 15 } });
    expect(t.consent.map((c) => c.channel)).toEqual(["email", "email", "sms"]);
  });

  it("one game per email, phone and browser; codes only shown back to the same browser", async () => {
    await t.service.session({ email: "jdoe@gmail.com", emailConsent: true, phone: "+14155550134", smsConsent: true }, t.ctx("v-1"));
    // Same inbox in another form, other browser: told it was emailed, nothing revealed.
    expect(await t.service.session({ email: "j.d.o.e+2@googlemail.com", emailConsent: true }, t.ctx("v-2")))
      .toEqual({ status: "existing", claim: null, emailed: true });
    // Same phone, new email.
    expect(await t.service.session({ email: "other@example.com", emailConsent: true, phone: "(415) 555-0134", smsConsent: true }, t.ctx("v-3")))
      .toMatchObject({ status: "existing", claim: null });
    // Same browser, new email: resumes the original game.
    expect(await t.service.session({ email: "third@example.com", emailConsent: true }, t.ctx("v-1"))).toMatchObject({ status: "resume" });
    expect(t.col(COLLECTIONS.leads).size).toBe(1);
  });

  it("scores on the server, keeps the best shot and pays at least the floor", async () => {
    const s = await t.service.session({ email: "a@example.com", emailConsent: true, phone: "+14155550134", smsConsent: true }, t.ctx());
    const sid = (s as { session: { sid: string } }).session.sid;
    expect(await t.service.shot({ sid, shot: 1, target: { x: 0, y: 0 }, e: 0 }, t.ctx())).toMatchObject({ code: "shot_played" });
    expect(await t.service.shot({ sid, shot: 0, target: { x: 0, y: 0 }, e: 0 }, t.ctx("intruder"))).toMatchObject({ code: "no_session" });
    for (let i = 0; i < 3; i++) {
      t.tick(2000);
      const r = await t.service.shot({ sid, shot: i, target: { x: 0, y: 0 }, e: 0.3 }, t.ctx());
      if (r.status !== "shot") break;
    }
    const claim = await t.service.claim({ sid }, t.ctx());
    expect(claim.status).toBe("claimed");
    const c = claim as { code: string; pct: number };
    expect(c.pct).toBeGreaterThanOrEqual(15);
    expect(c.pct).toBeLessThanOrEqual(30);
    expect(c.code).toMatch(GAME_CODE_PATTERN);
    expect(t.created).toHaveLength(1);
    // Claiming again returns the same code, no new discount.
    expect(await t.service.claim({ sid }, t.ctx())).toMatchObject({ code: c.code });
    expect(t.created).toHaveLength(1);
    expect(t.synced.at(-1)?.stages).toEqual(["email", "sms"]);
  });

  it("a better result replaces the lower code and queues deletion", async () => {
    const s = await t.service.session({ email: "a@example.com", emailConsent: true, phone: "+14155550134", smsConsent: true }, t.ctx());
    const sid = (s as { session: { sid: string } }).session.sid;
    const first = await t.service.claim({ sid }, t.ctx()) as { code: string; pct: number };
    expect(first.pct).toBe(15);
    // Force a 25% shot into the stored session, as if a later swing landed 5 ft away.
    const sess = t.col(COLLECTIONS.sessions).get(sid)!;
    t.col(COLLECTIONS.sessions).set(sid, { ...sess, results: [{ surf: "green", feet: 5, pct: 25, note: "", shot: 1 }] });
    const better = await t.service.claim({ sid }, t.ctx()) as { code: string; pct: number };
    expect(better.pct).toBe(25);
    expect(better.code).not.toBe(first.code);
    expect(t.removed).toEqual(["gid://shopify/DiscountCodeNode/1"]);
    expect(t.col(COLLECTIONS.codeDeletes).get("1")).toMatchObject({ status: "done" });
  });

  it("stores a pending code when Shopify fails, then the cron activates it", async () => {
    const f = setup({ createFails: true });
    const s = await f.service.session({ email: "a@example.com", emailConsent: true }, f.ctx());
    const sid = (s as { session: { sid: string } }).session.sid;
    expect(await f.service.claim({ sid }, f.ctx())).toEqual({ status: "pending", pct: 10, won: false });
    expect(f.synced).toHaveLength(0);
    f.shopify.fail = false;
    f.tick(6 * 60_000);
    const sum = await f.service.maintain({ deadlineMs: Date.now() + 5000 });
    expect(sum).toMatchObject({ pendingRetried: 1, pendingActivated: 1 });
    const lead = f.col(COLLECTIONS.leads).get(leadIdFor(normalizeEmail("a@example.com")!.key))!;
    expect((lead.reward as Data).status).toBe("active");
    expect(f.synced).toEqual([{ id: expect.any(String), stages: ["email"] }]);
  });

  it("cron claims abandoned games at their best result", async () => {
    const s = await t.service.session({ email: "a@example.com", emailConsent: true }, t.ctx());
    expect(s.status).toBe("new");
    t.tick(31 * 60_000);
    expect(await t.service.maintain({ deadlineMs: Date.now() + 5000 })).toMatchObject({ abandonedClaimed: 1 });
    expect(t.created).toHaveLength(1);
  });
});

describe("codes", () => {
  it("makes codes the bag recognizes", () => {
    for (const pct of [10, 15, 20, 25, 30]) {
      const code = makeCode(pct);
      expect(code).toMatch(GAME_CODE_PATTERN);
      expect(code.startsWith(`SHOT${pct}-`)).toBe(true);
      expect(isGameRewardCode(code)).toBe(true);
    }
    expect(isGameRewardCode("MULLYTEXT15")).toBe(false);
  });
  it("builds a single-use, non-stacking, 14-day code", () => {
    const now = Date.parse("2026-11-11T15:00:00Z");
    const endsAt = codeExpiry(now);
    expect(Date.parse(endsAt) - now).toBe(14 * 86_400_000);
    const input = buildDiscountInput({ code: "SHOT20-ABC234", percent: 45, startsAt: new Date(now).toISOString(), endsAt });
    expect(input).toMatchObject({
      code: "SHOT20-ABC234", usageLimit: 1, appliesOncePerCustomer: true, minimumRequirement: null,
      combinesWith: { orderDiscounts: false, productDiscounts: false, shippingDiscounts: false },
      customerGets: { value: { percentage: 0.3 }, appliesOnSubscription: false, items: { collections: { add: CODE_RULES.eligibleCollectionIds } } },
    });
    expect(input.tags).toContain("take-a-shot");
    // Full-price smart collection (no sale items, no Reserve/Access/gift subs).
    expect(CODE_RULES.eligibleCollectionIds).toEqual(["gid://shopify/Collection/485574770880"]);
  });
});

describe("server gate", () => {
  it("defaults off, except local development or an opted-in preview", () => {
    expect(isTakeAShotServerEnabled({ VERCEL_ENV: "production", NODE_ENV: "production" })).toBe(false);
    expect(isTakeAShotServerEnabled({ VERCEL_ENV: "preview", NODE_ENV: "production" })).toBe(false);
    expect(isTakeAShotServerEnabled({ VERCEL_ENV: "preview", TAKE_A_SHOT_PREVIEW_API: "true" })).toBe(true);
    expect(isTakeAShotServerEnabled({ NEXT_PUBLIC_TAKE_A_SHOT_ENABLED: "true", VERCEL_ENV: "production" })).toBe(true);
    expect(isTakeAShotServerEnabled({ NODE_ENV: "development" })).toBe(true);
  });
});

describe("discount token", () => {
  const scopes = (title: string, write: boolean) => ({
    ok: true, status: 200,
    json: async () => ({ data: { currentAppInstallation: { app: { title }, accessScopes: write ? [{ handle: "read_discounts" }, { handle: "write_discounts" }] : [{ handle: "read_orders" }] } } }),
  });
  beforeEach(() => resetDiscountTokenCache());

  it("picks the first token with write_discounts, then caches it", async () => {
    const env = { SHOPIFY_STORE_DOMAIN: "shop.example", SHOPIFY_DISCOUNTS_TOKEN: "t1", SHOPIFY_SUBSCRIPTIONS_TOKEN: "t2" };
    const f = vi.fn(async (_u: string, init: { headers: Record<string, string> }) =>
      scopes(init.headers["X-Shopify-Access-Token"] === "t1" ? "Reader" : "Subs", init.headers["X-Shopify-Access-Token"] === "t2"));
    expect(await getDiscountToken(env, f as unknown as typeof fetch)).toEqual({ token: "t2", source: "SHOPIFY_SUBSCRIPTIONS_TOKEN" });
    await getDiscountToken(env, f as unknown as typeof fetch);
    expect(f).toHaveBeenCalledTimes(2);
  });

  it("falls back to a client_credentials grant", async () => {
    const env = { SHOPIFY_STORE_DOMAIN: "shop.example", SHOPIFY_DISCOUNTS_CLIENT_ID: "id", SHOPIFY_DISCOUNTS_CLIENT_SECRET: "secret" };
    const f = vi.fn(async (u: string, init: { body: string }) => {
      if (u.endsWith("/admin/oauth/access_token")) {
        expect(init.body).toContain("grant_type=client_credentials");
        return { ok: true, status: 200, json: async () => ({ access_token: "cc", expires_in: 86399 }) };
      }
      return scopes("Discounts", true);
    });
    expect(await getDiscountToken(env, f as unknown as typeof fetch)).toEqual({ token: "cc", source: "client_credentials" });
  });

  it("trusts the grant's scope field, caches until 5 minutes before expiry and refreshes on 401", async () => {
    vi.useFakeTimers({ now: Date.parse("2026-11-11T15:00:00Z") });
    try {
      const env = { SHOPIFY_STORE_DOMAIN: "shop.example", SHOPIFY_DISCOUNTS_CLIENT_ID: "id", SHOPIFY_DISCOUNTS_CLIENT_SECRET: "secret" };
      let minted = 0, graphql = 0, reject = false;
      const f = vi.fn(async (u: string, init: { headers?: Record<string, string> }) => {
        if (u.endsWith("/admin/oauth/access_token")) {
          minted++;
          return { ok: true, status: 200, json: async () => ({ access_token: `cc${minted}`, expires_in: 86399, scope: "read_discounts,write_discounts" }) };
        }
        graphql++;
        if (reject && init.headers?.["X-Shopify-Access-Token"] === "cc1") return { ok: false, status: 401, json: async () => ({}) };
        return { ok: true, status: 200, json: async () => ({ data: { ok: true } }) };
      });
      const ff = f as unknown as typeof fetch;
      expect(await getDiscountToken(env, ff)).toEqual({ token: "cc1", source: "client_credentials" });
      expect(graphql).toBe(0); // No scope probe: the grant said write_discounts.
      vi.advanceTimersByTime(86399_000 - 6 * 60_000);
      expect((await getDiscountToken(env, ff))?.token).toBe("cc1");
      reject = true;
      expect(await discountGraphQL("query { ok }", {}, env, ff)).toEqual({ ok: true });
      expect(minted).toBe(2);
      vi.advanceTimersByTime(2 * 60_000); // Inside the 5-minute window: mint again.
      expect((await getDiscountToken(env, ff))?.token).toBe("cc2");
      expect(minted).toBe(2);
      vi.advanceTimersByTime(86399_000);
      expect((await getDiscountToken(env, ff))?.token).toBe("cc3");
    } finally { vi.useRealTimers(); }
  });

  it("refuses a grant whose scope lacks write_discounts", async () => {
    const env = { SHOPIFY_STORE_DOMAIN: "shop.example", SHOPIFY_DISCOUNTS_CLIENT_ID: "id", SHOPIFY_DISCOUNTS_CLIENT_SECRET: "secret" };
    const f = async (u: string) => u.endsWith("/access_token")
      ? { ok: true, status: 200, json: async () => ({ access_token: "cc", expires_in: 86399, scope: "read_discounts" }) }
      : scopes("Mully Discounts", false);
    expect(await getDiscountToken(env, f as unknown as typeof fetch)).toBeNull();
    const diag = await probeDiscountTokens(env, f as unknown as typeof fetch);
    expect(diag[2]).toEqual({ source: "client_credentials", present: true, appTitle: "Mully Discounts", hasWriteDiscounts: false });
  });

  it("diagnostics report booleans and titles only", async () => {
    const env = { SHOPIFY_STORE_DOMAIN: "shop.example", SHOPIFY_DISCOUNTS_TOKEN: "secret-token" };
    const out = await probeDiscountTokens(env, (async () => scopes("Mully Reserve", false)) as unknown as typeof fetch);
    expect(out).toEqual([
      { source: "SHOPIFY_DISCOUNTS_TOKEN", present: true, appTitle: "Mully Reserve", hasWriteDiscounts: false },
      { source: "SHOPIFY_SUBSCRIPTIONS_TOKEN", present: false, appTitle: null, hasWriteDiscounts: false },
      { source: "client_credentials", present: false, appTitle: null, hasWriteDiscounts: false },
    ]);
    expect(JSON.stringify(out)).not.toContain("secret-token");
  });
});

describe("Klaviyo inputs", () => {
  const base = {
    email: "a@example.com", phone: "+14155550134", shots: 3,
    emailConsent: { granted: true, capturedAt: new Date("2026-11-11T15:00:00Z") },
    smsConsent: { granted: true, capturedAt: new Date("2026-11-11T15:00:00Z") },
  };
  it("waits for an active code", () => {
    expect(buildStageInputs("take_a_shot_leads", "lead1", { ...base, reward: { code: "SHOT15-ABC234", percent: 15, status: "pending", expiresAt: "x" } })).toEqual({});
  });
  it("sends email and SMS stages with the reward", () => {
    const out = buildStageInputs("take_a_shot_leads", "lead1", { ...base, reward: { code: "SHOT20-ABC234", percent: 20, status: "active", expiresAt: "2026-11-25T15:00:00.000Z" } });
    expect(out.email).toMatchObject({ source: "take-a-shot", stage: "email", subscribe: { email: true },
      properties: { mully_reward_code: "SHOT20-ABC234", mully_reward_percent: 20, mully_signup_game: true },
      eventProperties: { email_consent: true, sms_consent: false, reward_code: "SHOT20-ABC234", reward_percent: 20, shots: 3 } });
    expect(out.sms).toMatchObject({ stage: "sms", phone: "+14155550134", eventProperties: { sms_consent: true } });
    expect(out.sms?.subscribe).not.toHaveProperty("email");
  });
  it("skips SMS without consent", () => {
    const out = buildStageInputs("take_a_shot_leads", "lead1", { ...base, smsConsent: undefined, reward: { code: "SHOT10-ABC234", percent: 10, status: "active", expiresAt: "z" } });
    expect(out.sms).toBeUndefined();
    expect(out.email).toBeDefined();
  });
});

describe("game reward readiness", () => {
  const now = new Date("2026-11-12T15:00:00Z");
  const reward = { code: "SHOT20-ABC234", percent: 20, expiresAt: "2026-11-25T15:00:00.000Z", status: "active" };
  const ok = { leadReadOk: true, reward, usedCodes: [], historyComplete: true, status: { active: true, oncePerCustomer: true }, now };
  it("verifies an active, unused, unexpired code", () => {
    expect(decideGameReward(ok)).toEqual({ verified: true, code: "SHOT20-ABC234", percent: 20, holds: [] });
  });
  it("drops used, expired, pending or inactive codes", () => {
    expect(decideGameReward({ ...ok, usedCodes: ["shot20-abc234"] }).verified).toBe(false);
    expect(decideGameReward({ ...ok, now: new Date("2026-11-26T00:00:00Z") })).toMatchObject({ verified: false, holds: [] });
    expect(decideGameReward({ ...ok, reward: { ...reward, status: "pending" } })).toMatchObject({ verified: false, holds: [] });
    expect(decideGameReward({ ...ok, status: { active: false, oncePerCustomer: true } })).toMatchObject({ verified: false, holds: [] });
    expect(decideGameReward({ ...ok, reward: null })).toMatchObject({ verified: false, holds: [] });
  });
  it("holds when evidence is missing", () => {
    expect(decideGameReward({ ...ok, status: undefined }).holds).toEqual(["reward_status_unknown:SHOT20-ABC234"]);
    expect(decideGameReward({ ...ok, historyComplete: false }).holds).toEqual(["game_reward_history_incomplete"]);
    expect(decideGameReward({ ...ok, leadReadOk: false }).holds).toEqual(["game_lead_unreadable"]);
  });
  it("pickReward keeps the higher percent", () => {
    const game = decideGameReward(ok);
    const popup = { verified: true, code: "MULLYTEXT15", percent: 15, holds: [] };
    expect(pickReward(game, popup).code).toBe("SHOT20-ABC234");
    expect(pickReward(popup, { ...game, percent: 10, code: "SHOT10-ABC234" }).code).toBe("MULLYTEXT15");
  });
});

describe("readiness evidence with a game code", () => {
  it("reads the lead by inbox identity and keeps the higher game code", async () => {
    const { readReadinessEvidence } = await import("@/lib/lifecycle/readinessSources");
    const now = new Date("2026-11-12T15:00:00Z");
    const wantId = leadIdFor(normalizeEmail("jdoe@gmail.com")!.key);
    const gameLead = vi.fn(async (id: string) => (id === wantId
      ? { reward: { code: "SHOT25-ABC234", percent: 25, expiresAt: "2026-11-25T15:00:00.000Z", status: "active" } } : null));
    const gql = vi.fn(async (_q: string, v?: Record<string, unknown>) => {
      if (typeof v?.code === "string") {
        return { codeDiscountNodeByCode: { codeDiscount: { __typename: "DiscountCodeBasic", status: "ACTIVE", startsAt: "2026-11-11T00:00:00Z", endsAt: "2026-11-25T15:00:00Z", appliesOncePerCustomer: true } } };
      }
      if (String(v?.q ?? "").startsWith("discount_code:")) return { orders: { nodes: [] } };
      throw new Error("customer search down"); // Stop after rewards.
    });
    const out = await readReadinessEvidence("J.Doe@gmail.com", {
      sb: {} as never, gql: gql as never, now, gameLead,
      lead: async () => null, metaLead: async () => null,
      consent: async () => ({ subscribed: true, marketable: true, internal: false }),
    });
    expect(gameLead).toHaveBeenCalledWith(wantId);
    // Status comes from the discounts token when one is injected; usage still uses the admin token.
    const discountGql = vi.fn(async () => ({ codeDiscountNodeByCode: null }));
    const viaDiscounts = await readReadinessEvidence("J.Doe@gmail.com", {
      sb: {} as never, gql: gql as never, discountGql: discountGql as never, now, gameLead,
      lead: async () => null, metaLead: async () => null,
      consent: async () => ({ subscribed: true, marketable: true, internal: false }),
    });
    expect(discountGql).toHaveBeenCalledTimes(1);
    expect(viaDiscounts.reward).toMatchObject({ verified: false, code: null }); // Deleted in Shopify.
    expect(out.reward).toMatchObject({ verified: true, code: "SHOT25-ABC234", percent: 25 });
  });
});
