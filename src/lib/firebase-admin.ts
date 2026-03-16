/**
 * Firebase Admin SDK — server-side only.
 * Never import this file from client components or pages.
 * Use only in API Routes (app/api/**) and Server Components.
 *
 * Credential resolution order (first match wins):
 *
 *   1. FIREBASE_SERVICE_ACCOUNT_BASE64
 *        Base64-encoded full service account JSON.
 *        Most reliable on serverless platforms (Vercel, Railway, Fly).
 *        Generate: base64 -i serviceAccount.json | tr -d '\n'
 *
 *   2. FIREBASE_SERVICE_ACCOUNT_JSON
 *        Raw service account JSON string.
 *        Useful when the platform handles multiline values natively.
 *
 *   3. FIREBASE_ADMIN_PROJECT_ID + FIREBASE_ADMIN_CLIENT_EMAIL + FIREBASE_ADMIN_PRIVATE_KEY
 *        Individual fields. FIREBASE_ADMIN_PRIVATE_KEY must use literal \n
 *        for newlines (common in .env files). Least reliable on some hosts.
 */

import { initializeApp, getApps, cert, type ServiceAccount } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";
import { getStorage } from "firebase-admin/storage";

function resolveCredential() {
  // ── Strategy 1: base64-encoded service account JSON ──────────────────────
  const b64 = process.env.FIREBASE_SERVICE_ACCOUNT_BASE64;
  if (b64) {
    try {
      const json = Buffer.from(b64, "base64").toString("utf-8");
      return cert(JSON.parse(json) as ServiceAccount);
    } catch (err) {
      throw new Error(
        `Failed to parse FIREBASE_SERVICE_ACCOUNT_BASE64: ${String(err)}`
      );
    }
  }

  // ── Strategy 2: raw service account JSON string ───────────────────────────
  const jsonStr = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (jsonStr) {
    try {
      return cert(JSON.parse(jsonStr) as ServiceAccount);
    } catch (err) {
      throw new Error(
        `Failed to parse FIREBASE_SERVICE_ACCOUNT_JSON: ${String(err)}`
      );
    }
  }

  // ── Strategy 3: individual env vars ──────────────────────────────────────
  const projectId = process.env.FIREBASE_ADMIN_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_ADMIN_CLIENT_EMAIL;
  // .env stores the key with literal \n — replace with real newlines
  const privateKey = process.env.FIREBASE_ADMIN_PRIVATE_KEY?.replace(
    /\\n/g,
    "\n"
  );

  if (!projectId || !clientEmail || !privateKey) {
    throw new Error(
      "Firebase Admin credentials not configured. Set one of:\n" +
        "  • FIREBASE_SERVICE_ACCOUNT_BASE64  (recommended for serverless)\n" +
        "  • FIREBASE_SERVICE_ACCOUNT_JSON\n" +
        "  • FIREBASE_ADMIN_PROJECT_ID + FIREBASE_ADMIN_CLIENT_EMAIL + FIREBASE_ADMIN_PRIVATE_KEY"
    );
  }

  return cert({ projectId, clientEmail, privateKey });
}

function getAdminApp() {
  if (getApps().length > 0) return getApps()[0]!;
  return initializeApp({ credential: resolveCredential() });
}

const adminApp = getAdminApp();

export const adminDb = getFirestore(adminApp);
export const adminAuth = getAuth(adminApp);
export const adminStorage = getStorage(adminApp);
