/**
 * POST /api/auth/check-email
 *
 * Checks whether a Firebase user exists for the given email.
 * Used by the home page EmailCTA to route new vs. existing users.
 *
 * Body: { email: string }
 * Response: { exists: boolean }
 *
 * No auth required — this is a public endpoint.
 * Rate-limited implicitly by Firebase Admin SDK.
 */

import { NextRequest, NextResponse } from "next/server";
import { adminAuth } from "@/lib/firebase-admin";

export async function POST(request: NextRequest) {
  let email: string;
  try {
    const body = await request.json() as { email?: unknown };
    if (!body.email || typeof body.email !== "string") {
      return NextResponse.json({ error: "Missing email" }, { status: 400 });
    }
    email = body.email.trim().toLowerCase();
  } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  try {
    await adminAuth.getUserByEmail(email);
    return NextResponse.json({ exists: true });
  } catch (err) {
    const code = (err as { code?: string })?.code;
    if (code === "auth/user-not-found") {
      return NextResponse.json({ exists: false });
    }
    console.error("[check-email] unexpected error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
