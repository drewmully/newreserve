export const SHOP_REWARDS = {
  email: { code: "MULLYEDIT10", percent: 10 },
  sms: { code: "MULLYTEXT15", percent: 15 },
} as const;
export type ShopReward = { code: string; percent: number };
const STORAGE = "mully_shop_reward_v1";
export function readShopReward(): ShopReward | null {
  try {
    const code = localStorage.getItem(STORAGE);
    return Object.values(SHOP_REWARDS).find(reward => reward.code === code) ?? null;
  } catch { return null; }
}
export function saveShopReward(reward: ShopReward) {
  const valid = Object.values(SHOP_REWARDS).find(r => r.code === reward.code);
  if (!valid) return;
  const best = (readShopReward()?.percent ?? 0) > valid.percent ? readShopReward()! : valid;
  try { localStorage.setItem(STORAGE, best.code); } catch { /* optional storage */ }
  window.dispatchEvent(new Event("mully:shop-reward"));
}
export function rewardCodes(existing: string[], reward: ShopReward | null): string[] {
  if (!reward) return existing;
  return [...new Set([...existing.filter(code => !Object.values(SHOP_REWARDS).some(r => r.code === code.toUpperCase())), reward.code])];
}
