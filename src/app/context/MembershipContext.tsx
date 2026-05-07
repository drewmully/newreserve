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
import { identifyAnalyticsUser, trackEvent } from "@/lib/tracking";
import {
  cartCreate,
  cartAttributesUpdate,
  cartLinesAdd,
  cartLinesRemove,
  cartLinesUpdate,
  updateCartBuyerIdentity,
  getCart,
  type ShopifyCart,
} from "@/lib/shopify";
import { buildCheckoutOriginAttributes } from "@/lib/shopifyCheckoutOrigin";
import { resolveMemberTierFromVariantId, resolveLegacyFromVariantId, getTierLabel } from "@/lib/membershipConfig";
import {
  buildCompleteOnboardingUpdatePayload,
  fromFirestoreOnboardingProfile,
} from "@/lib/onboardingProfile";

/* ═══════════════════════════════════════════
   TIER RESOLUTION FROM LOOP SUBSCRIPTIONS
   ═══════════════════════════════════════════ */

function resolveTierFromLoopSubs(
  subs: Array<Record<string, unknown>>
): { tier: MemberTier; variantId: unknown } | null {
  const active = subs.filter((s) => s.status === "ACTIVE");
  for (const sub of active) {
    // The list endpoint may not include `lines` — fall back to top-level variant fields
    const lines = sub.lines as Array<Record<string, unknown>> | undefined;
    const variantShopifyId =
      lines?.[0]?.variantShopifyId ??
      sub.shopify_variant_id ??
      sub.variant_id ??
      null;
    if (variantShopifyId != null) {
      const tier = resolveMemberTierFromVariantId(variantShopifyId);
      if (tier) return { tier, variantId: variantShopifyId };
    }
  }
  return null;
}

function getProjectReturnUrl(path = ""): string {
  if (typeof window === "undefined") return "";
  return `${window.location.origin}${path}`;
}

function getProjectCartAttributes() {
  return buildCheckoutOriginAttributes(getProjectReturnUrl());
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
  /** Original retail price — stored for member savings calculation */
  retailPrice?: number;
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
  source?: "shopify" | "cache";
  isStale?: boolean;
}

