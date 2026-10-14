/**
 * Meta offer sign-ups -> Klaviyo welcome.
 *
 * Meta's in-app offers (today the Commerce Manager "Email Sign-Up Offer",
 * which mints IG-EMAIL-xxxx codes) never touch the site. The only trace is in
 * Shopify: the "Facebook & Instagram" app creates a Shopify customer (email
 * marketing SUBSCRIBED) and a single-customer discount code for them.
 *
 * This module finds those codes and turns each one into a capture doc in
 * `meta_offer_leads`, which the normal signup sync then sends to Klaviyo as a
 * "Mully Site Signup" event with source "meta-email-offer". That is the same
 * event the website welcome flow listens for.
 *
 * Detection is by the app that created the discount (Shopify discount event
 * history), not by the code prefix, so any future Meta offer is caught too.
 *
 * Consent: we never subscribe anyone here. Email consent is read live from
 * the Shopify customer (Meta's own opt-in) and only recorded as evidence. The
 * Klaviyo subscription itself arrives through the Shopify integration.
 *
 * Never logs PII.
 */

import { createHash } from "node:crypto";
import { FieldValue } from "firebase-admin/firestore";
import { adminDb } from "@/lib/firebase-admin";
import { shopifyGraphQL } from "@/app/api/_lib/shopifyAdmin";
import { captureSyncFields } from "./syncState";

import { META_OFFER_COLLECTION, META_OFFER_SOURCE } from "./config";

export { META_OFFER_COLLECTION, META_OFFER_SOURCE };
/** Shopify app titles that create Meta offer codes. */
export const META_OFFER_APP_TITLES = ["Facebook & Instagram"];
/**
 * Fallback for codes whose Shopify event history has aged out: the shapes
 * Meta's app has used so far (IG-EMAIL-XXXXXXXX, FB-EMAIL-XXXXXXXX).
 */
export const META_OFFER_CODE_PATTERN = /^(IG|FB)-[A-Z]+-[A-Z0-9]{6,}$/;
/** How far back each run looks. Idempotent, so overlap is harmless. */
export const META_OFFER_LOOKBACK_HOURS = 7 * 24;
/**
 * Codes younger than this are left for the next run so the Shopify -> Klaviyo
 * consent sync (seconds in practice) has landed before the welcome event.
 */
export const META_OFFER_MIN_AGE_MS = 3 * 60_000;

export const META_OFFER_DISCOUNTS_QUERY = `query MullyMetaOfferDiscounts($q: String!, $after: String) {
  codeDiscountNodes(first: 50, after: $after, query: $q, sortKey: CREATED_AT) {
    pageInfo { hasNextPage endCursor }
    nodes {
      id
      events(first: 5) { nodes { appTitle attributeToApp } }
      codeDiscount {
        __typename
        ... on DiscountCodeBasic {
          title createdAt startsAt endsAt status asyncUsageCount appliesOncePerCustomer
          codes(first: 1) { nodes { code } }
          customerGets { value {
            __typename
            ... on DiscountPercentage { percentage }
            ... on DiscountAmount { amount { amount currencyCode } }
          } }
          customerSelection { __typename ... on DiscountCustomers { customers {
            id email defaultEmailAddress { marketingState marketingUpdatedAt }
          } } }
        }
        ... on DiscountCodeFreeShipping {
          title createdAt startsAt endsAt status asyncUsageCount appliesOncePerCustomer
          codes(first: 1) { nodes { code } }
          customerSelection { __typename ... on DiscountCustomers { customers {
            id email defaultEmailAddress { marketingState marketingUpdatedAt }
          } } }
        }
      }
    }
  }
}`;

export type MetaOfferValue =
  | { kind: "percentage"; percent: number }
  | { kind: "amount"; amount: number; currency: string }
  | { kind: "free_shipping" }
  | { kind: "unknown" };

export interface MetaOfferSignup {
  discountId: string;
  code: string;
  app: string;
  email: string;
  customerId: string;
  emailSubscribed: boolean;
  consentAt: string | null;
  createdAt: string;
  endsAt: string | null;
  used: boolean;
  active: boolean;
  value: MetaOfferValue;
}

type Data = Record<string, unknown>;
const obj = (v: unknown): Data => (v && typeof v === "object" ? (v as Data) : {});
const str = (v: unknown) => (typeof v === "string" ? v : "");

function parseValue(typename: string, d: Data): MetaOfferValue {
  if (typename === "DiscountCodeFreeShipping") return { kind: "free_shipping" };
  const v = obj(obj(d.customerGets).value);
  if (v.__typename === "DiscountPercentage" && typeof v.percentage === "number") {
    return { kind: "percentage", percent: Math.round(v.percentage * 1000) / 10 };
  }
  if (v.__typename === "DiscountAmount") {
    const a = obj(v.amount);
    const amount = Number(a.amount);
    if (Number.isFinite(amount)) return { kind: "amount", amount, currency: str(a.currencyCode) || "USD" };
  }
  return { kind: "unknown" };
}

/**
 * One discount node -> a Meta offer signup, or null when it is not a Meta
 * offer for exactly one customer with an email.
 */
