import { beforeEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({
  lead: {} as Record<string, unknown>,
  gql: vi.fn(),
}));
vi.mock("@/lib/firebase-admin", () => ({
  adminDb: {
    collection: () => ({doc: () => ({})}),
    runTransaction: async (fn: (tx: unknown) => Promise<unknown>) => fn({
      get: async () => ({data: () => state.lead}),
      update: (_: unknown, value: object) => Object.assign(state.lead, value),
    }),
  },
}));
vi.mock("@/app/api/_lib/shopifyAdmin", () => ({shopifyGraphQL: state.gql}));
import { issueSignupReward } from "@/lib/shopSignupReward";
const found = (percent = .1, used = 0) => ({
  codeDiscountNodeByCode: {id:"gid://shopify/DiscountCodeNode/123",
    codeDiscount:{asyncUsageCount:used,usageLimit:1,customerGets:{value:{percentage:percent}}}},
});
beforeEach(() => {state.lead={};state.gql.mockReset();});
describe("one-use signup reward", () => {
  it("creates 10% on all one-time merchandise with one global redemption and no combinations", async () => {
    state.gql.mockResolvedValueOnce({codeDiscountNodeByCode:null}).mockResolvedValueOnce({discountCodeBasicCreate:{codeDiscountNode:{id:"123"},userErrors:[]}});
    const r=await issueSignupReward("lead");
    expect(r).toMatchObject({percent:10,redeemed:false});
    expect(r.code).toMatch(/^MULLY-[A-F0-9]{24}$/);
    expect(state.gql.mock.calls[1][1].input).toMatchObject({
      code:r.code,usageLimit:1,appliesOncePerCustomer:true,context:{all:"ALL"},
      customerGets:{value:{percentage:.1},items:{all:true},appliesOnOneTimePurchase:true,appliesOnSubscription:false},
      combinesWith:{productDiscounts:false,orderDiscounts:false,shippingDiscounts:false},
    });
    expect(state.lead.rewardLeaseUntil).toBe(0);
  });
  it("upgrades the same code to 15% without resetting its usage limit", async () => {
    state.lead={rewardCode:"MULLY-"+"A".repeat(24),smsConsent:{granted:true}};
    state.gql.mockResolvedValueOnce(found()).mockResolvedValueOnce({discountCodeBasicUpdate:{codeDiscountNode:{id:"123"},userErrors:[]}});
    expect(await issueSignupReward("lead")).toEqual({code:state.lead.rewardCode,percent:15,redeemed:false});
    const input=state.gql.mock.calls[1][1].input;
    expect(input.customerGets.value.percentage).toBe(.15);
    expect(input).not.toHaveProperty("usageLimit");
    expect(input).not.toHaveProperty("code");
  });
  it("reuses an existing upgraded code and never downgrades it", async () => {
    state.lead={rewardCode:"MULLY-"+"A".repeat(24)};
    state.gql.mockResolvedValueOnce(found(.15));
    expect((await issueSignupReward("lead")).percent).toBe(15);
    expect(state.gql).toHaveBeenCalledTimes(1);
  });
  it("does not issue another reward after redemption", async () => {
    state.lead={rewardCode:"MULLY-"+"A".repeat(24),smsConsent:{granted:true}};
    state.gql.mockResolvedValueOnce(found(.1,1));
    expect((await issueSignupReward("lead")).redeemed).toBe(true);
    expect(state.gql).toHaveBeenCalledTimes(1);
  });
  it("recovers the reserved code after a lost Shopify response", async () => {
    state.gql.mockResolvedValueOnce({codeDiscountNodeByCode:null}).mockRejectedValueOnce(new Error("timeout"));
    await expect(issueSignupReward("lead")).rejects.toThrow("timeout");
    const code=state.lead.rewardCode;
    state.gql.mockResolvedValueOnce(found());
    expect((await issueSignupReward("lead")).code).toBe(code);
    expect(state.gql).toHaveBeenCalledTimes(3);
  });
  it("rejects concurrent issuance and surfaces Shopify user errors", async () => {
    state.lead={rewardLeaseUntil:Date.now()+60_000};
    await expect(issueSignupReward("lead")).rejects.toThrow("reward_busy");
    expect(state.gql).not.toHaveBeenCalled();
    state.lead={};
    state.gql.mockResolvedValueOnce({codeDiscountNodeByCode:null}).mockResolvedValueOnce({discountCodeBasicCreate:{codeDiscountNode:null,userErrors:[{message:"permission"}]}});
    await expect(issueSignupReward("lead")).rejects.toThrow("reward_unavailable");
    expect(state.lead.rewardLeaseUntil).toBe(0);
  });
});
