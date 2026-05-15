const DEFAULT_DROP_DATE_ISO = "2026-05-15T21:00:00-04:00";

/* ─── Featured Drop (Drop 001) ─────────────────────────────────────
   The product featured in the homepage Drop Zone and on the Drops tab.
   When the next drop ships, swap the values below (or remove the
   product config to fall back to the generic "coming soon" copy).
   ─────────────────────────────────────────────────────────────── */
export interface FeaturedDrop {
  number: string;            // e.g. "Drop 001"
  slug: string;              // URL slug for /drops/<slug>
  productHandle: string;     // Shopify storefront handle
  productName: string;       // Display name for cards
  brand: string;             // Vendor / brand label
  headline: string;          // Short editorial line for the drop card
  subhead: string;           // One-line description shown beneath
  image: string;             // Primary card image URL
  retailPrice: number;       // Sticker price
  memberPrice: number;       // Reserve / member price (15% off retail)
  isLive: boolean;           // true once the drop is publicly buyable
  badge?: string;            // Optional pill label, e.g. "Tonight"
  podcast?: {
    title: string;           // Episode title
    youtubeId: string;       // YouTube video ID for embed
    blurb?: string;          // 1–2 sentence lead-in
  };
}

export const FEATURED_DROP: FeaturedDrop = {
  number: "Drop 001",
  slug: "001",
  productHandle: "morning-people-golforever-polo",
  productName: "Morning People Golforever Polo",
  brand: "Morning People",
  headline: "Morning People · Golforever Polo",
  subhead:
    "Our first member drop. Three colorways, limited inventory, Reserve pricing.",
  image:
    "https://cdn.shopify.com/s/files/1/0734/7879/9573/files/Charcoal_Studio_Front.jpg?v=1768163516",
  retailPrice: 75,
  memberPrice: 64,
  isLive: true,
  podcast: {
    title: "The story behind Morning People",
    youtubeId: "TrJzBWFgj34",
    blurb:
      "We sat down with the founders to talk fabric, fit, and why the Golforever Polo became their flagship.",
  },
};

function parseDate(value: string | undefined): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
}

export function getExclusiveDropDate(): Date {
  const configured =
    parseDate(process.env.NEXT_PUBLIC_EXCLUSIVE_DROP_DATE) ??
    parseDate(process.env.NEXT_PUBLIC_HOME_DROP_DATE) ??
    parseDate(DEFAULT_DROP_DATE_ISO);

  if (configured) return configured;
  return new Date(DEFAULT_DROP_DATE_ISO);
}

export function formatExclusiveDropLabel(date: Date): string {
  const formatted = new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: "America/New_York",
  }).format(date);

  return `${formatted} ET`;
}
