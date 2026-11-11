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
  getGiftOrderById,
  getGiftOrderByToken,
  updateGiftOrderStatus,
} from "@/lib/gifts/giftOrder";
import {
  captureGiftSeasonEvent,
  formatSizingNote,
  giftEventProps,
  mirrorGiftSeasonToSupabase,
  prependOrderNote,
} from "@/lib/gifts/giftSeasonServer";

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

  const isSeason = found.data.gift_kind === "season";
  // Season gifts that already shipped box 1 keep their lifecycle status;
  // a sizing update only refreshes the sizing on file for the next box.
  const keepStatus =
    isSeason &&
    (found.data.status === "season_active" || found.data.status === "completed");
  await updateGiftOrderStatus(
    found.id,
    keepStatus ? found.data.status : "sizing_collected",
    {
      sizing,
      sizing_collected_at: found.data.sizing_collected_at ?? Date.now(),
    },
    keepStatus ? "recipient updated sizing" : "recipient submitted sizing"
  );

  if (isSeason) {
    // Put the sizing on the paid Shopify order so ops can style box 1
    // without opening admin/gifts. Best-effort.
    const fresh = await getGiftOrderById(found.id);
    await Promise.allSettled([
      prependOrderNote(found.id, formatSizingNote(sizing)).catch((err) =>
        console.error("[gifts/submit-sizing] order note failed:", err)
      ),
      fresh ? mirrorGiftSeasonToSupabase(found.id, fresh) : Promise.resolve(),
      captureGiftSeasonEvent("gift_season_sizing_submitted", found.data.recipient_email, {
        ...giftEventProps(found.id, found.data),
        update: keepStatus,
      }),
    ]);
  }

  return NextResponse.json({ ok: true });
}
