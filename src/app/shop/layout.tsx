import type { ReactNode } from "react";
import "./shop-pages.css";
import "./components/color-swatches.css";

/**
 * Shop-scoped layout. The only job here is to clamp horizontal overflow so
 * long content (product titles, editorial bodies, tables) can't push the
 * viewport wider than the screen on mobile.
 *
 * The signup popup (ShopSignupPopup or Take a Shot) is mounted once in the
 * root layout by TakeAShotGate.
 */
export default function ShopLayout({ children }: { children: ReactNode }) {
  return <div className="overflow-x-hidden">{children}</div>;
}