export interface SubscriptionsState {
  mullybox_active: boolean;
  status: string;
  total_subscription_count: number;
  active_subscription_ids: string[];
  manage_url: string | null;
  next_unblock_url: string | null;
  planPrice: string | null;
  planName: string | null;
  nextBillingDate: string | null;
  billingInterval: string | null;
  source?: "loop" | "cache";
  isStale?: boolean;
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

export interface OnboardingProfile {
  birthMonth: string;
  birthDay: string;
  birthYear: string;
  handicap: string;
  privateClub: boolean | null;
  clubName: string;
  vibeCheck: string;
  putterType: string;
  selectedTier: "free" | "access" | "member" | "";
}

export const EMPTY_ONBOARDING_PROFILE: OnboardingProfile = {
  birthMonth: "",
  birthDay: "",
  birthYear: "",
  handicap: "",
  privateClub: null,
  clubName: "",
  vibeCheck: "",
  putterType: "",
  selectedTier: "",
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
  isLegacy: boolean;
  legacyPlan: string | null;
  back9WelcomeSeen: boolean;
  back9UX: "landing" | "modal" | null;
  markBack9WelcomeSeen: () => Promise<void>;

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
  onboardingProfile: OnboardingProfile;
  completeOnboarding: (data: {
    username: string;
    onboardingProfile: OnboardingProfile;
    fitProfile?: FitProfile;
    phone?: string;
    smsOptIn?: boolean;
  }) => Promise<void>;
  saveUsername: (username: string) => Promise<void>;

  // Data refreshers
  refreshStoreCredit: () => Promise<void>;
  refreshSubscriptionStatus: () => Promise<void>;
}

/* ═══════════════════════════════════════════
   CONTEXT
   ═══════════════════════════════════════════ */

export const MembershipContext = createContext<MembershipContextValue | null>(null);

export function useMembership() {
  const ctx = useContext(MembershipContext);
  if (!ctx)
    throw new Error("useMembership must be used within MembershipProvider");
  return ctx;
}

/* ═══════════════════════════════════════════
   PROVIDER
   ═══════════════════════════════════════════ */

// Use getTierLabel from membershipConfig for dynamic label (legacy-aware).
// This static map is kept as a fallback for contexts without isLegacy info.
const TIER_LABELS: Record<MemberTier, string> = {
  free: "Free",
  access: "Reserve Access",
  member: "Reserve Member",
  black: "Reserve Black",
};

const GUEST_CART_ID_KEY = "mully_cart_id_guest";
const cartIdKey = (uid?: string | null) =>
  uid ? `mully_cart_id_${uid}` : GUEST_CART_ID_KEY;

const EMPTY_SUBSCRIPTIONS_STATE: SubscriptionsState = {
  mullybox_active: false,
  status: "none",
  total_subscription_count: 0,
  active_subscription_ids: [],
  manage_url: null,
  next_unblock_url: null,
  planPrice: null,
  planName: null,
  nextBillingDate: null,
  billingInterval: null,
  source: "cache",
  isStale: true,
};

function normalizeStoreCreditState(
  value: Partial<StoreCreditState> | null | undefined,
  source: "shopify" | "cache"
): StoreCreditState | null {
  if (!value) return null;
  return {
    balance_cents: Number(value.balance_cents ?? 0),
    currency:
      typeof value.currency === "string" && value.currency.trim()
        ? value.currency
        : "USD",
    source,
    isStale: source !== "shopify",
  };
}

function normalizeSubscriptionsState(
  value: Partial<SubscriptionsState> | null | undefined,
  source: "loop" | "cache"
): SubscriptionsState {
  return {
    ...EMPTY_SUBSCRIPTIONS_STATE,
    ...(value ?? {}),
    active_subscription_ids: Array.isArray(value?.active_subscription_ids)
      ? value.active_subscription_ids.filter(
          (id): id is string => typeof id === "string" && id.length > 0
        )
      : [],
    manage_url:
      typeof value?.manage_url === "string" ? value.manage_url : null,
    next_unblock_url:
      typeof value?.next_unblock_url === "string"
        ? value.next_unblock_url
        : null,
    source,
    isStale: source !== "loop",
  };
}

export function MembershipProvider({ children }: { children: ReactNode }) {
  // ── Auth ──────────────────────────────────────────────────────────────────
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [authLoading, setAuthLoading] = useState(true);

  // ── User display ──────────────────────────────────────────────────────────
  const [email, setEmailRaw] = useState("");
  const [username, setUsername] = useState("");

  // ── Membership tier ───────────────────────────────────────────────────────
  const [tier, setTier] = useState<MemberTier>("free");
  const [isLegacy, setIsLegacy] = useState(false);
  const [legacyPlan, setLegacyPlan] = useState<string | null>(null);
  const [back9WelcomeSeen, setBack9WelcomeSeen] = useState(false);
  const [back9UX, setBack9UX] = useState<"landing" | "modal" | null>(null);

  // ── Onboarding ────────────────────────────────────────────────────────────
  const [onboardingCompleted, setOnboardingCompleted] = useState(false);
  const [onboardingProfile, setOnboardingProfileState] =
    useState<OnboardingProfile>(EMPTY_ONBOARDING_PROFILE);

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
  /** Last uid for which "login" was tracked in this session */
  const loginTrackedUidRef = useRef<string | null>(null);
  /** Last subscription state signature sent to analytics */
  const lastTrackedSubscriptionStateRef = useRef<string | null>(null);

  // ── Store credit & subscriptions ──────────────────────────────────────────
  const [storeCredit, setStoreCredit] = useState<StoreCreditState | null>(null);
  const [subscriptions, setSubscriptions] = useState<SubscriptionsState | null>(null);

  // ── Fit profile ───────────────────────────────────────────────────────────
  const [fitProfile, setFitProfileState] = useState<FitProfile>(EMPTY_FIT);

  // ── Club ──────────────────────────────────────────────────────────────────
  const [clubStatus, setClubStatus] = useState<ClubStatus>("none");
  const [interestedClubs, setInterestedClubs] = useState<string[]>([]);

  // Guarded setEmail — no-op when the user is authenticated so that
  // components can't overwrite the canonical Firebase Auth email in state.
  const setEmail = useCallback((newEmail: string) => {
    if (user) return;
    setEmailRaw(newEmail);
  }, [user]);

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
        retailPrice: line.retailPrice,
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

  const persistCartIdLocally = useCallback((uid: string | null, id: string) => {
    try {
      localStorage.setItem(cartIdKey(uid), id);
    } catch {}
  }, []);

  const clearPersistedCartId = useCallback(
    async (
      uid: string | null,
      {
        clearFirestore = false,
      }: {
        clearFirestore?: boolean;
      } = {}
    ) => {
      try {
        localStorage.removeItem(cartIdKey(uid));
      } catch {}

      if (uid && clearFirestore) {
        try {
          await updateDoc(doc(db, "users", uid), {
            "cart.cart_id": null,
            "cart.updated_at": serverTimestamp(),
          });
        } catch {}
      }
    },
    []
  );

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
    async (uid: string | null, userEmail?: string | null) => {
      const candidates: Array<{
        id: string;
        source: "user_firestore" | "user_local" | "guest_local";
      }> = [];

      if (uid) {
        try {
          const snap = await getDoc(doc(db, "users", uid));
          const firestoreCartId = snap.data()?.cart?.cart_id;
          if (typeof firestoreCartId === "string" && firestoreCartId.length > 0) {
            candidates.push({ id: firestoreCartId, source: "user_firestore" });
          }
        } catch {}

        try {
          const userLocalCartId = localStorage.getItem(cartIdKey(uid));
          if (userLocalCartId) {
            candidates.push({ id: userLocalCartId, source: "user_local" });
          }
        } catch {}
      }

      try {
        const guestCartId = localStorage.getItem(cartIdKey(null));
        if (guestCartId) {
          candidates.push({ id: guestCartId, source: "guest_local" });
        }
      } catch {}

      const deduped = candidates.filter(
        (candidate, index, all) =>
          all.findIndex((entry) => entry.id === candidate.id) === index
      );

      if (deduped.length === 0) return;

      for (const candidate of deduped) {
        try {
          const sc = await getCart(candidate.id);
          if (!sc) {
            await clearPersistedCartId(
              candidate.source === "guest_local" ? null : uid,
              { clearFirestore: candidate.source === "user_firestore" }
            );
            continue;
          }

          syncFromShopifyCart(sc);

          let hydratedCart = sc;
          try {
            hydratedCart = await cartAttributesUpdate(
              sc.id,
              getProjectCartAttributes()
            );
            syncFromShopifyCart(hydratedCart);
          } catch (err) {
            console.error("[Cart] origin attribute sync failed:", err);
          }

          if (uid) {
            await persistCartId(uid, hydratedCart.id);
            if (candidate.source === "guest_local") {
              await clearPersistedCartId(null);
            }
          } else {
            persistCartIdLocally(null, hydratedCart.id);
          }

          if (userEmail) {
            bindCartBuyerIdentity(hydratedCart.id, userEmail);
          }

          return;
        } catch (err) {
          console.error("[Cart] rehydrateCart failed:", err);
          return;
        }
      }
    },
    [
      bindCartBuyerIdentity,
      clearPersistedCartId,
      persistCartId,
      persistCartIdLocally,
      syncFromShopifyCart,
    ]
  );

