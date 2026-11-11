/**
 * /gift-continue/[token]
 *
 * Gift a Season: the continue-as-member offer the recipient gets before
 * their last prepaid Reserve. Same random sizing token as auth.
 * Starts a regular quarterly Reserve Member checkout ($250 per season).
 */

import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getGiftOrderByToken } from "@/lib/gifts/giftOrder";
import GiftContinueClient from "./GiftContinueClient";
import { giftContinueLead } from "@/lib/email/templates/giftRecipient";
import { boxDueOn, seasonProgress } from "@/lib/gifts/giftSeason";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { robots: { index: false, follow: false } };

interface PageProps {
  params: Promise<{ token: string }>;
}

export default async function GiftContinuePage({ params }: PageProps) {
  const { token } = await params;
  const found = await getGiftOrderByToken(token);
  if (!found || found.data.gift_kind !== "season") notFound();
  const { id, data } = found;
  const seasonsTotal = data.seasons_total ?? 1;
  const lead = giftContinueLead({
    seasonsTotal,
    purchaserFirstName: data.purchaser_first_name,
    finalDueOn: seasonsTotal > 1 ? boxDueOn(data.first_box_shipped_at, seasonsTotal) : null,
    finalShipped: seasonProgress(data).boxesShipped >= seasonsTotal,
  });
  return (
    <GiftContinueClient
      giftOrderId={id}
      recipientFirstName={data.recipient_first_name}
      recipientEmail={data.recipient_email}
      purchaserFirstName={data.purchaser_first_name}
      seasonsTotal={seasonsTotal}
      lead={lead}
      alreadyMember={!!data.converted_at}
    />
  );
}
