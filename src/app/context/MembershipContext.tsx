"use client";

import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  useRef,
  type ReactNode,
} from "react";
import {
  onAuthStateChanged,
  signOut as firebaseSignOut,
  type User as FirebaseUser,
} from "firebase/auth";
import { doc, updateDoc, getDoc, serverTimestamp } from "firebase/firestore";
import { auth, db, syncUserProfile, sendOTPEmail, confirmOTPSignIn } from "@/lib/firebase";
import { trackEvent } from "@/lib/tracking";
import {
  cartCreate,
  cartLinesAdd,
  cartLinesRemove,
  cartLinesUpdate,
  updateCartBuyerIdentity,
  getCart,
  type ShopifyCart,
} from "@/lib/shopify";

/* ═══════════════════════════════════════════
   TIER RESOLUTION FROM LOOP SUBSCRIPTIONS
   ═══════════════════════════════════════════ */

const LOOP_VARIANT_TIER: Record<string, MemberTier> = {
  "47601025482944": "access",  // Reserve Access
  "47601025122496": "member",  // Reserve Member
  "47601025679552": "member",  // Back 9 Legacy
};

function resolveTierFromLoopSubs(
  subs: Array<Record<string, unknown>>
): MemberTier | null {
  const active = subs.filter((s) => s.status === "ACTIVE");
  for (const sub of active) {
    const lines = sub.lines as Array<Record<string, unknown>> | undefined;
    const variantShopifyId = lines?.[0]?.variantShopifyId;
    if (variantShopifyId != null) {
      const tier = LOOP_VARIANT_TIER[String(variantShopifyId)];
      if (tier) return tier;
    }
  }
  return null;
}

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
  /** Shopify variant GID — required for Storefront cart mutations */
  variantId?: string;
  /** Shopify cart line ID — required for update / remove */
  lineId?: string;
  /** Product thumbnail URL */
  image?: string;
}

export interface StoreCreditState {
  balance_cents: number;
  currency: string;
}

export interface SubscriptionsState {
  mullybox_active: boolean;
  status: string;
  total_subscription_count: number;
  active_subscription_ids: string[];
  manage_url: string | null;
  next_unblock_url: string | null;
}

export interface FitProfile {
  shirtSize: string;
  gloveHand: string;
  gloveSize: string;
  waistSize: string;
  pantsInseam: string;
  shortsInseam: string;
  shoeSize: string;
}

export const EMPTY_FIT: FitProfile = {
  shirtSize: "",
  gloveHand: "",
  gloveSize: "",
  waistSize: "",
  pantsInseam: "",
  shortsInseam: "",
  shoeSize: "",
};

interface MembershipContextValue {
  // Auth
  user: FirebaseUser | null;
  isSignedIn: boolean;
  authLoading: boolean;
  sendOTPEmail: (email: string) => Promise<void>;
  confirmOTPSignIn: (email: string, link: string) => Promise<void>;
  signOut: () => Promise<void>;

  // User
  email: string;
  setEmail: (email: string) => void;
  username: string;
  setUsername: (username: string) => void;

  // Tier
  tier: MemberTier;
  setTier: (tier: MemberTier) => void;
  tierLabel: string;

  // Cart
  cart: CartItem[];
  cartId: string | null;
  cartCheckoutUrl: string | null;
  cartLoading: boolean;
  cartOpen: boolean;
  setCartOpen: (open: boolean) => void;
  addToCart: (item: Omit<CartItem, "quantity">) => Promise<void>;
  removeFromCart: (slug: string) => Promise<void>;
  updateCartItem: (lineId: string, quantity: number) => Promise<void>;
  cartCount: number;
  cartTotal: number;

  // Fit profile
  fitProfile: FitProfile;
  setFitProfile: (profile: FitProfile) => void;

  // Club
  clubStatus: ClubStatus;
  setClubStatus: (status: ClubStatus) => void;
  interestedClubs: string[];
  toggleClubInterest: (clubName: string) => void;

  // Store credit & subscriptions
  storeCredit: StoreCreditState | null;
  subscriptions: SubscriptionsState | null;

  // Notifications
  messagingPreferences: { email_marketing: boolean; sms_marketing: boolean };
  saveMessagingPreferences: (prefs: { email_marketing: boolean; sms_marketing: boolean }) => Promise<void>;

  // Onboarding
  onboardingCompleted: boolean;
  completeOnboarding: (data: { username: string }) => Promise<void>;
  saveUsername: (username: string) => Promise<void>;

