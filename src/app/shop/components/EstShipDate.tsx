"use client";

import { useSyncExternalStore } from "react";

const noopSubscribe = () => () => {};

/** Weeks until a restocking item ships. Falls back to 2 when the product has no estimate. */
export function restockWeeks(weeks?: number): number {
  return weeks && weeks > 0 ? weeks : 2;
}

/** Today plus the restock estimate, formatted like "Oct 23". */
export function estShipDateLabel(weeks?: number, from: Date = new Date()): string {
  const d = new Date(from);
  d.setDate(d.getDate() + restockWeeks(weeks) * 7);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/**
 * Estimated ship date for restocking items, computed in the shopper's browser so
 * cached pages never show a stale date. Before hydration it shows "in about N weeks".
 */
export function EstShipDate({ weeks }: { weeks?: number }) {
  // false during server render and hydration, true in the browser afterwards.
  const mounted = useSyncExternalStore(noopSubscribe, () => true, () => false);
  return <>{mounted ? estShipDateLabel(weeks) : `in about ${restockWeeks(weeks)} weeks`}</>;
}
