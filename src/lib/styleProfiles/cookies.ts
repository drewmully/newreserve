/**
 * Cookie helpers for the pre-checkout style quiz.
 *
 * The `mully_quiz_anon` cookie identifies a visitor across the quiz steps and
 * any reloads BEFORE we have an email. Once the quiz is completed and the
 * email gate is passed, the profile is keyed by `profileId` (the Firestore
 * doc id) and the anon cookie is only kept for analytics correlation.
 *
 * Intentionally NOT HttpOnly so the client can read its own id for PostHog
 * event correlation. There is no auth value in this cookie — it's purely a
 * progressive-disclosure handle.
 */

import { randomUUID } from "crypto";
import type { NextRequest } from "next/server";
import type { NextResponse } from "next/server";

export const ANON_COOKIE = "mully_quiz_anon";
export const PROFILE_COOKIE = "mully_quiz_profile";

const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

/**
 * Read (or mint, in memory only — caller must `setAnonCookie` on the response)
 * the anonymous quiz id from the incoming request.
 */
export function readAnonId(req: NextRequest): { anonId: string; minted: boolean } {
  const existing = req.cookies.get(ANON_COOKIE)?.value;
  if (existing && existing.length > 8) {
    return { anonId: existing, minted: false };
  }
  return { anonId: randomUUID(), minted: true };
}

export function setAnonCookie(res: NextResponse, anonId: string): void {
  res.cookies.set({
    name: ANON_COOKIE,
    value: anonId,
    httpOnly: false,
    sameSite: "lax",
    secure: true,
    path: "/",
    maxAge: ONE_YEAR_SECONDS,
  });
}

export function setProfileCookie(res: NextResponse, profileId: string): void {
  res.cookies.set({
    name: PROFILE_COOKIE,
    value: profileId,
    httpOnly: false,
    sameSite: "lax",
    secure: true,
    path: "/",
    maxAge: ONE_YEAR_SECONDS,
  });
}

export function readProfileCookie(req: NextRequest): string | null {
  return req.cookies.get(PROFILE_COOKIE)?.value ?? null;
}
