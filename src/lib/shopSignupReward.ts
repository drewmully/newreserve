import { randomBytes } from "node:crypto";
import { adminDb } from "@/lib/firebase-admin";
import { shopifyGraphQL } from "@/app/api/_lib/shopifyAdmin";

export type SignupReward = { code: string; percent: 10 | 15; redeemed: boolean };

const LOOKUP = `query SignupReward($code: String!) {
  codeDiscountNodeByCode(code: $code) {
    id codeDiscount { ... on DiscountCodeBasic {
      asyncUsageCount usageLimit customerGets { value { ... on DiscountPercentage { percentage } } }
    } }
  }
}`;
const CREATE = `mutation CreateSignupReward($input: DiscountCodeBasicInput!) {
  discountCodeBasicCreate(basicCodeDiscount: $input) {
    codeDiscountNode { id } userErrors { field message }
  }
}`;
const UPDATE = `mutation UpgradeSignupReward($id: ID!, $input: DiscountCodeBasicInput!) {
  discountCodeBasicUpdate(id: $id, basicCodeDiscount: $input) {
    codeDiscountNode { id } userErrors { field message }
  }
}`;

/**
 * One entitlement per normalized email. A phone opt-in upgrades that same code,
 * never creates another redemption. Reserve the random code BEFORE calling
 * Shopify, so a lost response can be recovered by code on the next attempt.
 * The short Firestore lease serializes concurrent email/SMS requests.
 */
export async function issueSignupReward(leadId: string): Promise<SignupReward> {
  const ref = adminDb.collection("shop_marketing_leads").doc(leadId);
  const lease = randomBytes(16).toString("hex");
  const reward = await adminDb.runTransaction(async tx => {
    const snap = await tx.get(ref);
    const data = snap.data();
    if (!data) throw new Error("missing_lead");
    if (data.rewardLeaseUntil > Date.now()) throw new Error("reward_busy");
    const code = data.rewardCode || `MULLY-${randomBytes(12).toString("hex").toUpperCase()}`;
    tx.update(ref, { rewardCode: code, rewardLease: lease, rewardLeaseUntil: Date.now() + 60_000 });
    return { code: String(code), percent: data.smsConsent?.granted ? 15 : 10 } as SignupReward;
  });
  try {
    const found = await shopifyGraphQL<{
      codeDiscountNodeByCode: {
        id: string;
        codeDiscount: { asyncUsageCount: number; usageLimit: number; customerGets: { value: { percentage: number } } };
      } | null;
    }>(LOOKUP, { code: reward.code });
    const node = found.codeDiscountNodeByCode;
    const redeemed = Boolean(node && node.codeDiscount.asyncUsageCount >= node.codeDiscount.usageLimit);
    const currentPercent = node ? Math.round(node.codeDiscount.customerGets.value.percentage * 100) : 0;
    // A stale email request may never downgrade an already-upgraded code.
    const percent = Math.max(reward.percent, currentPercent) as 10 | 15;
    if (!redeemed && (!node || currentPercent < percent)) {
      const input = node ? { title: `Mully signup: ${percent}% off`, customerGets: { value: { percentage: percent / 100 } } } : {
        title: `Mully signup: ${percent}% off`,
        code: reward.code,
        startsAt: new Date().toISOString(),
        context: { all: "ALL" },
        customerGets: {
          value: { percentage: percent / 100 },
          items: { all: true },
          appliesOnOneTimePurchase: true,
          appliesOnSubscription: false,
        },
        usageLimit: 1,
        appliesOncePerCustomer: true,
        combinesWith: { productDiscounts: false, orderDiscounts: false, shippingDiscounts: false },
      };
      const result = await shopifyGraphQL<Record<string, {
        codeDiscountNode: { id: string } | null; userErrors: Array<{ message: string }>;
      }>>(node ? UPDATE : CREATE, { input, ...(node ? { id: node.id } : {}) });
      const payload = result[node ? "discountCodeBasicUpdate" : "discountCodeBasicCreate"];
      if (!payload?.codeDiscountNode || payload.userErrors.length) throw new Error("reward_unavailable");
    }
    return { code: reward.code, percent, redeemed };
  } finally {
    await adminDb.runTransaction(async tx => {
      const snap = await tx.get(ref);
      if (snap.data()?.rewardLease === lease) tx.update(ref, { rewardLeaseUntil: 0 });
    });
  }
}
