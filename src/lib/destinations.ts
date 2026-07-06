/**
 * Editorial destinations — hardcoded, NOT Shopify products.
 *
 * WHY THIS FILE EXISTS
 * ────────────────────
 * Destination profiles (Bandon, Pebble, St Andrews, etc.) are editorial
 * content, not merchandise. They should never live in the Shopify catalog:
 * we don't sell them, we don't ship them, they have no price and no
 * variants. Modeling them as products polluted the catalog with 8 fake
 * SKUs that showed up in inventory, analytics, and search.
 *
 * Rule: only real, sellable merchandise lives in Shopify. Amazon-affiliate
 * items live in `mully100.ts`. Destinations live here. Both are merged into
 * the editorial feed at render time via `getEditorialFeed()`.
 *
 * Each destination renders as an `EditorialProduct` with:
 *   - editorialCategory = "destinations"
 *   - destinationUrl    = outbound booking site
 *   - price / reservePrice = 0 (destination cards suppress the price line)
 *   - variantId = undefined (never adds to cart)
 *
 * Adding or editing a destination? Edit this file, commit, deploy.
 * The `mully-editorial-system` skill covers voice/tone.
 */

import type { EditorialProduct } from "@/lib/shopifyEditorial";

export interface DestinationEntry {
  slug: string;
  name: string;
  /** Region label — shown under the card name where price would be. */
  location: string;
  /** Outbound booking URL (opens in new tab). */
  bookingUrl: string;
  /** Hero image URL (external CDN allowed; hosts are whitelisted in next.config.ts). */
  heroImageUrl: string;
  /** One-sentence editorial hook shown on the card. */
  editorialHeadline: string;
  /** Longer editorial body (multi-line, plain text). */
  editorialBody: string;
  /** ISO 8601. Drives feed sort order. Older destinations should have older dates. */
  publishedAt: string;
}

/**
 * ORDER: newest first here maps to newest-first in the feed.
 * When adding a new destination, put it at the top with a fresh ISO date.
 */
