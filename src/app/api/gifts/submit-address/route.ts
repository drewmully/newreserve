/**
 * POST /api/gifts/submit-address
 *
 * Gift a Season: save the next-season address and sizes from
 * /gift-address/[token]. Token entropy is the auth. Unblocks the next season
 * in season-dispatch once a valid address is on file. Firestore only; no
 * Shopify writes (orders already created keep their address).
 */

import { NextRequest, NextResponse } from "next/server";
import {
  getGiftOrderById,
  getGiftOrderByToken,
  patchGiftOrder,
  type GiftOrderDoc,
} from "@/lib/gifts/giftOrder";
import { seasonProgress, validateGiftAddress } from "@/lib/gifts/giftSeason";
import { isSizingComplete, missingSizing, sanitizeSizing } from "@/lib/gifts/giftSizing";
import {
  captureGiftSeasonEvent,
  giftEventProps,
  mirrorGiftSeasonToSupabase,
} from "@/lib/gifts/giftSeasonServer";

export async function POST(request: NextRequest) {
  let body: { token?: unknown; address?: unknown; sizing?: unknown; email?: unknown; by?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const token = typeof body.token === "string" ? body.token.trim() : "";
  if (!/^[A-Za-z0-9_-]{24,64}$/.test(token)) {
    return NextResponse.json({ error: "Invalid link" }, { status: 400 });
  }
  const v = validateGiftAddress(body.address);
  if (!v.ok) return NextResponse.json({ error: v.error }, { status: 400 });
  const sizing = sanitizeSizing(body.sizing);
  if (!isSizingComplete(sizing)) {
    return NextResponse.json({ error: `Pick a ${missingSizing(sizing)[0].toLowerCase()}.` }, { status: 400 });
  }
  const rawEmail = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const email = rawEmail && rawEmail.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(rawEmail) ? rawEmail : "";
  const by = body.by === "purchaser" ? "purchaser" : "recipient";

  const found = await getGiftOrderByToken(token);
  if (!found || found.data.gift_kind !== "season") {
    return NextResponse.json({ error: "Invalid or expired link" }, { status: 404 });
  }
  const { id, data } = found;
  const p = seasonProgress(data);
  if (p.seasonsTotal <= 1 || p.nextBoxNumber === null) {
    return NextResponse.json({ error: "Every season of this gift has shipped." }, { status: 409 });
  }

  const now = Date.now();
  const hadAddress = !!data.next_shipping_address;
  const patch: Partial<GiftOrderDoc> = {
    next_shipping_address: v.address,
    address_source: by,
    address_collected_at: now,
    sizing: { ...sizing } as Record<string, string>,
    sizing_updated_at: now,
    ...(data.sizing_collected_at ? {} : { sizing_collected_at: now }),
    // Never overwrite an email the gifter gave us.
    ...(!data.recipient_email && email ? { recipient_email: email } : {}),
    ...(data.last_error && /address/i.test(data.last_error) ? { last_error: null } : {}),
  };
  await patchGiftOrder(id, patch);
  const fresh = (await getGiftOrderById(id)) ?? { ...data, ...patch };
  await Promise.allSettled([
    mirrorGiftSeasonToSupabase(id, fresh),
    captureGiftSeasonEvent(
      hadAddress ? "gift_season_sizing_updated" : "gift_season_address_collected",
      fresh.recipient_email || data.purchaser_email,
      { ...giftEventProps(id, fresh), by, ship_mode: data.ship_mode ?? null, update: hadAddress }
    ),
  ]);
  return NextResponse.json({ ok: true });
}
