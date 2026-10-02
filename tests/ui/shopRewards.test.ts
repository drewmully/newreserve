import { beforeEach, expect, it } from "vitest";
import { readShopReward, saveShopReward, rewardCodes, SHOP_REWARDS } from "@/lib/shopRewards";
beforeEach(() => localStorage.clear());
it("preserves the phone upgrade without storing contact details", () => {
  saveShopReward(SHOP_REWARDS.email);
  expect(readShopReward()?.percent).toBe(10);
  saveShopReward(SHOP_REWARDS.sms);
  saveShopReward(SHOP_REWARDS.email);
  expect(readShopReward()?.percent).toBe(15);
  expect(localStorage.getItem("mully_shop_reward_v1")).toBe("MULLYTEXT15");
});
it("replaces the email offer and preserves unrelated checkout codes", () => {
  expect(rewardCodes(["BOGO15", "mullyedit10"], SHOP_REWARDS.sms)).toEqual(["BOGO15", "MULLYTEXT15"]);
});