  /* ── Firebase auth listener ── */
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      setAuthLoading(true);
      setUser(firebaseUser);

      if (firebaseUser) {
        setEmailRaw(firebaseUser.email ?? "");
        setUsername(firebaseUser.displayName ?? "");

        // Captured after syncUserProfile, used after Loop reconciliation
        let firestoreIsLegacy = false;
        let firestoreBack9WelcomeSeen = false;

        if (loginTrackedUidRef.current !== firebaseUser.uid) {
          loginTrackedUidRef.current = firebaseUser.uid;
          void identifyAnalyticsUser({
            reserve_user_id: firebaseUser.uid,
            email: firebaseUser.email,
            phone: firebaseUser.phoneNumber,
          });
          void trackEvent("login", {
            properties: {
              auth_provider: firebaseUser.providerData[0]?.providerId ?? "unknown",
            },
          });
        }

        try {
          const profile = await syncUserProfile(firebaseUser);

          // Mirror the latest Firestore profile to mully-hub Supabase in
          // real time. Fire-and-forget: never block sign-in on hub IO.
          firebaseUser.getIdToken().then((token) => {
            fetch("/api/users/sync-hub", {
              method: "POST",
              headers: { Authorization: `Bearer ${token}` },
              keepalive: true,
            }).catch((e) =>
              console.warn("[MembershipContext] sync-hub failed:", e)
            );
          }).catch(() => {});

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
            setStoreCredit(
              normalizeStoreCreditState(profile.store_credit, "cache")
            );
          }
          if (profile.subscriptions) {
            setSubscriptions(
              normalizeSubscriptionsState(profile.subscriptions, "cache")
            );
          }
          if (profile.fit_profile && typeof profile.fit_profile === "object") {
            setFitProfileState({ ...EMPTY_FIT, ...profile.fit_profile });
          }
          const parsedOnboardingProfile = fromFirestoreOnboardingProfile(
            profile.onboarding_profile
          );
          if (parsedOnboardingProfile) {
            setOnboardingProfileState(parsedOnboardingProfile);
          } else {
            setOnboardingProfileState(EMPTY_ONBOARDING_PROFILE);
          }
          if (profile.tier && ["free", "access", "member", "black"].includes(profile.tier)) {
            setTier(profile.tier as MemberTier);
          }
          if (typeof profile.isLegacy === "boolean") {
            setIsLegacy(profile.isLegacy);
          }
          if (profile.legacyPlan === null || typeof profile.legacyPlan === "string") {
            setLegacyPlan(profile.legacyPlan ?? null);
          }
          firestoreIsLegacy = profile.isLegacy ?? false;
          firestoreBack9WelcomeSeen = profile.back9WelcomeSeen ?? false;
          setBack9WelcomeSeen(firestoreBack9WelcomeSeen);
          console.log("[back9]", { isLegacy: firestoreIsLegacy, back9WelcomeSeen: firestoreBack9WelcomeSeen });
          // Already known as legacy and haven't seen welcome — modal path
          if (firestoreIsLegacy && !firestoreBack9WelcomeSeen) {
            setBack9UX("modal");
            console.log("[back9] → modal");
          }
        } catch (err) {
          console.error("[MembershipContext] syncUserProfile failed:", err);
        }

