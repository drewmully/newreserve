export type MemberTier = "free" | "access" | "member" | "black";

export type BenefitKey =
  | "v1_virtual_coaching"
  | "concierge_support"
  | "pro_shop_15_off"
  | "free_2_day_shipping"
  | "far_sure_golf_tours_credit"
  | "priority_drop_access";

export type ActionableBenefitKey =
  | "v1_virtual_coaching"
  | "concierge_support"
  | "far_sure_golf_tours_credit";

export type BenefitCatalogCategory = "Coaching" | "Travel" | "Other";

export type BenefitCatalogAction = "toggle" | "request" | "auto";

export interface BenefitCatalogEntry {
  key: BenefitKey;
  title: string;
  subtitle: string;
  description: string;
  category: BenefitCatalogCategory;
  action: BenefitCatalogAction;
}

export const PAID_MEMBER_TIERS: readonly MemberTier[] = ["access", "member", "black"];

export const ACTIONABLE_BENEFIT_KEYS: readonly ActionableBenefitKey[] = [
  "v1_virtual_coaching",
  "concierge_support",
  "far_sure_golf_tours_credit",
];

export const BENEFIT_CATALOG: readonly BenefitCatalogEntry[] = [
  {
    key: "v1_virtual_coaching",
    title: "V1+ Virtual Coaching",
    subtitle: "Normally $59.95 - Free with membership",
    description:
      "Connect with a virtual golf coach through V1+. Get swing analysis, personalized drills, and video feedback from PGA-certified instructors.",
    category: "Coaching",
    action: "toggle",
  },
  {
    key: "concierge_support",
    title: "Concierge Support",
    subtitle: "Your personal Reserve concierge",
    description:
      "Need help with anything? Submit a request and our team will assist - from tee time bookings and travel planning to gifting and product sourcing.",
    category: "Other",
    action: "request",
  },
  {
    key: "pro_shop_15_off",
    title: "15% Off Pro Shop",
    subtitle: "Applied automatically at checkout",
    description:
      "Save 15% on every Pro Shop order. Active for Reserve Access, Reserve Member, and Legacy members.",
    category: "Other",
    action: "auto",
  },
  {
    key: "free_2_day_shipping",
    title: "Free 2-Day Shipping",
    subtitle: "No minimums, no codes needed",
    description:
      "Complimentary 2-day shipping on every Pro Shop order. Applied automatically at checkout for all paid members.",
    category: "Travel",
    action: "auto",
  },
  {
    key: "far_sure_golf_tours_credit",
    title: "Far & Sure Golf Tours Credit",
    subtitle: "$200 travel credit per golfer",
    description:
      "Use your Mully Reserve benefit toward eligible Far & Sure golf trips. Perfect for buddy trips, destination golf, and premium travel experiences.",
    category: "Travel",
    action: "request",
  },
  {
    key: "priority_drop_access",
    title: "Priority Drop Access",
    subtitle: "48-hour early access to limited releases",
    description:
      "Get first access to limited drops before they go live to free members. Never miss a release again.",
    category: "Other",
    action: "auto",
  },
];

export function isActionableBenefitKey(value: unknown): value is ActionableBenefitKey {
  return ACTIONABLE_BENEFIT_KEYS.includes(value as ActionableBenefitKey);
}
