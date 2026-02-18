"use client";

import { createContext, useContext, useState, useCallback, type ReactNode } from "react";

/* ═══════════════════════════════════════════
   TYPES
   ═══════════════════════════════════════════ */

export type MemberTier = "free" | "access" | "member" | "black";
export type ClubStatus = "none" | "pending" | "approved";

export interface CartItem {
  slug: string;
  name: string;
  brand: string;
  price: number;
  quantity: number;
}

interface MembershipContextValue {
  // Auth
  isSignedIn: boolean;
  signIn: () => void;

  // User
  email: string;
  setEmail: (email: string) => void;

  // Tier
  tier: MemberTier;
  setTier: (tier: MemberTier) => void;
  tierLabel: string;

  // Cart
  cart: CartItem[];
  cartOpen: boolean;
  setCartOpen: (open: boolean) => void;
  addToCart: (item: Omit<CartItem, "quantity">) => void;
  removeFromCart: (slug: string) => void;
  cartCount: number;
  cartTotal: number;

  // Club
  clubStatus: ClubStatus;
  setClubStatus: (status: ClubStatus) => void;
  interestedClubs: string[];
  toggleClubInterest: (clubName: string) => void;
}

/* ═══════════════════════════════════════════
   CONTEXT
   ═══════════════════════════════════════════ */

const MembershipContext = createContext<MembershipContextValue | null>(null);

export function useMembership() {
  const ctx = useContext(MembershipContext);
  if (!ctx) throw new Error("useMembership must be used within MembershipProvider");
  return ctx;
}

/* ═══════════════════════════════════════════
   PROVIDER
   ═══════════════════════════════════════════ */

const TIER_LABELS: Record<MemberTier, string> = {
  free: "Free",
  access: "Reserve Access",
  member: "Reserve Member",
  black: "Reserve Black",
};

export function MembershipProvider({ children }: { children: ReactNode }) {
  const [isSignedIn, setIsSignedIn] = useState(false);
  const [email, setEmail] = useState("");
  const [tier, setTier] = useState<MemberTier>("free");
  const [cart, setCart] = useState<CartItem[]>([]);
  const [cartOpen, setCartOpen] = useState(false);
  const [clubStatus, setClubStatus] = useState<ClubStatus>("none");
  const [interestedClubs, setInterestedClubs] = useState<string[]>([]);

  const signIn = useCallback(() => setIsSignedIn(true), []);

  const addToCart = useCallback((item: Omit<CartItem, "quantity">) => {
    setCart((prev) => {
      const existing = prev.find((c) => c.slug === item.slug);
      if (existing) {
        return prev.map((c) =>
          c.slug === item.slug ? { ...c, quantity: c.quantity + 1 } : c
        );
      }
      return [...prev, { ...item, quantity: 1 }];
    });
    setCartOpen(true);
  }, []);

  const removeFromCart = useCallback((slug: string) => {
    setCart((prev) => prev.filter((c) => c.slug !== slug));
  }, []);

  const cartCount = cart.reduce((sum, c) => sum + c.quantity, 0);
  const cartTotal = cart.reduce((sum, c) => sum + c.price * c.quantity, 0);

  const toggleClubInterest = useCallback((clubName: string) => {
    setInterestedClubs((prev) =>
      prev.includes(clubName)
        ? prev.filter((c) => c !== clubName)
        : [...prev, clubName]
    );
  }, []);

  return (
    <MembershipContext.Provider
      value={{
        isSignedIn,
        signIn,
        email,
        setEmail,
        tier,
        setTier,
        tierLabel: TIER_LABELS[tier],
        cart,
        cartOpen,
        setCartOpen,
        addToCart,
        removeFromCart,
        cartCount,
        cartTotal,
        clubStatus,
        setClubStatus,
        interestedClubs,
        toggleClubInterest,
      }}
    >
      {children}
    </MembershipContext.Provider>
  );
}
