/**
 * /preview-fixtures/gift-season?view=sizing|sizing-done|continue|admin
 *
 * Preview and local QA only (404 in production). Renders the Gift a Season
 * recipient reveal, continue offer and admin season view with sample data,
 * because Vercel previews have no Firestore credentials. Nothing here reads
 * or writes real data.
 */

import { notFound } from "next/navigation";
import type { Metadata } from "next";
import GiftSizingClient from "@/app/gift-sizing/[token]/GiftSizingClient";
import GiftContinueClient from "@/app/gift-continue/[token]/GiftContinueClient";
import { GiftsTable, type GiftRow } from "@/app/admin/gifts/GiftsTable";
import { seasonProgress } from "@/lib/gifts/giftSeason";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { robots: { index: false, follow: false } };

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 11, 2, 15, 0);

function seasonRow(
  id: string,
  seasons: 1 | 2 | 4,
  price: number,
  shippedCount: number,
  orderedCount: number,
  extra: Partial<GiftRow> = {}
): GiftRow {
  const first = shippedCount > 0 ? NOW - 200 * DAY : null;
  const box_orders = Array.from({ length: orderedCount }, (_, i) => ({
    box_number: i + 1,
    shopify_order_id: i === 0 ? id : String(Number(id) + i * 111),
    shopify_order_name: i === 0 ? `#R${id.slice(-4)}` : `#R${Number(id.slice(-4)) + i * 111}`,
    created_at: (first ?? NOW - 3 * DAY) + i * 91 * DAY,
    due_on: i === 0 ? null : new Date((first ?? NOW) + i * 91 * DAY).toISOString().slice(0, 10),
    shipped_at: i < shippedCount ? (first ?? NOW) + i * 91 * DAY + 2 * DAY : null,
  }));
  const p = seasonProgress({ seasons_total: seasons, box_orders, first_box_shipped_at: first });
  return {
    shopify_order_id: id,
    shopify_order_number: `R${id.slice(-4)}`,
    purchaser_email: "gifter@example.com",
    purchaser_first_name: "Alex",
    recipient_email: "sam@example.com",
    recipient_first_name: "Sam",
    gift_message: "Happy holidays. See you on the first tee.",
    deliver_on: "2026-12-24",
    sizing_token: "fixture-token-not-real",
    total_price: price,
    currency: "USD",
    status: shippedCount === 0 ? "sizing_collected" : p.boxesRemaining === 0 ? "completed" : "season_active",
    created_at: NOW - 210 * DAY,
    updated_at: NOW,
    recipient_emailed_at: NOW - 205 * DAY,
    sizing_collected_at: NOW - 204 * DAY,
    first_box_shipped_at: first,
    completed_at: null,
    sizing: { shirt: "L", pant_waist: "34", shoe: "10.5", glove: "ML" },
    loop_subscription_id: null,
    last_error: null,
    gift_kind: "season",
    seasons_total: p.seasonsTotal,
    boxes_dispatched: p.boxesDispatched,
    boxes_shipped: p.boxesShipped,
    boxes_remaining: p.boxesRemaining,
    next_box_number: p.nextBoxNumber,
    next_box_due_on: p.nextBoxDueOn,
    box_orders,
    continue_offer_sent_at: null,
    converted_at: null,
    converted_order_id: null,
    ...extra,
  };
}

export default async function GiftSeasonFixturesPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string }>;
}) {
  if (process.env.VERCEL_ENV === "production") notFound();
  const { view = "sizing" } = await searchParams;

  if (view === "sizing" || view === "sizing-done") {
    return (
      <GiftSizingClient
        orderId="fixture"
        token="fixture-token-not-real"
        recipientFirstName="Sam"
        purchaserFirstName="Alex"
        giftMessage="Happy holidays. See you on the first tee."
        alreadySubmitted={view === "sizing-done"}
        existingSizing={null}
        seasonsTotal={4}
      />
    );
  }
  if (view === "continue") {
    return (
      <GiftContinueClient
        giftOrderId="fixture"
        recipientFirstName="Sam"
        recipientEmail="sam@example.com"
        purchaserFirstName="Alex"
        seasonsTotal={4}
        alreadyMember={false}
      />
    );
  }
  if (view === "admin") {
    const rows: GiftRow[] = [
      seasonRow("6100000000001", 4, 1000, 3, 4, { continue_offer_sent_at: NOW - 1 * DAY }),
      seasonRow("6100000000002", 2, 550, 1, 1),
      seasonRow("6100000000003", 1, 299, 0, 1),
    ];
    return (
      <div className="min-h-screen bg-cream">
        <div className="max-w-7xl mx-auto px-6 py-8">
          <h1 className="font-serif text-2xl text-obsidian mb-1">Gift Orders (fixture)</h1>
          <p className="text-xs text-charcoal/55 mb-5">Sample data. Preview only.</p>
          <GiftsTable orders={rows} initiallyExpanded="6100000000001" />
        </div>
      </div>
    );
  }
  notFound();
}
