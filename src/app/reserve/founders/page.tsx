/**
 * /reserve/founders — Reserve Founders Shortlist v1 landing page.
 *
 * Server component. Reads `?t=<hmac>` once, validates it, and passes the
 * decoded payload (or `null` for token-less visitors) to the client island
 * that owns the counter polling + CTA wiring.
 *
 * Personalization tiers:
 *   - token + tier A/B  -> "VIP" copy, full $50 discount, hold-by-reply
 *   - token + tier C/D  -> "Founders" copy, full $50 discount, hold-by-reply
 *   - token + tier E    -> "Founders" copy, full $50 discount, hold-by-reply
 *   - no token / bad    -> public copy, NO discount, pay-now only
 */
import type { Metadata } from "next";
import FoundersLandingClient from "./FoundersLandingClient";
import {
  FOUNDERS_CAMPAIGN_ID,
  FOUNDERS_DISCOUNT_CODE,
  FOUNDERS_SHIP_DATE,
  FOUNDERS_TOTAL_SPOTS,
  verifyFoundersToken,
  type FoundersTokenPayload,
} from "@/lib/foundersCampaign";

export const metadata: Metadata = {
  title: "Reserve Founders Shortlist — Mully",
  description:
    "300 spots. One batch. Ships May 27. Lock in your founders pricing for the Reserve Box quarterly experience.",
  robots: { index: false, follow: false }, // shortlist-only, keep out of search
};

export const dynamic = "force-dynamic";

export default async function FoundersLandingPage({
  searchParams,
}: {
  searchParams: Promise<{ t?: string }>;
}) {
  const params = await searchParams;
  const tokenRaw = typeof params.t === "string" ? params.t : undefined;
  let invite: FoundersTokenPayload | null = null;
  if (tokenRaw) {
    invite = verifyFoundersToken(tokenRaw);
  }
  return (
    <FoundersLandingClient
      tokenRaw={tokenRaw ?? null}
      invite={invite}
      meta={{
        campaignId: FOUNDERS_CAMPAIGN_ID,
        totalSpots: FOUNDERS_TOTAL_SPOTS,
        deadline: FOUNDERS_SHIP_DATE,
        discountCode: FOUNDERS_DISCOUNT_CODE,
      }}
    />
  );
}
