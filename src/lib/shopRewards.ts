export const SHOP_REWARDS = {
  email: { code: "MULLYEDIT10", percent: 10 },
  sms: { code: "MULLYTEXT15", percent: 15 },
} as const;
export type ShopReward = { code: string; percent: number; expiresAt?: string };
const STORAGE = "mully_shop_reward_v1";
/** Take a Shot codes are unique per player, so they live in their own key with an expiry. */
const GAME_STORAGE = "mully_shop_reward_game_v1";
/** Single-use Take a Shot codes, e.g. SHOT20-7KQ2MX. */
export const GAME_CODE_PATTERN = /^SHOT\d{1,2}-[A-Z0-9]{6}$/;
export function isGameRewardCode(code: string): boolean {
  return GAME_CODE_PATTERN.test(code.toUpperCase());
}
function readGameReward(): ShopReward | null {
  try {
    const raw = localStorage.getItem(GAME_STORAGE);
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<ShopReward>;
    const expires = value.expiresAt ? Date.parse(value.expiresAt) : NaN;
    if (typeof value.code !== "string" || !isGameRewardCode(value.code) ||
      typeof value.percent !== "number" || !(value.percent > 0 && value.percent <= 100) ||
      !Number.isFinite(expires) || expires <= Date.now()) {
      localStorage.removeItem(GAME_STORAGE);
      return null;
    }
    return { code: value.code, percent: value.percent, expiresAt: value.expiresAt };
  } catch { return null; }
}
function readStaticReward(): ShopReward | null {
  try {
    const code = localStorage.getItem(STORAGE);
    return Object.values(SHOP_REWARDS).find(reward => reward.code === code) ?? null;
  } catch { return null; }
}
/** The best reward saved in this browser: a live game code or a popup code. */
export function readShopReward(): ShopReward | null {
  const game = readGameReward();
  const fixed = readStaticReward();
  if (game && (!fixed || game.percent >= fixed.percent)) return game;
  return fixed;
}
export function saveShopReward(reward: ShopReward) {
  if (isGameRewardCode(reward.code)) {
    const expires = reward.expiresAt ? Date.parse(reward.expiresAt) : NaN;
    if (!Number.isFinite(expires) || expires <= Date.now() || !(reward.percent > 0 && reward.percent <= 100)) return;
    const current = readGameReward();
    if (current && current.percent > reward.percent) return;
    try {
      localStorage.setItem(GAME_STORAGE, JSON.stringify({ code: reward.code.toUpperCase(), percent: reward.percent, expiresAt: reward.expiresAt }));
    } catch { /* optional storage */ }
    window.dispatchEvent(new Event("mully:shop-reward"));
    return;
  }
  const valid = Object.values(SHOP_REWARDS).find(r => r.code === reward.code);
  if (!valid) return;
  const best = (readStaticReward()?.percent ?? 0) > valid.percent ? readStaticReward()! : valid;
  try { localStorage.setItem(STORAGE, best.code); } catch { /* optional storage */ }
  window.dispatchEvent(new Event("mully:shop-reward"));
}
/** Replace any signup or game reward already in the bag with the current one; keep unrelated codes. */
export function rewardCodes(existing: string[], reward: ShopReward | null): string[] {
  if (!reward) return existing;
  const ours = (code: string) => Object.values(SHOP_REWARDS).some(r => r.code === code.toUpperCase()) || isGameRewardCode(code);
  return [...new Set([...existing.filter(code => !ours(code)), reward.code])];
}
