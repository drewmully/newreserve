/**
 * AI Sales Agents — scaffold (disabled by default).
 *
 * Enable by setting:  AI_SALES_AGENTS_ENABLED=true
 *
 * Firestore collections:
 *   ai_sales_profiles/{user_id}    — per-user sales profile & scoring
 *   ai_sales_signals/{signal_id}   — raw behavioral signals
 *
 * All exported functions are no-ops when the feature flag is off,
 * so callers do not need to check the flag themselves.
 */

import { adminDb } from "@/lib/firebase-admin";
import { FieldValue } from "firebase-admin/firestore";

const ENABLED = process.env.AI_SALES_AGENTS_ENABLED === "true";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface AISalesProfile {
  user_id: string;
  segments: string[];
  last_event: string | null;
  /** Propensity-to-buy score 0–100 */
  score: number;
  created_at: unknown;
  updated_at: unknown;
}

export interface AISalesSignal {
  signal_id: string;
  user_id: string;
  event_name: string;
  properties: Record<string, unknown>;
  created_at: unknown;
}

// ─── Profile ──────────────────────────────────────────────────────────────────

export async function upsertAISalesProfile(
  userId: string,
  data: Partial<
    Omit<AISalesProfile, "user_id" | "created_at" | "updated_at">
  >
): Promise<void> {
  if (!ENABLED) return;

  const ref = adminDb.collection("ai_sales_profiles").doc(userId);
  await ref.set(
    {
      user_id: userId,
      ...data,
      updated_at: FieldValue.serverTimestamp(),
    },
    { merge: true }
  );
}

export async function getAISalesProfile(
  userId: string
): Promise<AISalesProfile | null> {
  if (!ENABLED) return null;

  const snap = await adminDb
    .collection("ai_sales_profiles")
    .doc(userId)
    .get();

  return snap.exists ? (snap.data() as AISalesProfile) : null;
}

// ─── Signals ──────────────────────────────────────────────────────────────────

export async function recordAISalesSignal(
  signalId: string,
  signal: Omit<AISalesSignal, "signal_id" | "created_at">
): Promise<void> {
  if (!ENABLED) return;

  await adminDb.collection("ai_sales_signals").doc(signalId).set({
    signal_id: signalId,
    ...signal,
    created_at: FieldValue.serverTimestamp(),
  });
}
