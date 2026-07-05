/**
 * POST /api/auth/check-loop-status
 *
 * Called by the homepage EmailCTA / sticky bar when /api/auth/check-email
 * reports the email is NOT in Firebase Auth. Before assuming this is a new
 * signup, we ask Loop whether this email is already an ACTIVE paying
 * subscriber (very common for legacy Mullybox / Back 9 members whose
 * Loop subscription predates Firebase Auth adoption).
 *
 * If yes: provisions a Firebase user + Firestore doc with the correct tier,
 * emails a magic link, and returns `{ paid: true }` so the client can
 * route the visitor to a "check your inbox" screen instead of onboarding.
 *
 * If no: returns `{ paid: false }` and the client falls through to the
 * standard new-signup flow.
 *
 * Body: { email: string }
 * Response:
 *   { paid: true,  tier: "access" | "member", isLegacy: boolean,
 *                  magicLinkSent: boolean }
 *   { paid: false }
 *
 * No auth required — this is a public endpoint that mirrors the surface
 * area of /api/auth/check-email. Rate-limited implicitly by upstream
 * (Loop + Firebase Admin) APIs.
 */

import { NextRequest, NextResponse } from "next/server";
import { provisionPaidMemberFromLoop } from "@/app/api/_lib/provisionPaidMember";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(request: NextRequest) {
  let email: string;
  try {
    const body = (await request.json()) as { email?: unknown };
    if (typeof body.email !== "string") {
      return NextResponse.json({ error: "Missing email" }, { status: 400 });
    }
    email = body.email.trim().toLowerCase();
    if (!EMAIL_RE.test(email)) {
      return NextResponse.json({ error: "Invalid email" }, { status: 400 });
    }
  } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  const result = await provisionPaidMemberFromLoop(email, {
    source: "check_loop_status",
  });

  if (result.status === "provisioned") {
    return NextResponse.json({
      paid: true,
      tier: result.tier,
      isLegacy: result.isLegacy,
      magicLinkSent: result.magicLinkSent,
    });
  }

  if (result.status === "not_paid") {
    return NextResponse.json({ paid: false });
  }

  // Errors: don't block the user — treat as "not a paid member" so the
  // client can proceed with the standard signup flow. The error is logged
  // server-side inside provisionPaidMemberFromLoop.
  return NextResponse.json({ paid: false, degraded: true });
}
