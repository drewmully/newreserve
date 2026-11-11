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
it("keeps the best live game code and lets it replace popup codes in the bag", () => {
  const later = new Date(Date.now() + 14 * 86_400_000).toISOString();
  saveShopReward(SHOP_REWARDS.sms);
  saveShopReward({ code: "SHOT20-ABC234", percent: 20, expiresAt: later });
  expect(readShopReward()).toEqual({ code: "SHOT20-ABC234", percent: 20, expiresAt: later });
  saveShopReward({ code: "SHOT15-XYZ789", percent: 15, expiresAt: later });
  expect(readShopReward()?.code).toBe("SHOT20-ABC234");
  expect(rewardCodes(["BOGO15", "MULLYTEXT15", "SHOT15-XYZ789"], readShopReward())).toEqual(["BOGO15", "SHOT20-ABC234"]);
});
it("ignores expired or malformed game codes", () => {
  saveShopReward({ code: "SHOT20-ABC234", percent: 20, expiresAt: new Date(Date.now() - 1000).toISOString() });
  saveShopReward({ code: "SHOT20-ABC234", percent: 20 });
  expect(readShopReward()).toBeNull();
  localStorage.setItem("mully_shop_reward_game_v1", JSON.stringify({ code: "SHOT20-ABC234", percent: 20, expiresAt: "2000-01-01T00:00:00Z" }));
  saveShopReward(SHOP_REWARDS.email);
  expect(readShopReward()?.code).toBe("MULLYEDIT10");
  expect(localStorage.getItem("mully_shop_reward_game_v1")).toBeNull();
});
