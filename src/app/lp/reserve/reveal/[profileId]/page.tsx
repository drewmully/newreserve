/**
 * SSR Reveal page: /lp/reserve/reveal/{profileId}
 *
 * The middle-of-funnel destination after the visitor completes the style quiz.
 * Loads the profile, builds the quiz line-item-property payload from the
 * stored answers, and hands off to the client RevealBrick component (a
 * three-tier picker as of 2026-09-18).
 *
 * Gating:
 *   - 404 if the profileId doesn't exist in Firestore.
 *   - RevealBrick shows an "already a member" state if the profile was
 *     already converted (matched by the Shopify orders-paid webhook).
 */

import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getStyleProfile } from "@/lib/styleProfiles/admin";
import { getFirstNameForProfile } from "@/lib/email/sequences";
import { RevealBrick } from "./RevealBrick";
import {
  STYLE_BUCKET_LABELS,
  type StyleBucket,
} from "@/lib/styleProfiles/types";
import type { QuizLineItemPropsInput } from "./ReserveCheckoutCTA";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const metadata: Metadata = {
  title: "Your Reserve edit — Mully",
  description:
    "A quarterly golf apparel curation tailored to your style. $300+ retail, sourced from the brands, for $250 per quarter.",
  robots: { index: false, follow: false }, // personalized — keep out of indexes
};

interface PageProps {
  params: Promise<{ profileId: string }>;
}

const FIT_LABEL: Record<string, string> = {
  tailored: "Tailored",
  regular: "Regular",
  relaxed: "Relaxed",
};

const CATEGORY_LABEL: Record<string, string> = {
  polos: "Polos & shirts",
  layers: "Layers & 1/4 zips",
  shorts_pants: "Shorts & pants",
  outerwear: "Outerwear",
  accessories: "Hats & accessories",
};

const PLAY_LABEL: Record<string, string> = {
  weekly_plus: "Multiple times a week",
  weekly: "About once a week",
  monthly: "A few times a month",
  occasional: "Now and then",
};

export default async function ReserveRevealPage({ params }: PageProps) {
  const { profileId } = await params;

  const profile = await getStyleProfile(profileId);
  if (!profile) notFound();

  const bucket: StyleBucket = (profile.styleBucket ?? "classic") as StyleBucket;
  const alreadyConverted = profile.status === "converted";

  // Build the LIP payload from the profile's stored answers. These flow into
  // Shopify as line item properties on the Reserve subscription line.
  const quizLineItemProps: QuizLineItemPropsInput = {
    styleBucket: profile.styleBucket,
    styleLabel: profile.styleBucket ? STYLE_BUCKET_LABELS[profile.styleBucket] : null,
    categoryPrefs: (profile.answers?.categoryPrefs ?? []).map(
      (c) => CATEGORY_LABEL[c] ?? c
    ),
    fit: profile.answers?.fit ? FIT_LABEL[profile.answers.fit] ?? profile.answers.fit : null,
    topSize: profile.answers?.topSize ?? null,
    bottomSize: profile.answers?.bottomSize ?? null,
    favoriteBrands: profile.answers?.favoriteBrands ?? [],
    playFrequency: profile.answers?.playFrequency
      ? PLAY_LABEL[profile.answers.playFrequency] ?? profile.answers.playFrequency
      : null,
  };

  const firstName = await getFirstNameForProfile(profileId);
  return (
    <RevealBrick
      profileId={profileId}
      bucket={bucket}
      quizLineItemProps={quizLineItemProps}
      alreadyConverted={alreadyConverted}
      firstName={firstName ?? undefined}
    />
  );
}