export const DESTINATIONS: DestinationEntry[] = [
  {
    slug: "pebble-beach",
    name: "Pebble Beach",
    location: "Pebble Beach, California",
    bookingUrl: "https://www.pebblebeach.com/golf/pebble-beach-golf-links/",
    heroImageUrl:
      "https://evanschillerphotography.com/cdn/shop/products/17th-_-18th-Holes_-Pebble-Beach-Golf-Links_DJI_0771_1080x.jpg?v=1632409036",
    editorialHeadline:
      "Golf's most photographed mile of coastline still costs a small fortune to walk.",
    editorialBody:
      "A round at Pebble Beach Golf Links runs $675 for resort guests, before the cart fee or a $155 caddie tip enters the conversation. The course opened in 1919 on land nobody wanted for anything else, a rocky stretch of the Monterey Peninsula that turned out to be the best real estate in golf.\n\nSix U.S. Opens have been decided on this ground, most memorably by Tiger Woods in 2000, and the 8th, 9th, and 10th holes still run along cliffs with no fence between the fairway and the Pacific. It is the round every serious golfer books once, prices out twice, and books anyway.",
    publishedAt: "2026-07-06T10:00:00Z",
  },
  {
    slug: "kiawah-ocean-course",
    name: "Kiawah Island (The Ocean Course)",
    location: "Kiawah Island, South Carolina",
    bookingUrl: "https://kiawahresort.com/golf/the-ocean-course/",
    heroImageUrl:
      "https://kiawahresort.com/wp-content/uploads/2024/10/The-Ocean-Course-9-Kiawah-1-1200x800.jpg",
    editorialHeadline:
      "Pete Dye pointed every hole at the ocean and let the wind do the rest.",
    editorialBody:
      "Pete and Alice Dye opened the Ocean Course in 1991, six weeks before it hosted the Ryder Cup and turned into the \"War by the Shore.\" Every hole faces the Atlantic, a routing decision that makes the wind the real opponent on a course already stretched to 7,876 yards from the tips.\n\nIt has since hosted two PGA Championships, in 2012 and 2021, making it one of only four courses to hold every major run by the PGA of America. Expect to pay north of $600 a round in peak season, caddie and gratuity extra.",
    publishedAt: "2026-07-06T09:45:00Z",
  },
  {
    slug: "pinehurst-no-2",
    name: "Pinehurst No. 2",
    location: "Pinehurst, North Carolina",
    bookingUrl: "https://www.pinehurst.com/golf/courses/no-2/",
    heroImageUrl:
      "https://cdn-ilbbpdb.nitrocdn.com/ZPvHxDAnfjiOCTRKZzZlFwdZrjJUwSbC/assets/images/optimized/rev-ea61c83/www.pinehurst.com/wp-content/uploads/2023/01/thistledhu_aerial.jpg",
    editorialHeadline:
      "Donald Ross spent forty years perfecting the greens nobody else could copy.",
    editorialBody:
      "Pinehurst No. 2 opened in 1907, though Donald Ross kept reshaping it for another three decades, finally settling on today's routing in 1935. The turtleback greens he built from Sandhills clay have humbled U.S. Open fields four times, most recently in 2024, and the course has hosted more single golf championships than any other in America.\n\nThere's no water in play and barely any rough, just native sandscape and wiregrass that punishes anyone who misses a fairway by more than a few steps. This is the Cradle of American Golf, and it plays like it was designed to test patience as much as talent.",
    publishedAt: "2026-07-06T09:30:00Z",
  },
  {
    slug: "st-andrews-old-course",
    name: "St Andrews (The Old Course)",
    location: "St Andrews, Fife, Scotland",
    bookingUrl: "https://www.standrews.com",
    heroImageUrl:
      "https://www.haversham.com/wp-content/uploads/bb-plugin/cache/st-andrews-old-course-tee-times-hero-scaled-landscape-5ded91cdface8889acb8325dbd8aeded-kwxehruaoqyj.jpg",
    editorialHeadline:
      "The Old Course has no owner's manual because golfers wrote the rules by playing it.",
    editorialBody:
      "St Andrews Links runs seven courses on the same stretch of coastline, but the Old Course is the one that matters, the layout where golf as we know it took shape over public common ground centuries before anyone thought to design a course on purpose. A single round costs around £340 in high season, booked a year out through the ballot or advance application, though the Links Trust also runs a discounted rate near £60 for those willing to gamble on the daily lottery.\n\nThe Swilcan Bridge sits on the 18th, a stone crossing older than the United States, and every player who walks it joins a list that includes Old Tom Morris and every Open champion since. No architect is credited because the land and centuries of golfers built it together.",
    publishedAt: "2026-07-06T09:15:00Z",
  },
  {
    slug: "sand-valley",
    name: "Sand Valley",
    location: "Nekoosa, Wisconsin",
    bookingUrl: "https://www.sandvalley.com",
    heroImageUrl:
      "https://cdn.shopify.com/s/files/1/0561/0530/4256/files/sand-valley-hero.webp?v=1783292782",
    editorialHeadline:
      "Mike Keiser's Midwest answer to Bandon. Six courses across a Wisconsin sandbelt, firm-and-fast, and no rider carts.",
    editorialBody:
      "Nekoosa, Wisconsin. Mike Keiser did on an inland Wisconsin sandbelt what he'd done on the Oregon coast, and somehow got the turf firmer.\n\nSix courses now (Sand Valley, Mammoth Dunes, The Lido, Sedge Valley, The Sand Box, The Commons). Fly into Central Wisconsin or drive from Chicago. Walk everything. Stay two nights minimum, three if you can.",
    publishedAt: "2026-07-05T20:00:00Z",
  },
  {
    slug: "bandon-dunes",
    name: "Bandon Dunes",
    location: "Bandon, Oregon",
    bookingUrl: "https://bandondunesgolf.com",
    heroImageUrl:
      "https://cdn.shopify.com/s/files/1/0561/0530/4256/files/bandon-pacific-dunes.jpg?v=1783292782",
    editorialHeadline:
      "Five courses on a Pacific bluff, plus a par-3 and a putting course. The pilgrimage every American golfer eventually makes.",
    editorialBody:
      "Bandon, Oregon. The property that reset the American golf destination in 1999 and has been the reference ever since.\n\nBandon Dunes, Pacific Dunes, Bandon Trails, Old Macdonald, Sheep Ranch, plus the Preserve and the Punchbowl. No carts, walking only. Fly into North Bend from Denver or SFO, then a 25-minute drive. Book twelve months out. Bring rain gear regardless of the forecast.",
    publishedAt: "2026-07-05T19:45:00Z",
  },
  {
    slug: "cabot-cape-breton",
    name: "Cabot Cape Breton",
    location: "Inverness, Nova Scotia",
    bookingUrl: "https://cabot.com/capebreton",
    heroImageUrl:
      "https://cdn.shopify.com/s/files/1/0561/0530/4256/files/cabot-cape-breton.jpg?v=1783292783",
    editorialHeadline:
      "Two links courses on the Nova Scotia coast. Cliffs, cold beer, no filler.",
    editorialBody:
      "Inverness, Nova Scotia. Two courses (Cabot Links, Cabot Cliffs) both top 100 in the world, sitting on the northern edge of Cape Breton Island.\n\nCliffs holes 15, 16, and 17 are the closest thing North America has to Pebble's 7-8-9. Fly Toronto or Halifax, then a scenic drive up the Ceilidh Trail. Peak season is June through mid-October.",
    publishedAt: "2026-07-05T19:30:00Z",
  },
  {
    slug: "streamsong",
    name: "Streamsong",
    location: "Bowling Green, Florida",
    bookingUrl: "https://www.streamsongresort.com",
    heroImageUrl:
      "https://cdn.shopify.com/s/files/1/0561/0530/4256/files/streamsong-blue.jpg?v=1783292783",
    editorialHeadline:
      "A reclaimed phosphate mine turned into three top-100 courses. Central Florida golf without the palm tree cliche.",
    editorialBody:
      "Bowling Green, Florida. Mosaic Company handed a former phosphate mine to Coore-Crenshaw, Tom Doak, and Gil Hanse. The result: three of the best public courses built this century.\n\nBlue (Coore-Crenshaw) is surgical. Red (Doak) uses every ridge. Black (Hanse) is the boldest of the three. Bring a wedge you trust from tight lies. Two hours from Tampa or Orlando. Play the par-3 Chain at sunset.",
    publishedAt: "2026-07-05T19:15:00Z",
  },
];

/**
 * Convert the code-level destination list into feed-shaped
 * `EditorialProduct` records. Matches everything `EditorialCard` and
 * `EditorialFeed` expect. No price, no variants — the destination branch
 * in `EditorialCard` handles those absences.
 */
export function getDestinationEditorialProducts(): EditorialProduct[] {
  return DESTINATIONS.map((d) => ({
    slug: d.slug,
    name: d.name,
    brand: "Mully Travel",
    collection: d.location,
    price: 0,
    reservePrice: 0,
    images: [d.heroImageUrl],
    imageDetails: [{ url: d.heroImageUrl, altText: d.name }],
    description: d.editorialBody,
    material: "",
    aboutBrand: "",
    whyWeLikeIt: "",
    sizing: "",
    editorialHeadline: d.editorialHeadline,
    editorialBody: d.editorialBody,
    editorialCategory: "destinations",
    destinationUrl: d.bookingUrl,
    options: [],
    variants: [],
    variantId: undefined,
    sourceCollections: ["destinations"],
    publishedAt: d.publishedAt,
    sourceHandle: "destinations",
  }));
}
