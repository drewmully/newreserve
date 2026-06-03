/**
 * Server-side Firestore helpers for the `styleProfiles` collection.
 *
 * NEVER import from client components — this file imports firebase-admin and
 * would balloon the client bundle (and leak the service account if mis-used).
 *
 * Required Firestore composite indexes (see firestore.indexes.json):
 *   1. email (ASC) + status (ASC)            — orders-paid webhook lookup
 *   2. status (ASC) + abandonNudgeSentAt (ASC) + updatedAt (ASC)
 *                                            — abandon-nudge cron query
 */

import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { randomUUID } from "crypto";
import { adminDb } from "@/lib/firebase-admin";
import type {
  StyleProfileDoc,
  StyleProfileInput,
  ProfileStatus,
  StyleBucket,
} from "./types";

const COLLECTION = "styleProfiles";

function ref(profileId: string) {
  return adminDb.collection(COLLECTION).doc(profileId);
}

function normalizeEmail(email: string | null | undefined): string | null {
  if (!email) return null;
  const trimmed = email.trim().toLowerCase();
  if (!trimmed) return null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) return null;
  return trimmed;
}

/**
 * Create a new style profile in `started` status. Returns the profileId
 * (also used as the Firestore doc id).
 *
 * `anonId` is a cookie-backed client identifier — lets the quiz UI continue
 * across reloads before we have an email.
 */
export async function createStyleProfile(args: {
  anonId: string;
  initialAnswer: StyleBucket;
  utm: StyleProfileDoc["utm"];
}): Promise<string> {
  const profileId = randomUUID();
  const now = Timestamp.now();

  const doc: StyleProfileDoc = {
    profileId,
    email: null,
    anonId: args.anonId,
    createdAt: now,
    updatedAt: now,
    styleBucket: args.initialAnswer,
    answers: {
      golfStyle: args.initialAnswer,
      categoryPrefs: [],
      fit: null,
      topSize: null,
      bottomSize: null,
      favoriteBrands: [],
      playFrequency: null,
    },
    status: "started",
    emailCaptured: false,
    consent: false,
    utm: args.utm,
    nurtureStage: -1,
    lastEmailedAt: null,
    shopifyOrderId: null,
    convertedAt: null,
    abandonNudgeSentAt: null,
  };

  await ref(profileId).set(doc);
  return profileId;
}

/**
 * Patch an in-progress profile (one step's worth of answers). Status
 * transitions are NOT inferred — call `markCompleted` explicitly when the
 * quiz finishes.
 */
export async function updateStyleProfile(
  profileId: string,
  patch: StyleProfileInput
): Promise<void> {
  // Flatten `answers.*` so partial updates don't clobber sibling keys.
  // Firestore's `update()` does field-path merging for dot-notation paths.
  const flat: Record<string, unknown> = {};
  if (patch.styleBucket !== undefined) flat.styleBucket = patch.styleBucket;
  if (patch.answers) {
    for (const [k, v] of Object.entries(patch.answers)) {
      flat[`answers.${k}`] = v;
    }
  }
  if (patch.utm) flat.utm = patch.utm;
  if (patch.status !== undefined) flat.status = patch.status;
  if (patch.email !== undefined) {
    flat.email = patch.email ? normalizeEmail(patch.email) : null;
  }
  if (patch.emailCaptured !== undefined) flat.emailCaptured = patch.emailCaptured;
  if (patch.consent !== undefined) flat.consent = patch.consent;
  flat.updatedAt = FieldValue.serverTimestamp();

  await ref(profileId).update(flat);
}

/**
 * Mark a profile completed and capture the email + consent in one transaction.
 * Idempotent: re-calling is safe.
 */
export async function markProfileCompleted(args: {
  profileId: string;
  email: string;
  consent: boolean;
}): Promise<StyleProfileDoc | null> {
  const email = normalizeEmail(args.email);
  if (!email) throw new Error("invalid email");

  const docRef = ref(args.profileId);
  await docRef.update({
    status: "completed" as ProfileStatus,
    email,
    emailCaptured: true,
    consent: args.consent,
    updatedAt: FieldValue.serverTimestamp(),
  });

  const snap = await docRef.get();
  return snap.exists ? (snap.data() as StyleProfileDoc) : null;
}

/**
 * Called by the Shopify orders/paid webhook. Matches by lowercase email,
 * flips matching profiles to `converted`, stamps the order id + convertedAt.
 *
 * Returns the list of converted profile ids (callers use this to halt the
 * nurture sequence in the existing email_sequences engine).
 */
export async function markProfilesConvertedByEmail(args: {
  email: string;
  shopifyOrderId: string;
}): Promise<string[]> {
  const email = normalizeEmail(args.email);
  if (!email) return [];

  const snap = await adminDb
    .collection(COLLECTION)
    .where("email", "==", email)
    .where("status", "in", ["completed", "started", "abandoned"])
    .get();

  if (snap.empty) return [];

  const now = FieldValue.serverTimestamp();
  const batch = adminDb.batch();
  const ids: string[] = [];
  for (const d of snap.docs) {
    ids.push(d.id);
    batch.update(d.ref, {
      status: "converted" as ProfileStatus,
      shopifyOrderId: args.shopifyOrderId,
      convertedAt: now,
      updatedAt: now,
    });
  }
  await batch.commit();
  return ids;
}

export async function getStyleProfile(
  profileId: string
): Promise<StyleProfileDoc | null> {
  const snap = await ref(profileId).get();
  if (!snap.exists) return null;
  return snap.data() as StyleProfileDoc;
}

/**
 * Used by the abandon-quiz cron. Finds profiles where email was captured but
 * the quiz wasn't completed within `staleMs`, and we haven't already nudged.
 */
export async function findAbandonNudgeCandidates(args: {
  staleMs: number;
  limit: number;
}): Promise<StyleProfileDoc[]> {
  const cutoff = Timestamp.fromMillis(Date.now() - args.staleMs);
  const snap = await adminDb
    .collection(COLLECTION)
    .where("status", "==", "started")
    .where("abandonNudgeSentAt", "==", null)
    .where("updatedAt", "<=", cutoff)
    .limit(args.limit)
    .get();
  return snap.docs
    .map((d) => d.data() as StyleProfileDoc)
    .filter((d) => d.emailCaptured && d.email);
}

export async function recordAbandonNudge(profileId: string): Promise<void> {
  await ref(profileId).update({
    abandonNudgeSentAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });
}
