import { initializeApp, getApps, getApp } from "firebase/app";
import {
  getAuth,
  sendSignInLinkToEmail,
  isSignInWithEmailLink,
  signInWithEmailLink,
  signInWithPopup,
  GoogleAuthProvider,
} from "firebase/auth";
import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  updateDoc,
  serverTimestamp,
} from "firebase/firestore";
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

export const auth = getAuth(app);
export const db = getFirestore(app);

/* ═══════════════════════════════════════════
   USER DOCUMENT SCHEMA
   ═══════════════════════════════════════════ */

export interface UserDocument {
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
  fit_profile?: Record<string, string>;
  tier?: "free" | "access" | "member" | "black";
}

const USER_DEFAULTS: Omit<
  UserDocument,
  "email" | "created_at" | "last_login" | "updated_at"
> = {
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
    sms_marketing: false,
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

  if (!snap.exists()) {
    const newDoc = {
      email: user.email ?? "",
      created_at: now,
      last_login: now,
      updated_at: now,
      ...USER_DEFAULTS,
    };
    await setDoc(ref, newDoc);
  } else {
    await updateDoc(ref, {
      email: user.email ?? "",
      last_login: now,
      updated_at: now,
    });
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
  const actionCodeSettings = {
    // Must be whitelisted in Firebase Console → Authentication → Settings → Authorized domains.
    url: `${window.location.origin}/login`,
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
