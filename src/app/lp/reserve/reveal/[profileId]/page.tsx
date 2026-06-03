/**
 * SSR Reveal page: /lp/reserve/reveal/{profileId}
 *
 * The middle-of-funnel destination after the visitor completes the style quiz.
 * Renders the personalized edit (2 apparel + 2 accessories + rangefinder gift)
 * pulled live from Shopify, with the $300+ value math and a single primary
 * CTA → Shopify membership checkout.
 *
 * Gating:
 *   - 404 if the profileId doesn't exist in Firestore.
 *   - Renders an "already a member" friendly state if the profile was already
 *     converted (Shopify orders-paid webhook had already matched the email).
 *   - Anyone can hit the URL directly (it's a personalized page, not an
 *     auth-gated one) — but the content is built only from the profile's
 *     stored answers + Shopify catalog, so there's no PII leakage beyond
 *     what the visitor entered.
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
import { ReserveCheckoutCTA } from "./ReserveCheckoutCTA";
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

  return (
    <main className="min-h-screen bg-white text-zinc-900">
      <RevealPageView profileId={profileId} bucket={bucket} />

      <section className="mx-auto max-w-4xl px-4 pb-16 pt-12 sm:px-6 sm:pt-20">
        <p className="mb-3 text-xs uppercase tracking-[0.22em] text-zinc-500">
          {bucketLabel} · Your Reserve edit
        </p>
        <h1 className="text-3xl font-medium tracking-tight text-zinc-900 sm:text-5xl">
          {voice.headline}
        </h1>
        <p className="mt-4 max-w-2xl text-base text-zinc-600 sm:text-lg">
          {voice.oneLiner}
        </p>
      </section>

      {alreadyConverted ? (
        <ConvertedState />
      ) : (
        <>
          <EditGrid edit={edit} />
          <ValueBlock edit={edit} />
          <CheckoutBlock profileId={profileId} bucket={bucket} />
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
        <div className="rounded-2xl border border-zinc-200 bg-zinc-50 p-8 text-center text-zinc-600">
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
        <h2 className="text-xl font-medium tracking-tight text-zinc-900 sm:text-2xl">
          {title}
        </h2>
        <p className="text-sm text-zinc-500">{subtitle}</p>
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
        "overflow-hidden rounded-2xl border bg-white",
        highlight ? "border-amber-300 shadow-sm" : "border-zinc-200",
      ].join(" ")}
    >
      <div className="relative aspect-[4/5] w-full bg-zinc-100">
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
        <div className="text-xs uppercase tracking-wide text-zinc-500">
          {product.vendor ?? product.productType ?? "Mully"}
        </div>
        <div className="mt-1 line-clamp-2 text-base font-medium text-zinc-900">
          {product.title}
        </div>
        <div className="mt-2 flex items-baseline gap-2">
          <span className="text-sm font-medium text-zinc-900">
            {product.priceDisplay}
          </span>
          {product.compareAtDisplay && (
            <span className="text-xs text-zinc-400 line-through">
              {product.compareAtDisplay}
            </span>
          )}
          {highlight && (
            <span className="ml-auto rounded-full bg-amber-100 px-2 py-0.5 text-[10px] uppercase tracking-wide text-amber-800">
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
      <div className="rounded-2xl border border-zinc-200 bg-zinc-50 p-6 sm:p-8">
        <div className="grid items-baseline gap-4 sm:grid-cols-3">
          <div>
            <div className="text-xs uppercase tracking-[0.18em] text-zinc-500">
              Retail value
            </div>
            <div className="mt-1 text-3xl font-medium text-zinc-900">
              {formatCentsUSD(edit.totalRetailCents)}+
            </div>
          </div>
          <div>
            <div className="text-xs uppercase tracking-[0.18em] text-zinc-500">
              You pay
            </div>
            <div className="mt-1 text-3xl font-medium text-zinc-900">
              {formatCentsUSD(edit.reservePriceCents)}
            </div>
            <div className="text-xs text-zinc-500">/ quarter</div>
          </div>
          <div>
            <div className="text-xs uppercase tracking-[0.18em] text-zinc-500">
              Plus
            </div>
            <div className="mt-1 text-base font-medium text-zinc-900">
              Rangefinder welcome gift
            </div>
            <div className="text-xs text-zinc-500">Yours to keep.</div>
          </div>
        </div>
      </div>
    </section>
  );
}

function CheckoutBlock({
  profileId,
  bucket,
}: {
  profileId: string;
  bucket: StyleBucket;
}) {
  return (
    <section className="mx-auto max-w-2xl px-4 pb-16 sm:px-6">
      <ReserveCheckoutCTA profileId={profileId} styleBucket={bucket} />
      <p className="mt-4 text-center text-xs text-zinc-500">
        Sizing is confirmed after checkout. Free shipping. Cancel anytime after the first quarter.
      </p>
    </section>
  );
}

function ProofBlock() {
  return (
    <section className="mx-auto max-w-4xl border-t border-zinc-200 px-4 py-16 sm:px-6">
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
      <div className={small ? "text-xl font-medium text-zinc-900" : "text-4xl font-medium text-zinc-900"}>
        {value}
      </div>
      <div className="mt-1 text-xs uppercase tracking-[0.18em] text-zinc-500">{label}</div>
    </div>
  );
}

function ConvertedState() {
  return (
    <section className="mx-auto max-w-2xl px-4 pb-24 sm:px-6">
      <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-8 text-center">
        <div className="text-xs uppercase tracking-[0.22em] text-emerald-700">
          You're in
        </div>
        <h2 className="mt-2 text-2xl font-medium tracking-tight text-emerald-900">
          Looks like you've already joined Reserve.
        </h2>
        <p className="mt-3 text-sm text-emerald-900/80">
          Check your inbox for the next steps. If you don't see anything, reply to drew@mymully.com
          and I'll sort it out personally.
        </p>
      </div>
    </section>
  );
}
