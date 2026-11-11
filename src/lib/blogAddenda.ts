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
