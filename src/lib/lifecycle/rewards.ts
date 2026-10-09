/**
 * Earned signup rewards. Pure decision: no I/O, no profile writes.
 *
 * Existing codes only (no new incentives): the shop popup email step earns
 * MULLYEDIT10 and the SMS step earns MULLYTEXT15. Both are once per customer.
 * A reward is shown only when ALL of these are proven:
 *   - the customer actually earned it (consent evidence on the popup lead),
 *   - the code is ACTIVE in Shopify right now (not expired or scheduled),
 *   - the customer's complete order history shows they have not used it.
 * Only the HIGHEST earned reward is considered, so a 15% upgrade is never
 * downgraded to 10%, and once it is used the signup reward is spent (we do
 * not resurface the lower code). Codes never stack: at most one is returned.
 */
import { SHOP_REWARDS } from "@/lib/shopRewards";

export type RewardCode = (typeof SHOP_REWARDS)[keyof typeof SHOP_REWARDS]["code"];

export interface RewardEvidence {
  /** Popup lead for this email was read without error. */
  leadReadOk: boolean;
  emailConsentGranted: boolean;
  smsConsentGranted: boolean;
  /** Codes seen on any of the customer's orders (any status counts as used). */
  usedCodes: string[];
  /** Order history was read completely (no truncation, no error). */
  historyComplete: boolean;
  /** Live Shopify status per code; missing means unknown. */
  codeStatus: Partial<Record<RewardCode, { active: boolean; oncePerCustomer: boolean }>>;
}

export interface RewardDecision {
  verified: boolean;
  code: RewardCode | null;
  percent: number | null;
  holds: string[];
}

const NONE = (holds: string[]): RewardDecision => ({ verified: false, code: null, percent: null, holds });

export function decideEarnedReward(e: RewardEvidence): RewardDecision {
  if (!e.leadReadOk) return NONE(["reward_lead_unreadable"]);
  const earned = [
    ...(e.smsConsentGranted ? [SHOP_REWARDS.sms] : []),
    ...(e.emailConsentGranted ? [SHOP_REWARDS.email] : []),
  ].sort((a, b) => b.percent - a.percent);
  if (!earned.length) return NONE([]); // Nothing earned is a normal state, not a hold.
  if (!e.historyComplete) return NONE(["reward_history_incomplete"]);
  const used = new Set(e.usedCodes.map((c) => c.trim().toUpperCase()));
  const reward = earned[0];
  if (used.has(reward.code)) return NONE([]); // Spent: normal state, nothing to show.
  const status = e.codeStatus[reward.code];
  if (!status) return NONE([`reward_status_unknown:${reward.code}`]);
  if (!status.active) return NONE([`reward_inactive:${reward.code}`]);
  if (!status.oncePerCustomer) return NONE([`reward_rules_changed:${reward.code}`]);
  return { verified: true, code: reward.code, percent: reward.percent, holds: [] };
}

export const REWARD_STATUS_QUERY = `query MullyRewardCodeStatus($code: String!) {
  codeDiscountNodeByCode(code: $code) {
    id
    codeDiscount {
      __typename
      ... on DiscountCodeBasic { status startsAt endsAt appliesOncePerCustomer }
    }
  }
}`;

/** Normalize the Admin response; anything unexpected is "unknown" (undefined). */
export function parseRewardStatus(data: unknown, now = new Date()): { active: boolean; oncePerCustomer: boolean } | undefined {
  const node = (data as { codeDiscountNodeByCode?: { codeDiscount?: Record<string, unknown> } | null } | null)?.codeDiscountNodeByCode;
  if (node === null) return { active: false, oncePerCustomer: false }; // Code deleted.
  const d = node?.codeDiscount;
  if (!d || d.__typename !== "DiscountCodeBasic") return undefined;
  const starts = Date.parse(String(d.startsAt ?? ""));
  const ends = d.endsAt == null ? Infinity : Date.parse(String(d.endsAt));
  const active = d.status === "ACTIVE" && Number.isFinite(starts) && starts <= now.getTime() && ends > now.getTime();
  return { active, oncePerCustomer: d.appliesOncePerCustomer === true };
}