  // Data refreshers
  refreshStoreCredit: () => Promise<void>;
  refreshSubscriptionStatus: () => Promise<void>;
}

/* ═══════════════════════════════════════════
   CONTEXT
   ═══════════════════════════════════════════ */

const MembershipContext = createContext<MembershipContextValue | null>(null);

export function useMembership() {
  const ctx = useContext(MembershipContext);
  if (!ctx)
    throw new Error("useMembership must be used within MembershipProvider");
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

const cartIdKey = (uid: string) => `mully_cart_id_${uid}`;

export function MembershipProvider({ children }: { children: ReactNode }) {
  // ── Auth ──────────────────────────────────────────────────────────────────
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [authLoading, setAuthLoading] = useState(true);

  // ── User display ──────────────────────────────────────────────────────────
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");

  // ── Membership tier ───────────────────────────────────────────────────────
  const [tier, setTier] = useState<MemberTier>("free");

  // ── Onboarding ────────────────────────────────────────────────────────────
  const [onboardingCompleted, setOnboardingCompleted] = useState(false);

  // ── Messaging preferences ─────────────────────────────────────────────────
  const [messagingPreferences, setMessagingPreferences] = useState({ email_marketing: true, sms_marketing: false });

  // ── Cart state ────────────────────────────────────────────────────────────
  const [cart, setCart] = useState<CartItem[]>([]);
  const [cartId, setCartId] = useState<string | null>(null);
  const [cartCheckoutUrl, setCartCheckoutUrl] = useState<string | null>(null);
  const [cartLoading, setCartLoading] = useState(false);
  const [cartOpen, setCartOpen] = useState(false);

  // Refs keep the latest values accessible inside async callbacks without
  // stale-closure issues (no need to list them in useCallback deps).
  const cartRef = useRef<CartItem[]>([]);
  const cartIdRef = useRef<string | null>(null);
  useEffect(() => {
    cartRef.current = cart;
  }, [cart]);
  useEffect(() => {
    cartIdRef.current = cartId;
  }, [cartId]);

  // ── Guards ────────────────────────────────────────────────────────────────
  /** Last "cartId:email" pair that was successfully bound */
  const identityBoundRef = useRef<string | null>(null);
  /** True while a bindCartBuyerIdentity call is in-flight */
  const identityInFlightRef = useRef(false);
  /** Timestamp of last store-credit fetch (ms) */
  const creditLastFetchRef = useRef(0);
  /** Timestamp of last subscription-status fetch (ms) */
  const subLastFetchRef = useRef(0);

  // ── Store credit & subscriptions ──────────────────────────────────────────
  const [storeCredit, setStoreCredit] = useState<StoreCreditState | null>(null);
  const [subscriptions, setSubscriptions] = useState<SubscriptionsState | null>(null);

  // ── Fit profile ───────────────────────────────────────────────────────────
  const [fitProfile, setFitProfileState] = useState<FitProfile>(EMPTY_FIT);

  // ── Club ──────────────────────────────────────────────────────────────────
  const [clubStatus, setClubStatus] = useState<ClubStatus>("none");
  const [interestedClubs, setInterestedClubs] = useState<string[]>([]);

  /* ── Fit profile helpers ── */

  const setFitProfile = useCallback(
    async (profile: FitProfile) => {
      setFitProfileState(profile);
      if (user?.uid) {
        try {
          await updateDoc(doc(db, "users", user.uid), { fit_profile: profile });
        } catch (err) {
          console.error("[FitProfile] Firestore persist failed:", err);
        }
      }
    },
    [user]
  );

  /* ── Cart helpers ── */

  const syncFromShopifyCart = useCallback((sc: ShopifyCart) => {
    cartIdRef.current = sc.id;
    setCartId(sc.id);
    setCartCheckoutUrl(sc.checkoutUrl);
    setCart(
      sc.lines.map((line) => ({
        slug: line.productSlug,
        name: line.productName,
        brand: line.brand,
        price: line.price,
        quantity: line.quantity,
        variantId: line.variantId,
        lineId: line.id,
        image: line.image,
      }))
    );
  }, []);

  const persistCartId = useCallback(async (uid: string, id: string) => {
    try {
      localStorage.setItem(cartIdKey(uid), id);
    } catch {}
    try {
      await updateDoc(doc(db, "users", uid), {
        "cart.cart_id": id,
        "cart.updated_at": serverTimestamp(),
      });
    } catch {}
  }, []);

  /* ── bindCartBuyerIdentity ── */
  const bindCartBuyerIdentity = useCallback(
    async (cId: string, userEmail: string) => {
      const key = `${cId}:${userEmail}`;
      if (identityBoundRef.current === key) return;
      if (identityInFlightRef.current) return;

      identityInFlightRef.current = true;
      try {
        const updated = await updateCartBuyerIdentity(cId, {
          email: userEmail,
        });
        identityBoundRef.current = key;
        syncFromShopifyCart(updated);
      } catch (err) {
        console.error("[Cart] bindCartBuyerIdentity failed:", err);
      } finally {
        identityInFlightRef.current = false;
      }
    },
    [syncFromShopifyCart]
  );

  /* ── Cart rehydration on login ── */
  const rehydrateCart = useCallback(
    async (uid: string, userEmail: string) => {
      let savedId: string | null = null;

      // 1) Firestore
      try {
        const snap = await getDoc(doc(db, "users", uid));
        savedId = (snap.data()?.cart?.cart_id as string) ?? null;
      } catch {}

      // 2) localStorage fallback
      if (!savedId) {
        try {
          savedId = localStorage.getItem(cartIdKey(uid));
        } catch {}
      }

      if (!savedId) return;

      // 3) Validate with Shopify
      try {
        const sc = await getCart(savedId);
        if (sc) {
          syncFromShopifyCart(sc);
          bindCartBuyerIdentity(sc.id, userEmail);
        } else {
          try {
            localStorage.removeItem(cartIdKey(uid));
          } catch {}
        }
      } catch (err) {
        console.error("[Cart] rehydrateCart failed:", err);
      }
    },
    [syncFromShopifyCart, bindCartBuyerIdentity]
  );

  /* ── Firebase auth listener ── */
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      setAuthLoading(true);
      setUser(firebaseUser);

      if (firebaseUser) {
        setEmail(firebaseUser.email ?? "");
        setUsername(firebaseUser.displayName ?? "");

        try {
          const profile = await syncUserProfile(firebaseUser);
          if (profile.username) setUsername(profile.username);
          setOnboardingCompleted(profile.onboarding_completed ?? false);
          if (profile.messaging_preferences) {
            setMessagingPreferences({
              email_marketing: profile.messaging_preferences.email_marketing ?? true,
              sms_marketing: profile.messaging_preferences.sms_marketing ?? false,
            });
          }
          // Pre-populate store credit & subscriptions from Firestore — avoids
          // a "null data" flash before the dashboard calls the refresh APIs.
          if (profile.store_credit) {
            setStoreCredit({
              balance_cents: profile.store_credit.balance_cents,
              currency: profile.store_credit.currency,
            });
          }
          if (profile.subscriptions) {
            setSubscriptions({
              mullybox_active: profile.subscriptions.mullybox_active,
              status: profile.subscriptions.status,
              total_subscription_count: profile.subscriptions.total_subscription_count,
              active_subscription_ids: profile.subscriptions.active_subscription_ids,
              manage_url: profile.subscriptions.manage_url,
              next_unblock_url: profile.subscriptions.next_unblock_url,
            });
          }
          if (profile.fit_profile && typeof profile.fit_profile === "object") {
            setFitProfileState({ ...EMPTY_FIT, ...profile.fit_profile });
          }
          if (profile.tier && ["free", "access", "member", "black"].includes(profile.tier)) {
            setTier(profile.tier as MemberTier);
          }
        } catch (err) {
          console.error("[MembershipContext] syncUserProfile failed:", err);
        }

        // Reconcile tier against live Loop subscriptions
        try {
          const idToken = await firebaseUser.getIdToken();
          const res = await fetch("/api/loop/subscriptions", {
            headers: { Authorization: `Bearer ${idToken}` },
          });
          if (res.ok) {
            const data = await res.json() as { subscriptions: Array<Record<string, unknown>>; source: string };
            console.log("[Loop] raw subscriptions:", JSON.stringify(data, null, 2));

            const loopTier = resolveTierFromLoopSubs(data.subscriptions);
            if (loopTier) {
              setTier(loopTier);
              // Sync Firestore if it differs
              try {
                const snap = await getDoc(doc(db, "users", firebaseUser.uid));
                if (snap.data()?.tier !== loopTier) {
                  await updateDoc(doc(db, "users", firebaseUser.uid), { tier: loopTier });
                }
              } catch (err) {
                console.error("[Loop] Firestore tier sync failed:", err);
              }
            }
          }
        } catch (err) {
          console.error("[Loop] subscription tier check failed:", err);
        }

        if (firebaseUser.email) {
          rehydrateCart(firebaseUser.uid, firebaseUser.email).catch(
            console.error
          );
        }
      } else {
        // Signed out — reset all state
        setEmail("");
        setUsername("");
        setTier("free");
        setCart([]);
        setCartId(null);
        setCartCheckoutUrl(null);
        setFitProfileState(EMPTY_FIT);
        setStoreCredit(null);
        setSubscriptions(null);
        setOnboardingCompleted(false);
        setMessagingPreferences({ email_marketing: true, sms_marketing: false });
        setClubStatus("none");
        setInterestedClubs([]);
        cartIdRef.current = null;
        identityBoundRef.current = null;
      }

      setAuthLoading(false);
    });

    return unsubscribe;
  }, [rehydrateCart]);

  /* ── Auth actions ── */
  const signOut = useCallback(async () => {
    await firebaseSignOut(auth);
  }, []);

  /* ── Cart actions ── */

  const addToCart = useCallback(
    async (item: Omit<CartItem, "quantity">) => {
      // Capture pre-update snapshot via ref (avoids stale closure on cart state)
      const current = cartRef.current;
      const existing = current.find((c) => c.slug === item.slug);
      const newQty = existing ? existing.quantity + 1 : 1;

      // Optimistic local update
      if (existing) {
        setCart((prev) =>
          prev.map((c) =>
            c.slug === item.slug ? { ...c, quantity: c.quantity + 1 } : c
          )
        );
      } else {
        setCart((prev) => [...prev, { ...item, quantity: 1 }]);
      }
      setCartOpen(true);

      if (!item.variantId) return; // No Shopify variant — local-only

      const currentCartId = cartIdRef.current;

      try {
        let result: ShopifyCart;

        if (currentCartId) {
          if (existing?.lineId) {
            // Increment existing line
            result = await cartLinesUpdate(currentCartId, [
              { id: existing.lineId, quantity: newQty },
            ]);
          } else {
            // New product in existing cart
            result = await cartLinesAdd(currentCartId, [
              { merchandiseId: item.variantId, quantity: 1 },
            ]);
          }
        } else {
          // No cart yet — create one
          result = await cartCreate([
            { merchandiseId: item.variantId, quantity: 1 },
          ]);
        }

        syncFromShopifyCart(result);

        if (user?.uid) await persistCartId(user.uid, result.id);
        if (user?.email) bindCartBuyerIdentity(result.id, user.email);

        void trackEvent("add_to_cart", {
          product_id: item.slug,
          variant_id: item.variantId,
          name: item.name,
          brand: item.brand,
          value: item.price,
          quantity: newQty,
          user_id: user?.uid,
        });
      } catch (err) {
        console.error("[Cart] addToCart Shopify sync failed:", err);
        // Optimistic update already applied; leave local state as-is
      }
    },
    [user, syncFromShopifyCart, persistCartId, bindCartBuyerIdentity]
  );

  const removeFromCart = useCallback(
    async (slug: string) => {
      const item = cartRef.current.find((c) => c.slug === slug);
      if (!item) return;

      // Optimistic removal
      setCart((prev) => prev.filter((c) => c.slug !== slug));

      if (!cartIdRef.current || !item.lineId) return;

      try {
        const result = await cartLinesRemove(cartIdRef.current, [item.lineId]);
        syncFromShopifyCart(result);
      } catch (err) {
        console.error("[Cart] removeFromCart failed:", err);
        // Revert optimistic removal
        setCart((prev) => [item, ...prev]);
      }
    },
    [syncFromShopifyCart]
  );

  const updateCartItem = useCallback(
    async (lineId: string, quantity: number) => {
      if (quantity <= 0) {
        const item = cartRef.current.find((c) => c.lineId === lineId);
        if (item) await removeFromCart(item.slug);
        return;
      }

      // Optimistic update
      setCart((prev) =>
        prev.map((c) => (c.lineId === lineId ? { ...c, quantity } : c))
      );

      if (!cartIdRef.current) return;

      try {
        setCartLoading(true);
        const result = await cartLinesUpdate(cartIdRef.current, [
          { id: lineId, quantity },
        ]);
        syncFromShopifyCart(result);
      } catch (err) {
        console.error("[Cart] updateCartItem failed:", err);
      } finally {
        setCartLoading(false);
      }
    },
    [removeFromCart, syncFromShopifyCart]
  );

  /* ── Onboarding ── */

  const completeOnboarding = useCallback(
    async (data: { username: string }) => {
      setUsername(data.username);
      setOnboardingCompleted(true);
      if (user?.uid) {
        try {
          await updateDoc(doc(db, "users", user.uid), {
            username: data.username,
            onboarding_completed: true,
            updated_at: serverTimestamp(),
          });
        } catch (err) {
          console.error("[Onboarding] Firestore persist failed:", err);
        }
      }
    },
    [user]
  );

  const saveMessagingPreferences = useCallback(
    async (prefs: { email_marketing: boolean; sms_marketing: boolean }) => {
      setMessagingPreferences(prefs);
      if (user?.uid) {
        try {
          await updateDoc(doc(db, "users", user.uid), {
            "messaging_preferences.email_marketing": prefs.email_marketing,
            "messaging_preferences.sms_marketing": prefs.sms_marketing,
            updated_at: serverTimestamp(),
          });
        } catch (err) {
          console.error("[MessagingPrefs] Firestore persist failed:", err);
        }
      }
    },
    [user]
  );

  const saveUsername = useCallback(
    async (newUsername: string) => {
      setUsername(newUsername);
      if (user?.uid) {
        try {
          await updateDoc(doc(db, "users", user.uid), {
            username: newUsername,
            updated_at: serverTimestamp(),
          });
        } catch (err) {
          console.error("[Username] Firestore persist failed:", err);
        }
      }
    },
    [user]
  );

  /* ── Data refreshers ── */

  const refreshStoreCredit = useCallback(async () => {
    if (!user) return;
    const now = Date.now();
    if (now - creditLastFetchRef.current < 60_000) return; // 60s throttle
    creditLastFetchRef.current = now;

    try {
      const token = await user.getIdToken();
      const res = await fetch("/api/shopify/store-credit", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = (await res.json()) as { store_credit: StoreCreditState };
        setStoreCredit(data.store_credit);
      }
    } catch (err) {
      console.error("[StoreCredit] refresh failed:", err);
    }
  }, [user]);

  const refreshSubscriptionStatus = useCallback(async () => {
    if (!user) return;
    const now = Date.now();
    if (now - subLastFetchRef.current < 60_000) return; // 60s throttle
    subLastFetchRef.current = now;

    try {
      const token = await user.getIdToken();
      const res = await fetch("/api/loop/subscription-status", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = (await res.json()) as { subscriptions: SubscriptionsState };
        setSubscriptions(data.subscriptions);
      }
    } catch (err) {
      console.error("[SubscriptionStatus] refresh failed:", err);
    }
  }, [user]);

  /* ── Club actions ── */
  const toggleClubInterest = useCallback((clubName: string) => {
    setInterestedClubs((prev) =>
      prev.includes(clubName)
        ? prev.filter((c) => c !== clubName)
        : [...prev, clubName]
    );
  }, []);

  const cartCount = cart.reduce((sum, c) => sum + c.quantity, 0);
  const cartTotal = cart.reduce((sum, c) => sum + c.price * c.quantity, 0);

  return (
    <MembershipContext.Provider
      value={{
        // Auth
        user,
        isSignedIn: user !== null,
        authLoading,
        sendOTPEmail,
        confirmOTPSignIn,
        signOut,

        // User
        email,
        setEmail,
        username,
        setUsername,

        // Tier
        tier,
        setTier,
        tierLabel: TIER_LABELS[tier],

        // Cart
        cart,
        cartId,
        cartCheckoutUrl,
        cartLoading,
        cartOpen,
        setCartOpen,
        addToCart,
        removeFromCart,
        updateCartItem,
        cartCount,
        cartTotal,

        // Fit profile
        fitProfile,
        setFitProfile,

        // Club
        clubStatus,
        setClubStatus,
        interestedClubs,
        toggleClubInterest,

        // Store credit & subscriptions
        storeCredit,
        subscriptions,

        // Notifications
        messagingPreferences,
        saveMessagingPreferences,

        // Onboarding
        onboardingCompleted,
        completeOnboarding,
        saveUsername,

        // Data refreshers
        refreshStoreCredit,
        refreshSubscriptionStatus,
      }}
    >
      {children}
    </MembershipContext.Provider>
  );
}
