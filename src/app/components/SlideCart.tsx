"use client";

import { useEffect, useMemo, useState } from "react";
import { useMembership } from "../context/MembershipContext";
import { trackEvent } from "@/lib/tracking";
import { MEMBER_DISCOUNT_RATE } from "@/lib/shopify";

export function SlideCart() {
  const {
    cart,
    cartOpen,
    setCartOpen,
    removeFromCart,
    updateCartItem,
    cartTotal,
    cartCheckoutUrl,
    cartLoading,
    tier,
    user,
  } = useMembership();
  const isPaid = tier !== "free";

  const [checkoutHref, setCheckoutHref] = useState<string | null>(null);

  useEffect(() => {
    if (!cartCheckoutUrl) {
      setCheckoutHref(null);
      return;
    }

    let cancelled = false;

    const buildCheckoutUrl = async () => {
      let baseUrl = cartCheckoutUrl;
      try {
        const url = new URL(baseUrl);
        url.searchParams.set("return_url", window.location.href);
        baseUrl = url.toString();
      } catch {
        const sep = baseUrl.includes("?") ? "&" : "?";
        baseUrl = `${baseUrl}${sep}return_url=${encodeURIComponent(window.location.href)}`;
      }

      if (!user) {
        if (!cancelled) setCheckoutHref(baseUrl);
        return;
      }

      try {
        const token = await user.getIdToken();
        const cartItems = cart
          .filter((item) => item.variantId)
          .map((item) => ({
            variantId: item.variantId!,
            quantity: item.quantity,
            retailPrice: item.retailPrice ?? item.price,
          }));

        console.log("[SlideCart] checkout cartItems:", cartItems);

        const res = await fetch("/api/shopify/checkout", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ checkoutUrl: baseUrl, cartItems }),
        });
        if (res.ok) {
          const data = await res.json() as { checkoutUrl: string; error?: string };
          console.log("[SlideCart] checkout response:", data);
          if (!cancelled) setCheckoutHref(data.checkoutUrl);
          return;
        }
        console.error("[SlideCart] checkout API error:", res.status, await res.text());
      } catch {
        // Fall through to plain URL
      }

      if (!cancelled) setCheckoutHref(baseUrl);
    };

    void buildCheckoutUrl();
    return () => { cancelled = true; };
  }, [cartCheckoutUrl, user]);

  useEffect(() => {
    if (!cartOpen) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setCartOpen(false);
    };
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", handleKey);
    return () => {
      document.body.style.overflow = "";
      window.removeEventListener("keydown", handleKey);
    };
  }, [cartOpen, setCartOpen]);

  if (!cartOpen) return null;

  return (
    <div className="fixed inset-0 z-[90]">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-obsidian/50 backdrop-blur-sm animate-modal-backdrop"
        onClick={() => setCartOpen(false)}
      />

      {/* Slide panel */}
      <div className="absolute top-0 right-0 bottom-0 w-full max-w-md flex flex-col animate-slide-in-right glass-modal">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-5 border-b border-taupe/20">
          <h2 className="font-serif text-xl text-obsidian">Your Cart</h2>
          <button
            onClick={() => setCartOpen(false)}
            className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-taupe/15 transition-colors duration-200 cursor-pointer"
          >
            <svg
              className="w-5 h-5 text-charcoal/60"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>

        {/* Launch banner */}
        <div className="px-6 py-3 bg-forest/5 border-b border-forest/10">
          <div className="flex items-center gap-2">
            <svg
              className="w-4 h-4 text-forest shrink-0"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={1.5}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 00-2.455 2.456z"
              />
            </svg>
            <p className="text-xs text-forest font-medium">
              Launch party! Free priority shipping on all orders.
            </p>
          </div>
        </div>

        {/* Items */}
        <div className="flex-1 overflow-y-auto px-6 py-4 relative">
          {/* Loading overlay */}
          {cartLoading && (
            <div className="absolute inset-0 bg-bone/60 backdrop-blur-[2px] z-10 flex items-center justify-center">
              <div className="w-5 h-5 border-2 border-forest/30 border-t-forest rounded-full animate-spin" />
            </div>
          )}

          {cart.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-center">
              <svg
                className="w-12 h-12 text-taupe/30 mb-4"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={1}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M15.75 10.5V6a3.75 3.75 0 10-7.5 0v4.5m11.356-1.993l1.263 12c.07.665-.45 1.243-1.119 1.243H4.25a1.125 1.125 0 01-1.12-1.243l1.264-12A1.125 1.125 0 015.513 7.5h12.974c.576 0 1.059.435 1.119 1.007zM8.625 10.5a.375.375 0 11-.75 0 .375.375 0 01.75 0zm7.5 0a.375.375 0 11-.75 0 .375.375 0 01.75 0z"
                />
              </svg>
              <p className="text-sm text-charcoal/40 mb-1">
                Your cart is empty
              </p>
              <p className="text-xs text-charcoal/30">
                Add items from the shop to get started.
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {cart.map((item) => (
                <div
                  key={item.lineId ?? item.slug}
                  className="flex items-start gap-4 bg-cream rounded-xl p-4 border border-taupe/15"
                >
                  {/* Product image */}
                  <div className="w-16 h-20 bg-bone rounded-lg overflow-hidden shrink-0 border border-taupe/15">
                    {item.image ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={item.image}
                        alt={item.name}
                        className="w-full h-full object-cover"
                        draggable={false}
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
                        <svg
                          className="w-6 h-6 text-taupe/25"
                          fill="none"
                          viewBox="0 0 24 24"
                          stroke="currentColor"
                          strokeWidth={1}
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            d="M15.75 10.5V6a3.75 3.75 0 10-7.5 0v4.5m11.356-1.993l1.263 12c.07.665-.45 1.243-1.119 1.243H4.25a1.125 1.125 0 01-1.12-1.243l1.264-12A1.125 1.125 0 015.513 7.5h12.974c.576 0 1.059.435 1.119 1.007z"
                          />
                        </svg>
                      </div>
                    )}
                  </div>

                  <div className="flex-1 min-w-0">
                    <p className="text-[10px] text-charcoal/40 tracking-wide uppercase mb-0.5">
                      {item.brand}
                    </p>
                    <p className="text-sm font-medium text-obsidian leading-snug mb-1">
                      {item.name}
                    </p>
                    <div className="flex items-center gap-1.5">
                      {isPaid && item.retailPrice ? (
                        <>
                          <span className="text-xs text-charcoal/40 line-through">
                            ${item.retailPrice.toFixed(2)}
                          </span>
                          <p className="text-sm text-forest font-medium">
                            ${(item.retailPrice * (1 - MEMBER_DISCOUNT_RATE)).toFixed(2)}
                          </p>
                          <span className="text-[9px] tracking-wide uppercase text-forest bg-forest/10 px-1 py-0.5 rounded font-medium">
                            Member
                          </span>
                        </>
                      ) : (
                        <p className="text-sm text-forest font-medium">
                          ${item.price.toFixed(2)}
                        </p>
                      )}
                    </div>

                    {/* Quantity controls */}
                    <div className="flex items-center gap-2 mt-2">
                      <button
                        onClick={() =>
                          item.lineId
                            ? void updateCartItem(
                                item.lineId,
                                item.quantity - 1
                              )
                            : void removeFromCart(item.slug)
                        }
                        className="w-6 h-6 rounded-full border border-taupe/30 flex items-center justify-center text-charcoal/50 hover:border-forest hover:text-forest transition-colors duration-200 cursor-pointer text-xs leading-none"
                        aria-label="Decrease quantity"
                      >
                        −
                      </button>
                      <span className="text-xs text-charcoal/60 w-4 text-center">
                        {item.quantity}
                      </span>
                      <button
                        onClick={() =>
                          item.lineId
                            ? void updateCartItem(
                                item.lineId,
                                item.quantity + 1
                              )
                            : undefined
                        }
                        className="w-6 h-6 rounded-full border border-taupe/30 flex items-center justify-center text-charcoal/50 hover:border-forest hover:text-forest transition-colors duration-200 cursor-pointer text-xs leading-none"
                        aria-label="Increase quantity"
                      >
                        +
                      </button>
                    </div>
                  </div>

                  {/* Remove */}
                  <button
                    onClick={() => void removeFromCart(item.slug)}
                    className="text-charcoal/30 hover:text-charcoal/60 transition-colors duration-200 cursor-pointer shrink-0 mt-0.5"
                    aria-label="Remove item"
                  >
                    <svg
                      className="w-4 h-4"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={1.5}
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M6 18L18 6M6 6l12 12"
                      />
                    </svg>
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer — totals & checkout */}
        {cart.length > 0 && (
          <div className="border-t border-taupe/20 px-6 py-5 space-y-4">
            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="text-charcoal/50">Subtotal</span>
                <span className="text-obsidian font-medium">
                  ${cartTotal.toFixed(2)}
                </span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-charcoal/50">Shipping</span>
                <span className="text-forest font-medium">Free</span>
              </div>
              {isPaid ? (
                (() => {
                  const savings = cart.reduce((sum, item) => {
                    const retail = item.retailPrice ?? item.price;
                    return sum + retail * MEMBER_DISCOUNT_RATE * item.quantity;
                  }, 0);
                  return savings > 0 ? (
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-forest/80">Member savings</span>
                      <span className="text-forest font-medium">-${savings.toFixed(2)}</span>
                    </div>
                  ) : null;
                })()
              ) : (
                <div className="flex items-center justify-between text-sm">
                  <span className="text-charcoal/50">Reserve savings</span>
                  <span className="text-charcoal/30 text-xs">
                    Upgrade to unlock
                  </span>
                </div>
              )}
            </div>

            {checkoutHref ? (
              <a
                href={checkoutHref}
                onClick={() => {
                  void trackEvent("checkout_clicked", {
                    properties: {
                      cart_total: cartTotal,
                      cart_items: cart.length,
                      currency: "USD",
                    },
                  });
                }}
                className="w-full h-12 rounded-xl bg-forest text-bone text-sm font-medium tracking-wider uppercase hover:bg-forest-dark transition-colors duration-300 cursor-pointer btn-press flex items-center justify-center"
              >
                Go to Checkout
              </a>
            ) : (
              <button
                disabled
                className="w-full h-12 rounded-xl bg-forest/50 text-bone text-sm font-medium tracking-wider uppercase cursor-not-allowed flex items-center justify-center"
              >
                Go to Checkout
              </button>
            )}

            <button
              onClick={() => setCartOpen(false)}
              className="w-full text-center text-xs text-charcoal/40 hover:text-charcoal/60 transition-colors duration-300 cursor-pointer"
            >
              Continue Shopping
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
