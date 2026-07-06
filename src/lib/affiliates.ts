/**
 * Editorial affiliates — off-Shopify products we link out to.
 *
 * WHY THIS FILE EXISTS
 * ────────────────────
 * Some pieces belong on the shelf editorially but don't belong in our
 * Shopify catalog. A $2,600 iron set, a $27k electric runabout, and a
 * boutique cigar shipped by tobacconists are things we admire and want
 * to write about, not things we inventory. Modeling them as Shopify
 * products would pollute the catalog with fake SKUs; leaving them off
 * the site would strand editorial voice at the shelf edge.
 *
 * Rule of thumb:
 *   - Sellable Mully SKUs live in Shopify.
 *   - Editorial destinations live in `destinations.ts`.
 *   - Everything else we want to feature lives here.
 *
 * Each affiliate renders as an `EditorialProduct` with:
 *   - editorialCategory set to its real bucket (gear / tech / style /
 *     golf-adjacent) so the filter still works
 *   - destinationUrl = outbound vendor URL (reused; the card's outbound
 *     branch already knows how to open it in a new tab)
 *   - affiliateVendor set so the card renders "Buy at <Vendor>" instead
 *     of "Add to Cart"
 *   - price = 0, variantId = undefined (never adds to cart)
 *
 * Adding an affiliate? Add an entry below, save an image under
 * `/public/affiliates/`, and deploy. `mully-editorial-system` skill
 * covers voice/tone.
 */

import type {
  EditorialProduct,
  EditorialCategory,
} from "@/lib/shopifyEditorial";

export interface AffiliateEntry {
  slug: string;
  name: string;
  /** Vendor/brand label shown on the tag chip and CTA button. */
  vendor: string;
  /** Editorial category — drives the parent chip and filter. */
  editorialCategory: Exclude<EditorialCategory, "destinations">;
  /** Local image path in /public. Include a couple if we have hover state. */
  images: string[];
  /** Outbound vendor URL (opens in a new tab, tracked). */
  outboundUrl: string;
  /** Card headline — one sentence, editorial voice. */
  editorialHeadline: string;
  /** Longer body under Read More. Two paragraphs, plain text, `\n\n` between. */
  editorialBody: string;
  /**
   * Optional display price shown in the card deck. Keep as a raw string
   * ("$375", "from $6") — we don't do currency math on affiliates.
   */
  displayPrice?: string;
  /** ISO 8601. Newer entries surface earlier when they land in a slot. */
  publishedAt: string;
}

/**
 * ORDER: doesn't matter for feed placement (they interleave at fixed
 * cadence). But the array order determines the ROTATION order among
 * the 8 affiliates once we start injecting them. Put the strongest
 * pieces first.
 */
