"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import { useMembership } from "../../context/MembershipContext";
import { trackEvent } from "@/lib/tracking";

/**
 * Shop-native cart drawer. Modeled on the V1 Sports storefront cart:
 * white background, uppercase mono labels, minimal chrome. Independent from
 * the site-wide SlideCart used on non-shop routes.
 */
export function ShopSlideCart({ accent }: { accent: string }) {
  const {
    cart,
    cartOpen,
    setCartOpen,
    removeFromCart,
    updateCartItem,
    cartTotal,
    cartCheckoutUrl,
    cartLoading,
  } = useMembership();

  const [checkoutPending, setCheckoutPending] = useState(false);

  useEffect(() => {
    if (cartOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [cartOpen]);

  async function handleCheckout(event: React.MouseEvent<HTMLButtonElement>) {
    event.preventDefault();
    if (!cartCheckoutUrl || checkoutPending) return;
    void trackEvent("checkout_clicked", {
      properties: {
        cart_total: cartTotal,
        cart_items: cart.length,
        currency: "USD",
        source: "shop_cart",
      },
    });
    setCheckoutPending(true);
    window.location.assign(cartCheckoutUrl);
  }

  const itemCount = cart.reduce((sum, item) => sum + item.quantity, 0);

  return (
    <>
      {/* Backdrop */}
      <div
        className={`fixed inset-0 z-50 bg-charcoal/40 backdrop-blur-sm transition-opacity duration-300 ${
          cartOpen ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
        onClick={() => setCartOpen(false)}
        aria-hidden="true"
      />

      {/* Drawer */}
      <aside
        className={`fixed right-0 top-0 z-50 flex h-full w-full flex-col bg-white shadow-2xl transition-transform duration-300 ease-out sm:w-[440px] ${
          cartOpen ? "translate-x-0" : "translate-x-full"
        }`}
        aria-label="Shopping cart"
        aria-hidden={!cartOpen}
      >
        {/* Header */}
        <header className="flex items-center justify-between border-b border-charcoal/10 px-6 py-5">
          <div className="flex items-center gap-2">
            <svg
              className="h-5 w-5 text-charcoal"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={1.5}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M15.75 10.5V6a3.75 3.75 0 10-7.5 0v4.5m11.356-1.993l1.263 12c.07.665-.45 1.243-1.119 1.243H4.25a1.125 1.125 0 01-1.12-1.243l1.264-12A1.125 1.125 0 015.513 7.5h12.974c.576 0 1.059.435 1.119 1.007z"
              />
            </svg>
            <h2 className="text-[12px] font-mono uppercase tracking-[0.28em] text-charcoal">
              Your Cart
            </h2>
            {itemCount > 0 && (
              <span className="text-[11px] font-mono uppercase tracking-[0.2em] text-charcoal/50">
                ({itemCount})
              </span>
            )}
          </div>
          <button
            onClick={() => setCartOpen(false)}
            className="text-charcoal/60 transition-colors hover:text-charcoal"
            aria-label="Close cart"
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </header>

        {/* Body */}
        {cart.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-4 px-8 text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-full border border-charcoal/10 bg-cream">
              <svg
                className="h-7 w-7 text-charcoal/40"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={1.5}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M15.75 10.5V6a3.75 3.75 0 10-7.5 0v4.5m11.356-1.993l1.263 12c.07.665-.45 1.243-1.119 1.243H4.25a1.125 1.125 0 01-1.12-1.243l1.264-12A1.125 1.125 0 015.513 7.5h12.974c.576 0 1.059.435 1.119 1.007z"
                />
              </svg>
            </div>
            <p className="font-serif text-xl text-charcoal">Your cart is empty</p>
            <p className="text-sm text-charcoal/60">Add gear to get started.</p>
            <button
              onClick={() => setCartOpen(false)}
              className="mt-2 text-[11px] font-mono uppercase tracking-[0.24em] text-charcoal underline underline-offset-4 transition-opacity hover:opacity-70"
            >
              Continue shopping
            </button>
          </div>
        ) : (
          <>
            <div className="flex-1 overflow-y-auto px-6 py-5">
              <ul className="divide-y divide-charcoal/10">
                {cart.map((item) => (
                  <li key={item.slug} className="flex gap-4 py-5">
                    <div className="relative h-24 w-20 flex-shrink-0 overflow-hidden bg-cream">
                      {item.image ? (
                        <Image
                          src={item.image}
                          alt={item.name}
                          fill
                          sizes="80px"
                          className="object-cover"
                        />
                      ) : null}
                    </div>
                    <div className="flex flex-1 flex-col justify-between">
                      <div>
                        <div className="text-[10px] font-mono uppercase tracking-[0.24em] text-charcoal/50">
                          {item.brand}
                        </div>
                        <div className="mt-1 text-sm font-medium text-charcoal">
                          {item.name}
                        </div>
                      </div>
                      <div className="mt-2 flex items-center justify-between">
                        <div className="flex items-center border border-charcoal/15">
                          <button
                            onClick={() =>
                              item.lineId &&
                              updateCartItem(item.lineId, Math.max(1, item.quantity - 1))
                            }
                            disabled={cartLoading || item.quantity <= 1}
                            className="h-7 w-7 text-charcoal/70 transition-colors hover:text-charcoal disabled:opacity-30"
                            aria-label="Decrease quantity"
                          >
                            −
                          </button>
                          <span className="w-7 text-center text-xs text-charcoal">
                            {item.quantity}
                          </span>
                          <button
                            onClick={() =>
                              item.lineId && updateCartItem(item.lineId, item.quantity + 1)
                            }
                            disabled={cartLoading}
                            className="h-7 w-7 text-charcoal/70 transition-colors hover:text-charcoal disabled:opacity-30"
                            aria-label="Increase quantity"
                          >
                            +
                          </button>
                        </div>
                        <div className="text-sm font-medium text-charcoal">
                          ${(item.price * item.quantity).toFixed(2)}
                        </div>
                      </div>
                      <button
                        onClick={() => removeFromCart(item.slug)}
                        disabled={cartLoading}
                        className="mt-2 self-start text-[10px] font-mono uppercase tracking-[0.24em] text-charcoal/50 underline underline-offset-4 transition-colors hover:text-charcoal disabled:opacity-30"
                      >
                        Remove
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            </div>

            {/* Footer */}
            <footer className="border-t border-charcoal/10 px-6 py-5">
              <div className="flex items-center justify-between pb-4">
                <span className="text-[11px] font-mono uppercase tracking-[0.24em] text-charcoal/60">
                  Subtotal
                </span>
                <span className="font-serif text-xl text-charcoal">
                  ${cartTotal.toFixed(2)}
                </span>
              </div>
              <button
                onClick={handleCheckout}
                disabled={!cartCheckoutUrl || checkoutPending || cartLoading}
                className="flex w-full items-center justify-center gap-2 py-4 text-[11px] font-mono uppercase tracking-[0.28em] text-white transition-opacity duration-200 hover:opacity-90 disabled:opacity-50"
                style={{ backgroundColor: accent }}
              >
                {checkoutPending ? "Redirecting…" : "Checkout"}
              </button>
              <p className="mt-3 text-center text-[10px] font-mono uppercase tracking-[0.2em] text-charcoal/40">
                Shipping and taxes at checkout
              </p>
            </footer>
          </>
        )}
      </aside>
    </>
  );
}
