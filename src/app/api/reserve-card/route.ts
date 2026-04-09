import { NextRequest, NextResponse } from "next/server";
import { Timestamp } from "firebase-admin/firestore";
import { adminDb } from "@/lib/firebase-admin";

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
  const selectedPlan = normalizeString(body.selected_plan);

  if (!isValidEmail(email)) {
    return NextResponse.json({ error: "Valid email is required" }, { status: 400 });
  }

  if (!selectedPlan) {
    return NextResponse.json({ error: "A membership plan is required" }, { status: 400 });
  }

  const fit = (body.fit ?? {}) as Record<string, unknown>;
  const style = (body.style ?? {}) as Record<string, unknown>;

  await adminDb
    .collection("reserve_card_submissions")
    .doc(email)
    .set(
      {
        email,
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
        selected_plan: selectedPlan,
        submitted_at: Timestamp.now(),
        source: normalizeString(body.source) || "reserve_card_qr",
      },
      { merge: true }
    );

  return NextResponse.json({ ok: true });
}
