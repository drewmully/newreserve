import { NextRequest, NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { adminDb } from "@/lib/firebase-admin";
import { captureSyncFields, scheduleKlaviyoSync, sha } from "@/lib/klaviyo/syncState";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const str = (v: unknown, max = 200) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);

/**
 * Back-in-stock waitlist capture. Stores the request in Firestore
 * `back_in_stock_requests` (one doc per email + product + variant), then syncs
 * the shopper to Klaviyo as a contact with a "Mully Site Signup" event in
 * after(). This is a transactional request: it never subscribes anyone to
 * marketing. The client treats any non-200 as a soft success.
 */
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      email?: string;
      productSlug?: string;
      productName?: string;
      variantId?: string;
      size?: string;
    };

    if (!body.email || !body.productSlug) {
      return NextResponse.json(
        { ok: false, error: "missing_fields" },
        { status: 400 }
      );
    }

    const email = String(body.email).trim().toLowerCase();
    if (email.length > 254 || !EMAIL_RE.test(email)) {
      return NextResponse.json({ ok: false, error: "missing_fields" }, { status: 400 });
    }
    const productSlug = str(body.productSlug);
    const variantId = str(body.variantId);
    const id = sha(`${email}|${productSlug}|${variantId ?? ""}`).slice(0, 40);

    await adminDb.collection("back_in_stock_requests").doc(id).set(
      {
        email,
        productSlug,
        productName: str(body.productName),
        variantId,
        size: str(body.size, 40),
        createdAt: FieldValue.serverTimestamp(),
        notified: false,
        ...captureSyncFields("request"),
      },
      { merge: true },
    );
    scheduleKlaviyoSync("back_in_stock_requests", id, ["request"]);

    return NextResponse.json({ ok: true });
  } catch {
    // Never log the email or request body.
    console.error("[back-in-stock] save failed");
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
