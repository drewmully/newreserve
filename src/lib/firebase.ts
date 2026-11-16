"use client";

import { initializeApp, getApps, getApp } from "firebase/app";
import {
  getAuth,
  sendSignInLinkToEmail,
  isSignInWithEmailLink,
  signInWithEmailLink,
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  connectAuthEmulator,
  GoogleAuthProvider,
} from "firebase/auth";
import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  updateDoc,
  serverTimestamp,
  connectFirestoreEmulator,
} from "firebase/firestore";
import {
  getStorage,
  ref as storageRef,
  uploadBytes,
  getDownloadURL,
} from "firebase/storage";
import type { User } from "firebase/auth";

/* ═══════════════════════════════════════════
   CONFIG & INITIALIZATION
   ═══════════════════════════════════════════ */

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

const app = getApps().length ? getApp() : initializeApp(firebaseConfig);

const isBrowser = typeof window !== "undefined";

// During server-side prerender, Firebase Auth can throw if web env vars are
// missing/invalid. Defer real Auth/Firestore instances to the browser.
export const auth = isBrowser
  ? getAuth(app)
  : (null as unknown as ReturnType<typeof getAuth>);
export const db = isBrowser
  ? getFirestore(app)
  : (null as unknown as ReturnType<typeof getFirestore>);
export const storage = isBrowser
  ? getStorage(app)
  : (null as unknown as ReturnType<typeof getStorage>);

// Local QA only: point the browser SDK at the Firebase emulators when
// NEXT_PUBLIC_FIREBASE_EMULATORS=1. Never set in Vercel; production and
// preview builds are unaffected. Server routes use firebase-admin, which
// honours FIRESTORE_EMULATOR_HOST / FIREBASE_AUTH_EMULATOR_HOST natively.
if (isBrowser && process.env.NEXT_PUBLIC_FIREBASE_EMULATORS === "1") {
  const g = globalThis as { __mullyEmulatorsConnected?: boolean };
  if (!g.__mullyEmulatorsConnected) {
    g.__mullyEmulatorsConnected = true;
    connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
    connectFirestoreEmulator(db, "127.0.0.1", 8080);
  }
}

/**
 * Uploads an image File to Firebase Storage under community/posts/
 * and returns the public download URL.
 */
export async function uploadCommunityImage(file: File): Promise<string> {
  const ext = file.name.split(".").pop() ?? "jpg";
  const path = `community/posts/${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`;
  const ref = storageRef(storage, path);
  await uploadBytes(ref, file);
  return getDownloadURL(ref);
}

/* ═══════════════════════════════════════════
   USER DOCUMENT SCHEMA
   ═══════════════════════════════════════════ */

export interface UserDocument {
  shopify_outfit_membership?: import("./shopifyOutfitMembership").ShopifyOutfitMembership;
  onboarding_profile?: {
    birth_month: string;
    birth_day: string;
    birth_year: string;
    birthdate_iso: string | null;
    handicap: string;
    private_club_member: boolean | null;
    club_name: string;
    vibe_check: string;
    putter_type: string;
    selected_tier: "free" | "access" | "member" | "";
  };
  email: string;
  created_at: unknown; // Firestore Timestamp (FieldValue on write, Timestamp on read)
  last_login: unknown;
  updated_at: unknown;
  shopify_customer_id: string | null;
  store_credit: {
    balance_cents: number;
    currency: string;
    last_synced: unknown | null;
  };
  subscriptions: {
    mullybox_active: boolean;
    status: string;
    total_subscription_count: number;
    active_subscription_ids: string[];
    manage_url: string | null;
    next_unblock_url: string | null;
    last_checked: unknown | null;
  };
  cart: {
    cart_id: string | null;
    updated_at: unknown | null;
  };
  segments: string[];
  messaging_preferences: {
    email_marketing: boolean;
    sms_marketing: boolean;
    push_notifications: boolean;
  };
  username: string;
  onboarding_completed: boolean;
  fit_profile?: Record<string, string>;
  tier?: "free" | "access" | "member" | "black";
  isLegacy?: boolean;
  legacyPlan?: string | null;
  back9WelcomeSeen?: boolean;
}

const USER_DEFAULTS: Omit<
  UserDocument,
  "email" | "created_at" | "last_login" | "updated_at"
> = {
  onboarding_profile: {
    birth_month: "",
    birth_day: "",
    birth_year: "",
    birthdate_iso: null,
    handicap: "",
    private_club_member: null,
    club_name: "",
    vibe_check: "",
    putter_type: "",
    selected_tier: "",
  },
  username: "",
  onboarding_completed: false,
  shopify_customer_id: null,
  store_credit: {
    balance_cents: 0,
    currency: "USD",
    last_synced: null,
  },
  subscriptions: {
    mullybox_active: false,
    status: "none",
    total_subscription_count: 0,
    active_subscription_ids: [],
    manage_url: null,
    next_unblock_url: null,
    last_checked: null,
  },
  cart: {
    cart_id: null,
    updated_at: null,
  },
  segments: [],
  messaging_preferences: {
    email_marketing: true,
    sms_marketing: true,
    push_notifications: false,
  },
};

