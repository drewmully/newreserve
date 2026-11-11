/**
 * Email funnel dashboard (/admin/email-funnel) source configuration.
 *
 * Only identifiers live here. Every number the dashboard shows is read live
 * from Klaviyo, PostHog or Shopify by ./sources.ts and computed by
 * ./compute.ts. Which sources each welcome flow accepts is parsed from the
 * flow trigger filters at request time, never listed here.
 */

export const FUNNEL_WINDOWS = [7, 30, 90] as const;
export type FunnelWindow = (typeof FUNNEL_WINDOWS)[number];

export function parseWindow(raw: string | null | undefined): FunnelWindow {
  const n = Number(raw);
  return (FUNNEL_WINDOWS as readonly number[]).includes(n) ? (n as FunnelWindow) : 30;
}

export const KLAVIYO_METRICS = {
  siteSignup: "YaHVGC", // Mully Site Signup
  receivedEmail: "TuRWJz",
  openedEmail: "X5HHKx",
  clickedEmail: "R5r2Bt",
  placedOrder: "TqCdVY", // Placed Order [Shopify]
  subscriptionStarted: "VxP6Ut", // Loop Subscription Started
} as const;

/** Internal & test exclusion segment ("Mully | Lifecycle | Internal & Test Exclusions"). */
export const EXCLUSION_SEGMENT_ID = "SXGW5m";

/** Placed Order "Source Name" for Loop renewals; excluded the same way the flows do. */
export const RENEWAL_SOURCE_NAME = "subscription_contract_checkout_one";

/** Placed Order item names that mean a Reserve membership (from the F3B/F4A trigger filters). */
export const RESERVE_ITEM_NAMES = [
  "Mully Reserve | Seasonal Styling Subscription",
  "Mully Reserve | The Seasonal Edit",
  "Reserve Member – Quarterly Golf Curation | Mullybox",
];

export interface FlowRef {
  id: string;
  label: string;
  stage: "Nourish" | "Convert" | "Lifecycle";
  welcome: boolean;
}

/** Flows on the dashboard. Names, status and triggers come from Klaviyo. */
export const FLOWS: FlowRef[] = [
  { id: "ShW6Z4", label: "F1", stage: "Nourish", welcome: true },
  { id: "Yi5Z7a", label: "F1b", stage: "Nourish", welcome: true },
  { id: "Uw8b3k", label: "F1c", stage: "Nourish", welcome: true },
  { id: "TZymKc", label: "F1d", stage: "Nourish", welcome: true },
  { id: "Secuhs", label: "F1g", stage: "Nourish", welcome: true },
  { id: "RZEXYF", label: "F3A", stage: "Lifecycle", welcome: false },
  { id: "RdpqFg", label: "F3B", stage: "Lifecycle", welcome: false },
  { id: "YkuGwj", label: "F4A", stage: "Lifecycle", welcome: false },
  { id: "WnNij4", label: "F4B", stage: "Lifecycle", welcome: false },
  { id: "RF9WB7", label: "F5", stage: "Lifecycle", welcome: false },
  { id: "RvZVWi", label: "F10", stage: "Lifecycle", welcome: false },
];

export const WELCOME_FLOW_IDS = FLOWS.filter((f) => f.welcome).map((f) => f.id);

/** PostHog hosts that count as mymully.com traffic (preview deployments are excluded). */
export const SITE_HOSTS = ["www.mymully.com", "mymully.com"];

/** PostHog event for a site visit (the app sends page_view, not $pageview). */
export const VISIT_EVENT = "page_view";

/** Generic popup view events (popup_view etc. arrive with the popup tracking PR). */
export const POPUP_VIEW_EVENT = "popup_view";

/**
 * Take a Shot popup steps, in order. Phone is optional in the modal
 * (players can skip it), so it is a side branch, not a drop-off step.
 */
export const POPUP_STEPS: ReadonlyArray<{ event: string; label: string; optional?: boolean }> = [
  { event: "take_a_shot_open", label: "Opened" },
  { event: "take_a_shot_start", label: "Started" },
  { event: "take_a_shot_email", label: "Email" },
  { event: "take_a_shot_phone", label: "Added phone", optional: true },
  { event: "take_a_shot_shot", label: "Shot" },
  { event: "take_a_shot_claim", label: "Claimed" },
];

/** Take a Shot discount codes look like SHOT20-7KQ2MX (lib/takeAShot/codes). */
export const SHOT_CODE_PREFIX = "SHOT";

export function isTestEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  const e = email.trim().toLowerCase();
  return e.endsWith("@mullybox.com") || e.startsWith("leo+") || e.includes("+synctest");
}
