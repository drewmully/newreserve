/**
 * /gift-address/[token]: next-season address and sizes for a Gift a Season.
 * Token entropy is the auth, same as /gift-sizing and /gift-card. Linked from
 * the address request, purchaser reminder and season notice emails, and
 * from the gifter confirmation. ?by=p marks links sent to the purchaser.
 */

import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getGiftOrderByToken } from "@/lib/gifts/giftOrder";
import { seasonProgress } from "@/lib/gifts/giftSeason";
import { monthDay } from "@/lib/email/templates/giftSeasonEmails";
import GiftAddressClient from "./GiftAddressClient";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Your Mully Reserve gift",
  robots: { index: false, follow: false },
};

export default async function GiftAddressPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ by?: string }>;
}) {
  const { token } = await params;
  const { by } = await searchParams;
  const found = await getGiftOrderByToken(token);
  if (!found || found.data.gift_kind !== "season") notFound();
  const { data } = found;
  const p = seasonProgress(data);
  // The next season this page can still change (box 1 is the paid order and
  // is always in box_orders, so this is 2..N, or null when all are out).
  const nextSeason = p.nextBoxNumber && p.nextBoxNumber >= 2 ? p.nextBoxNumber : null;
  return (
    <GiftAddressClient
      token={token}
      recipientFirstName={data.recipient_first_name}
      purchaserFirstName={data.purchaser_first_name}
      seasonsTotal={p.seasonsTotal}
      nextSeason={nextSeason}
      nextDueLabel={p.nextBoxDueOn ? monthDay(p.nextBoxDueOn) : null}
      existingAddress={data.next_shipping_address ?? null}
      existingSizing={data.sizing}
      askEmail={!data.recipient_email}
      by={by === "p" ? "purchaser" : "recipient"}
    />
  );
}
