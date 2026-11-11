/**
 * /gift-continue/[token]
 *
 * Gift a Season: the continue-as-member offer the recipient gets when their
 * final prepaid Reserve is on its way. Same random sizing token as auth.
 * Starts a regular quarterly Reserve Member checkout ($250 per season).
 */

import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getGiftOrderByToken } from "@/lib/gifts/giftOrder";
import GiftContinueClient from "./GiftContinueClient";

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
  return (
    <GiftContinueClient
      giftOrderId={id}
      recipientFirstName={data.recipient_first_name}
      recipientEmail={data.recipient_email}
      purchaserFirstName={data.purchaser_first_name}
      seasonsTotal={data.seasons_total ?? 1}
      alreadyMember={!!data.converted_at}
    />
  );
}
