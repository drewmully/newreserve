/**
 * Take a Shot server rules. The browser only sends inputs (where it aimed,
 * when it tapped); this module decides the pin, the wind, every result and
 * the one code each player gets. Storage and Shopify are injected so the
 * rules are unit-tested without Firestore (see ./firestoreStore.ts).
 *
 * Never logs or returns PII.
 */
import { EMAIL_CONSENT, SHOP_CONSENT_VERSION, SMS_CONSENT } from "@/lib/shopSignup";
import { codeExpiry, makeCode, type ShopifyCodes } from "./codes";
import { LIMITS, MAX_PERCENT, SHOTS, TAKE_A_SHOT_SOURCE, floorFor } from "./config";
import { identityIdFor, isDisposableDomain, leadIdFor, normalizeEmail, normalizePhone, type NormalizedEmail } from "./identity";
import { PINS, WIND_MAX, WIND_MIN, shotNoise, simulateShot, windFrom } from "./sim";

/**
 * Consent version for the SMS checkbox shown after the first shot (phone
 * upsell). Bump it whenever that placement or its text changes.
 */
export const TAS_SMS_UPSELL_CONSENT_VERSION = "take-a-shot-upsell-2026-11-11";

export const COLLECTIONS = {
  leads: "take_a_shot_leads",
  sessions: "take_a_shot_sessions",
  identities: "take_a_shot_identities",
  rateLimits: "take_a_shot_rate_limits",
  codeDeletes: "take_a_shot_code_deletes",
} as const;

type Data = Record<string, unknown>;

/** Minimal transactional store. Reads must happen before writes in a transaction. */
export interface TasTx {
  get(collection: string, id: string): Promise<Data | null>;
  set(collection: string, id: string, data: Data, opts?: { merge?: boolean }): void;
  /** Append-only consent log under the lead doc. */
  addConsentEvent(leadId: string, data: Data): void;
  /** Mark the lead for the Klaviyo sync worker for these stages. */
  markForSync(leadId: string, stages: string[]): void;
}
export interface TasStore {
  transaction<T>(fn: (tx: TasTx) => Promise<T>): Promise<T>;
  /** Single-field equality query. */
  findWhere(collection: string, field: string, value: unknown, limit: number): Promise<Array<{ id: string; data: Data }>>;
}

export interface TasDeps {
  store: TasStore;
  shopify: ShopifyCodes;
  /** true / false / null (unknown, allow). */
  mxCheck: (domain: string) => Promise<boolean | null>;
  /** Uniform [0, 1). Server randomness for pins, wind and noise. */
  rand: () => number;
  /** Random id generator for session ids. */
  newId: () => string;
  now: () => number;
  /** Called after a code becomes active, so the Klaviyo sync can run after the response. */
  onSyncReady?: (leadId: string, stages: string[]) => void;
}

export interface RequestContext {
  ipHash: string;
  visitor: string | null;
  /** posthog-js distinct id from the browser, for joining Klaviyo to PostHog. */
  posthogDistinctId?: string | null;
  page: string | null;
  userAgent: string;
}

export type PublicClaim = { code: string; pct: number; won: boolean; expiresAt: string };
export type PublicResult = { surf: string; feet: number; pct: number; note: string; strike?: string; rest?: { x: number; y: number }; shot: number };
export type PublicSession = {
  sid: string; pin: number; winds: Array<{ mph: number; dirDeg: number }>;
  shots: number; floor: number; results: PublicResult[];
};

export type ApiResult =
  | { status: "error"; error: string; code?: string; httpStatus?: number }
  | { status: "ok" }
  | { status: "existing"; claim: PublicClaim | null; emailed: boolean }
  | { status: "new" | "resume"; session: PublicSession; claim: PublicClaim | null }
  | { status: "shot"; noise: { carry: number; lat: number }; result: PublicResult }
  | ({ status: "claimed" } & PublicClaim)
  | { status: "pending"; pct: number; won: boolean }
  /** First shot scored, waiting on the phone decision. No code exists yet. */
  | { status: "locked"; pct: number; won: boolean };

