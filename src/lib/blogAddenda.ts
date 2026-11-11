/**
 * Code-level additions to Supabase Journal posts (SEO tasks s06, s07, s09).
 * Kept in the repo so every change is a reviewable, revertible PR and the
 * live blog_posts rows stay untouched.
 *
 * Paragraph text supports one inline syntax: [label](/internal-path).
 * Only same-site paths starting with "/" become links.
 */
import type { BlogSection } from "@/app/blog/posts";

export type BlogAddendum =
  /** Append paragraphs to the end of an existing section, matched by heading. */
  | { kind: "append"; heading: string; paragraphs: string[] }
  /** Insert a new section after an existing heading (or at the end if null). */
  | { kind: "section"; after: string | null; section: BlogSection };

export const BLOG_ADDENDA: Record<string, BlogAddendum[]> = {
  // s09: answer "brands like peter millar" in the Greyson vs. Peter Millar post.
  // Every brand below is carried in the Mully Shop; copy is drawn from each PDP.
  "greyson-vs-peter-millar-golf-comparison": [
    {
      kind: "section",
      after: "On-Course Performance",
      section: {
        heading: "Brands like Peter Millar",
        paragraphs: [
          "Peter Millar's appeal is a polo that looks as right in the dining room as it does on the first tee. These brands, all carried in the [Mully Shop](/shop), cover the same ground from different angles.",
          "Rhone: The [Commuter Polo](/shop/rhone-commuter-polo) pairs four-way stretch with a wrinkle-releasing finish and a hidden-button collar. It is cut slim, closer to Crown Crafted than to Summer Comfort.",
          "Sloat: The [Merino Polo](/shop/sloat-merino-polo) is 200 gsm RWS-certified merino jersey sewn in Portugal. It is a natural-fiber answer to Peter Millar's performance jersey, with a soft drape that regulates temperature through a full round.",
          "Olydoe: The [OG Supima Hollow Polo](/shop/olydoe-og-supima-hollow-polo) uses American-grown Supima cotton with a hollow yarn that lets moisture move through. Softly structured, with fine stripes, for the golfer who wants cotton over synthetics.",
          "Technically Golf: The [Performance Polo](/shop/technically-golf-performance-polo) is lightweight nylon-spandex piqué with permanent collar stays, so the collar holds its shape from the first tee to the 19th hole.",
          "Quiet Golf: The [Remy Polo](/shop/quiet-golf-remy-polo-active-pique) is a 96% polyester, 4% spandex active piqué with a three-button collar and shell buttons. It is the closest match here to Peter Millar's poly-spandex stretch.",
          "Duck Head: The [Gold School Chino](/shop/duckhead-classic-fit-gold-school-chino-khaki) comes in a classic fit with your choice of waist and inseam, in khaki. It is the pant to wear with any of the polos above.",
        ],
      },
    },
  ],
  // s07: answer "golf mystery box" in the subscription comparison post.
  // Price intentionally links to /subscription (no hard-coded prices).
  "best-golf-subscription-boxes-2026-compared": [
    {
      kind: "section",
      after: "Golfer's Box (Inside the Leather)",
      section: {
        heading: "The Golf Mystery Box, Explained",
        paragraphs: [
          "A golf mystery box ships a surprise assortment of apparel and gear chosen with nothing more than your size. The reveal is the fun part. The catch is the hit rate: a polo in a color you would never pick still counts toward the box value, and past-season stock is how most mystery boxes keep that number high.",
          "Mully Reserve runs the other way. A stylist picks every piece after a short style quiz on fit, sizing and the brands you already wear, and you see your picks before anything ships. The surprise is the brand you had not tried yet, not whether the polo fits.",
          "Current plan pricing lives on the [Mully Reserve page](/subscription).",
        ],
      },
    },
  ],
  // s06: internal link from the dress code post to the restored hat guide.
  "what-to-wear-private-golf-club-dress-code": [
    {
      kind: "append",
      heading: "On the Golf Course",
      paragraphs: [
        "Hats get their own guide: [Choosing the Perfect Golf Hat](/blogs/news/choosing-the-perfect-golf-hat-tips-for-comfort-and-performance).",
      ],
    },
  ],
};

export function applyAddenda(slug: string, sections: BlogSection[]): BlogSection[] {
  const adds = BLOG_ADDENDA[slug];
  if (!adds?.length) return sections;
  let out = sections.map((s) => ({ ...s, paragraphs: [...s.paragraphs] }));
  for (const a of adds) {
    if (a.kind === "append") {
      const target = out.find((s) => s.heading === a.heading);
      if (target) target.paragraphs.push(...a.paragraphs);
    } else {
      const i = a.after === null ? -1 : out.findIndex((s) => s.heading === a.after);
      if (i === -1) out = [...out, a.section];
      else out = [...out.slice(0, i + 1), a.section, ...out.slice(i + 1)];
    }
  }
  return out;
}
