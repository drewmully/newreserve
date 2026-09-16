import type { ReactNode } from "react";

/**
 * Shop-scoped layout. The only job here is to clamp horizontal overflow so
 * long content (product titles, editorial bodies, tables) can't push the
 * viewport wider than the screen on mobile.
 */
export default function ShopLayout({ children }: { children: ReactNode }) {
  return <div className="overflow-x-hidden">{children}</div>;
}
