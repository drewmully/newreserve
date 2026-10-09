/**
 * Live, read-only evidence for the readiness writer, plus the single
 * Klaviyo profile write it performs. No PII is logged or returned.
 *
 * Nonmembership rules:
 *  - Shopify customer exists: Loop mirror + native Flow snapshot + storewide
 *    order history must all be complete (reconcileMembership decides).
 *  - No Shopify customer has this exact email (complete storewide Admin
 *    customer search, not an app-scoped contract list): no subscription
 *    contract can belong to this email, so it is a verified nonmember.
 *  - More than one exact match, or any read error: unknown, never nonmember.
 */
import { createHash } from "node:crypto";
import { adminDb } from "@/lib/firebase-admin";
import { getSupabaseService } from "@/app/api/_lib/supabaseService";
import { shopifyGraphQL } from "@/app/api/_lib/shopifyAdmin";
import { klaviyoRequest } from "@/lib/klaviyo/client";
import { reconcileMembership, verifyServiceClear, type MembershipDecision } from "@/lib/klaviyo/eligibility";
import { shopifyId } from "@/lib/klaviyo/orderMatching";
import { SHOP_REWARDS } from "@/lib/shopRewards";
import { buildNativeEvidence } from "./flowBridge";
import { readCustomerOrderHistory } from "./orderHistory";
import { readKlaviyoConsent } from "./consent";
import { readLoopEvidence, readNativeEvents, readServiceEvidence, REVIEW_OWNER } from "./sources";
import { decideEarnedReward, parseRewardStatus, REWARD_STATUS_QUERY, type RewardCode } from "./rewards";
import type { ProfileProps, ReadinessInput } from "./readiness";

type Sb = ReturnType<typeof getSupabaseService>;
type Gql = (q: string, v: Record<string, unknown>) => Promise<unknown>;

export const CUSTOMER_BY_EMAIL_QUERY = `query MullyLifecycleCustomerByEmail($q: String!) {
  customers(first: 3, query: $q) { nodes { id email } }
}`;
export const REWARD_USE_QUERY = `query MullyLifecycleRewardUse($q: String!) {
  orders(first: 5, query: $q) { nodes { id email discountCodes } }
}`;

const searchValue = (s: string) => `"${s.replace(/["\\]/g, "")}"`;

export interface ReadinessDeps {
  sb?: Sb;
  gql?: Gql;
  /** Popup lead lookup by email digest. Returns null when absent; throws on read error. */
  lead?: (docId: string) => Promise<Record<string, unknown> | null>;
  consent?: (email: string) => Promise<{ subscribed: boolean; marketable: boolean; internal: boolean }>;
  now?: Date;
}

const defaultLead = async (id: string) => {
  const snap = await adminDb.collection("shop_marketing_leads").doc(id).get();
  return snap.exists ? (snap.data() as Record<string, unknown>) : null;
};

/** Synthetic decision for an email no Shopify customer owns. */
function prospectMembership(now: Date): MembershipDecision {
  return { customerId: null, activeVerified: false, nonmemberVerified: true, activeContractKeys: [],
    activeContractValidUntil: {}, evaluatedAt: now.toISOString(), holds: [] };
}

async function intercomMirrorFresh(sb: Sb, now: Date) {
  const { data, error } = await sb.from("hub_message").select("created_at").eq("channel", "intercom")
    .order("created_at", { ascending: false }).limit(1);
  const at = Date.parse(String((data?.[0] as { created_at?: string } | undefined)?.created_at ?? ""));
  return !error && Number.isFinite(at) && now.getTime() - at <= 24 * 3_600_000;
}