        // Load persisted registry status (if user has already applied)
        try {
          const registrySnap = await getDoc(
            doc(db, "registry_applications", firebaseUser.uid)
          );
          const status = registrySnap.data()?.status;
          if (status === "pending" || status === "approved") {
            setClubStatus(status);
          } else {
            setClubStatus("none");
          }
        } catch (err) {
          console.error("[MembershipContext] registry status load failed:", err);
          setClubStatus("none");
        }

        // Reconcile tier against live Loop subscriptions
        try {
          const idToken = await firebaseUser.getIdToken();
          const res = await fetch("/api/loop/subscriptions", {
            headers: { Authorization: `Bearer ${idToken}` },
          });
          if (res.ok) {
            const data = await res.json() as { subscriptions: Array<Record<string, unknown>>; source: string };
            const resolved = resolveTierFromLoopSubs(data.subscriptions);
            if (resolved) {
              const { tier: loopTier, variantId } = resolved;
              const legacy = resolveLegacyFromVariantId(variantId);
              setTier(loopTier);
              setIsLegacy(legacy.isLegacy);
              setLegacyPlan(legacy.legacyPlan);
              // Newly detected as Back 9 this session — show landing page
              if (legacy.isLegacy && !firestoreBack9WelcomeSeen && !firestoreIsLegacy) {
                setBack9UX("landing");
              }
              // Persist to Firestore so future cold loads are correct
              try {
                await updateDoc(doc(db, "users", firebaseUser.uid), {
                  tier: loopTier,
                  isLegacy: legacy.isLegacy,
                  legacyPlan: legacy.legacyPlan,
                  updated_at: serverTimestamp(),
                });
              } catch {
                // Non-fatal
              }
            }
          }
        } catch (err) {
          console.error("[Loop] subscription tier check failed:", err);
        }

        // Kick off welcome email flow — runs AFTER Loop reconciliation so
        // tier and isLegacy are already written to Firestore before welcome reads them.
        try {
          const idToken = await firebaseUser.getIdToken();
          void fetch("/api/email/welcome", {
            method: "POST",
            headers: { Authorization: `Bearer ${idToken}` },
          });
        } catch {
          // Non-fatal: email flow failure should never break auth
        }

