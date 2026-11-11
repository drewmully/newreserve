/**
 * Server-side loader for the "Complete the look" test. Fetches the live
 * Storefront products for the pairing config and the gift guide fallback
 * lists, so every name, price, image and stock flag is current.
 */

import { getProductByHandle } from "./shopify";
import { shopProductPhoto } from "./shopProductPhotos";
import { GIFT_GUIDE_TIERS } from "./giftGuide";
import {
  COMPLETE_LOOK_FALLBACK_TIERS,
  COMPLETE_LOOK_PAIRINGS,
  toLookItem,
  type LookItem,
} from "./pdpCompleteLook";

export interface CompleteLookData {
  /** Pairing items in config order; null where Shopify has no product. */
  pairing: Array<LookItem | null>;
  fallbacks: LookItem[];
}

/** Gift guide fallback handles in list order, without vests or duplicates. */
export function completeLookFallbackHandles(): string[] {
  const handles: string[] = [];
  for (const slug of COMPLETE_LOOK_FALLBACK_TIERS) {
    const tier = GIFT_GUIDE_TIERS.find((t) => t.slug === slug);
    for (const h of tier?.picks ?? []) {
      if (/-vest\b/.test(h) || isCompleteLookVest(h) || handles.includes(h)) continue;
      handles.push(h);
    }
  }
  return handles;
}

function isCompleteLookVest(handle: string): boolean {
  return Object.prototype.hasOwnProperty.call(COMPLETE_LOOK_PAIRINGS, handle);
}

const itemCache = new Map<string, { at: number; item: Promise<LookItem | null> }>();
const TTL_MS = 60_000;

export function loadLookItem(handle: string): Promise<LookItem | null> {
  const hit = itemCache.get(handle);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.item;
  const item = getProductByHandle(handle)
    .then((p) => (p ? toLookItem(p, shopProductPhoto(p)) : null))
    .catch((err) => {
      console.error(`[complete-look] product fetch failed: ${handle}`, err);
      itemCache.delete(handle);
      return null;
    });
  itemCache.set(handle, { at: Date.now(), item });
  return item;
}

export async function loadCompleteLook(vestHandle: string): Promise<CompleteLookData | null> {
  const pairingHandles = COMPLETE_LOOK_PAIRINGS[vestHandle];
  if (!pairingHandles) return null;
  const fallbackHandles = completeLookFallbackHandles().filter((h) => !pairingHandles.includes(h));
  const [pairing, fallbacks] = await Promise.all([
    Promise.all(pairingHandles.map(loadLookItem)),
    Promise.all(fallbackHandles.map(loadLookItem)),
  ]);
  return { pairing, fallbacks: fallbacks.filter((i): i is LookItem => i !== null) };
}
