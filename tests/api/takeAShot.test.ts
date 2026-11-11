import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/firebase-admin", () => ({ adminDb: { collection: () => ({ doc: () => ({ get: async () => ({ exists: false }) }) }) } }));

import { createTakeAShotService, COLLECTIONS, type TasStore, type TasTx } from "@/lib/takeAShot/service";
import { buildDiscountInput, codeExpiry, makeCode } from "@/lib/takeAShot/codes";
import { CODE_RULES, CODE_TERMS, FLOOR_PERCENT, MAX_PERCENT, SHOTS, isTakeAShotServerEnabled, percentForResult } from "@/lib/takeAShot/config";
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
        // Same rule as Firestore: no read after the first write in a transaction.
        async get(c, id) {
          if (writes.length) throw new Error("Firestore transactions require all reads to be executed before all writes.");
          const d = col(c).get(id); return d ? structuredClone(d) : null;
        },
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

  it("check for a returning player reads its session before writing (Firestore order)", async () => {
    await t.service.session({ email: "back@example.com", emailConsent: true }, t.ctx("v-back"));
    // Plus aliases are the same person.
    expect(await t.service.check({ email: "back+again@example.com" }, t.ctx("v-other"))).toMatchObject({ status: "existing", claim: null });
    expect(await t.service.check({ email: "back@example.com" }, t.ctx("v-back"))).toEqual({ status: "ok" });
  });

  it("requires email consent, and SMS consent when a phone is given", async () => {
    expect(await t.service.session({ email: "a@example.com" }, t.ctx())).toMatchObject({ code: "consent_required" });
    expect(await t.service.session({ email: "a@example.com", emailConsent: true, phone: "+1 415 555 0134" }, t.ctx()))
      .toMatchObject({ code: "sms_consent_required" });
    expect(t.col(COLLECTIONS.leads).size).toBe(0);
  });

  it("keeps the previewed pin and first wind, clamped to the normal ranges", async () => {
    const r = await t.service.session({ email: "a@example.com", emailConsent: true, preview: { pin: 1, mph: 99, dirDeg: -90 } }, t.ctx("v-a")) as { session: { pin: number; winds: { mph: number; dirDeg: number }[] } };
    expect(r.session.pin).toBe(1);
    expect(r.session.winds[0]).toEqual({ mph: 17, dirDeg: 270 });
    const bad = await t.service.session({ email: "b@example.com", emailConsent: true, preview: { pin: 99, mph: 5, dirDeg: 0 } }, t.ctx("v-b")) as { session: { pin: number } };
    expect(bad.session.pin).toBeLessThan(99);
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
      .toEqual({ status: "existing", claim: null, emailed: true, identify: false });
    // Same phone, new email.
    expect(await t.service.session({ email: "other@example.com", emailConsent: true, phone: "(415) 555-0134", smsConsent: true }, t.ctx("v-3")))
      .toMatchObject({ status: "existing", claim: null });
    // Same browser, new email: resumes the original game.
    expect(await t.service.session({ email: "third@example.com", emailConsent: true }, t.ctx("v-1"))).toMatchObject({ status: "resume", identify: false });
    expect(t.col(COLLECTIONS.leads).size).toBe(1);
  });

  it("marks only the owner's email on the owner's browser as identifiable", async () => {
    await t.service.session({ email: "jdoe@gmail.com", emailConsent: true }, t.ctx("v-1"));
    expect(await t.service.session({ email: "jdoe@gmail.com", emailConsent: true }, t.ctx("v-1")))
      .toMatchObject({ status: "resume", identify: true });
    expect(await t.service.session({ email: "jdoe@gmail.com", emailConsent: true }, t.ctx("v-9")))
      .toMatchObject({ status: "existing", identify: false });
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

  it("a lead keeps its one code: a later claim never mints a second", async () => {
    const s = await t.service.session({ email: "a@example.com", emailConsent: true, phone: "+14155550134", smsConsent: true }, t.ctx());
    const sid = (s as { session: { sid: string } }).session.sid;
    const first = await t.service.claim({ sid }, t.ctx()) as { code: string; pct: number };
    expect(first.pct).toBe(15);
    // Force a 25% shot into the stored session, as if a later swing landed 5 ft away.
    const sess = t.col(COLLECTIONS.sessions).get(sid)!;
    t.col(COLLECTIONS.sessions).set(sid, { ...sess, results: [{ surf: "green", feet: 5, pct: 25, note: "", shot: 1 }] });
    const again = await t.service.claim({ sid }, t.ctx()) as { code: string; pct: number };
    expect(again).toMatchObject({ code: first.code, pct: 15 });
    expect(t.created).toHaveLength(1);
    expect(t.removed).toHaveLength(0);
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

describe("phone upsell after the first shot", () => {
  let t: ReturnType<typeof setup>;
  beforeEach(() => { t = setup(); });
  const start = async (email = "a@example.com", visitor = "v-1") => {
    const s = await t.service.session({ email, emailConsent: true }, t.ctx(visitor));
    const sid = (s as { session: { sid: string } }).session.sid;
    t.tick(2000);
    await t.service.shot({ sid, shot: 0, target: { x: 0, y: 0 }, e: 0.3 }, t.ctx(visitor));
    return sid;
  };
  const lead = (email = "a@example.com") => t.col(COLLECTIONS.leads).get(leadIdFor(normalizeEmail(email)!.key))!;

  const live = () => t.created.length - t.removed.length;

  it("locks the first result and mints nothing before the phone decision", async () => {
    const sid = await start();
    const first = await t.service.claim({ sid, upsell: true }, t.ctx()) as { status: string; pct: number; code?: string };
    expect(first.status).toBe("locked");
    expect(first.pct).toBeGreaterThanOrEqual(10);
    expect(first.code).toBeUndefined();
    expect(t.created).toHaveLength(0);
    expect(t.synced).toHaveLength(0);
    expect(lead().reward).toBeUndefined();
    // Asking again is idempotent and still mints nothing.
    expect(await t.service.claim({ sid, upsell: true }, t.ctx())).toMatchObject({ status: "locked", pct: first.pct });
    expect(t.created).toHaveLength(0);
  });

  it("keep mints the locked percent once and syncs the email stage once", async () => {
    const sid = await start();
    const first = await t.service.claim({ sid, upsell: true }, t.ctx()) as { pct: number };
    const kept = await t.service.keep({ sid }, t.ctx()) as { status: string; code: string; pct: number };
    expect(kept).toMatchObject({ status: "claimed", pct: first.pct });
    expect(t.created).toHaveLength(1);
    expect(t.synced).toEqual([{ id: expect.any(String), stages: ["email"] }]);
    expect(await t.service.keep({ sid }, t.ctx())).toMatchObject({ code: kept.code });
    expect(await t.service.claim({ sid }, t.ctx())).toMatchObject({ code: kept.code });
    expect(t.created).toHaveLength(1);
    expect(t.synced).toHaveLength(1);
    // A kept code ends the game: no more shots, no upgrade.
    expect(await t.service.shot({ sid, shot: 1, target: { x: 0, y: 0 }, e: 0.3 }, t.ctx())).toMatchObject({ status: "error" });
    expect(await t.service.upgrade({ sid, phone: "+14155550134", smsConsent: true }, t.ctx())).toMatchObject({ code: "upgrade_refused" });
    expect(t.created).toHaveLength(1);
  });

  it("upgrade needs SMS consent and the same browser", async () => {
    const sid = await start();
    await t.service.claim({ sid, upsell: true }, t.ctx());
    expect(await t.service.upgrade({ sid, phone: "+14155550134" }, t.ctx())).toMatchObject({ code: "sms_consent_required" });
    expect(await t.service.upgrade({ sid, phone: "+14155550134", smsConsent: true }, t.ctx("intruder"))).toMatchObject({ status: "error" });
    expect(lead().phone).toBeFalsy();
  });

  it("upgrade is refused before the first result is locked", async () => {
    const sid = await start();
    expect(await t.service.upgrade({ sid, phone: "+14155550134", smsConsent: true }, t.ctx())).toMatchObject({ code: "upgrade_refused" });
  });

  it("upgrade goes 1 to 3 shots, never mints, and the final claim mints exactly one code", async () => {
    const sid = await start();
    const first = await t.service.claim({ sid, upsell: true }, t.ctx()) as { pct: number };
    const up = await t.service.upgrade({ sid, phone: "+14155550134", smsConsent: true }, t.ctx());
    expect(up).toMatchObject({ status: "resume", session: { shots: 3, floor: 15 } });
    expect((up as { session: { results: unknown[]; winds: unknown[] } }).session.results).toHaveLength(1);
    expect((up as { session: { winds: unknown[] } }).session.winds).toHaveLength(3);
    expect(t.created).toHaveLength(0);
    const l = lead();
    expect(l.smsConsent).toMatchObject({ version: "take-a-shot-upsell-2026-11-11", placement: "after_first_shot" });
    expect(t.consent.map((c) => c.channel)).toEqual(["email", "sms"]);
    expect(t.synced).toHaveLength(0);
    // A better later shot, as if it landed 5 ft away.
    const sess = t.col(COLLECTIONS.sessions).get(sid)!;
    t.col(COLLECTIONS.sessions).set(sid, { ...sess, results: [...(sess.results as unknown[]), { surf: "green", feet: 5, pct: 25, note: "", shot: 1 }] });
    const final = await t.service.claim({ sid }, t.ctx()) as { code: string; pct: number };
    expect(final.pct).toBe(Math.max(25, first.pct));
    expect(t.created).toHaveLength(1);
    expect(t.removed).toHaveLength(0);
    expect(live()).toBe(1);
    expect(t.synced).toEqual([{ id: expect.any(String), stages: ["email", "sms"] }]);
    // Later keep / claim calls return the same code.
    expect(await t.service.keep({ sid }, t.ctx())).toMatchObject({ code: final.code });
    expect(t.created).toHaveLength(1);
  });

  it("one live code per session on every path", async () => {
    for (const path of ["keep", "upgrade", "cron"] as const) {
      t = setup();
      const sid = await start();
      await t.service.claim({ sid, upsell: true }, t.ctx());
      if (path === "keep") await t.service.keep({ sid }, t.ctx());
      if (path === "upgrade") {
        await t.service.upgrade({ sid, phone: "+14155550134", smsConsent: true }, t.ctx());
        await t.service.claim({ sid }, t.ctx());
        await t.service.keep({ sid }, t.ctx());
      }
      if (path === "cron") { t.tick(31 * 60_000); await t.service.maintain({ deadlineMs: Date.now() + 5000 }); }
      await t.service.claim({ sid, upsell: true }, t.ctx());
      expect(t.created, path).toHaveLength(1);
      expect(live(), path).toBe(1);
    }
  });

  it("a phone that already played elsewhere gets the generic error", async () => {
    await t.service.session({ email: "b@example.com", emailConsent: true, phone: "+14155550134", smsConsent: true }, t.ctx("v-b"));
    const sid = await start("a@example.com", "v-a");
    await t.service.claim({ sid, upsell: true }, t.ctx("v-a"));
    const out = await t.service.upgrade({ sid, phone: "(415) 555-0134", smsConsent: true }, t.ctx("v-a")) as { code: string; error: string };
    expect(out.code).toBe("upgrade_refused");
    expect(out.error).not.toMatch(/played|already|used/i);
  });

  it("rate-limits upgrade attempts per game", async () => {
    const sid = await start();
    await t.service.claim({ sid, upsell: true }, t.ctx());
    await t.service.session({ email: "b@example.com", emailConsent: true, phone: "+14155550134", smsConsent: true }, t.ctx("v-b"));
    for (let i = 0; i < 3; i++) expect(await t.service.upgrade({ sid, phone: "+14155550134", smsConsent: true }, t.ctx())).toMatchObject({ code: "upgrade_refused" });
    expect(await t.service.upgrade({ sid, phone: "+14155550199", smsConsent: true }, t.ctx())).toMatchObject({ code: "rate_limited" });
  });

  it("the cron mints and emails a locked result left more than 30 minutes", async () => {
    const sid = await start();
    await t.service.claim({ sid, upsell: true }, t.ctx());
    t.tick(10 * 60_000);
    expect(await t.service.maintain({ deadlineMs: Date.now() + 5000 })).toMatchObject({ lockedFinalized: 0 });
    expect(t.created).toHaveLength(0);
    t.tick(25 * 60_000);
    expect(await t.service.maintain({ deadlineMs: Date.now() + 5000 })).toMatchObject({ lockedFinalized: 1 });
    expect(t.created).toHaveLength(1);
    expect(t.synced).toEqual([{ id: expect.any(String), stages: ["email"] }]);
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
      customerGets: {
        value: { percentage: 0.3 },
        appliesOnOneTimePurchase: true,
        appliesOnSubscription: true,
        items: { collections: { add: CODE_RULES.eligibleCollectionIds } },
      },
      // First Reserve quarter only: renewals bill at the regular quarterly price.
      recurringCycleLimit: 1,
    });
    expect(input.tags).toContain("take-a-shot");
    // Full-price smart collection (no sale items, no Access/gift subs), plus the first Reserve quarter.
    expect(CODE_RULES.eligibleCollectionIds).toEqual(["gid://shopify/Collection/485574770880"]);
  });
  it("covers the first Reserve quarter and still excludes Access, gifts and the outfit-builder plan", () => {
    const reserve = "gid://shopify/Product/8501257044160";
    expect(CODE_RULES.reserveFirstQuarterProductIds).toEqual([reserve]);
    expect(CODE_RULES.excludedProductIds).not.toContain(reserve);
    for (const id of [
      "gid://shopify/Product/10250499719360", // The Seasonal Edit
      "gid://shopify/Product/8652818940096", // Golf Curation Box (gift)
      "gid://shopify/Product/10327639392448", // Reserve Gift Season
      "gid://shopify/Product/8501257175232", // Access annual
      "gid://shopify/Product/10268591096000", // Access monthly
    ]) expect(CODE_RULES.excludedProductIds).toContain(id);
    expect(CODE_RULES.recurringCycleLimit).toBe(1);
    expect(MAX_PERCENT).toBe(30);
    // No em dashes in customer copy, and the terms say renewals bill at the regular quarterly price.
    for (const line of Object.values(CODE_TERMS)) expect(line).not.toMatch(/\u2014/);
    expect(CODE_TERMS.short).toBe("Works on one-time Shop orders or your first Reserve quarter.");
    expect(CODE_TERMS.full).not.toMatch(/Excludes Mully Reserve/);
    expect(CODE_TERMS.full).toMatch(/renewals bill at the regular quarterly price/i);
    expect(CODE_TERMS.full).toMatch(/Excludes sale items, Mully Access and gift subscriptions/);
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
  it("carries the PostHog join ids on the profile", () => {
    const out = buildStageInputs("take_a_shot_leads", "lead1", { ...base, visitorIds: ["anon-abc12345"], posthogDistinctId: "0192ab-ph",
      reward: { code: "SHOT10-ABC234", percent: 10, status: "active", expiresAt: "z" } });
    expect(out.email?.properties).toMatchObject({ mully_anon_id: "anon-abc12345", mully_posthog_distinct_id: "0192ab-ph" });
    const bare = buildStageInputs("take_a_shot_leads", "lead1", { ...base, reward: { code: "SHOT10-ABC234", percent: 10, status: "active", expiresAt: "z" } });
    expect(bare.email?.properties).not.toHaveProperty("mully_anon_id");
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

describe("Reserve checkout codes", () => {
  it("auto-applies only a saved Take a Shot code, and an explicit code wins", async () => {
    const { membershipDiscountCodes } = await import("@/lib/shopifyCheckout");
    expect(membershipDiscountCodes([], "SHOT25-ABC234")).toEqual(["SHOT25-ABC234"]);
    expect(membershipDiscountCodes([], "shot25-abc234")).toEqual(["SHOT25-ABC234"]);
    expect(membershipDiscountCodes([], "MULLYEDIT10")).toEqual([]);
    expect(membershipDiscountCodes([], "MULLYTEXT15")).toEqual([]);
    expect(membershipDiscountCodes([], null)).toEqual([]);
    expect(membershipDiscountCodes(["FOUNDERS50"], "SHOT25-ABC234")).toEqual(["FOUNDERS50"]);
  });
});
