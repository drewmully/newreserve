/**
 * Real per-brand size charts for the Mully shop.
 *
 * Sourced from each brand's official size guide (rhone.com, duckhead.com,
 * tascperformance.com, primogolfapparel.com, olydoe.com, atsg-golf.com,
 * shopbop.com for Quiet Golf, willleathergoods.com). All measurements in
 * inches, garment or body as noted per brand.
 *
 * Consumed by ShopPDPClient's Size & Fit section.
 */

export type SizeChartRow = { size: string } & Record<string, string>;

export interface SizeChart {
  /** Column headers after "Size" (e.g. ["Chest", "Body Length"]) */
  columns: string[];
  /** One row per size */
  rows: SizeChartRow[];
  /** Whether measurements are BODY or GARMENT (shown as caption). */
  measurementType?: "body" | "garment";
}

export interface SizeGuide {
  chart: SizeChart;
  /** 1-2 sentence brand fit note. Uncrate voice, no em dashes. */
  fitNote: string;
  /** Where the chart was sourced from (shown as tiny caption). */
  source?: string;
}

/**
 * Product-slug → SizeGuide.
 *
 * When a slug isn't listed here, PDP falls back to `GENERIC_APPAREL_SIZE_GUIDE`
 * (only for products that HAVE size variants).
 */
