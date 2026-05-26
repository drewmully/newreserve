#!/usr/bin/env node
/**
 * One-time seeder for the Founding 100 counter doc.
 *
 * Usage (from newreserve/ root):
 *   node scripts/seed-founding-100.mjs
 *
 * Requires FIREBASE_SERVICE_ACCOUNT_BASE64 (or the other admin-cred
 * patterns documented in src/lib/firebase-admin.ts) to be set in the
 * shell. Reads .env.local if present.
 *
 * Safe to re-run: only creates the doc if it doesn't already exist.
 * To reset/reseed, delete the doc in the Firebase console first.
 */
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

// Lightweight .env.local loader so the script works without dotenv.
const here = path.dirname(fileURLToPath(import.meta.url));
const envFile = path.join(here, "..", ".env.local");
if (existsSync(envFile)) {
  const raw = readFileSync(envFile, "utf8");
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = val;
  }
}

const admin = await import("firebase-admin");
const { initializeApp, getApps, cert } = admin.default ?? admin;
const { getFirestore } = await import("firebase-admin/firestore");

function resolveCredential() {
  const b64 = process.env.FIREBASE_SERVICE_ACCOUNT_BASE64;
  if (b64) {
    return cert(JSON.parse(Buffer.from(b64, "base64").toString("utf-8")));
  }
  const jsonStr = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (jsonStr) return cert(JSON.parse(jsonStr));
  const projectId = process.env.FIREBASE_ADMIN_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_ADMIN_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_ADMIN_PRIVATE_KEY?.replace(/\\n/g, "\n");
  if (projectId && clientEmail && privateKey) {
    return cert({ projectId, clientEmail, privateKey });
  }
  throw new Error("No Firebase Admin credentials found in env.");
}

if (!getApps().length) {
  initializeApp({ credential: resolveCredential() });
}

const db = getFirestore();
const ref = db.doc("system_counters/founding_100");

const existing = await ref.get();
if (existing.exists) {
  console.log("[seed] system_counters/founding_100 already exists:", existing.data());
  process.exit(0);
}

await ref.set({
  claimed: 5,
  cap: 100,
  active: true,
  last_order_ids: [],
  created_at: Date.now(),
});

console.log("[seed] system_counters/founding_100 created with { claimed: 5, cap: 100, active: true }");
process.exit(0);
