/**
 * Server-side membership tier for return shipping (server-only).
 *
 * The tier used to come from the request body. Now it is only taken from
 * Firestore users/{uid}.tier for the bearer of a valid Firebase ID token,
 * and only when that account's email matches the order email. Anything
 * else (guest, bad token, different account, Firestore error) is "free".
 */
import type { NextRequest } from "next/server";
import { adminAuth, adminDb } from "@/lib/firebase-admin";
import { normalizeEmail } from "./eligibility";

export type ReturnTier = "free" | "access" | "member" | "black";

function normalizeTier(raw: unknown): ReturnTier {
  if (raw === "access" || raw === "member" || raw === "black") return raw;
  return "free";
}

export async function resolveReturnTier(request: NextRequest, orderEmail: string): Promise<ReturnTier> {
  const header = request.headers.get("authorization") ?? "";
  if (!header.startsWith("Bearer ")) return "free";
  const idToken = header.slice(7).trim();
  if (!idToken || idToken.length > 4096) return "free";
  try {
    const decoded = await adminAuth.verifyIdToken(idToken);
    const accountEmail = normalizeEmail(decoded.email);
    if (!accountEmail || accountEmail !== normalizeEmail(orderEmail)) return "free";
    const snap = await adminDb.collection("users").doc(decoded.uid).get();
    return normalizeTier(snap.exists ? snap.data()?.tier : undefined);
  } catch (err) {
    console.warn("[returns] tier lookup failed; using free tier", err instanceof Error ? err.message : err);
    return "free";
  }
}