        if (firebaseUser.email) {
          rehydrateCart(firebaseUser.uid, firebaseUser.email).catch(
            console.error
          );
        }
      } else {
        // Signed out — reset all state
        setEmailRaw("");
        setUsername("");
        setTier("free");
        setIsLegacy(false);
        setLegacyPlan(null);
        setCart([]);
        setCartId(null);
        setCartCheckoutUrl(null);
        setFitProfileState(EMPTY_FIT);
        setStoreCredit(null);
        setSubscriptions(null);
        setOnboardingCompleted(false);
        setOnboardingProfileState(EMPTY_ONBOARDING_PROFILE);
        setMessagingPreferences({ email_marketing: true, sms_marketing: false });
        setClubStatus("none");
        setInterestedClubs([]);
        setBack9WelcomeSeen(false);
        setBack9UX(null);
        cartIdRef.current = null;
        identityBoundRef.current = null;
        loginTrackedUidRef.current = null;
        lastTrackedSubscriptionStateRef.current = null;
        rehydrateCart(null).catch(console.error);
      }

      setAuthLoading(false);
    });

    return unsubscribe;
  }, [rehydrateCart]);

  /* ── Auth actions ── */
  const signOut = useCallback(async () => {
    await firebaseSignOut(auth);
  }, []);

  /* ── Back 9 welcome ── */
  const markBack9WelcomeSeen = useCallback(async () => {
    if (!user) return;
    setBack9WelcomeSeen(true);
    setBack9UX(null);
    try {
      await updateDoc(doc(db, "users", user.uid), {
        back9WelcomeSeen: true,
        updated_at: serverTimestamp(),
      });
    } catch (err) {
      console.error("[Back9] markBack9WelcomeSeen failed:", err);
    }
  }, [user]);

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
        const originAttributes = getProjectCartAttributes();

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
          try {
            result = await cartAttributesUpdate(result.id, originAttributes);
          } catch (err) {
            console.error("[Cart] origin attribute sync failed:", err);
          }
        } else {
          // No cart yet — create one
          result = await cartCreate([
            { merchandiseId: item.variantId, quantity: 1 },
          ], undefined, originAttributes);
        }

        syncFromShopifyCart(result);

        if (user?.uid) {
          await persistCartId(user.uid, result.id);
        } else {
          persistCartIdLocally(null, result.id);
        }
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
    [
      user,
      syncFromShopifyCart,
      persistCartId,
      persistCartIdLocally,
      bindCartBuyerIdentity,
    ]
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
    async (data: {
      username: string;
      onboardingProfile: OnboardingProfile;
      fitProfile?: FitProfile;
      phone?: string;
      smsOptIn?: boolean;
    }) => {
      const { normalizedOnboardingProfile, normalizedFitProfile, updates } =
        buildCompleteOnboardingUpdatePayload({
          username: data.username,
          onboardingProfile: data.onboardingProfile,
          fitProfile: data.fitProfile,
          emptyFitProfile: EMPTY_FIT,
          updatedAt: serverTimestamp(),
        });

      // Phone + SMS consent (TCPA: only mark consent when checkbox checked AND a valid phone is present)
      const phoneE164 = (data.phone ?? "").trim();
      const smsOptIn = !!(data.smsOptIn && phoneE164);
      if (phoneE164) {
        updates.phone_e164 = phoneE164;
      }
      // Always write email_marketing default true; sms only true when explicit consent
      updates["messaging_preferences.email_marketing"] = true;
      updates["messaging_preferences.sms_marketing"] = smsOptIn;
      if (smsOptIn) {
        updates.sms_consent_given_at = serverTimestamp();
      }

      setUsername(data.username);
      setOnboardingCompleted(true);
      setOnboardingProfileState(normalizedOnboardingProfile);
      setMessagingPreferences({
        email_marketing: true,
        sms_marketing: smsOptIn,
      });
      if (normalizedFitProfile) {
        setFitProfileState(normalizedFitProfile);
      }
      if (user?.uid) {
        try {
          await updateDoc(doc(db, "users", user.uid), updates);
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
      if (!res.ok) {
        setStoreCredit((prev) =>
          prev ? { ...prev, source: prev.source ?? "cache", isStale: true } : prev
        );
        return;
      }
      const data = (await res.json()) as {
        store_credit: StoreCreditState;
        source?: "shopify" | "cache";
      };
      setStoreCredit(
        normalizeStoreCreditState(data.store_credit, data.source ?? "cache")
      );
    } catch (err) {
      console.error("[StoreCredit] refresh failed:", err);
      setStoreCredit((prev) =>
        prev ? { ...prev, source: prev.source ?? "cache", isStale: true } : prev
      );
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
      if (!res.ok) {
        setSubscriptions((prev) =>
          prev ? { ...prev, source: prev.source ?? "cache", isStale: true } : prev
        );
        return;
      }
      const data = (await res.json()) as {
        subscriptions: SubscriptionsState;
        source?: "loop" | "cache";
      };
      const nextState = normalizeSubscriptionsState(
        data.subscriptions,
        data.source ?? "cache"
      );
      setSubscriptions(nextState);

      const sig = [
        nextState.status,
        nextState.mullybox_active ? "1" : "0",
        String(nextState.total_subscription_count),
      ].join(":");

      if (lastTrackedSubscriptionStateRef.current !== sig) {
        lastTrackedSubscriptionStateRef.current = sig;
        void trackEvent("subscription_state", {
          properties: {
            status: nextState.status,
            mullybox_active: nextState.mullybox_active,
            total_subscription_count: nextState.total_subscription_count,
          },
        });
      }
    } catch (err) {
      console.error("[SubscriptionStatus] refresh failed:", err);
      setSubscriptions((prev) =>
        prev ? { ...prev, source: prev.source ?? "cache", isStale: true } : prev
      );
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
        tierLabel: getTierLabel(tier, isLegacy, legacyPlan),
        isLegacy,
        legacyPlan,
        back9WelcomeSeen,
        back9UX,
        markBack9WelcomeSeen,

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
        onboardingProfile,
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
