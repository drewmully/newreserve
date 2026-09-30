import type { ReactNode } from "react";
import { ShopSeasonalHeader } from "./ShopSeasonalHeader";
import { ShopFooter } from "./ShopFooter";
import "../shop-pages.css";

/** Public support/editorial chrome. Deliberately not applied in the root layout:
 * acquisition pages and existing authentication/checkout logic stay independent.
 * Support and sign-in remain accessible without the shop's preview curtain. */
export function ShopPageShell({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div className={`shop-pages ${className}`}>
      <ShopSeasonalHeader accent="#4A3528" />
      {children}
      <ShopFooter accent="#4A3528" />
    </div>
  );
}
