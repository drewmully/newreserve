/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/firebase-admin", () => ({ adminDb: { collection: vi.fn() } }));
vi.mock("@/lib/events/alert", () => ({ raiseAlert: vi.fn(async () => undefined) }));
vi.mock("@/app/api/_lib/shopifyAdmin", () => ({ shopifyGraphQL: async () => ({}) }));
vi.mock("@/app/api/_lib/supabaseService", () => ({ getSupabaseService: () => ({}) }));

import { collectMetaOfferSignups, metaOfferDocId, parseMetaOfferNode } from "@/lib/klaviyo/metaOffers";
import { buildStageInputs } from "@/lib/klaviyo/syncState";
import { decideMetaOfferReward, pickReward } from "@/lib/lifecycle/rewards";
import { metaOfferFromLead } from "@/lib/lifecycle/readinessSources";

const now = new Date("2026-10-14T16:00:00Z");

const node = (o: { app?: string | null; title?: string; customers?: any[]; used?: number; createdAt?: string; percent?: number | null; status?: string } = {}) => ({
  id: "gid://shopify/DiscountCodeNode/1470034084032",
  events: { nodes: o.app === null ? [] : [{ appTitle: o.app ?? "Facebook & Instagram", attributeToApp: true }] },
  codeDiscount: {
    __typename: "DiscountCodeBasic",
    title: o.title ?? "IG-EMAIL-8LZSHIND",
    createdAt: o.createdAt ?? "2026-10-14T08:48:20Z",
    startsAt: o.createdAt ?? "2026-10-14T08:48:20Z",
    endsAt: "2026-11-13T08:48:19Z",
    status: o.status ?? "ACTIVE",
    asyncUsageCount: o.used ?? 0,
    appliesOncePerCustomer: true,
    codes: { nodes: [{ code: o.title ?? "IG-EMAIL-8LZSHIND" }] },
    customerGets: { value: o.percent === null ? { __typename: "DiscountAmount", amount: { amount: "10.0", currencyCode: "USD" } } : { __typename: "DiscountPercentage", percentage: o.percent ?? 0.15 } },
    customerSelection: {
      __typename: "DiscountCustomers",
      customers: o.customers ?? [{ id: "gid://shopify/Customer/1", email: "Prospect@Example.com", defaultEmailAddress: { marketingState: "SUBSCRIBED", marketingUpdatedAt: "2026-10-14T08:48:20Z" } }],
    },
  },
});

describe("Meta offer detection", () => {
  it("accepts a code created by the Facebook & Instagram app for one customer", () => {
    const s = parseMetaOfferNode(node(), now)!;
    expect(s).toMatchObject({ code: "IG-EMAIL-8LZSHIND", email: "prospect@example.com", emailSubscribed: true, used: false, active: true, value: { kind: "percentage", percent: 15 } });
  });
  it("catches any Meta offer by app, not by prefix", () => {
    expect(parseMetaOfferNode(node({ title: "FB-EMAIL-ZQ97E7GP" }), now)?.code).toBe("FB-EMAIL-ZQ97E7GP");
    expect(parseMetaOfferNode(node({ title: "META-NEWOFFER-1" }), now)?.code).toBe("META-NEWOFFER-1");
    expect(parseMetaOfferNode(node({ percent: null }), now)?.value).toEqual({ kind: "amount", amount: 10, currency: "USD" });
  });
  it("ignores other apps, multi-customer codes and unknown codes without history", () => {
    expect(parseMetaOfferNode(node({ app: "Shopify Web" }), now)).toBeNull();
    expect(parseMetaOfferNode(node({ customers: [] }), now)).toBeNull();
    const two = node().codeDiscount.customerSelection.customers;
    expect(parseMetaOfferNode(node({ customers: [...two, ...two] }), now)).toBeNull();
    expect(parseMetaOfferNode(node({ app: null, title: "WELCOME10" }), now)).toBeNull();
  });
  it("falls back to the known Meta code shape when event history has aged out", () => {
    expect(parseMetaOfferNode(node({ app: null, title: "IG-EMAIL-B8T6NIA9" }), now)?.app).toBe("Facebook & Instagram");
  });
});

function fakeDb() {
  const docs = new Map<string, any>();
  const sub: any[] = [];
  const db: any = {
    collection: (name: string) => ({
      doc: (id: string) => ({
        id, path: `${name}/${id}`,
        collection: () => ({ doc: () => ({ path: "consent" }) }),
      }),
    }),
    runTransaction: async (fn: any) => fn({
      get: async (ref: any) => ({ exists: docs.has(ref.path), get: (k: string) => docs.get(ref.path)?.[k] }),
      set: (ref: any, data: any) => { if (ref.path === "consent") sub.push(data); else docs.set(ref.path, { ...(docs.get(ref.path) ?? {}), ...data }); },
    }),
  };
  return { db, docs, sub };
}

