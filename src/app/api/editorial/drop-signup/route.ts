/**
 * POST /api/editorial/drop-signup
 *
 * Public browser-callable endpoint for the "Never miss a drop" floating
 * footer on /lp/editorial. Writes the email into a Firestore collection
 * (`editorial_drop_list`) with dedupe on lowercased email, and fires a
 * PostHog `email_submitted` event so it flows into the daily A/B rollup.
 *
 * Deliberately permissive: no captcha, no gate. If someone hammers it,
 * the dedupe upsert makes it a no-op and the honeypot field filters bots.
 */
import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { FieldValue } from "firebase-admin/firestore";
import { adminDb } from "@/lib/firebase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const COLLECTION = "editorial_drop_list";
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function firePostHog(
  email: string,
  variant: string | null,
  distinctId: string,
) {
  const apiKey = process.env.NEXT_PUBLIC_POSTHOG_KEY || process.env.POSTHOG_KEY;
  const host =
    process.env.NEXT_PUBLIC_POSTHOG_HOST ||
    process.env.POSTHOG_HOST ||
    "https://us.i.posthog.com";
  if (!apiKey) return;
  try {
    await fetch(`${host}/i/v0/e/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: apiKey,
        event: "email_submitted",
        distinct_id: distinctId,
        properties: {
          $lib: "server",
          source: "editorial-drop-bar",
          email,
          "homepage-lp": variant ?? undefined,
        },
      }),
      // Fire-and-forget — don't block the response.
      cache: "no-store",
    });
  } catch {
    /* swallow */
  }
}

export async function POST(req: Request) {
  let body: {
    email?: string;
    hp?: string;
    variant?: string | null;
    distinctId?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  // Honeypot: bots that fill every input trip this. Return 200 to keep the
  // page happy but do nothing.
  if (body.hp && body.hp.length > 0) {
    return NextResponse.json({ ok: true, skipped: true });
  }

  const email = body.email?.trim().toLowerCase();
  if (!email || !EMAIL_RE.test(email)) {
    return NextResponse.json({ error: "invalid_email" }, { status: 400 });
  }

  const variant =
    typeof body.variant === "string" && body.variant.length < 40
      ? body.variant
      : null;
  const distinctId =
    typeof body.distinctId === "string" && body.distinctId.length < 200
      ? body.distinctId
      : email;

  const hdrs = await headers();
  const ip =
    hdrs.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    hdrs.get("x-real-ip") ||
    null;
  const userAgent = hdrs.get("user-agent") ?? null;
  const referer = hdrs.get("referer") ?? null;

  try {
    // Doc id = lowercased email. Merge upsert dedupes silently.
    const docId = email.replace(/[^a-z0-9@._-]+/g, "_");
    await adminDb
      .collection(COLLECTION)
      .doc(docId)
      .set(
        {
          email,
          source: "editorial-drop-bar",
          variant: variant ?? null,
          ip,
          userAgent,
          referer,
          firstSeenAt: FieldValue.serverTimestamp(),
          lastSeenAt: FieldValue.serverTimestamp(),
          submissionCount: FieldValue.increment(1),
        },
        { merge: true },
      );
  } catch (err) {
    console.error("[drop-signup] firestore write failed", err);
    return NextResponse.json({ error: "write_failed" }, { status: 500 });
  }

  // Fire PostHog after the write so a failed event doesn't lose the email.
  await firePostHog(email, variant, distinctId);

  return NextResponse.json({ ok: true });
}