type StoredResult = PublicResult & { input: { x: number; y: number; e: number }; noise: { carry: number; lat: number }; at: number };
type Session = {
  leadId: string; visitor: string | null; pin: number; winds: Array<{ mph: number; dirDeg: number }>;
  shots: number; floor: number; results: StoredResult[]; flags: Array<{ shot: number; why: string; ms?: number }>;
  /** decision: 1-shot result locked in, waiting on the phone ask; no code minted yet. */
  status: "open" | "decision" | "claimed"; createdAtMs: number; lastShotAtMs: number; claimedAtMs?: number;
  decisionAtMs?: number;
};
type Reward = {
  code: string; percent: number; expiresAt: string; status: "active" | "pending" | "failed";
  discountId: string | null; won: boolean; issuedAtMs: number; attempts: number; nextAttemptAtMs: number;
  lastError: string | null; review: boolean;
};

const err = (error: string, code: string, httpStatus = 400): ApiResult => ({ status: "error", error, code, httpStatus });

function publicClaim(r: Reward | undefined | null): PublicClaim | null {
  return r && r.status === "active" ? { code: r.code, pct: r.percent, won: r.won, expiresAt: r.expiresAt } : null;
}
function publicSession(sid: string, s: Session): PublicSession {
  return {
    sid, pin: s.pin, winds: s.winds, shots: s.shots, floor: s.floor,
    results: s.results.map(({ surf, feet, pct, note, strike, rest, shot }) => ({ surf, feet, pct, note, strike, rest, shot })),
  };
}
function shotsLeft(s: Session): boolean {
  return s.results.length < s.shots && !s.results.some((r) => r.surf === "holed");
}
function bestPercent(s: Session): number {
  return Math.min(MAX_PERCENT, s.results.reduce((m, r) => (r.pct > m ? r.pct : m), 0));
}
function strongFlags(s: Session): boolean {
  return s.flags.some((f) => f.why === "too_fast") || s.flags.filter((f) => f.why === "perfect_strike").length >= 2;
}

/** Backoff for pending Shopify codes, minutes by attempt (1-based). */
const CODE_BACKOFF_MIN = [5, 15, 30, 60, 120, 240, 480, 960];