describe("collecting Meta offer sign-ups", () => {
  const gqlWith = (nodes: any[]) => vi.fn(async () => ({ codeDiscountNodes: { nodes, pageInfo: { hasNextPage: false } } }));

  it("queues new, unused, consented sign-ups once and skips the rest", async () => {
    const { db, docs, sub } = fakeDb();
    const gql = gqlWith([
      node(),
      node({ title: "IG-EMAIL-USED0001", used: 1, customers: [{ id: "c2", email: "buyer@example.com", defaultEmailAddress: { marketingState: "SUBSCRIBED" } }] }),
      node({ title: "IG-EMAIL-YOUNG001", createdAt: "2026-10-14T15:59:00Z", customers: [{ id: "c3", email: "young@example.com", defaultEmailAddress: { marketingState: "SUBSCRIBED" } }] }),
      node({ title: "FB-EMAIL-NOCONSNT", customers: [{ id: "c4", email: "no@example.com", defaultEmailAddress: { marketingState: "UNSUBSCRIBED" } }] }),
    ]);
    const first = await collectMetaOfferSignups({ now, gql, db });
    expect(first).toMatchObject({ found: 4, queued: 1, skippedUsed: 1, skippedYoung: 1, skippedNoConsent: 1 });
    const doc = docs.get(`meta_offer_leads/${metaOfferDocId("prospect@example.com")}`);
    expect(doc).toMatchObject({ email: "prospect@example.com", source: "meta-email-offer", sendingStatus: "not_synced", emailConsent: { granted: true, source: "meta-email-offer" } });
    expect(doc.offer).toMatchObject({ code: "IG-EMAIL-8LZSHIND", value: { kind: "percentage", percent: 15 } });
    expect(sub).toHaveLength(1);
    const again = await collectMetaOfferSignups({ now, gql, db });
    expect(again).toMatchObject({ queued: 0, skippedExisting: 1 });
  });

  it("throws on an unreadable Shopify response instead of acting on a partial list", async () => {
    const { db } = fakeDb();
    await expect(collectMetaOfferSignups({ now, gql: vi.fn(async () => ({})), db })).rejects.toThrow("meta_offers_unreadable");
  });
});

describe("Meta offer -> Klaviyo signup event", () => {
  const lead = {
    email: "prospect@example.com", source: "meta-email-offer",
    emailConsent: { granted: true },
    offer: { code: "IG-EMAIL-8LZSHIND", app: "Facebook & Instagram", value: { kind: "percentage", percent: 15 }, createdAt: "2026-10-14T08:48:20Z", endsAt: "2026-11-13T08:48:19Z" },
    klaviyoSync: { capturedAt: now },
  };
  it("sends the welcome-trigger event with source meta-email-offer and never subscribes", () => {
    const { email } = buildStageInputs("meta_offer_leads", "abc", lead);
    expect(email.source).toBe("meta-email-offer");
    expect(email.stage).toBe("email");
    expect(email.subscribe).toEqual({ email: false });
    expect(email.eventProperties).toMatchObject({ email_consent: true, reward_code: "IG-EMAIL-8LZSHIND", reward_percent: 15 });
    expect(email.capturedAt).toEqual(now);
  });
  it("sends nothing without recorded consent or for historical replays", () => {
    expect(buildStageInputs("meta_offer_leads", "abc", { ...lead, emailConsent: { granted: false } })).toEqual({});
    expect(buildStageInputs("meta_offer_leads", "abc", lead, { historical: true })).toEqual({});
  });
});

describe("Meta offer as the welcome reward", () => {
  const live = { active: true, oncePerCustomer: true };
  const offer = { code: "IG-EMAIL-8LZSHIND", percent: 15 };
  it("shows the person's own active, unused Meta code", () => {
    expect(decideMetaOfferReward({ leadReadOk: true, offer, usedCodes: [], historyComplete: true, status: live }))
      .toEqual({ verified: true, code: "IG-EMAIL-8LZSHIND", percent: 15, holds: [] });
  });
  it("hides it once used or expired, and holds when unsure", () => {
    expect(decideMetaOfferReward({ leadReadOk: true, offer, usedCodes: ["ig-email-8lzshind"], historyComplete: true, status: live }).verified).toBe(false);
    expect(decideMetaOfferReward({ leadReadOk: true, offer, usedCodes: [], historyComplete: true, status: { active: false, oncePerCustomer: true } }).verified).toBe(false);
    expect(decideMetaOfferReward({ leadReadOk: true, offer, usedCodes: [], historyComplete: false, status: live }).holds).toEqual(["meta_offer_history_incomplete"]);
    expect(decideMetaOfferReward({ leadReadOk: true, offer, usedCodes: [], historyComplete: true, status: undefined }).holds[0]).toMatch(/status_unknown/);
    expect(decideMetaOfferReward({ leadReadOk: true, offer: { ...offer, percent: null }, usedCodes: [], historyComplete: true, status: live }).verified).toBe(false);
  });
  it("never shows two codes: the higher percent wins", () => {
    const popup10 = { verified: true, code: "MULLYEDIT10", percent: 10, holds: [] };
    const meta15 = { verified: true, code: "IG-EMAIL-8LZSHIND", percent: 15, holds: [] };
    const none = { verified: false, code: null, percent: null, holds: ["x"] };
    expect(pickReward(popup10, meta15).code).toBe("IG-EMAIL-8LZSHIND");
    expect(pickReward(meta15, popup10).code).toBe("IG-EMAIL-8LZSHIND");
    expect(pickReward(none, popup10).code).toBe("MULLYEDIT10");
    expect(pickReward(none, none)).toEqual({ verified: false, code: null, percent: null, holds: ["x", "x"] });
  });
  it("reads the offer off the lead doc", () => {
    expect(metaOfferFromLead({ offer: { code: "ig-email-x1", value: { kind: "percentage", percent: 15 } } })).toEqual({ code: "IG-EMAIL-X1", percent: 15 });
    expect(metaOfferFromLead({ offer: { code: "FB-EMAIL-X2", value: { kind: "amount", amount: 10 } } })).toEqual({ code: "FB-EMAIL-X2", percent: null });
    expect(metaOfferFromLead(null)).toBeNull();
  });
});
