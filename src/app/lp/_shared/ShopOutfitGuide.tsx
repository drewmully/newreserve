"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import {
  OUTFIT_STORAGE_KEY,
  readOutfitGuide,
  type OutfitGuide,
} from "@/lib/shopOutfit";

/** Explicit, removable handoff. It is a style reference, not a reserved inventory hold. */
export function ShopOutfitGuide() {
  const [guide, setGuide] = useState<OutfitGuide | null>(null);
  useEffect(() => {
    // Hydrate browser-only storage after the identical server/client first paint.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setGuide(readOutfitGuide());
  }, []);
  if (!guide) return null;
  return (
    <aside className="mx-auto mb-6 max-w-3xl border border-forest/20 bg-cream p-4 text-left">
      <p className="text-sm font-semibold text-forest">
        Your outfit is coming with you.
      </p>
      <p className="mt-1 text-xs leading-relaxed text-charcoal/70">
        We&apos;ll share these pieces and sizes with your curator as your style
        guide. Complete your profile, then confirm your $250 quarterly Reserve
        shipment at checkout. Exact styles depend on availability.
      </p>
      <ul className="mt-3 space-y-1 text-xs">
        {guide.items.map((item) => (
          <li key={item.variantId}>
            {item.name} · {item.size}
          </li>
        ))}
      </ul>
      <div className="mt-3 flex flex-wrap gap-4 text-xs underline">
        <Link href="/shop#outfit">Back to the shop</Link>
        <button
          type="button"
          onClick={() => {
            sessionStorage.removeItem(OUTFIT_STORAGE_KEY);
            setGuide(null);
          }}
        >
          Remove this style guide
        </button>
      </div>
    </aside>
  );
}