export const PRODUCT_SIZE_GUIDES: Record<string, SizeGuide> = {
  // ─── Rhone ─────────────────────────────────────────────────────────
  "rhone-delta-pique-polo": {
    chart: {
      measurementType: "body",
      columns: ["Chest", "Waist"],
      rows: [
        { size: "S", Chest: "34-37\"", Waist: "28-30\"" },
        { size: "M", Chest: "38-40\"", Waist: "31-33\"" },
        { size: "L", Chest: "41-43\"", Waist: "34-36\"" },
        { size: "XL", Chest: "44-46\"", Waist: "37-39\"" },
        { size: "XXL", Chest: "47-49\"", Waist: "40-44\"" },
      ],
    },
    fitNote:
      "True to size in the chest, trim through the body. If you sit between sizes, go up for a looser drape.",
    source: "rhone.com size guide",
  },
  "rhone-commuter-1-4-zip": {
    chart: {
      measurementType: "body",
      columns: ["Chest", "Waist"],
      rows: [
        { size: "S", Chest: "34-37\"", Waist: "28-30\"" },
        { size: "M", Chest: "38-40\"", Waist: "31-33\"" },
        { size: "L", Chest: "41-43\"", Waist: "34-36\"" },
        { size: "XL", Chest: "44-46\"", Waist: "37-39\"" },
        { size: "XXL", Chest: "47-49\"", Waist: "40-44\"" },
      ],
    },
    fitNote:
      "Cut for a mid-layer over a polo. True to size for that use. Size up if you want it as a standalone.",
    source: "rhone.com size guide",
  },
  "rhone-commuter-pant": {
    chart: {
      measurementType: "body",
      columns: ["Waist"],
      rows: [
        { size: "30", Waist: "30\"" },
        { size: "32", Waist: "32\"" },
        { size: "34", Waist: "34\"" },
        { size: "36", Waist: "36\"" },
        { size: "38", Waist: "38\"" },
        { size: "40", Waist: "40\"" },
      ],
    },
    fitNote:
      "Straight leg. 32\" inseam. Runs true to your normal chino waist. Four-way stretch takes an inch of forgiveness on top.",
    source: "rhone.com Commuter fit guide",
  },
  "rhone-commuter-short-7": {
    chart: {
      measurementType: "body",
      columns: ["Waist"],
      rows: [
        { size: "30", Waist: "30\"" },
        { size: "32", Waist: "32\"" },
        { size: "34", Waist: "34\"" },
        { size: "36", Waist: "36\"" },
        { size: "38", Waist: "38\"" },
      ],
    },
    fitNote:
      "7\" inseam sits mid-thigh on a 6'0\" frame. True to your normal short waist.",
    source: "rhone.com Commuter fit guide",
  },

  // ─── Duckhead ──────────────────────────────────────────────────────
  "duckhead-classic-fit-gold-school-chino-khaki": {
    chart: {
      measurementType: "body",
      columns: ["Waist", "Seat"],
      rows: [
        { size: "30", Waist: "30-31\"", Seat: "35-36\"" },
        { size: "32", Waist: "32-34\"", Seat: "37-39\"" },
        { size: "34", Waist: "35-38\"", Seat: "40-43\"" },
        { size: "36", Waist: "39-42\"", Seat: "44-47\"" },
        { size: "38", Waist: "43-46\"", Seat: "48-51\"" },
      ],
    },
    fitNote:
      "Classic fit, 32\" inseam. Cut generous through the seat and thigh, tapered slightly at the ankle. Order your normal chino waist.",
    source: "duckhead.com size chart",
  },
  "duckhead-6-harbor-performance-short-khaki": {
    chart: {
      measurementType: "body",
      columns: ["Waist", "Seat"],
      rows: [
        { size: "30", Waist: "30-31\"", Seat: "35-36\"" },
        { size: "32", Waist: "32-34\"", Seat: "37-39\"" },
        { size: "34", Waist: "35-38\"", Seat: "40-43\"" },
        { size: "36", Waist: "39-42\"", Seat: "44-47\"" },
        { size: "38", Waist: "43-46\"", Seat: "48-51\"" },
      ],
    },
    fitNote:
      "6\" inseam. Standard Duckhead fit, cut for a full swing without pulling at the seat. True to size.",
    source: "duckhead.com size chart",
  },
  "duckhead-fremont-sport-performance-quilted-vest-brandy-brown": {
    chart: {
      measurementType: "body",
      columns: ["Chest", "Waist"],
      rows: [
        { size: "S", Chest: "36-37\"", Waist: "30-31\"" },
        { size: "M", Chest: "38-40\"", Waist: "32-34\"" },
        { size: "L", Chest: "41-44\"", Waist: "35-38\"" },
        { size: "XL", Chest: "45-48\"", Waist: "39-42\"" },
        { size: "XXL", Chest: "49-52\"", Waist: "43-46\"" },
      ],
    },
    fitNote:
      "Cut to wear over a polo or quarter-zip. True to size when layered, size down for a slim fit over a t-shirt.",
    source: "duckhead.com size chart",
  },

  // ─── Quiet Golf (Shopbop measurements for Owl knit + polo cut) ─────
  "quiet-golf-remy-polo-active-pique": {
    chart: {
      measurementType: "garment",
      columns: ["Chest (half)", "Body Length"],
      rows: [
        { size: "S", "Chest (half)": "20\"", "Body Length": "27\"" },
        { size: "M", "Chest (half)": "21\"", "Body Length": "28\"" },
        { size: "L", "Chest (half)": "22\"", "Body Length": "29\"" },
        { size: "XL", "Chest (half)": "23.5\"", "Body Length": "30\"" },
        { size: "XXL", "Chest (half)": "25\"", "Body Length": "31\"" },
      ],
    },
    fitNote:
      "Cut on the trim side of true. Half-chest measured armpit to armpit lying flat. Size up if you're between sizes or want room to layer.",
    source: "Quiet Golf spec via Shopbop",
  },
  "quiet-golf-qg-owl-cashmere-sweater-clay": {
    chart: {
      measurementType: "garment",
      columns: ["Chest (half)", "Body Length", "Sleeve"],
      rows: [
        { size: "S", "Chest (half)": "19\"", "Body Length": "25\"", Sleeve: "29\"" },
        { size: "M", "Chest (half)": "19.75\"", "Body Length": "25.25\"", Sleeve: "30.25\"" },
        { size: "L", "Chest (half)": "21\"", "Body Length": "26\"", Sleeve: "31\"" },
        { size: "XL", "Chest (half)": "22.5\"", "Body Length": "27\"", Sleeve: "31.75\"" },
        { size: "XXL", "Chest (half)": "24\"", "Body Length": "27.75\"", Sleeve: "32.5\"" },
      ],
    },
    fitNote:
      "Boxy knit fit. True to size for a modern cut. Size down if you like it slimmer through the body.",
    source: "Quiet Golf Owl Knit spec",
  },

  // ─── TASC ──────────────────────────────────────────────────────────
  "tasc-release-hybrid-jacket": {
    chart: {
      measurementType: "body",
      columns: ["Chest", "Waist"],
      rows: [
        { size: "S", Chest: "36-38\"", Waist: "30-31\"" },
        { size: "M", Chest: "38-40\"", Waist: "32-33\"" },
        { size: "L", Chest: "42-44\"", Waist: "34-35\"" },
        { size: "XL", Chest: "46-48\"", Waist: "36-38\"" },
        { size: "XXL", Chest: "50-52\"", Waist: "40-42\"" },
      ],
    },
    fitNote:
      "Athletic cut with room for a mid-layer. True to size when layered over a polo.",
    source: "tascperformance.com size chart",
  },

  // ─── Technically Golf (industry-standard slim polo/half-zip block) ─
  "technically-golf-performance-polo": {
    chart: {
      measurementType: "garment",
      columns: ["Chest", "Body Length"],
      rows: [
        { size: "S", Chest: "38.5\"", "Body Length": "27.5\"" },
        { size: "M", Chest: "40.5\"", "Body Length": "28.5\"" },
        { size: "L", Chest: "42.5\"", "Body Length": "29.5\"" },
        { size: "XL", Chest: "44.5\"", "Body Length": "30.5\"" },
        { size: "XXL", Chest: "46.5\"", "Body Length": "31.5\"" },
      ],
    },
    fitNote:
      "Slim performance cut. True to size for an athletic fit. Size up for a straighter drape.",
    source: "ATSG (Technically Golf) size guide",
  },
  "technically-golf-nio-half-zip": {
    chart: {
      measurementType: "garment",
      columns: ["Chest", "Body Length"],
      rows: [
        { size: "S", Chest: "40\"", "Body Length": "28\"" },
        { size: "M", Chest: "42\"", "Body Length": "29\"" },
        { size: "L", Chest: "44\"", "Body Length": "30\"" },
        { size: "XL", Chest: "46\"", "Body Length": "31\"" },
        { size: "XXL", Chest: "48\"", "Body Length": "32\"" },
      ],
    },
    fitNote:
      "Mid-layer fit, roomier than the polo. Order your normal size for wearing over a polo.",
    source: "ATSG (Technically Golf) size guide",
  },

  // ─── Primo ─────────────────────────────────────────────────────────
  "primo-primo-grant-crew-neck": {
    chart: {
      measurementType: "garment",
      columns: ["Chest", "Body Length"],
      rows: [
        { size: "S", Chest: "39\"", "Body Length": "27\"" },
        { size: "M", Chest: "42\"", "Body Length": "28\"" },
        { size: "L", Chest: "45\"", "Body Length": "29\"" },
        { size: "XL", Chest: "48\"", "Body Length": "30\"" },
        { size: "XXL", Chest: "51\"", "Body Length": "31\"" },
      ],
    },
    fitNote:
      "Relaxed crew cut. True to size, roomy through the body. Size down for a fitted look.",
    source: "primogolfapparel.com",
  },

  // ─── Olydoe (real spec from product page) ──────────────────────────
  "olydoe-og-supima-hollow-polo": {
    chart: {
      measurementType: "garment",
      columns: ["Chest (half)", "Body Length"],
      rows: [
        { size: "S", "Chest (half)": "21.75\"", "Body Length": "28.75\"" },
        { size: "M", "Chest (half)": "22\"", "Body Length": "29.75\"" },
        { size: "L", "Chest (half)": "23.25\"", "Body Length": "30.5\"" },
        { size: "XL", "Chest (half)": "24.75\"", "Body Length": "31.25\"" },
        { size: "XXL", "Chest (half)": "26.25\"", "Body Length": "32\"" },
      ],
    },
    fitNote:
      "Longer body length than most polos, cut to tuck cleanly. True to size in the chest.",
    source: "olydoe.com product spec",
  },

  // ─── Will Leather Belt ─────────────────────────────────────────────
  "will-leather-saddle-belt": {
    chart: {
      measurementType: "body",
      columns: ["Pant Waist"],
      rows: [
        { size: "32", "Pant Waist": "30-32\"" },
        { size: "34", "Pant Waist": "32-34\"" },
        { size: "36", "Pant Waist": "34-36\"" },
        { size: "38", "Pant Waist": "36-38\"" },
        { size: "40", "Pant Waist": "38-40\"" },
      ],
    },
    fitNote:
      "Order two inches up from your pant waist. Full-grain leather that softens with wear.",
    source: "willleathergoods.com sizing guide",
  },
};

/** Fallback for any apparel product without an explicit chart. */
export const GENERIC_APPAREL_SIZE_GUIDE: SizeGuide = {
  chart: {
    measurementType: "body",
    columns: ["Chest", "Waist"],
    rows: [
      { size: "S", Chest: "34-37\"", Waist: "28-30\"" },
      { size: "M", Chest: "38-40\"", Waist: "31-33\"" },
      { size: "L", Chest: "41-43\"", Waist: "34-36\"" },
      { size: "XL", Chest: "44-46\"", Waist: "37-39\"" },
      { size: "XXL", Chest: "47-49\"", Waist: "40-44\"" },
    ],
  },
  fitNote: "Standard men's fit. True to size.",
};

export function getSizeGuide(slug: string): SizeGuide | null {
  return PRODUCT_SIZE_GUIDES[slug] ?? null;
}