/* ═══════════════════════════════════════════
   syncUserProfile
   - On first sign-in: creates users/{uid} with full defaults + created_at
   - On subsequent sign-ins: updates last_login, updated_at, and email only
   - Returns the final document data
   ═══════════════════════════════════════════ */

export async function syncUserProfile(user: User): Promise<UserDocument> {
  const ref = doc(db, "users", user.uid);
  const snap = await getDoc(ref);
  const now = serverTimestamp();
  // Stored lowercased so server lookups (orders-paid, Loop) match no matter
  // how the address was typed. firestore.rules compares case-insensitively.
  const email = (user.email ?? "").trim().toLowerCase();

  if (!snap.exists()) {
    const newDoc = {
      email,
      created_at: now,
      last_login: now,
      updated_at: now,
      ...USER_DEFAULTS,
    };
    await setDoc(ref, newDoc);
  } else {
    const updates: Record<string, unknown> = {
      email,
      last_login: now,
      updated_at: now,
    };
    // Migrate existing users who predate the onboarding_completed field
    if (snap.data()?.onboarding_completed === undefined) {
      updates.onboarding_completed = true;
    }
    await updateDoc(ref, updates);
  }

  const finalSnap = await getDoc(ref);
  return finalSnap.data() as UserDocument;
}

/* ═══════════════════════════════════════════
   PASSWORDLESS EMAIL LINK AUTH
   ─────────────────────────────────────────
   SETUP REQUIRED: In Firebase Console →
   Authentication → Sign-in methods →
   Email/Password → enable "Email link
   (passwordless sign-in)".
   ═══════════════════════════════════════════ */

/**
 * Sends a Firebase Email Link (magic link) to the given email.
 * Saves the email in localStorage so confirmOTPSignIn can retrieve
 * it on the same device automatically.
 */
export async function sendOTPEmail(email: string): Promise<void> {
  const { shopReturnFromLogin } = await import("./shopLogin");
  const destination = new URL("/login", window.location.origin);
  const shopReturn = window.location.pathname === "/login"
    ? shopReturnFromLogin(window.location.search)
    : null;
  if (shopReturn) destination.searchParams.set("returnTo", shopReturn);
  // A fresh link requested from an expired post-purchase link (/login?paid=1)
  // keeps the paid marker, so pending onboarding never re-sends the buyer to
  // checkout. The flag only suppresses the checkout redirect; it grants nothing.
  if (
    window.location.pathname === "/login" &&
    new URLSearchParams(window.location.search).get("paid") === "1"
  ) {
    destination.searchParams.set("paid", "1");
  }
  const actionCodeSettings = {
    // Must be whitelisted in Firebase Console → Authentication → Settings → Authorized domains.
    url: destination.toString(),
    handleCodeInApp: true,
  };
  await sendSignInLinkToEmail(auth, email, actionCodeSettings);
  try {
    localStorage.setItem("emailForSignIn", email);
  } catch {}
}

/**
 * Completes the Email Link sign-in.
 * Call this when isSignInWithEmailLink(auth, window.location.href) is true.
 */
export async function confirmOTPSignIn(
  email: string,
  link: string
): Promise<void> {
  if (!isSignInWithEmailLink(auth, link)) {
    throw new Error("Invalid sign-in link.");
  }
  await signInWithEmailLink(auth, email, link);
  try {
    localStorage.removeItem("emailForSignIn");
  } catch {}
}

export { isSignInWithEmailLink };

/**
 * Opens a Google sign-in popup and completes Firebase auth.
 */
export async function signInWithGoogle(): Promise<void> {
  const provider = new GoogleAuthProvider();
  await signInWithPopup(auth, provider);
}

/** Session flag so /login only calls getRedirectResult after it started a redirect. */
export const GOOGLE_REDIRECT_PENDING_KEY = "mully_google_redirect_pending";

/**
 * Full-page Google sign-in. Used only as a fallback when the popup flow is
 * unsupported in this browser (auth/operation-not-supported-in-this-environment)
 * or the popup was blocked. /login completes it via completeGoogleRedirectSignIn.
 */
export async function signInWithGoogleRedirect(): Promise<void> {
  try {
    sessionStorage.setItem(GOOGLE_REDIRECT_PENDING_KEY, "1");
  } catch {}
  const provider = new GoogleAuthProvider();
  await signInWithRedirect(auth, provider);
}

/**
 * Completes a Google redirect started by signInWithGoogleRedirect. Resolves
 * false when no redirect was pending; throws the Firebase error on failure.
 */
export async function completeGoogleRedirectSignIn(): Promise<boolean> {
  let pending = false;
  try {
    pending = sessionStorage.getItem(GOOGLE_REDIRECT_PENDING_KEY) === "1";
    sessionStorage.removeItem(GOOGLE_REDIRECT_PENDING_KEY);
  } catch {}
  if (!pending) return false;
  const result = await getRedirectResult(auth);
  return Boolean(result?.user);
}