export async function readReadinessEvidence(emailRaw: string, deps: ReadinessDeps = {}): Promise<ReadinessInput> {
  const now = deps.now ?? new Date();
  const sb = deps.sb ?? getSupabaseService();
  const gql: Gql = deps.gql ?? ((q, v) => shopifyGraphQL(q, v));
  const email = emailRaw.trim().toLowerCase();
  const out: ReadinessInput = { membership: null, hadTerminalContract: false, service: null, preferences: null,
    reward: { verified: false, code: null, percent: null, holds: ["reward_unread"] }, consent: null };

  const [customers, consent, lead] = await Promise.all([
    gql(CUSTOMER_BY_EMAIL_QUERY, { q: `email:${searchValue(email)}` }).catch(() => null) as Promise<{ customers?: { nodes?: Array<{ id?: string; email?: string }> } } | null>,
    (deps.consent ?? readKlaviyoConsent)(email).catch(() => null),
    (deps.lead ?? defaultLead)(createHash("sha256").update(email).digest("hex")).then((d) => ({ ok: true as const, d })).catch(() => ({ ok: false as const, d: null })),
  ]);
  out.consent = consent;
  const matches = (customers?.customers?.nodes ?? []).filter((c) => (c.email ?? "").trim().toLowerCase() === email);
  const customerId = matches.length === 1 ? shopifyId(matches[0].id, "Customer") : null;

  // Reward usage is checked by email so guest checkouts count too.
  const codeStatus: Partial<Record<RewardCode, { active: boolean; oncePerCustomer: boolean }>> = {};
  let usedCodes: string[] = [], usageOk = true;
  await Promise.all(Object.values(SHOP_REWARDS).map(async ({ code }) => {
    try {
      codeStatus[code] = parseRewardStatus(await gql(REWARD_STATUS_QUERY, { code }), now);
      const used = await gql(REWARD_USE_QUERY, { q: `discount_code:${code} email:${searchValue(email)}` }) as { orders?: { nodes?: Array<{ email?: string; discountCodes?: string[] }> } };
      for (const o of used?.orders?.nodes ?? []) {
        if ((o.email ?? "").trim().toLowerCase() === email) usedCodes = [...usedCodes, ...(o.discountCodes ?? [])];
      }
    } catch { usageOk = false; }
  }));
  const l = lead.d as { emailConsent?: { granted?: unknown }; smsConsent?: { granted?: unknown } } | null;
  out.reward = decideEarnedReward({ leadReadOk: lead.ok, emailConsentGranted: l?.emailConsent?.granted === true,
    smsConsentGranted: l?.smsConsent?.granted === true, usedCodes, historyComplete: usageOk, codeStatus });

  if (!customers) return out; // Customer search failed: everything unknown.
  if (matches.length > 1) { out.membership = { ...prospectMembership(now), nonmemberVerified: false, holds: ["duplicate_customer_email"] }; return out; }

  if (!customerId) {
    out.membership = prospectMembership(now);
    const fresh = await intercomMirrorFresh(sb, now);
    // Support threads are keyed by Shopify customer ID; with no customer there is no open thread.
    out.service = { clear: fresh, reviewOwnerClear: fresh, holds: fresh ? [] : ["service_coverage_unverified"] };
    out.preferences = { readOk: true, hasTopAndBottomSize: false };
    return out;
  }

  const [loop, events, service, history, facts] = await Promise.all([
    readLoopEvidence(sb, customerId, now), readNativeEvents(sb, customerId), readServiceEvidence(sb, customerId, now),
    readCustomerOrderHistory(customerId, gql, () => now),
    sb.from("customer_facts").select("size_top,size_bottom").eq("customer_id", customerId).limit(2),
  ]);
  const s = verifyServiceClear(customerId, service, now);
  out.service = { clear: s.clear, reviewOwnerClear: s.reviewOwnerClear && REVIEW_OWNER === "junip", holds: s.holds };
  if (facts.error || (facts.data?.length ?? 0) > 1) out.preferences = { readOk: false, hasTopAndBottomSize: false };
  else {
    const f = (facts.data?.[0] ?? {}) as { size_top?: string | null; size_bottom?: string | null };
    out.preferences = { readOk: true, hasTopAndBottomSize: Boolean(f.size_top?.trim() && f.size_bottom?.trim()) };
  }
  if (!loop.ok || !events) return out;
  const native = buildNativeEvidence(customerId, events, history, now);
  const contracts = [...loop.contracts, ...native.contracts];
  let coverage = [loop.coverage, ...native.coverage];
  // Positive proof of never-subscribed: a COMPLETE storewide order history with
  // zero subscription orders of any status (Loop, Recharge or native), and no
  // contract rows anywhere. Every contract on this store starts from a
  // subscription checkout, so this is evidence, not an empty-result inference.
  if (contracts.length === 0 && history.complete && history.customerId === customerId && history.subscriptionSignalCount === 0) {
    coverage = (["loop", "shopify_native"] as const).map((provider) => ({
      provider, customerId, scope: "all_customer_contracts" as const, complete: true, checkedAt: history.checkedAt }));
  }
  out.membership = reconcileMembership(customerId, contracts, coverage, now);
  out.hadTerminalContract = contracts.some((c) => c.status === "cancelled" || c.status === "expired");
  return out;
}

/** One profile write. Properties only: never subscribes, unsubscribes or suppresses. */
export async function writeReadinessProperties(email: string, properties: ProfileProps) {
  await klaviyoRequest("/api/profile-import", { body: { data: { type: "profile", attributes: { email, properties } } } });
}

/** Candidate emails: every Loop-mirror customer plus recent popup leads. Deduped, sorted. */
export async function readinessCandidates(sb: Sb = getSupabaseService(), leadDays = 30): Promise<string[]> {
  const emails = new Set<string>();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb.from("loop_subscriptions").select("email").range(from, from + 999);
    if (error) throw new Error("candidates_loop_failed");
    for (const r of (data ?? []) as Array<{ email: string | null }>) if (r.email) emails.add(r.email.trim().toLowerCase());
    if ((data?.length ?? 0) < 1000) break;
  }
  const since = new Date(Date.now() - leadDays * 86_400_000);
  const leads = await adminDb.collection("shop_marketing_leads").where("updatedAt", ">=", since).limit(5000).get();
  for (const doc of leads.docs) {
    const e = doc.get("email");
    if (typeof e === "string" && e) emails.add(e.trim().toLowerCase());
  }
  return [...emails].filter((e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)).sort();
}

/**
 * Inline refresh for a brand-new signup, run BEFORE the signup event so the
 * immediate welcome email sees current flags. Consent comes from the
 * submission itself (the bulk-subscribe job is asynchronous, so a profile
 * read here could still show the old state). Never throws; on failure the
 * flags stay as they were, so the welcome holds rather than sends.
 */
export async function refreshReadinessForSignup(email: string, submittedEmailConsent: boolean): Promise<"written" | "skipped" | "failed"> {
  const { computeReadiness, readReadinessConfig } = await import("./readiness");
  const config = readReadinessConfig();
  if (!config.enabled) return "skipped";
  try {
    const internal = /@mullybox\.com$/i.test(email) || /\+synctest/i.test(email);
    const evidence = await readReadinessEvidence(email, {
      consent: async (e) => submittedEmailConsent
        ? { subscribed: true, marketable: true, internal }
        : readKlaviyoConsent(e),
    });
    await writeReadinessProperties(email, computeReadiness(evidence, config).properties);
    return "written";
  } catch { return "failed"; }
}