export function createTakeAShotService(deps: TasDeps) {
  const { store } = deps;

  async function checkEmail(raw: unknown): Promise<{ ok: true; n: NormalizedEmail } | { ok: false; res: ApiResult }> {
    const n = normalizeEmail(raw);
    if (!n) return { ok: false, res: err("Enter a valid email.", "invalid_email") };
    if (isDisposableDomain(n.domain)) return { ok: false, res: err("Please use a real inbox. We send your code there.", "disposable_email") };
    const mx = await deps.mxCheck(n.domain);
    if (mx === false) return { ok: false, res: err("That email domain does not get mail. Check the spelling.", "no_mx") };
    return { ok: true, n };
  }

  function previewFrom(raw: unknown): { pin: number; wind: { mph: number; dirDeg: number } } | null {
    if (!raw || typeof raw !== "object") return null;
    const p = raw as Record<string, unknown>;
    const pin = Number(p.pin), mph = Number(p.mph), dir = Number(p.dirDeg);
    if (!Number.isInteger(pin) || pin < 0 || pin >= PINS.length || !Number.isFinite(mph) || !Number.isFinite(dir)) return null;
    return { pin, wind: { mph: Math.round(Math.min(WIND_MAX, Math.max(WIND_MIN, mph))), dirDeg: Math.round(((dir % 360) + 360) % 360) } };
  }

  /** Bump an hourly counter inside the transaction. Returns false when over the limit. */
  async function rateLimitRead(tx: TasTx, kind: string, key: string | null, max: number) {
    if (!key) return { ok: true, write: () => {} };
    const hour = Math.floor(deps.now() / 3_600_000);
    const id = identityIdFor("visitor", `${kind}:${key}:${hour}`);
    const doc = await tx.get(COLLECTIONS.rateLimits, id);
    const count = typeof doc?.count === "number" ? doc.count : 0;
    return {
      ok: count < max,
      write: () => tx.set(COLLECTIONS.rateLimits, id, { count: count + 1, expiresAt: new Date(deps.now() + 2 * 3_600_000) }),
    };
  }

  /** Who is this? Email first, then phone, then browser. */
  async function findLead(tx: TasTx, emailKey: string, phone: string | null, visitor: string | null) {
    const byEmailId = leadIdFor(emailKey);
    const byEmail = await tx.get(COLLECTIONS.leads, byEmailId);
    const phoneRef = phone ? await tx.get(COLLECTIONS.identities, identityIdFor("phone", phone)) : null;
    const visitorRef = visitor ? await tx.get(COLLECTIONS.identities, identityIdFor("visitor", visitor)) : null;
    if (byEmail) return { leadId: byEmailId, lead: byEmail };
    for (const ref of [phoneRef, visitorRef]) {
      const id = typeof ref?.leadId === "string" ? ref.leadId : null;
      if (id) {
        const lead = await tx.get(COLLECTIONS.leads, id);
        if (lead) return { leadId: id, lead };
      }
    }
    return null;
  }

  function visitorMatches(lead: Data, visitor: string | null): boolean {
    return Boolean(visitor) && Array.isArray(lead.visitorIds) && (lead.visitorIds as string[]).includes(visitor!);
  }

  /**
   * Shared outcome for someone who already has a game. Codes are only shown
   * back to the same browser; anyone else is told the code went to the inbox.
   */
  async function existingOutcome(tx: TasTx, found: { leadId: string; lead: Data }, visitor: string | null): Promise<ApiResult> {
    const mine = visitorMatches(found.lead, visitor);
    const sid = typeof found.lead.sessionId === "string" ? found.lead.sessionId : "";
    const session = sid ? ((await tx.get(COLLECTIONS.sessions, sid)) as Session | null) : null;
    const reward = found.lead.reward as Reward | undefined;
    if (mine && session && shotsLeft(session)) return { status: "resume", session: publicSession(sid, session), claim: publicClaim(reward) };
    return { status: "existing", claim: mine ? publicClaim(reward) : null, emailed: !mine || !publicClaim(reward) };
  }

  return {
    /** Step 1: email typed. Rejects bad inboxes and people who already played. */
    async check(body: Data, ctx: RequestContext): Promise<ApiResult> {
      const r = await checkEmail(body.email);
      if (!r.ok) return r.res;
      return store.transaction(async (tx) => {
        const limit = await rateLimitRead(tx, "check-ip", ctx.ipHash, LIMITS.checksPerIpPerHour);
        if (!limit.ok) return err("Too many tries from this device. Try again later.", "rate_limited", 429);
        const found = await findLead(tx, r.n.key, null, ctx.visitor);
        limit.write();
        if (!found) return { status: "ok" };
        const out = await existingOutcome(tx, found, ctx.visitor);
        return out.status === "resume" ? { status: "ok" } : out;
      });
    },

    /** Step 2: start (or resume) the one game this person gets. Consent is stored here. */
    async session(body: Data, ctx: RequestContext): Promise<ApiResult> {
      if (body.emailConsent !== true) return err("Agree to emails so we can send your code.", "consent_required");
      const r = await checkEmail(body.email);
      if (!r.ok) return r.res;
      let phone: string | null = null;
      if (body.phone !== undefined && body.phone !== null && body.phone !== "") {
        phone = normalizePhone(body.phone);
        if (!phone) return err("Use a valid phone number, including your country code outside the US.", "invalid_phone");
        if (body.smsConsent !== true) return err("Agree to texts to get more shots.", "sms_consent_required");
      }
      const n = r.n;
      return store.transaction(async (tx) => {
        const found = await findLead(tx, n.key, phone, ctx.visitor);
        if (found) {
          const out = await existingOutcome(tx, found, ctx.visitor);
          return out;
        }
        const ipLimit = await rateLimitRead(tx, "session-ip", ctx.ipHash, LIMITS.sessionsPerIpPerHour);
        const visLimit = await rateLimitRead(tx, "session-visitor", ctx.visitor, LIMITS.sessionsPerVisitorPerHour);
        if (!ipLimit.ok || !visLimit.ok) return err("Too many tries from this device. Try again later.", "rate_limited", 429);
        ipLimit.write(); visLimit.write();

        const now = deps.now();
        const shots = phone ? SHOTS.phone : SHOTS.email;
        // Game first: the shopper aimed at the hole shown before the email,
        // so the first shot keeps that pin and wind (clamped to the normal ranges).
        const preview = previewFrom(body.preview);
        const sid = deps.newId();
        const leadId = leadIdFor(n.key);
        const session: Session = {
          leadId, visitor: ctx.visitor,
          pin: preview ? preview.pin : Math.floor(deps.rand() * PINS.length),
          winds: Array.from({ length: shots }, (_, i) => (i === 0 && preview ? preview.wind : {
            mph: Math.round(WIND_MIN + deps.rand() * (WIND_MAX - WIND_MIN)), dirDeg: Math.round(deps.rand() * 360),
          })),
          shots, floor: floorFor(Boolean(phone)), results: [], flags: [], status: "open",
          createdAtMs: now, lastShotAtMs: now,
        };
        const evidence = (channel: "email" | "sms") => ({
          channel, granted: true, version: SHOP_CONSENT_VERSION,
          text: channel === "email" ? EMAIL_CONSENT : SMS_CONSENT,
          capturedAt: new Date(now), source: TAKE_A_SHOT_SOURCE,
          page: ctx.page, userAgent: ctx.userAgent.slice(0, 300),
        });
        tx.set(COLLECTIONS.sessions, sid, session as unknown as Data);
        tx.set(COLLECTIONS.leads, leadId, {
          email: n.email, emailKey: n.key, phone, source: TAKE_A_SHOT_SOURCE,
          emailConsent: evidence("email"), ...(phone ? { smsConsent: evidence("sms") } : {}),
          sessionId: sid, shots, visitorIds: ctx.visitor ? [ctx.visitor] : [], ipHash: ctx.ipHash,
          ...(ctx.posthogDistinctId ? { posthogDistinctId: ctx.posthogDistinctId } : {}),
          createdAt: new Date(now), updatedAt: new Date(now),
        });
        tx.addConsentEvent(leadId, { ...evidence("email"), email: n.email });
        if (phone) tx.addConsentEvent(leadId, { ...evidence("sms"), phone });
        if (phone) tx.set(COLLECTIONS.identities, identityIdFor("phone", phone), { leadId, kind: "phone", createdAt: new Date(now) });
        if (ctx.visitor) tx.set(COLLECTIONS.identities, identityIdFor("visitor", ctx.visitor), { leadId, kind: "visitor", createdAt: new Date(now) });
        return { status: "new", session: publicSession(sid, session), claim: null };
      });
    },

    /** Step 3: one swing. Adds hidden variance and decides the result. */
    async shot(body: Data, ctx: RequestContext): Promise<ApiResult> {
      const sid = typeof body.sid === "string" ? body.sid : "";
      const shot = Number(body.shot);
      const target = (body.target ?? {}) as Data;
      const tx_ = Number(target.x), ty = Number(target.y), e = Number(body.e);
      if (!sid || !Number.isInteger(shot) || ![tx_, ty, e].every(Number.isFinite) || Math.abs(e) > 1 || Math.abs(tx_) > 500 || Math.abs(ty) > 500)
        return err("Bad swing data.", "invalid_shot");
      return store.transaction(async (tx) => {
        const s = (await tx.get(COLLECTIONS.sessions, sid)) as Session | null;
        if (!s || (s.visitor && s.visitor !== ctx.visitor)) return err("Game expired. Reopen Take a Shot.", "no_session", 404);
        if (s.status === "claimed") return err("This game is finished.", "claimed", 409);
        if (shot !== s.results.length) return err("That shot was already played.", "shot_played", 409);
        if (shot >= s.shots) return err("No shots left.", "no_shots", 409);
        if (s.results.some((r) => r.surf === "holed")) return err("You already aced it.", "holed", 409);
        const now = deps.now();
        const flags = [...s.flags];
        const gap = now - s.lastShotAtMs;
        if (shot > 0 && gap < LIMITS.minMsBetweenShots) flags.push({ shot, why: "too_fast", ms: gap });
        if (Math.abs(e) <= 0.02) flags.push({ shot, why: "perfect_strike" });
        const w = s.winds[shot];
        const noise = shotNoise(deps.rand);
        const sim = simulateShot({ pin: s.pin, wind: windFrom(w.mph, w.dirDeg), target: { x: tx_, y: ty }, e, noise });
        const result: PublicResult = { ...sim.result, pct: Math.min(MAX_PERCENT, sim.result.pct), shot: shot + 1 };
        const stored: StoredResult = { ...result, input: { x: +tx_.toFixed(2), y: +ty.toFixed(2), e: +e.toFixed(3) }, noise, at: now };
        tx.set(COLLECTIONS.sessions, sid, { results: [...s.results, stored], flags, lastShotAtMs: now, status: "open" }, { merge: true });
        return { status: "shot", noise, result };
      });
    },

    /** Step 4: issue (or upgrade) the one code for this person. */
    async claim(body: Data, ctx: RequestContext | null): Promise<ApiResult> {
      const sid = typeof body.sid === "string" ? body.sid : "";
      if (!sid) return err("Game expired. Reopen Take a Shot.", "no_session", 404);
      const now = deps.now();

      // A 1-shot email player who is about to be offered more shots (phone
      // ask): lock the percent and mint nothing. keep(), the final claim
      // after upgrade(), or the cron mints exactly one code later.
      const offerUpsell = Boolean(ctx) && body.upsell === true;

      // 1. Decide the percent. A lead never gets a second code: if one exists, return it.
      const plan = await store.transaction(async (tx) => {
        const s = (await tx.get(COLLECTIONS.sessions, sid)) as Session | null;
        if (!s || (ctx && s.visitor && s.visitor !== ctx.visitor)) return { done: err("Game expired. Reopen Take a Shot.", "no_session", 404) };
        const lead = await tx.get(COLLECTIONS.leads, s.leadId);
        if (!lead) return { done: err("Game expired. Reopen Take a Shot.", "no_session", 404) };
        const best = bestPercent(s);
        const pct = Math.min(MAX_PERCENT, Math.max(best, s.floor));
        const won = best > 0 && best >= s.floor;
        const prior = lead.reward as Reward | undefined;
        if (prior && prior.status !== "failed") {
          tx.set(COLLECTIONS.sessions, sid, { status: "claimed", claimedAtMs: s.claimedAtMs ?? now }, { merge: true });
          const pub = publicClaim(prior);
          return { done: pub ? ({ status: "claimed", ...pub } as ApiResult) : ({ status: "pending", pct: prior.percent, won: prior.won } as ApiResult) };
        }
        const canUpsell = offerUpsell && s.shots === SHOTS.email && !lead.phone && best < MAX_PERCENT &&
          (s.status === "open" || s.status === "decision");
        if (canUpsell) {
          if (s.status !== "decision") tx.set(COLLECTIONS.sessions, sid, { status: "decision", decisionAtMs: now }, { merge: true });
          return { done: { status: "locked", pct, won } as ApiResult };
        }
        tx.set(COLLECTIONS.sessions, sid, { status: "claimed", claimedAtMs: now }, { merge: true });
        return { leadId: s.leadId, pct, won, review: strongFlags(s) };
      });
      if ("done" in plan && plan.done) return plan.done;
      const { leadId, pct, won, review } = plan as { leadId: string; pct: number; won: boolean; review: boolean };

      // 2. Create the Shopify code outside the transaction.
      const code = makeCode(pct);
      const startsAt = new Date(now).toISOString();
      const expiresAt = codeExpiry(now);
      let discountId: string | null = null;
      let lastError: string | null = null;
      try {
        discountId = (await deps.shopify.create({ code, percent: pct, startsAt, endsAt: expiresAt })).discountId;
      } catch (e) {
        lastError = e instanceof Error ? e.message.slice(0, 60) : "shopify_unavailable";
        console.warn(`[take-a-shot] code create failed (${lastError}); stored as pending`);
      }

      // 3. Store it, unless another claim stored a code in the meantime (one code per lead).
      const stored = await store.transaction(async (tx) => {
        const lead = await tx.get(COLLECTIONS.leads, leadId);
        const current = lead?.reward as Reward | undefined;
        if (current && current.status !== "failed") return { lost: true as const, current };
        const reward: Reward = {
          code, percent: pct, expiresAt, status: discountId ? "active" : "pending", discountId, won,
          issuedAtMs: now, attempts: discountId ? 0 : 1,
          nextAttemptAtMs: now + CODE_BACKOFF_MIN[0] * 60_000, lastError, review,
        };
        tx.set(COLLECTIONS.leads, leadId, { reward, updatedAt: new Date(now) }, { merge: true });
        const stages = discountId ? syncStages(lead) : [];
        if (stages.length) tx.markForSync(leadId, stages);
        return { lost: false as const, reward, stages };
      });
      if (stored.lost) {
        if (discountId) await deps.shopify.remove(discountId).catch(() => {});
        const pub = publicClaim(stored.current);
        return pub ? { status: "claimed", ...pub } : { status: "pending", pct: stored.current.percent, won: stored.current.won };
      }
      if (stored.stages.length) deps.onSyncReady?.(leadId, stored.stages);
      const pub = publicClaim(stored.reward);
      return pub ? { status: "claimed", ...pub } : { status: "pending", pct, won };
    },

    /**
     * Phone ask, declined ("Keep my X%"), closed, or left: mint the locked
     * percent now. That is the lead's one code; Klaviyo gets it once.
     */
    async keep(body: Data, ctx: RequestContext): Promise<ApiResult> {
      return this.claim({ sid: body.sid }, ctx);
    },

    /**
     * Phone ask, accepted: phone + SMS consent. The same session goes from 1
     * shot to 3 with the phone floor; the first result stays. Never mints:
     * the final claim mints the one code at the best of 3. Errors other than
     * input validation are one generic message, so it cannot be used to probe
     * which phones have played.
     */
    async upgrade(body: Data, ctx: RequestContext): Promise<ApiResult> {
      const sid = typeof body.sid === "string" ? body.sid : "";
      if (!sid) return err("Game expired. Reopen Take a Shot.", "no_session", 404);
      const phone = normalizePhone(body.phone);
      if (!phone) return err("Use a valid phone number, including your country code outside the US.", "invalid_phone");
      if (body.smsConsent !== true) return err("Agree to texts to get more shots.", "sms_consent_required");
      const now = deps.now();
      const refused = () => err("We could not add shots to this game. Keep your locked-in code instead.", "upgrade_refused", 409);
      return store.transaction(async (tx) => {
        const ipLimit = await rateLimitRead(tx, "upgrade-ip", ctx.ipHash, LIMITS.upgradesPerIpPerHour);
        const sidLimit = await rateLimitRead(tx, "upgrade-sid", sid, LIMITS.upgradesPerSessionPerHour);
        if (!ipLimit.ok || !sidLimit.ok) return err("Too many tries. Try again later.", "rate_limited", 429);
        ipLimit.write(); sidLimit.write();
        const s = (await tx.get(COLLECTIONS.sessions, sid)) as Session | null;
        if (!s || (s.visitor && s.visitor !== ctx.visitor)) return err("Game expired. Reopen Take a Shot.", "no_session", 404);
        const lead = await tx.get(COLLECTIONS.leads, s.leadId);
        const phoneRef = await tx.get(COLLECTIONS.identities, identityIdFor("phone", phone));
        if (!lead) return err("Game expired. Reopen Take a Shot.", "no_session", 404);
        // Only a locked first shot with no code, no phone, and a phone nobody else used.
        const reward = lead.reward as Reward | undefined;
        if (s.status !== "decision" || (reward && reward.status !== "failed") || lead.phone ||
          s.shots !== SHOTS.email || s.results.length !== SHOTS.email || s.results.some((r) => r.surf === "holed")) return refused();
        if (typeof phoneRef?.leadId === "string" && phoneRef.leadId !== s.leadId) return refused();
        const winds = [...s.winds];
        while (winds.length < SHOTS.phone) {
          winds.push({ mph: Math.round(WIND_MIN + deps.rand() * (WIND_MAX - WIND_MIN)), dirDeg: Math.round(deps.rand() * 360) });
        }
        const next: Session = { ...s, shots: SHOTS.phone, floor: floorFor(true), winds, status: "open", lastShotAtMs: now };
        const smsConsent = {
          channel: "sms", granted: true, version: TAS_SMS_UPSELL_CONSENT_VERSION, text: SMS_CONSENT,
          placement: "after_first_shot", capturedAt: new Date(now), source: TAKE_A_SHOT_SOURCE,
          page: ctx.page, userAgent: ctx.userAgent.slice(0, 300),
        };
        tx.set(COLLECTIONS.sessions, sid, { shots: next.shots, floor: next.floor, winds, status: "open", lastShotAtMs: now }, { merge: true });
        tx.set(COLLECTIONS.leads, s.leadId, { phone, smsConsent, shots: SHOTS.phone, updatedAt: new Date(now) }, { merge: true });
        tx.addConsentEvent(s.leadId, { ...smsConsent, phone });
        tx.set(COLLECTIONS.identities, identityIdFor("phone", phone), { leadId: s.leadId, kind: "phone", createdAt: new Date(now) });
        return { status: "resume", session: publicSession(sid, next), claim: null };
      });
    },

    /**
     * Cron: retry pending Shopify codes, finish abandoned games at their best
     * result (the player consented, so they still get their code by email),
     * and retry deleting replaced codes. Counts only.
     */
    async maintain(opts: { limit?: number; deadlineMs?: number } = {}) {
      const limit = opts.limit ?? 25;
      const deadline = opts.deadlineMs ?? Date.now() + 20_000;
      const summary = { pendingRetried: 0, pendingActivated: 0, pendingFailed: 0, abandonedClaimed: 0, deletesDone: 0, lockedFinalized: 0 };
      const now = deps.now();

      for (const doc of await store.findWhere(COLLECTIONS.leads, "reward.status", "pending", limit)) {
        if (Date.now() > deadline) break;
        const reward = doc.data.reward as Reward;
        if (reward.nextAttemptAtMs > now) continue;
        summary.pendingRetried++;
        let discountId: string | null = null;
        let lastError: string | null = null;
        // A pending code is still valid until its original expiry; never extend it.
        if (Date.parse(reward.expiresAt) <= now) lastError = "expired_before_created";
        else {
          try {
            discountId = (await deps.shopify.create({ code: reward.code, percent: reward.percent, startsAt: new Date(now).toISOString(), endsAt: reward.expiresAt })).discountId;
          } catch (e) { lastError = e instanceof Error ? e.message.slice(0, 60) : "shopify_unavailable"; }
        }
        const activated = await store.transaction(async (tx) => {
          const lead = await tx.get(COLLECTIONS.leads, doc.id);
          const cur = lead?.reward as Reward | undefined;
          if (!lead || !cur || cur.code !== reward.code || cur.status !== "pending") return false;
          const attempts = cur.attempts + 1;
          if (discountId) {
            tx.set(COLLECTIONS.leads, doc.id, { reward: { ...cur, status: "active", discountId, lastError: null, attempts }, updatedAt: new Date(now) }, { merge: true });
            const stages = syncStages(lead);
            if (stages.length) tx.markForSync(doc.id, stages);
            return stages;
          }
          const failed = attempts >= LIMITS.maxCodeAttempts || lastError === "expired_before_created";
          tx.set(COLLECTIONS.leads, doc.id, {
            reward: {
              ...cur, attempts, lastError, status: failed ? "failed" : "pending",
              nextAttemptAtMs: now + CODE_BACKOFF_MIN[Math.min(attempts, CODE_BACKOFF_MIN.length) - 1] * 60_000,
            },
          }, { merge: true });
          if (failed) summary.pendingFailed++;
          return false;
        });
        if (activated) { summary.pendingActivated++; deps.onSyncReady?.(doc.id, activated); }
      }

      const staleBefore = now - LIMITS.abandonAfterMinutes * 60_000;
      for (const doc of await store.findWhere(COLLECTIONS.sessions, "status", "open", limit * 2)) {
        if (Date.now() > deadline) break;
        const s = doc.data as unknown as Session;
        if (Math.max(s.lastShotAtMs ?? 0, s.createdAtMs ?? 0) > staleBefore) continue;
        const out = await this.claim({ sid: doc.id }, null);
        if (out.status === "claimed" || out.status === "pending") summary.abandonedClaimed++;
      }

      // Phone asks nobody answered (tab closed): mint the locked percent and email it.
      for (const doc of await store.findWhere(COLLECTIONS.sessions, "status", "decision", limit)) {
        if (Date.now() > deadline) break;
        const s = doc.data as unknown as Session;
        if ((s.decisionAtMs ?? s.lastShotAtMs ?? 0) > staleBefore) continue;
        const out = await this.claim({ sid: doc.id }, null);
        if (out.status === "claimed" || out.status === "pending") summary.lockedFinalized++;
      }

      for (const doc of await store.findWhere(COLLECTIONS.codeDeletes, "status", "pending", limit)) {
        if (Date.now() > deadline) break;
        if (await deleteReplaced(String(doc.data.discountId))) summary.deletesDone++;
      }
      return summary;
    },
  };

  /** Stages the Klaviyo worker should (re)send once the code is real. */
  function syncStages(lead: Data | null): string[] {
    if (!lead) return [];
    const stages: string[] = [];
    if ((lead.emailConsent as Data | undefined)?.granted === true) stages.push("email");
    if (lead.phone && (lead.smsConsent as Data | undefined)?.granted === true) stages.push("sms");
    return stages;
  }

  async function deleteReplaced(discountId: string): Promise<boolean> {
    const id = discountId.split("/").pop()!;
    try {
      await deps.shopify.remove(discountId);
      await store.transaction(async (tx) => { tx.set(COLLECTIONS.codeDeletes, id, { discountId, status: "done", doneAtMs: deps.now() }, { merge: true }); });
      return true;
    } catch {
      await store.transaction(async (tx) => {
        const cur = await tx.get(COLLECTIONS.codeDeletes, id);
        const attempts = (typeof cur?.attempts === "number" ? cur.attempts : 0) + 1;
        tx.set(COLLECTIONS.codeDeletes, id, { discountId, status: attempts >= LIMITS.maxCodeAttempts ? "failed" : "pending", attempts }, { merge: true });
      }).catch(() => {});
      return false;
    }
  }
}

export type TakeAShotService = ReturnType<typeof createTakeAShotService>;