export const AFFILIATES: AffiliateEntry[] = [
  {
    slug: "mclaren-golf-series-3-iron",
    name: "McLaren Golf Series 3 Iron",
    vendor: "McLaren Golf",
    editorialCategory: "gear",
    images: ["/affiliates/mclaren-series-3.jpg"],
    outboundUrl: "https://mclarengolf.com/products/series-3",
    editorialHeadline:
      "The car company built an iron, and the honeycomb on the back is not for show.",
    editorialBody:
      "McLaren's first serious foray into golf is a metal-injection-moulded players-distance iron with a carbon-fiber bonnet across the back and a structural honeycomb mesh that lifts directly from the rear ends of the W1 and 750S. Tungsten weighting scales from 3 to 16 grams across the set, calibrated to progressive centres of gravity, and the heel-cut sole borrows a turf-interaction idea from tour prototypes. On the range the numbers land near a Srixon ZX5 or a P790, which is a compliment.\n\nJustin Rose, Ian Poulter, and Michelle Wie West are on the design panel. The clubs are $375 each and sold only through McLaren Golf direct plus a short list of Club Champion and True Spec fitters, which is intentional. If you already own the driver, this is the set that finally justifies the bag.",
    displayPrice: "$375 per club",
    publishedAt: "2026-07-06T14:00:00Z",
  },
  {
    slug: "hackmotion-sensor-4",
    name: "HackMotion Sensor 4",
    vendor: "HackMotion",
    editorialCategory: "tech",
    images: ["/affiliates/hackmotion-sensor-4.png"],
    outboundUrl: "https://hackmotion.com/hackmotion-sensor-4/",
    editorialHeadline:
      "A coach on your wrist that finally fits under a glove.",
    editorialBody:
      "The fourth generation of HackMotion's lead-wrist sensor is 25% smaller than the last one, which is the difference between a device you clip on for a lesson and one you actually wear for a round. It samples flexion, extension, ulnar and radial deviation, and rotation at 800 frames per second, up from 100, and the new Bluetooth 6.0 radio keeps the phone in sync without dropping the range bay.\n\nWhat you get back is a diagnosis, not a data dump. Casting, flipping, pulling the handle, over-hinging at the top: the app names the fault, prescribes the drill, and hums the linear haptic when you stray. Three strap sizes ship in the box. No subscription. Sixty-day money-back. If clubface control is the last thing standing between you and a real handicap, this is the shortcut.",
    displayPrice: "from $345",
    publishedAt: "2026-07-06T13:45:00Z",
  },
  {
    slug: "even-realities-g2",
    name: "Even Realities G2",
    vendor: "Even Realities",
    editorialCategory: "tech",
    images: ["/affiliates/even-realities-g2.png"],
    outboundUrl: "https://www.evenrealities.com/smart-glasses",
    editorialHeadline:
      "The most restrained pair of smart glasses on the market, which is exactly why they belong on a course.",
    editorialBody:
      "Everyone else building smart glasses is racing to put a camera on your face. Even Realities went the other way. The G2 is a 36-gram titanium and magnesium frame with a green monochrome microLED display that only you can see, a 27.5° field of view, prescription range from -12 to +12, and no camera or speakers at all. Two-day battery, IP67, translation across 33 languages, teleprompt, navigation, and a paired R1 ring for health tracking and gesture control.\n\nThere are no first-party golf features. That is the point. On the course you get discreet notifications, a heads-up phone-free glance at texts or a weather warning, translation at an international club where the pro shop staff speak four languages between them, and a teleprompt window for the toast you owe your partners at dinner. It reads less like a gadget and more like a pair of glasses that happen to know what time it is.",
    displayPrice: "$599",
    publishedAt: "2026-07-06T13:30:00Z",
  },
  {
    slug: "my-father-blue",
    name: "My Father Blue",
    vendor: "My Father Cigars",
    editorialCategory: "golf-adjacent",
    images: ["/affiliates/my-father-blue.webp"],
    outboundUrl: "https://myfathercigars.com/cigar/my-father-blue/",
    editorialHeadline:
      "Our house cigar for the round. Box-pressed, Nicaraguan, and quiet in the wind.",
    editorialBody:
      "The Garcia family's Blue is a full Nicaraguan puro under a dark, oily wrapper, box-pressed so it sits in the divot fixer slot on the cart without rolling. Milk chocolate up front, pecan and brown sugar through the middle, a faint spice on the retrohale that shows up around the seventh hole and stays through the back nine. Medium-full body, thick white smoke, a burn line you can measure with a ruler.\n\nIt is the cigar we keep in the humidor for the round we actually mean to enjoy. Available through most serious tobacconists, and shipped direct from myfathercigars.com to the states that allow it. If you already smoke Padrón or Ashton VSG on the course, this belongs in the rotation.",
    displayPrice: "from $9 per stick",
    publishedAt: "2026-07-06T13:15:00Z",
  },
  {
    slug: "cycleboard-x-quad-golf",
    name: "Cycleboard X-Quad 3000 Golf",
    vendor: "Cycleboard",
    editorialCategory: "gear",
    images: ["/affiliates/cycleboard-xquad.png"],
    outboundUrl: "https://www.cycleboard.com/products/x-quad-golf",
    editorialHeadline:
      "A stand-on, four-wheel electric that rides like a snowboard and carries your bag.",
    editorialBody:
      "The X-Quad 3000 Golf Edition is dual-motor, 3000-watt peak, four-wheel independent double-wishbone suspension, hydraulic disc brakes, aircraft-grade aluminum frame, and a lean-to-steer geometry borrowed from Cycleboard's original three-wheelers. Golf mode caps the top speed at 14 mph, keeps full torque available for cart-path climbs, and pairs with a custom bag mount that carries a full carry stand-bag without knocking your hip.\n\nIt is not a golf cart. It is a personal vehicle you happen to ride to your ball, and after nine holes you stop noticing you're on it. Assembled in Orange County, three-year chassis and motor warranty, and turf-friendly enough that a small handful of clubs are already letting members ride them. Order directly from Cycleboard; the golf trim ships from the factory.",
    displayPrice: "$3,995",
    publishedAt: "2026-07-06T13:00:00Z",
  },
  {
    slug: "arturo-fuente-hemingway-short-story",
    name: "Arturo Fuente Hemingway Short Story",
    vendor: "Arturo Fuente",
    editorialCategory: "golf-adjacent",
    images: ["/affiliates/fuente-short-story.jpg"],
    outboundUrl:
      "https://www.holts.com/cigars/all-cigar-brands/arturo-fuente-hemingway.html",
    editorialHeadline:
      "The best short-format cigar on the course, and it always has been.",
    editorialBody:
      "A 4x49 perfecto under a Cameroon wrapper, Dominican binder and filler, made by the Fuentes at Tabacalera A. Fuente y Cia. Thirty to sixty minutes on the mouth, which is exactly the window between the halfway house and the 18th tee. Cedar, sweet spice, cinnamon, a hint of pepper on the retrohale, and construction that holds its ash the way better cigars are supposed to.\n\nThe Hemingway line has been in production since 1983 and the Short Story has been a 90-plus review from every serious cigar critic in that time. It is what you hand a guest who says they don't have time for a full smoke. Six to seven dollars a stick, and easier to find than most Fuentes because everyone stocks it. Holt's, Heritage Wine and Liquor, and any tobacconist worth walking into will have them behind the counter.",
    displayPrice: "$6-$7 per stick",
    publishedAt: "2026-07-06T12:45:00Z",
  },
  {
    slug: "moke-america-007-san-monique",
    name: "Moke America 007 San Monique Edition",
    vendor: "Moke America",
    editorialCategory: "golf-adjacent",
    images: ["/affiliates/moke-007.jpg"],
    outboundUrl:
      "https://mokeamerica.com/products/007-special-edition-moke",
    editorialHeadline:
      "The car Roger Moore drove in Live and Let Die, remade as an electric runabout for the second house.",
    editorialBody:
      "Moke America built the 007 San Monique in honor of the white Mini Moke that appears in the 1973 Bond film, on the fictional Caribbean island of San Monique. It ships white, with a blue-and-white striped Bimini top, a wood-rimmed steering wheel, a wood shift knob, and a spare-tire cover that reads San Monique across the back of the vehicle. Electric drivetrain, roughly 80-mile range on the current lithium spec, six-hour charge, and enough top speed on the newer trim to hold traffic.\n\nIt is not a golf cart. It is the vehicle you keep at the second residence for the drive to the club, the drive to the beach, and every errand between. Ordered directly from Moke America; the 007 is a limited edition and the 60th-anniversary midnight-blue edition is worth asking about at the same time. Delivery takes some patience. Everything about it does.",
    displayPrice: "$26,975",
    publishedAt: "2026-07-06T12:30:00Z",
  },
  {
    slug: "wybranski-tgl-inaugural-poster",
    name: "TGL Inaugural Season Poster",
    vendor: "Lee Wybranski",
    editorialCategory: "style",
    images: ["/affiliates/tgl-poster.jpg"],
    outboundUrl:
      "https://leewybranski.com/product/2025-t-g-l-the-inaugural-season/",
    editorialHeadline:
      "The official commemorative print for the first season of Tiger and Rory's indoor league.",
    editorialBody:
      "Lee Wybranski has been the painter of record for the U.S. Open since 2008, the Masters, the Open Championship, the PGA, and the Ryder Cup. His style pulls from vintage travel posters and classical landscape painting, with the whimsical typography of a stamp book. The 2025 TGL print marks the inaugural season of the Tomorrow's Golf League at the SoFi Centre in Palm Beach Gardens, founded by Tiger Woods and Rory McIlroy.\n\nSold directly through the artist. Open-edition sizes start at $50 and the largest signed archival print runs to $375. This is the poster to hang before the Wybranski collection you're going to keep buying accumulates around it. Frame it wide, hang it in the room where you keep the whiskey, done.",
    displayPrice: "$50-$375",
    publishedAt: "2026-07-06T12:15:00Z",
  },
];

/**
 * Convert affiliate entries into feed-shaped `EditorialProduct` records.
 * Matches everything `EditorialCard` and `EditorialFeed` expect.
 * The card's affiliate branch (destinationUrl set, category !== destinations,
 * affiliateVendor present) handles the Buy at <Vendor> CTA.
 */
export function getAffiliateEditorialProducts(): EditorialProduct[] {
  return AFFILIATES.map((a) => ({
    slug: a.slug,
    name: a.name,
    brand: a.vendor,
    collection: a.vendor,
    price: 0,
    reservePrice: 0,
    images: a.images,
    imageDetails: a.images.map((url) => ({ url, altText: a.name })),
    description: a.editorialBody,
    material: "",
    aboutBrand: "",
    whyWeLikeIt: "",
    sizing: "",
    editorialHeadline: a.editorialHeadline,
    editorialBody: a.editorialBody,
    editorialCategory: a.editorialCategory,
    destinationUrl: a.outboundUrl,
    options: [],
    variants: [],
    variantId: undefined,
    sourceCollections: ["affiliates"],
    publishedAt: a.publishedAt,
    sourceHandle: "affiliates",
    affiliateVendor: a.vendor,
    affiliateDisplayPrice: a.displayPrice,
  }));
}
