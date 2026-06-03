/**
 * SSR Reveal page: /lp/reserve/reveal/{profileId}
 *
 * The middle-of-funnel destination after the visitor completes the style quiz.
 * Renders the personalized edit (2 apparel + 2 accessories + rangefinder gift)
 * pulled live from Shopify, with the $300+ value math and a single primary
 * CTA → Shopify membership checkout (with quiz answers attached as line
 * item properties).
 *
 * Gating:
 *   - 404 if the profileId doesn't exist in Firestore.
 *   - Renders an "already a member" friendly state if the profile was already
 *     converted (Shopify orders-paid webhook had already matched the email).
 */

import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getStyleProfile } from "@/lib/styleProfiles/admin";
import {
  buildRevealEdit,
  formatCentsUSD,
  type ReserveProductCard,
  type RevealEdit,
} from "@/lib/styleProfiles/reserveProducts";
import {
  STYLE_BUCKET_LABELS,
  STYLE_BUCKET_VOICE,
  type StyleBucket,
} from "@/lib/styleProfiles/types";
import { ReserveCheckoutCTA, type QuizLineItemPropsInput } from "./ReserveCheckoutCTA";
import { RevealPageView } from "./RevealPageView";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const metadata: Metadata = {
  title: "Your Reserve edit — Mully",
  description:
    "A quarterly golf apparel curation tailored to your style. Welcome-gift rangefinder included.",
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
  const voice = STYLE_BUCKET_VOICE[bucket];
  const bucketLabel = STYLE_BUCKET_LABELS[bucket];

  let edit: RevealEdit;
  try {
    edit = await buildRevealEdit({ profileId, styleBucket: bucket });
  } catch (err) {
    console.error("[reveal] buildRevealEdit failed", err);
    edit = {
      apparel: [],
      accessories: [],
      rangefinder: null,
      totalRetailCents: 0,
      reservePriceCents: 25000,
      savingsCents: 0,
    };
  }

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

  return (
    <main className="min-h-screen bg-bone text-charcoal">
      <RevealPageView profileId={profileId} bucket={bucket} />

      <section className="mx-auto max-w-4xl px-4 pb-10 pt-12 sm:px-6 sm:pt-20">
        <p className="mb-3 text-[11px] uppercase tracking-[0.25em] text-ember/85">
          {bucketLabel} · Your Reserve edit
        </p>
        <h1 className="font-serif text-3xl text-forest leading-[1.1] sm:text-5xl">
          {voice.headline}
        </h1>
        <p className="mt-4 max-w-2xl text-base text-charcoal/75 sm:text-lg">
          {voice.oneLiner}
        </p>
      </section>

      {alreadyConverted ? (
        <ConvertedState />
      ) : (
        <>
          <EditGrid edit={edit} />
          <ValueBlock edit={edit} />
          <CheckoutBlock
            profileId={profileId}
            bucket={bucket}
            quizLineItemProps={quizLineItemProps}
          />
          <ProofBlock />
        </>
      )}
    </main>
  );
}

// ─── Sections ────────────────────────────────────────────────────────────────

function EditGrid({ edit }: { edit: RevealEdit }) {
  const apparel = edit.apparel;
  const accessories = edit.accessories;
  const rangefinder = edit.rangefinder;

  return (
    <section className="mx-auto max-w-6xl px-4 pb-8 sm:px-6">
      {apparel.length + accessories.length === 0 && (
        <div className="rounded-lg border border-forest/15 bg-bone-dark/40 p-8 text-center text-charcoal/70">
          Your edit is being prepared. Refresh in a moment.
        </div>
      )}

      {apparel.length > 0 && (
        <SubBlock title="Apparel" subtitle="Two pieces from this quarter's drop.">
          <ProductRow products={apparel} />
        </SubBlock>
      )}

      {accessories.length > 0 && (
        <SubBlock title="Accessories" subtitle="Built to live in your bag.">
          <ProductRow products={accessories} />
        </SubBlock>
      )}

      {rangefinder && (
        <SubBlock
          title="Welcome gift"
          subtitle="Yours to keep. Even if you cancel after the first quarter."
        >
          <ProductRow products={[rangefinder]} highlight />
        </SubBlock>
      )}
    </section>
  );
}

function SubBlock({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-12">
      <div className="mb-4 flex items-baseline justify-between gap-4">
        <h2 className="font-serif text-xl text-forest sm:text-2xl">{title}</h2>
        <p className="text-xs text-charcoal/65 sm:text-sm">{subtitle}</p>
      </div>
      {children}
    </div>
  );
}

function ProductRow({
  products,
  highlight,
}: {
  products: ReserveProductCard[];
  highlight?: boolean;
}) {
  if (products.length === 0) return null;
  return (
    <div
      className={`grid gap-4 ${
        products.length === 1 ? "sm:grid-cols-1" : "sm:grid-cols-2"
      }`}
    >
      {products.map((p) => (
        <ProductCard key={p.id} product={p} highlight={highlight} />
      ))}
    </div>
  );
}

