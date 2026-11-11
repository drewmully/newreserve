"use client";

import { useSyncExternalStore } from "react";
import { restockWeeks } from "../components/EstShipDate";
import { giftRestockCutoff, giftRestockCutoffShort } from "@/lib/giftGuideDates";

const noopSubscribe = () => () => {};

/**
 * Christmas note for a restocking card, computed on the shopper's clock so a
 * cached page never shows a stale answer. Before the restock cutoff (order-by
 * date minus the restock lead time) it gives the date to order by; after it,
 * it warns the piece may not arrive by Christmas. The server render uses the
 * render time (pages revalidate hourly), so no-JS readers and crawlers get the
 * right answer too.
 */
export function RestockChristmasNote({ weeks }: { weeks?: number }) {
  const now = useSyncExternalStore(noopSubscribe, () => Date.now(), () => Date.now());
  const w = restockWeeks(weeks);
  const inTime = now > 0 && now <= giftRestockCutoff(w);
  return (
    <p className="gg-pick__meta gg-pick__meta--warn">
      {inTime ? `Order by ${giftRestockCutoffShort(w)} for Christmas.` : "May not arrive by Christmas."}
    </p>
  );
}
