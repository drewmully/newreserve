/**
 * /gift-card/[token]: printable card for "I'll give it myself" season gifts.
 * Linked from the gifter's reveal email. Token entropy is the auth, same as
 * /gift-sizing/[token].
 */

import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getGiftOrderByToken } from "@/lib/gifts/giftOrder";
import GiftCardView from "./GiftCardView";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Your Mully Reserve gift card",
  robots: { index: false, follow: false },
};

interface PageProps {
  params: Promise<{ token: string }>;
}

function siteOrigin(): string {
  return process.env.NEXT_PUBLIC_SITE_URL ?? "https://mymully.com";
}

export default async function GiftCardPage({ params }: PageProps) {
  const { token } = await params;
  const found = await getGiftOrderByToken(token);
  if (!found || found.data.gift_kind !== "season") notFound();
  const { data } = found;
  return (
    <GiftCardView
      recipientFirstName={data.recipient_first_name}
      purchaserFirstName={data.purchaser_first_name}
      giftMessage={data.gift_message}
      seasonsTotal={data.seasons_total ?? 1}
      sizingUrl={`${siteOrigin()}/gift-sizing/${token}`}
    />
  );
}