function ProductCard({
  product,
  highlight,
}: {
  product: ReserveProductCard;
  highlight?: boolean;
}) {
  return (
    <article
      className={[
        "overflow-hidden rounded-lg border bg-bone",
        highlight
          ? "border-ember/40 shadow-[0_4px_24px_-12px_rgba(212,119,44,0.35)]"
          : "border-forest/15",
      ].join(" ")}
    >
      <div className="relative aspect-square w-full bg-bone-dark/40">
        {product.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={product.imageUrl}
            alt={product.imageAlt ?? product.title}
            className="h-full w-full object-cover"
            loading="lazy"
          />
        ) : null}
      </div>
      <div className="px-5 py-4">
        <div className="text-[10px] uppercase tracking-[0.2em] text-ember/85">
          {product.vendor ?? product.productType ?? "Mully"}
        </div>
        <div className="mt-1 line-clamp-2 text-sm font-medium text-forest sm:text-base">
          {product.title}
        </div>
        <div className="mt-2 flex items-baseline gap-2">
          <span className="text-sm font-medium text-charcoal">
            {product.priceDisplay}
          </span>
          {product.compareAtDisplay && (
            <span className="text-xs text-charcoal/45 line-through">
              {product.compareAtDisplay}
            </span>
          )}
          {highlight && (
            <span className="ml-auto rounded-full bg-ember/15 px-2 py-0.5 text-[10px] uppercase tracking-[0.18em] text-ember">
              Gift
            </span>
          )}
        </div>
      </div>
    </article>
  );
}

function ValueBlock({ edit }: { edit: RevealEdit }) {
  if (edit.totalRetailCents === 0) return null;
  return (
    <section className="mx-auto max-w-4xl px-4 pb-12 sm:px-6">
      <div className="rounded-lg border border-forest/15 bg-bone-dark/40 p-6 sm:p-8">
        <div className="grid items-baseline gap-4 sm:grid-cols-3">
          <div>
            <div className="text-[10px] uppercase tracking-[0.22em] text-charcoal/60">
              Retail value
            </div>
            <div className="mt-1 font-serif text-3xl text-forest">
              {formatCentsUSD(edit.totalRetailCents)}+
            </div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-[0.22em] text-charcoal/60">
              You pay
            </div>
            <div className="mt-1 font-serif text-3xl text-forest">
              {formatCentsUSD(edit.reservePriceCents)}
            </div>
            <div className="text-xs text-charcoal/60">/ quarter</div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-[0.22em] text-charcoal/60">
              Plus
            </div>
            <div className="mt-1 text-base font-medium text-forest">
              Rangefinder welcome gift
            </div>
            <div className="text-xs text-charcoal/60">Yours to keep.</div>
          </div>
        </div>
      </div>
    </section>
  );
}

function CheckoutBlock({
  profileId,
  bucket,
  quizLineItemProps,
}: {
  profileId: string;
  bucket: StyleBucket;
  quizLineItemProps: QuizLineItemPropsInput;
}) {
  return (
    <section className="mx-auto max-w-2xl px-4 pb-16 sm:px-6">
      <ReserveCheckoutCTA
        profileId={profileId}
        styleBucket={bucket}
        quizLineItemProps={quizLineItemProps}
      />
      <p className="mt-4 text-center text-xs text-charcoal/65">
        Your quiz answers travel with your order. Sizing confirmed after checkout. Free shipping. Cancel anytime after the first quarter.
      </p>
    </section>
  );
}

function ProofBlock() {
  return (
    <section className="mx-auto max-w-4xl border-t border-forest/15 px-4 py-16 sm:px-6">
      <div className="grid gap-8 sm:grid-cols-3 sm:gap-12">
        <Stat label="Renewal rate" value="96%" />
        <Stat label="Quarterly retail value" value="$300+" />
        <Stat label="Welcome gift" value="Yours to keep" small />
      </div>
    </section>
  );
}

function Stat({ label, value, small }: { label: string; value: string; small?: boolean }) {
  return (
    <div>
      <div
        className={
          small
            ? "font-serif text-xl text-forest"
            : "font-serif text-4xl text-forest"
        }
      >
        {value}
      </div>
      <div className="mt-1 text-[10px] uppercase tracking-[0.22em] text-charcoal/60">
        {label}
      </div>
    </div>
  );
}

function ConvertedState() {
  return (
    <section className="mx-auto max-w-2xl px-4 pb-24 sm:px-6">
      <div className="rounded-lg border border-forest/30 bg-forest/5 p-8 text-center">
        <div className="text-[11px] uppercase tracking-[0.22em] text-forest/80">
          You're in
        </div>
        <h2 className="mt-2 font-serif text-2xl text-forest">
          Looks like you've already joined Reserve.
        </h2>
        <p className="mt-3 text-sm text-charcoal/75">
          Check your inbox for the next steps. If you don't see anything, reply to drew@mymully.com
          and I'll sort it out personally.
        </p>
      </div>
    </section>
  );
}