export function parseMetaOfferNode(node: unknown, now = new Date()): MetaOfferSignup | null {
  const n = obj(node);
  const events = (obj(n.events).nodes as Data[] | undefined) ?? [];
  const d = obj(n.codeDiscount);
  const byEvent = events.find((e) => e.attributeToApp === true && META_OFFER_APP_TITLES.includes(str(e.appTitle)));
  const byPattern = events.length === 0 && META_OFFER_CODE_PATTERN.test(str(d.title).toUpperCase());
  if (!byEvent && !byPattern) return null;
  const app = byEvent ?? { appTitle: META_OFFER_APP_TITLES[0] };
  const typename = str(d.__typename);
  if (typename !== "DiscountCodeBasic" && typename !== "DiscountCodeFreeShipping") return null;
  const sel = obj(d.customerSelection);
  if (sel.__typename !== "DiscountCustomers") return null;
  const customers = (sel.customers as Data[] | undefined) ?? [];
  if (customers.length !== 1) return null;
  const c = customers[0];
  const email = str(c.email).trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
  const code = str(obj(((obj(d.codes).nodes as Data[] | undefined) ?? [])[0]).code) || str(d.title);
  if (!code) return null;
  const addr = obj(c.defaultEmailAddress);
  const endsAt = str(d.endsAt) || null;
  const starts = Date.parse(str(d.startsAt));
  const ends = endsAt ? Date.parse(endsAt) : Infinity;
  return {
    discountId: str(n.id),
    code: code.toUpperCase(),
    app: str(app.appTitle),
    email,
    customerId: str(c.id),
    emailSubscribed: addr.marketingState === "SUBSCRIBED",
    consentAt: str(addr.marketingUpdatedAt) || null,
    createdAt: str(d.createdAt),
    endsAt,
    used: Number(d.asyncUsageCount) > 0,
    active: d.status === "ACTIVE" && Number.isFinite(starts) && starts <= now.getTime() && ends > now.getTime(),
    value: parseValue(typename, d),
  };
}

export const metaOfferDocId = (email: string) => createHash("sha256").update(email.trim().toLowerCase()).digest("hex");

type Gql = (q: string, v: Record<string, unknown>) => Promise<unknown>;

/** Read recent Meta offer codes. Throws on read errors so a partial page is never acted on. */
export async function readRecentMetaOffers(since: Date, gql: Gql = (q, v) => shopifyGraphQL(q, v), now = new Date(), maxPages = 20) {
  const out: MetaOfferSignup[] = [];
  let after: string | null = null;
  for (let page = 0; page < maxPages; page++) {
    const res = obj(await gql(META_OFFER_DISCOUNTS_QUERY, { q: `created_at:>='${since.toISOString()}'`, after }));
    const conn = obj(res.codeDiscountNodes);
    if (!Array.isArray(conn.nodes)) throw new Error("meta_offers_unreadable");
    for (const node of conn.nodes) {
      const s = parseMetaOfferNode(node, now);
      if (s) out.push(s);
    }
    const info = obj(conn.pageInfo);
    if (info.hasNextPage !== true) return out;
    after = str(info.endCursor) || null;
    if (!after) throw new Error("meta_offers_cursor_missing");
  }
  throw new Error("meta_offers_truncated");
}

export interface CollectSummary {
  found: number;
  queued: number;
  skippedExisting: number;
  skippedYoung: number;
  skippedUsed: number;
  skippedNoConsent: number;
}

/**
 * Queue a capture doc for every new, unused Meta offer signup with email
 * consent. Customers who already used their code (bought) are skipped: they
 * are customers, not prospects to welcome.
 */
export async function collectMetaOfferSignups(opts: {
  now?: Date;
  lookbackHours?: number;
  minAgeMs?: number;
  gql?: Gql;
  db?: typeof adminDb;
} = {}): Promise<CollectSummary> {
  const now = opts.now ?? new Date();
  const db = opts.db ?? adminDb;
  const since = new Date(now.getTime() - (opts.lookbackHours ?? META_OFFER_LOOKBACK_HOURS) * 3_600_000);
  const minAge = opts.minAgeMs ?? META_OFFER_MIN_AGE_MS;
  const signups = await readRecentMetaOffers(since, opts.gql, now);
  const summary: CollectSummary = { found: signups.length, queued: 0, skippedExisting: 0, skippedYoung: 0, skippedUsed: 0, skippedNoConsent: 0 };
  for (const s of signups) {
    if (now.getTime() - Date.parse(s.createdAt) < minAge) { summary.skippedYoung++; continue; }
    if (s.used) { summary.skippedUsed++; continue; }
    if (!s.emailSubscribed) { summary.skippedNoConsent++; continue; }
    const ref = db.collection(META_OFFER_COLLECTION).doc(metaOfferDocId(s.email));
    const queued = await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const offers = (snap.exists ? (snap.get("offers") as Data | undefined) : undefined) ?? {};
      const key = s.discountId.split("/").pop() || s.code;
      if (offers[key]) return false;
      const evidence = {
        channel: "email", granted: true, source: META_OFFER_SOURCE,
        basis: "shopify_customer_marketing_state", app: s.app,
        consentAt: s.consentAt, recordedAt: FieldValue.serverTimestamp(),
      };
      tx.set(ref, {
        email: s.email,
        source: META_OFFER_SOURCE,
        shopifyCustomerId: s.customerId,
        offer: { code: s.code, discountId: s.discountId, app: s.app, value: s.value, createdAt: s.createdAt, endsAt: s.endsAt },
        offers: { [key]: { code: s.code, createdAt: s.createdAt } },
        emailConsent: evidence,
        ...(!snap.exists ? { createdAt: FieldValue.serverTimestamp() } : {}),
        updatedAt: FieldValue.serverTimestamp(),
        ...captureSyncFields("email"),
      }, { merge: true });
      tx.set(ref.collection("consent_events").doc(), { ...evidence, email: s.email, code: s.code });
      return true;
    });
    if (queued) summary.queued++; else summary.skippedExisting++;
  }
  return summary;
}
