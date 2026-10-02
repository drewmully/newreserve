import { cartDiscountCodesUpdate, type ShopifyCart } from "@/lib/shopify";

export const SHOP_REWARD_STORAGE = "mully_shop_reward_v1";
const REWARD_CODE = /^MULLY-[A-F0-9]{24}$/;
let memoryCode: string | null = null;

export function readShopRewardCode(): string | null {
  try {
    const code = localStorage.getItem(SHOP_REWARD_STORAGE);
    if (code && REWARD_CODE.test(code)) return code;
  } catch { /* The code still works for this page when storage is unavailable. */ }
  return memoryCode;
}

export function saveShopRewardCode(code: string, percent?: 10 | 15) {
  if (!REWARD_CODE.test(code)) return;
  memoryCode = code;
  try { localStorage.setItem(SHOP_REWARD_STORAGE, code); } catch { /* private mode */ }
  window.dispatchEvent(new CustomEvent("mully:shop-reward", { detail: { code, percent } }));
}

/**
 * Submit both candidates, NOT a locally estimated winner. Shopify evaluates
 * their actual eligible dollar savings and enforces combinesWith=false.
 * Keeping both candidates also lets Shopify re-evaluate after quantity changes.
 */
export async function applyShopRewards(cart: ShopifyCart, requestedCode?: string): Promise<ShopifyCart> {
  const reward = readShopRewardCode();
  const existing = (cart.discountCodes ?? []).map(item => item.code);
  if (!reward && !requestedCode) return cart;
  const codes = Array.from(new Set([
    ...existing.filter(code => !reward || !REWARD_CODE.test(code) || code === reward),
    ...(requestedCode ? [requestedCode] : []),
    ...(reward ? ["BOGO15", reward] : []),
  ]));
  return cartDiscountCodesUpdate(cart.id, codes);
}
