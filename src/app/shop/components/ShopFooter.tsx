import Link from "next/link";
import { MullyWordmark } from "./MullyWordmark";

/**
 * Shop-native footer. Two-column layout with SHOP + SUPPORT link groups,
 * wordmark left, legal at the bottom. Modeled on the V1 storefront footer.
 */
export function ShopFooter({ accent }: { accent: string }) {
  return (
    <footer id="shop-site-footer" className="border-t border-charcoal/10 bg-white">
      <div className="mx-auto max-w-7xl px-6 py-14 md:px-12 md:py-20">
        <div className="grid grid-cols-2 gap-8 md:grid-cols-[2fr_1fr_1fr]">
          {/* Wordmark + tagline */}
          <div className="col-span-2 md:col-span-1">
            <MullyWordmark accent={accent} className="text-2xl" />
            <p className="mt-4 max-w-xs text-sm text-charcoal/60">
              Golf apparel and gear, selected by Mully.
            </p>
          </div>

          {/* Shop links */}
          <div>
            <h4 className="text-[11px] font-mono uppercase tracking-[0.28em] text-charcoal/50">
              Shop
            </h4>
            <ul className="mt-4 space-y-2 text-sm text-charcoal/70">
              <li><Link href="/login?returnTo=%2Fshop" className="hover:text-charcoal">Log in / Account</Link></li>
              <li><Link href="/blog" className="hover:text-charcoal">From the Journal</Link></li>
              <li><Link href="/lp/subscription" className="hover:text-charcoal">Explore Mully Reserve</Link></li>
              <li>
                <Link href="/shop/collection/shop-tops" className="hover:text-charcoal">
                  Tops
                </Link>
              </li>
              <li>
                <Link href="/shop/collection/shop-bottoms" className="hover:text-charcoal">
                  Bottoms
                </Link>
              </li>
              <li>
                <Link href="/shop/collection/shop-outerwear" className="hover:text-charcoal">
                  Outerwear
                </Link>
              </li>
              <li>
                <Link href="/shop/collection/shop-tech" className="hover:text-charcoal">
                  Tech
                </Link>
              </li>
              <li>
                <Link href="/shop/collection/shop-bags" className="hover:text-charcoal">
                  Bags
                </Link>
              </li>
              <li>
                <Link href="/shop/collection/shop-accessories" className="hover:text-charcoal">
                  Accessories
                </Link>
              </li>
            </ul>
          </div>

          {/* Support links */}
          <div>
            <h4 className="text-[11px] font-mono uppercase tracking-[0.28em] text-charcoal/50">
              Support
            </h4>
            <ul className="mt-4 space-y-2 text-sm text-charcoal/70">
              <li>
                <Link href="/returns" className="hover:text-charcoal">
                  Shipping and returns
                </Link>
              </li>
              <li>
                <Link href="/faq" className="hover:text-charcoal">
                  FAQ
                </Link>
              </li>
              <li>
                <Link href="/policies/terms" className="hover:text-charcoal">
                  Terms
                </Link>
              </li>
              <li>
                <Link href="/policies/privacy" className="hover:text-charcoal">
                  Privacy
                </Link>
              </li>
            </ul>
          </div>
        </div>

        {/* Bottom rule */}
        <div className="mt-14 flex flex-col items-center justify-between gap-3 border-t border-charcoal/10 pt-6 md:flex-row">
          <p className="text-[10px] font-mono uppercase tracking-[0.24em] text-charcoal/40">
            &copy; {new Date().getFullYear()} Mully Group
          </p>
          <p className="text-[10px] font-mono uppercase tracking-[0.24em] text-charcoal/40">
            Built in Detroit
          </p>
        </div>
      </div>
    </footer>
  );
}
