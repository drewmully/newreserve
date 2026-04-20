export type MemberTier = "free" | "access" | "member" | "black";
export type PaidMemberTier = "access" | "member";

interface MembershipPlanDefinition {
  tier: PaidMemberTier;
  label: string;
  price: string;
  variantId: number;
  sellingPlanId: number;
  merchandiseId: string;
  sellingPlanGid: string;
}

const DEFAULT_IDS = {
  access: {
    variantId: 47601025482944,
    sellingPlanId: 3241443520,
  },
  member: {
    variantId: 47601025122496,
    sellingPlanId: 3241476288,
  },
} as const;

const DEFAULT_MEMBER_LEGACY_VARIANT_IDS = [47601025679552];

function parsePositiveInteger(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) return fallback;
  return parsed;
}

function parsePositiveIntegerList(raw: string | undefined, fallback: number[]): number[] {
  if (!raw) return fallback;
  const values = raw
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
    .map((value) => Number(value))
    .filter((value) => Number.isSafeInteger(value) && value > 0);
  return values.length ? values : fallback;
}

function normalizePositiveIntegerString(value: unknown): string | null {
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value) || value <= 0) return null;
    return String(value);
  }

  if (typeof value !== "string") return null;

  const trimmed = value.trim();
  if (!trimmed) return null;
  if (/^\d+$/.test(trimmed)) return trimmed;

  const gidMatch = trimmed.match(
    /^gid:\/\/shopify\/(?:ProductVariant|SellingPlan)\/(\d+)$/i
  );
  return gidMatch?.[1] ?? null;
}

export function normalizeShopifyNumericId(value: unknown): number | null {
  const normalized = normalizePositiveIntegerString(value);
  if (!normalized) return null;
  const parsed = Number(normalized);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

export function toShopifyVariantGid(variantId: number | string): string {
  return `gid://shopify/ProductVariant/${String(variantId)}`;
}

export function toShopifySellingPlanGid(sellingPlanId: number | string): string {
  return `gid://shopify/SellingPlan/${String(sellingPlanId)}`;
}

const ACCESS_VARIANT_ID = parsePositiveInteger(
  process.env.NEXT_PUBLIC_SHOPIFY_ACCESS_VARIANT_ID,
  DEFAULT_IDS.access.variantId
);

const MEMBER_VARIANT_ID = parsePositiveInteger(
  process.env.NEXT_PUBLIC_SHOPIFY_MEMBER_VARIANT_ID,
  DEFAULT_IDS.member.variantId
);

const ACCESS_SELLING_PLAN_ID = parsePositiveInteger(
  process.env.NEXT_PUBLIC_SHOPIFY_ACCESS_SELLING_PLAN_ID,
  DEFAULT_IDS.access.sellingPlanId
);

const MEMBER_SELLING_PLAN_ID = parsePositiveInteger(
  process.env.NEXT_PUBLIC_SHOPIFY_MEMBER_SELLING_PLAN_ID,
  DEFAULT_IDS.member.sellingPlanId
);

const MEMBER_LEGACY_VARIANT_IDS = parsePositiveIntegerList(
  process.env.NEXT_PUBLIC_SHOPIFY_MEMBER_LEGACY_VARIANT_IDS,
  DEFAULT_MEMBER_LEGACY_VARIANT_IDS
);

function createPlan(input: {
  tier: PaidMemberTier;
  label: string;
  price: string;
  variantId: number;
  sellingPlanId: number;
}): MembershipPlanDefinition {
  return {
    tier: input.tier,
    label: input.label,
    price: input.price,
    variantId: input.variantId,
    sellingPlanId: input.sellingPlanId,
    merchandiseId: toShopifyVariantGid(input.variantId),
    sellingPlanGid: toShopifySellingPlanGid(input.sellingPlanId),
  };
}

export const SHOPIFY_MEMBERSHIP_PLANS: Record<
  PaidMemberTier,
  MembershipPlanDefinition
> = {
  access: createPlan({
    tier: "access",
    label: "Reserve Access",
    price: "$99/year",
    variantId: ACCESS_VARIANT_ID,
    sellingPlanId: ACCESS_SELLING_PLAN_ID,
  }),
  member: createPlan({
    tier: "member",
    label: "Reserve Member",
    price: "$249/quarter",
    variantId: MEMBER_VARIANT_ID,
    sellingPlanId: MEMBER_SELLING_PLAN_ID,
  }),
};

export const LOOP_CHANGE_PLAN_OPTIONS = [
  {
    label: SHOPIFY_MEMBERSHIP_PLANS.access.label,
    price: SHOPIFY_MEMBERSHIP_PLANS.access.price,
    sellingPlanShopifyId: SHOPIFY_MEMBERSHIP_PLANS.access.sellingPlanId,
  },
  {
    label: SHOPIFY_MEMBERSHIP_PLANS.member.label,
    price: SHOPIFY_MEMBERSHIP_PLANS.member.price,
    sellingPlanShopifyId: SHOPIFY_MEMBERSHIP_PLANS.member.sellingPlanId,
  },
] as const;

const VARIANT_TIER_MAP: Record<string, PaidMemberTier> = {
  [String(SHOPIFY_MEMBERSHIP_PLANS.access.variantId)]: "access",
  [String(SHOPIFY_MEMBERSHIP_PLANS.member.variantId)]: "member",
};

for (const legacyVariantId of MEMBER_LEGACY_VARIANT_IDS) {
  VARIANT_TIER_MAP[String(legacyVariantId)] = "member";
}

const SUPPORTED_SELLING_PLAN_IDS = new Set<string>(
  Object.values(SHOPIFY_MEMBERSHIP_PLANS).map((plan) =>
    String(plan.sellingPlanId)
  )
);

export function resolveMemberTierFromVariantId(
  variantId: unknown
): PaidMemberTier | null {
  const normalized = normalizePositiveIntegerString(variantId);
  if (!normalized) return null;
  return VARIANT_TIER_MAP[normalized] ?? null;
}

export function isSupportedSellingPlanId(value: unknown): boolean {
  const normalized = normalizePositiveIntegerString(value);
  if (!normalized) return false;
  return SUPPORTED_SELLING_PLAN_IDS.has(normalized);
}

// ─── Legacy plan detection ────────────────────────────────────────────────────

const LEGACY_VARIANT_PLAN_MAP: Record<string, string> = {};
for (const legacyVariantId of MEMBER_LEGACY_VARIANT_IDS) {
  LEGACY_VARIANT_PLAN_MAP[String(legacyVariantId)] = "back9";
}

export function resolveLegacyFromVariantId(
  variantId: unknown
): { isLegacy: boolean; legacyPlan: string | null } {
  const normalized = normalizePositiveIntegerString(variantId);
  if (!normalized) return { isLegacy: false, legacyPlan: null };
  const legacyPlan = LEGACY_VARIANT_PLAN_MAP[normalized] ?? null;
  return { isLegacy: legacyPlan !== null, legacyPlan };
}

export function getTierLabel(
  tier: MemberTier,
  isLegacy: boolean,
  legacyPlan: string | null
): string {
  if (isLegacy && legacyPlan === "back9") return "Back 9 (Legacy)";
  const TIER_LABELS: Record<MemberTier, string> = {
    free: "Free",
    access: "Reserve Access",
    member: "Reserve Member",
    black: "Reserve Black",
  };
  return TIER_LABELS[tier];
}
