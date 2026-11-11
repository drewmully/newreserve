/**
 * Take a Shot discount codes: one single-use Shopify code per player.
 * Built from CODE_RULES in ./config. Server only.
 */
import { randomInt } from "node:crypto";
import { CODE_RULES, MAX_PERCENT } from "./config";
import { discountGraphQL } from "./discountToken";

const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

/** e.g. SHOT20-7KQ2MX. Matches GAME_CODE_PATTERN in lib/shopRewards. */
export function makeCode(percent: number, rand: (max: number) => number = randomInt): string {
  let suffix = "";
  for (let i = 0; i < 6; i++) suffix += ALPHABET[rand(ALPHABET.length)];
  return `${CODE_RULES.prefix}${percent}-${suffix}`;
}

export function codeExpiry(now: number, days = CODE_RULES.expiryDays): string {
  return new Date(now + days * 86_400_000).toISOString();
}

/** DiscountCodeBasicInput for discountCodeBasicCreate (Admin API 2026-07). */
export function buildDiscountInput(opts: { code: string; percent: number; startsAt: string; endsAt: string }) {
  const percent = Math.min(Math.max(Math.round(opts.percent), 1), MAX_PERCENT);
  const collections = CODE_RULES.eligibleCollectionIds;
  return {
    title: `Take a Shot ${percent}% ${opts.code}`,
    code: opts.code,
    startsAt: opts.startsAt,
    endsAt: opts.endsAt,
    context: { all: "ALL" },
    customerGets: {
      value: { percentage: percent / 100 },
      items: collections.length ? { collections: { add: collections } } : { all: true },
      appliesOnOneTimePurchase: CODE_RULES.appliesOnOneTimePurchase,
      appliesOnSubscription: CODE_RULES.appliesOnSubscription,
    },
    // First Reserve quarter only: renewals bill at the regular quarterly price.
    recurringCycleLimit: CODE_RULES.recurringCycleLimit,
    minimumRequirement: CODE_RULES.minSubtotal
      ? { subtotal: { greaterThanOrEqualToSubtotal: String(CODE_RULES.minSubtotal) } }
      : null,
    usageLimit: 1,
    appliesOncePerCustomer: true,
    combinesWith: { ...CODE_RULES.combinesWith },
    tags: [...CODE_RULES.tags],
  };
}

const CREATE = `mutation TakeAShotCreate($basicCodeDiscount: DiscountCodeBasicInput!) {
  discountCodeBasicCreate(basicCodeDiscount: $basicCodeDiscount) {
    codeDiscountNode { id }
    userErrors { field code message }
  }
}`;
const DELETE = `mutation TakeAShotDelete($id: ID!) {
  discountCodeDelete(id: $id) { deletedCodeDiscountId userErrors { field code message } }
}`;

export type Gql = <T>(query: string, variables?: Record<string, unknown>) => Promise<T>;

/** Uses the first token with write_discounts (see ./discountToken). */
const defaultGql: Gql = (query, variables) => discountGraphQL(query, variables);

/** Error code only; never the Shopify message (it can echo the code). */
export class CodeError extends Error {
  constructor(public readonly reason: string) { super(reason); }
}

export interface ShopifyCodes {
  create(input: { code: string; percent: number; startsAt: string; endsAt: string }): Promise<{ discountId: string }>;
  remove(discountId: string): Promise<void>;
}

export function shopifyCodes(gql: Gql = defaultGql): ShopifyCodes {
  return {
    async create(input) {
      let data: { discountCodeBasicCreate?: { codeDiscountNode?: { id?: string } | null; userErrors?: { code?: string }[] } };
      try {
        data = await gql(CREATE, { basicCodeDiscount: buildDiscountInput(input) });
      } catch (err) {
        const msg = err instanceof Error ? err.message : "";
        // Missing write_discounts shows up as ACCESS_DENIED or a 403.
        throw new CodeError(/access|denied|403|scope/i.test(msg) ? "access_denied" : "shopify_unavailable");
      }
      const result = data.discountCodeBasicCreate;
      const id = result?.codeDiscountNode?.id;
      if (!id) throw new CodeError(result?.userErrors?.[0]?.code?.toLowerCase() || "shopify_rejected");
      return { discountId: id };
    },
    async remove(discountId) {
      const data = await gql<{ discountCodeDelete?: { userErrors?: { code?: string }[] } }>(
        DELETE, { id: discountId });
      const err = data.discountCodeDelete?.userErrors?.[0];
      if (err) throw new CodeError(err.code?.toLowerCase() || "delete_rejected");
    },
  };
}
