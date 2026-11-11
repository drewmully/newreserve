/**
 * Code-level collection config for The Mully Letter (/blog/letters).
 *
 * `blog_posts.category` has a check constraint limited to the six Journal
 * categories, so issues are stored as ordinary rows with
 * `category = LETTER_STORED_CATEGORY` and belong to the collection because
 * their slug is listed here. The site shows them as "The Mully Letter".
 *
 * scripts/newsletter-to-post.ts appends new slugs. A slug listed here only
 * appears once its row is inserted with status "published", so a
 * ready-to-publish issue can be listed before it sends.
 */
export const LETTER_STORED_CATEGORY = "The Craft" as const;

export const LETTER_ISSUE_SLUGS: readonly string[] = [
  "fall-ball-sloat-leaf-rule-greywalls-november-2026",
  "this-past-week-in-golf-november-8-2026",
  "holiday-golf-gift-guide-mully-edit-november-2026",
];
