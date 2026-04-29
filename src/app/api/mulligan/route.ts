import { NextRequest, NextResponse } from "next/server";
import { Timestamp } from "firebase-admin/firestore";
import { adminDb } from "@/lib/firebase-admin";

const VALID_CHOICES = new Set(["member", "access", "not_now"]);

function normalizeString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export async function POST(request: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const email = normalizeString(body.email).toLowerCase();
  const firstName = normalizeString(body.first_name);
  const lastName = normalizeString(body.last_name);
  const reactivationChoice = normalizeString(body.reactivation_choice);

  if (!isValidEmail(email)) {
    return NextResponse.json({ error: "Valid email is required" }, { status: 400 });
  }

  if (!firstName || !lastName) {
    return NextResponse.json({ error: "First and last name are required" }, { status: 400 });
  }

  if (!VALID_CHOICES.has(reactivationChoice)) {
    return NextResponse.json({ error: "A re-activation choice is required" }, { status: 400 });
  }

  const fit = (body.fit ?? {}) as Record<string, unknown>;
  const style = (body.style ?? {}) as Record<string, unknown>;

  const status =
    reactivationChoice === "not_now" ? "declined" : "pending_reactivation";

  await adminDb
    .collection("mulligan_submissions")
    .doc(email)
    .set(
      {
        email,
        first_name: firstName,
        last_name: lastName,
        gender: normalizeString(body.gender),
        fit: {
          shirt_size: normalizeString(fit.shirt_size),
          glove_hand: normalizeString(fit.glove_hand),
          glove_size: normalizeString(fit.glove_size),
          waist_size: normalizeString(fit.waist_size),
          pants_inseam: normalizeString(fit.pants_inseam),
          shorts_inseam: normalizeString(fit.shorts_inseam),
          shoe_size: normalizeString(fit.shoe_size),
        },
        style: {
          vibe: normalizeString(style.vibe),
          color_preference: normalizeString(style.color_preference),
          putter_type: normalizeString(style.putter_type),
          brand_interest: normalizeStringArray(style.brand_interest),
        },
        reactivation_choice: reactivationChoice,
        status,
        submitted_at: Timestamp.now(),
        source: normalizeString(body.source) || "mulligan",
      },
      { merge: true }
    );

  return NextResponse.json({ ok: true });
}
