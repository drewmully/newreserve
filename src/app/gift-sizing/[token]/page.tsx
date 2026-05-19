/**
 * /gift-sizing/[token]
 *
 * The recipient lands here after clicking the "confirm your sizing" link in
 * the gift announcement email. We look up the gift_orders doc by token (no
 * login required \u2014 the random token is the auth) and render a short sizing
 * form. The submitted sizing is written back to the gift_orders doc and the
 * status flips to "sizing_collected".
 *
 * Public route \u2014 token entropy is the security boundary. If the token
 * doesn't resolve, we render a friendly 404-style message.
 */

import { notFound } from "next/navigation";
import { getGiftOrderByToken } from "@/lib/gifts/giftOrder";
import GiftSizingClient from "./GiftSizingClient";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ token: string }>;
}

export default async function GiftSizingPage({ params }: PageProps) {
  const { token } = await params;
  const found = await getGiftOrderByToken(token);
  if (!found) {
    notFound();
  }

  const { id, data } = found;
  const alreadySubmitted =
    data.status === "sizing_collected" ||
    data.status === "first_box_shipped" ||
    data.status === "completed";

  return (
    <GiftSizingClient
      orderId={id}
      token={token}
      recipientFirstName={data.recipient_first_name}
      purchaserFirstName={data.purchaser_first_name}
      giftMessage={data.gift_message}
      alreadySubmitted={alreadySubmitted}
      existingSizing={data.sizing}
    />
  );
}
