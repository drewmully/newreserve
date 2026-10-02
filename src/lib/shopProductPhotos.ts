import type { ShopifyProduct } from "./shopify";
import prepared from "./shopProductPhotos.json";

/** Never show an old prepared photo after the merchant changes the catalog image. */
export function shopProductPhoto(p: Pick<ShopifyProduct, "slug" | "images">): string {
  const photo = prepared.find((row) => row.slug === p.slug);
  return photo && photo.catalogPrimary === p.images[0]
    ? photo.prepared
    : p.images[0] || "";
}

const names: Record<string, string> = {
  "quiet-golf-remy-polo-active-pique": "Remy Polo",
  "rhone-delta-pique-polo": "Delta Piqué Polo",
  "rhone-commuter-pant": "Commuter Pant",
  "rhone-commuter-short-7": 'Commuter Short · 7"',
  "rhone-commuter-1-4-zip": "Commuter Quarter-Zip",
  "duckhead-fremont-sport-performance-quilted-vest-brandy-brown": "Fremont Quilted Vest",
  "olydoe-og-supima-hollow-polo": "Supima Hollow Polo",
  "duckhead-classic-fit-gold-school-chino-khaki": "Gold School Chino",
  "voice-caddie-laser-fit": "Laser Fit Rangefinder",
  "blue-tees-player-gps-speaker": "Player+ GPS Speaker",
  "garmin-approach-s70": "Approach S70",
  "bushnell-tour-v7-shift": "Tour V7 Shift",
  "winston-solid-tradition-leather-headcover": "Tradition Leather Headcover",
};

export function shopProductLabel(p: Pick<ShopifyProduct, "slug" | "name">): string {
  return names[p.slug] || p.name.replace(/^(Olydoe|Rhone|Quiet Golf|Technically Golf|Primo|Duck Head|Winston|Leon|Stitch|Jolly Golf) /, "");
}
