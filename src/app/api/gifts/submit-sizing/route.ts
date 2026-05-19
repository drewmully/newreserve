/**
 * POST /api/gifts/submit-sizing
 *
 * Public route — the random sizing token from the recipient email is the auth.
 * Saves the recipient's sizing onto the gift_orders doc and flips status to
 * "sizing_collected".
 *
 * Body:
 *   { token: string, sizing: Record<string, string> }
 */

import { NextRequest, NextResponse } from "next/server";
import {
  getGiftOrderByToken,
  updateGiftOrderStatus,
} from "@/lib/gifts/giftOrder";

const ALLOWED_KEYS = new Set([
  "shirt",
  "waist",
  "inseam",
  "shoe",
  "glove_size",
  "glove_hand",
  "notes",
]);

const REQUIRED = ["shirt", "waist", "inseam", "shoe", "glove_size", "glove_hand"] as const;
const MAX_FIELD_LEN = 120;

function sanitize(input: unknown): Record<string, string> {
  if (typeof input !== "object" || !input) return {};
  const obj = input as Record<string, unknown>;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (!ALLOWED_KEYS.has(k)) continue;
    if (typeof v !== "string") continue;
    out[k] = v.slice(0, MAX_FIELD_LEN).trim();
  }
  return out;
}

export async function POST(request: NextRequest) {
  let body: { token?: string; sizing?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const token = typeof body.token === "string" ? body.token.trim() : "";
  if (!token) {
    return NextResponse.json({ error: "Missing token" }, { status: 400 });
  }

  const sizing = sanitize(body.sizing);
  for (const k of REQUIRED) {
    if (!sizing[k]) {
      return NextResponse.json(
        { error: `Missing required sizing field: ${k}` },
        { status: 400 }
      );
    }
  }

  const found = await getGiftOrderByToken(token);
  if (!found) {
    return NextResponse.json({ error: "Invalid or expired token" }, { status: 404 });
  }

  await updateGiftOrderStatus(
    found.id,
    "sizing_collected",
    {
      sizing,
      sizing_collected_at: Date.now(),
    },
    "recipient submitted sizing"
  );

  return NextResponse.json({ ok: true });
}
