import type { ReactNode } from "react";
import "./shop-pages.css";
import "./components/color-swatches.css";
import { TakeAShotGate } from "./components/takeAShot/TakeAShotGate";

/**
 * Shop-scoped layout. The only job here is to clamp horizontal overflow so
 * long content (product titles, editorial bodies, tables) can't push the
 * viewport wider than the screen on mobile.
 *
 * TakeAShotGate renders ShopSignupPopup unchanged unless
 * NEXT_PUBLIC_TAKE_A_SHOT_ENABLED is "true" (or ?tas=1 on a preview).
 */
export default function ShopLayout({ children }: { children: ReactNode }) {
  const enabled = process.env.NEXT_PUBLIC_TAKE_A_SHOT_ENABLED === "true";
  // ?tas=1 can force the game on preview deployments and local dev only.
  const allowOverride = process.env.NODE_ENV === "development" ||
    (Boolean(process.env.VERCEL_ENV) && process.env.VERCEL_ENV !== "production");
  return <div className="overflow-x-hidden">{children}<TakeAShotGate enabled={enabled} allowOverride={allowOverride} /></div>;
}
