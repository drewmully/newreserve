/**
 * Campaign and flow readiness: the profile properties the draft Klaviyo
 * flows and segments require before they can send. Pure; no I/O.
 *
 * Two layers:
 *   1. Evidence flags (member verified, nonmember verified, service clear,
 *      cancelled verified, setup incomplete, earned reward). Computed from
 *      live sources and written regardless of program switches, because
 *      they are facts, not permissions.
 *   2. Program "ready" flags (one per flow/campaign). True only when the
 *      program is in LIFECYCLE_READINESS_PROGRAMS AND that program's
 *      evidence prerequisites hold. This is the per-program launch switch.
 *
 * Fail closed: any unreadable or stale source turns every program flag off
 * and records a hold code. Never infer nonmembership from an empty result.
 * Order-scoped programs (shop purchase/delivery, member start/first delivery)
 * still require the outbox recheck per order; their profile flag is only a
 * coarse gate on top of it.
 */
import type { MembershipDecision } from "@/lib/klaviyo/eligibility";
import type { RewardDecision } from "./rewards";

export const READINESS_PROGRAMS = {
  welcome: "mully_wave1_welcome_launch_ready",
  checkout: "mully_wave1_checkout_launch_ready",
  member_start: "mully_wave1_paid_start_ready",
  member_first_delivery: "mully_wave1_first_member_delivery_ready",
  shop_purchase: "mully_wave1_shop_purchase_ready",
  shop_delivery: "mully_wave1_shop_delivery_ready",
  winback: "mully_wave1_winback_ready",
  sunset: "mully_wave1_sunset_ready",
  browse: "mully_wave2_browse_ready",
  cart: "mully_wave2_cart_ready",
  reserve: "mully_wave2_reserve_ready",
  campaign: "mully_wave2_campaign_ready",
} as const;
export type ReadinessProgram = keyof typeof READINESS_PROGRAMS;

/** Programs whose audience rules are not built yet can never be switched on here. */
export const UNSUPPORTED_PROGRAMS: ReadonlySet<ReadinessProgram> = new Set(["sunset"]);

export interface ReadinessConfig { enabled: boolean; programs: Set<ReadinessProgram> }

export function readReadinessConfig(env: Record<string, string | undefined> = process.env): ReadinessConfig {
  const programs = new Set<ReadinessProgram>();
  for (const raw of (env.LIFECYCLE_READINESS_PROGRAMS ?? "").split(",")) {
    const p = raw.trim() as ReadinessProgram;
    if (p in READINESS_PROGRAMS && !UNSUPPORTED_PROGRAMS.has(p)) programs.add(p);
  }
  return { enabled: env.LIFECYCLE_READINESS_WRITE_ENABLED === "true", programs };
}

export interface ReadinessInput {
  membership: MembershipDecision | null;
  /** Some contract for this customer is cancelled/expired (not merely absent). */
  hadTerminalContract: boolean;
  service: { clear: boolean; reviewOwnerClear: boolean; holds: string[] } | null;
  /** Size preferences from a fresh read; null when unreadable. */
  preferences: { readOk: boolean; hasTopAndBottomSize: boolean } | null;
  reward: RewardDecision;
  /** Explicit, current email marketing consent. Internal addresses are never ready. */
  consent: { subscribed: boolean; marketable: boolean; internal: boolean } | null;
}

export type ProfileProps = Record<string, string | number | boolean | null>;

export function computeReadiness(input: ReadinessInput, config: ReadinessConfig, now = new Date()): { properties: ProfileProps; holds: string[] } {
  const holds: string[] = [];
  const m = input.membership;
  if (!m) holds.push("membership_unreadable");
  else holds.push(...m.holds.map((h) => `membership:${h}`));
  if (!input.service) holds.push("service_unreadable");
  else holds.push(...input.service.holds.map((h) => `service:${h}`));
  if (!input.consent) holds.push("consent_unreadable");
  else {
    if (input.consent.internal) holds.push("internal_profile");
    if (!input.consent.subscribed || !input.consent.marketable) holds.push("not_email_marketable");
  }
  holds.push(...input.reward.holds);

  const member = m?.activeVerified === true;
  const nonmember = m?.nonmemberVerified === true;
  const cancelled = nonmember && input.hadTerminalContract;
  const serviceClear = input.service?.clear === true;
  const reviewOwnerClear = input.service?.reviewOwnerClear === true;
  const prefsKnown = input.preferences?.readOk === true;
  if (member && !prefsKnown) holds.push("preferences_unreadable");
  const sendable = input.consent?.subscribed === true && input.consent.marketable === true && input.consent.internal === false;

  // Program prerequisites beyond the flow's own filters. Every program also
  // needs consent and a non-internal profile.
  const prereq: Record<ReadinessProgram, boolean> = {
    welcome: serviceClear,
    checkout: serviceClear,
    member_start: member && serviceClear,
    member_first_delivery: member && serviceClear,
    shop_purchase: serviceClear,
    shop_delivery: serviceClear && reviewOwnerClear,
    winback: cancelled && serviceClear,
    sunset: false,
    browse: serviceClear,
    cart: serviceClear,
    reserve: nonmember && serviceClear,
    campaign: serviceClear && (member || nonmember),
  };
  const properties: ProfileProps = {
    mully_wave1_member_verified: member,
    mully_wave1_nonmember_verified: nonmember,
    mully_wave1_cancelled_verified: cancelled,
    // No source records cancellation reasons today, so a verified cancel is always "unknown reason".
    mully_wave1_cancel_reason_unknown: cancelled,
    mully_wave1_service_clear: serviceClear,
    mully_wave1_review_owner_clear: reviewOwnerClear,
    mully_wave1_setup_incomplete: member && prefsKnown && input.preferences!.hasTopAndBottomSize === false,
    mully_wave1_reward_verified: input.reward.verified,
    // Only overwrite the code when verified; clear it otherwise so templates never show a spent code.
    mully_reward_code: input.reward.verified ? input.reward.code : null,
    mully_reward_percent: input.reward.verified ? input.reward.percent : null,
  };
  for (const [program, prop] of Object.entries(READINESS_PROGRAMS) as [ReadinessProgram, string][]) {
    properties[prop] = config.enabled && config.programs.has(program) && sendable && prereq[program] &&
      !holds.some((h) => h.startsWith("membership_unreadable") || h === "service_unreadable" || h === "consent_unreadable");
  }
  const uniqueHolds = [...new Set(holds)].sort();
  properties.mully_readiness_checked_at = now.toISOString();
  // Codes only, no PII. Capped so the property stays small.
  properties.mully_readiness_holds = uniqueHolds.slice(0, 12).join(",") || null;
  return { properties, holds: uniqueHolds };
}
