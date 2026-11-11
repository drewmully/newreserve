/**
 * Klaviyo email HTML -> Journal post draft (The Mully Letter).
 *
 * Pure functions over a DOM `Document`, used by
 * scripts/newsletter-to-post.ts (with jsdom) and the unit tests. Not
 * imported by any page.
 *
 * The draft is a starting point, not a finished post: the editor still
 * writes the title and meta description, trims time-bound lines and checks
 * every warning before the row is inserted. `validateLetterRow` enforces the
 * hard rules (no prices, codes, template tags, tracking or footer copy).
 */
import { LETTER_ISSUE_SLUGS, LETTER_STORED_CATEGORY } from "@/lib/letterIssues";

export interface DraftSection {
  heading: string;
  paragraphs: string[];
  image?: string;
  imageAlt?: string;
  caption?: string;
}

/** Shape of a `blog_posts` row (snake_case, as inserted). */
export interface LetterRow {
  slug: string;
  title: string;
  excerpt: string;
  category: typeof LETTER_STORED_CATEGORY;
  date: string;
  read_time: string;
  image: string;
  image_alt: string;
  featured: boolean;
  intro: string;
  highlights: string[];
  sections: DraftSection[];
  closing: string;
  status: "published";
  publish_date: string;
  seo_keywords: string[];
}

export interface LetterSource {
  campaignId: string;
  campaignName?: string;
  subject?: string;
  previewText?: string;
  sentAt: string;
  templateId?: string;
}

export interface LetterDraft extends LetterRow {
  _source: LetterSource;
  /** Product handles linked from the email (they render as live product rows). */
  _products: string[];
  _warnings: string[];
}

const SITE_HOSTS = /^(?:www\.)?(?:mymully\.com|mullybox\.com)$/i;
const IMAGE_HOSTS = /(?:^|\.)(?:klaviyomail\.com|klaviyo\.com|cloudfront\.net|shopify\.com|shopifycdn\.com)$/i;
const TRACKING_PARAM = /^(?:utm_[a-z]+|_kx|_ke|kx|klaviyo_[a-z]+|mc_[a-z]+|fbclid|gclid)$/i;
const TEMPLATE_TAG = /\{\{[\s\S]*?\}\}|\{%[\s\S]*?%\}/g;
const PRICE = /\$\s?\d[\d,]*(?:\.\d{2})?/;
const PRICE_G = /\s*(?:·\s*)?(?:from\s+)?\$\s?\d[\d,]*(?:\.\d+)?(?:\s?(?:million|billion|k)\b)?\+?/gi;
const FOOTER = /you're receiving this|you’re receiving this|no longer want to receive|unsubscribe|manage (?:your )?preferences|organization\.(?:name|full_address)/i;
const SHARE_LINE = /^(?:forwarded this\??|know someone who'd like this|share (?:this issue|the web version)|email it|text it|view (?:this )?in (?:your )?browser)/i;
const EYEBROW = /^\d{2}\s*·\s*(.+)$/;
const OFFER = /\b(?:promo|discount|coupon)\b|\bcode\b\s*[“"']?[A-Z0-9]{4,}|\d+%\s*off|\bfree (?:shipping|towel|gift)\b|members?[- ]only|member pricing|reply with your answer|reply to this email/i;
const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/gu;

/** Clean a link: strip tracking, make Mully links relative, drop mailto/sms/template links. */
export function cleanHref(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const href = raw.trim();
  if (!href || TEMPLATE_TAG.test(href)) { TEMPLATE_TAG.lastIndex = 0; return null; }
  TEMPLATE_TAG.lastIndex = 0;
  if (/^(?:mailto|sms|tel|javascript):/i.test(href) || href.startsWith("#")) return null;
  let url: URL;
  try { url = new URL(href, "https://www.mymully.com"); } catch { return null; }
  // Klaviyo click wrappers carry the target in a query param when present.
  if (/klclick|klaviyo\.com$/i.test(url.hostname)) {
    const target = url.searchParams.get("url") || url.searchParams.get("u");
    return target ? cleanHref(target) : null;
  }
  for (const k of [...url.searchParams.keys()]) if (TRACKING_PARAM.test(k)) url.searchParams.delete(k);
  if (SITE_HOSTS.test(url.hostname)) {
    const path = (url.pathname.replace(/\/+$/, "") || "/") + (url.search || "") + (url.hash || "");
    return path;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  url.protocol = "https:";
  return url.toString();
}

export function cleanText(s: string): string {
  return s
    .replace(TEMPLATE_TAG, "")
    .replace(EMOJI, "")
    .replace(/[\u00a0\u200b-\u200d\u034f\u2060]/g, " ")
    .replace(/\s*[—–]\s*/g, ", ") // no em or en dashes in Mully copy
    .replace(/\s+([,.;:!?])/g, "$1")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function stripPrices(s: string): string {
  return s.replace(PRICE_G, "").replace(/\s*·\s*$/, "").replace(/,\s*$/, "").trim();
}

const BLOCK = new Set(["TD", "TH", "DIV", "P", "H1", "H2", "H3", "H4", "H5", "H6", "LI", "BLOCKQUOTE", "FIGCAPTION", "CENTER", "TABLE", "TR", "TBODY", "UL", "OL"]);

interface Block {
  kind: "text" | "img";
  text: string; // markdown-ish inline text (links as [label](href))
  plain: string;
  links: string[];
  fontSize: number;
  serif: boolean;
  hidden: boolean;
  src?: string;
  alt?: string;
  href?: string | null;
}

function styleOf(el: Element): string {
  let out = "";
  for (let n: Element | null = el; n && out.length < 2000; n = n.parentElement) out = (n.getAttribute("style") || "") + ";" + out;
  return out;
}

function lastMatch(style: string, re: RegExp): string | null {
  let m: RegExpExecArray | null; let last: string | null = null;
  const g = new RegExp(re.source, "gi");
  while ((m = g.exec(style))) { last = m[1]; if (m[0] === "") g.lastIndex++; }
  return last;
}

function inlineText(el: Element, links: string[]): { md: string; plain: string } {
  let md = ""; let plain = "";
  el.childNodes.forEach(node => {
    if (node.nodeType === 3) { md += node.textContent ?? ""; plain += node.textContent ?? ""; return; }
    if (node.nodeType !== 1) return;
    const child = node as Element;
    if (BLOCK.has(child.tagName) || child.tagName === "IMG" || child.tagName === "STYLE") return;
    if (child.tagName === "BR") { md += " "; plain += " "; return; }
    const inner = inlineText(child, links);
    if (child.tagName === "A") {
      const href = cleanHref(child.getAttribute("href"));
      const label = inner.plain.trim();
      if (href && label) { links.push(href); md += `[${label}](${href})`; } else md += inner.md;
      plain += inner.plain;
      return;
    }
    md += inner.md; plain += inner.plain;
  });
  return { md, plain };
}

function collectBlocks(doc: Document): Block[] {
  const blocks: Block[] = [];
  const body = doc.body ?? doc.documentElement;
  const walk = (el: Element) => {
    if (el.tagName === "STYLE" || el.tagName === "SCRIPT" || el.tagName === "HEAD") return;
    if (el.tagName === "IMG") {
      const style = styleOf(el);
      const a = el.closest("a");
      blocks.push({ kind: "img", text: "", plain: "", links: [], fontSize: 0, serif: false,
        hidden: /display:\s*none/i.test(style), src: el.getAttribute("src") ?? "", alt: (el.getAttribute("alt") ?? "").trim(), href: a ? cleanHref(a.getAttribute("href")) : null });
      return;
    }
    if (BLOCK.has(el.tagName) || el === body) {
      const links: string[] = [];
      const { md, plain } = inlineText(el, links);
      if (plain.replace(TEMPLATE_TAG, "").trim()) {
        const style = styleOf(el);
        const fs = Number(lastMatch(style, /font-size:\s*(\d+)/) ?? 16);
        const ff = lastMatch(style, /font-family:\s*([^;]+)/) ?? "";
        blocks.push({ kind: "text", text: md, plain: plain.trim(), links, fontSize: fs,
          serif: /playfair|georgia|serif(?!-)/i.test(ff) && !/sans-serif/i.test(ff.split(",")[0]),
          hidden: /display:\s*none|max-height:\s*0|mso-hide:\s*all/i.test(style) });
      }
    }
    for (const c of Array.from(el.children)) walk(c);
  };
  walk(body);
  return blocks;
}

const SHOP_HANDLE = /^\/shop\/(?!gifts\b|collection\b|new-arrivals\b)([a-z0-9][a-z0-9-]*)$/;

function slugify(s: string): string {
  return s.toLowerCase().normalize("NFKD").replace(/[^\w\s-]/g, "").replace(/[\s_]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "").slice(0, 80);
}

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];

/** Descriptive slug, e.g. "this-past-week-in-golf-november-8-2026". */
export function suggestSlug(series: string, sentAt: string): string {
  const d = new Date(sentAt);
  const et = new Date(d.toLocaleString("en-US", { timeZone: "America/New_York" }));
  return slugify(`${series} ${MONTHS[et.getMonth()]} ${et.getDate()} ${et.getFullYear()}`);
}

export function readTime(row: Pick<LetterRow, "intro" | "sections" | "closing">): string {
  const words = [row.intro, row.closing, ...row.sections.flatMap(s => [s.heading, ...s.paragraphs])].join(" ").split(/\s+/).filter(Boolean).length;
  return `${Math.max(2, Math.round(words / 220))} min read`;
}

/** Convert email HTML into a post draft. */
export function emailToDraft(doc: Document, source: LetterSource): LetterDraft {
  const warnings: string[] = [];
  const products: string[] = [];
  const all = collectBlocks(doc);
  const footerAt = all.findIndex(b => b.kind === "text" && FOOTER.test(b.plain));
  const blocks = (footerAt >= 0 ? all.slice(0, footerAt) : all).filter(b => !b.hidden);

  const preview = cleanText(source.previewText ?? "");
  const sections: DraftSection[] = [];
  const introParts: string[] = [];
  let series = "";
  let current: DraftSection | null = null;
  let awaitingHeading = false;
  let hero: { src: string; alt: string } | null = null;

  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    if (b.kind === "img") {
      const src = b.src ?? "";
      let host = "";
      try { host = new URL(src).hostname; } catch { /* relative */ }
      if (!IMAGE_HOSTS.test(host)) { if (src) warnings.push(`Image not on Klaviyo or Shopify CDN, skipped: ${src}`); continue; }
      if (b.href) { const h = b.href.match(SHOP_HANDLE)?.[1]; if (h) products.push(h); }
      // Logos and wordmarks: single-word alt text on a PNG.
      if (/\.png(?:\?|$)/i.test(src) && !/\s/.test(b.alt ?? "")) continue;
      if (!b.alt) warnings.push(`Image without alt text: ${src}`);
      const alt = stripPrices(cleanText(b.alt ?? ""));
      if (!hero) hero = { src, alt };
      if (current && !current.image) { current.image = src; current.imageAlt = alt; }
      continue;
    }
    const plain = cleanText(b.plain);
    if (!plain || (preview && plain === preview)) continue;
    if (SHARE_LINE.test(plain)) continue;
    for (const l of b.links) { const h = l.match(SHOP_HANDLE)?.[1]; if (h) products.push(h); }

    // Masthead: "The Mully Newsletter · This Past Week in Golf · Nov. 8, 2026"
    if (!series && /^the mully (?:newsletter|edit|letter)\s*·/i.test(plain)) {
      series = plain.split("·").map(s => s.trim())[1] ?? "";
      continue;
    }
    if (/^in this issue:/i.test(plain)) { introParts.push(plain); continue; }

    const eyebrow = plain.match(EYEBROW);
    if (eyebrow) {
      current = { heading: "", paragraphs: [] };
      sections.push(current);
      awaitingHeading = true;
      continue;
    }
    if (/^\d{1,2}$/.test(plain)) continue; // product ordinals
    if (awaitingHeading && current && b.serif && b.fontSize >= 22) {
      current.heading = plain;
      awaitingHeading = false;
      continue;
    }
    // Buttons: "Shop the jacket", "Read the full story" (keep external source links as text links).
    const onlyLink = b.links.length === 1 && b.text.trim().startsWith("[") && b.text.trim().endsWith(")");
    if (onlyLink && /^(?:shop|see|get|gift|explore)\b/i.test(plain)) continue;

    let md = cleanText(b.text);
    if (PRICE.test(md)) { warnings.push(`Price removed: "${plain.slice(0, 80)}"`); md = stripPrices(md); if (!md) continue; }
    if (OFFER.test(md)) warnings.push(`Possible offer or member-only line, review: "${plain.slice(0, 100)}"`);
    // Caption lines ("Photo: ...") attach to the section image.
    if (current && /^(?:photo|video|illustration)s?:|\bphoto:/i.test(plain) && b.fontSize <= 13) {
      current.caption = md.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");
      continue;
    }
    // Product card titles become bold-free lead-ins on the next paragraph.
    if (current && b.serif && b.fontSize >= 17 && b.fontSize < 22) {
      current.paragraphs.push(md);
      continue;
    }
    if (!current) { introParts.push(md); continue; }
    if (!current.heading && awaitingHeading) { current.heading = plain; awaitingHeading = false; continue; }
    current.paragraphs.push(md);
  }

  const kept = sections.filter(s => s.heading && (s.paragraphs.length || s.image));
  const uniqueProducts = [...new Set(products)];
  const sentAt = new Date(source.sentAt).toISOString();
  const seriesName = series || source.campaignName?.split("|")[1]?.trim() || "The Mully Letter";
  const row: LetterRow = {
    slug: suggestSlug(seriesName, sentAt),
    title: `TODO: search title (${source.subject ?? seriesName})`,
    excerpt: `TODO: 150 to 160 character meta description. Preview text was: ${preview}`,
    category: LETTER_STORED_CATEGORY,
    date: new Intl.DateTimeFormat("en-US", { month: "short", day: "2-digit", year: "numeric", timeZone: "America/New_York" }).format(new Date(sentAt)),
    read_time: "",
    image: hero?.src ?? "",
    image_alt: hero?.alt ?? "",
    featured: false,
    intro: preview || introParts[0] || "",
    highlights: [],
    sections: kept,
    closing: "",
    status: "published",
    publish_date: sentAt,
    seo_keywords: [],
  };
  row.read_time = readTime(row);
  if (!hero) warnings.push("No hero image found; set image and image_alt.");
  return { ...row, _source: source, _products: uniqueProducts, _warnings: [...new Set(warnings)] };
}

/* ─── Validation (run before insert) ───────────────────────────────────── */

const BANNED: [RegExp, string][] = [
  [/[—–]|--/, "em dash, en dash or double dash"],
  [TEMPLATE_TAG, "Klaviyo template tag"],
  [/utm_[a-z]+=|_kx=|klclick|ctrk\./i, "tracking parameter or Klaviyo link wrapper"],
  [/unsubscribe|you're receiving this|manage preferences/i, "unsubscribe or footer copy"],
  [PRICE, "hard-coded price"],
  [OFFER, "discount code, offer or member-only line"],
  [/\bmullybox\b/i, "the word Mullybox"],
  [/\bTODO\b/, "unfinished TODO"],
  [/\]\(https?:\/\/(?:www\.)?(?:mymully|mullybox)\.com/i, "absolute Mully link (use a relative path)"],
];

/** Problems that block an insert. Empty array means the row is ready. */
export function validateLetterRow(row: LetterRow): string[] {
  const problems: string[] = [];
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(row.slug)) problems.push("slug must be lowercase words joined by hyphens");
  if (row.category !== LETTER_STORED_CATEGORY) problems.push(`category must be "${LETTER_STORED_CATEGORY}" (the stored category for letter issues)`);
  if (!LETTER_ISSUE_SLUGS.includes(row.slug)) problems.push(`add "${row.slug}" to LETTER_ISSUE_SLUGS in src/lib/letterIssues.ts`);
  if (row.excerpt.length < 150 || row.excerpt.length > 160) problems.push(`excerpt (meta description) is ${row.excerpt.length} characters; needs 150 to 160`);
  if (!row.title || row.title.length > 90) problems.push("title is missing or longer than 90 characters");
  if (!row.image || !row.image_alt) problems.push("hero image and alt text are required");
  if (Number.isNaN(new Date(row.publish_date).getTime())) problems.push("publish_date must be the send timestamp");
  if (row.sections.length === 0) problems.push("no sections");
  for (const s of row.sections) if (s.image && !s.imageAlt) problems.push(`section "${s.heading}" image needs alt text`);
  const fields: [string, string][] = [
    ["title", row.title], ["excerpt", row.excerpt], ["intro", row.intro], ["closing", row.closing], ["image_alt", row.image_alt],
    ...row.highlights.map((h, i) => [`highlights[${i}]`, h] as [string, string]),
    ...row.sections.flatMap((s, i) => [[`sections[${i}].heading`, s.heading], [`sections[${i}].imageAlt`, s.imageAlt ?? ""], [`sections[${i}].caption`, s.caption ?? ""], ...s.paragraphs.map((p, j) => [`sections[${i}].paragraphs[${j}]`, p])] as [string, string][]),
  ];
  for (const [name, value] of fields) {
    for (const [re, label] of BANNED) {
      const g = new RegExp(re.source, re.flags.replace("g", ""));
      if (g.test(value)) problems.push(`${name}: ${label}`);
    }
  }
  return problems;
}

/** Strip draft-only keys. */
export function toRow(draft: LetterRow & Partial<Pick<LetterDraft, "_source" | "_products" | "_warnings">>): LetterRow {
  const { slug, title, excerpt, category, date, read_time, image, image_alt, featured, intro, highlights, sections, closing, status, publish_date, seo_keywords } = draft;
  return { slug, title, excerpt, category, date, read_time, image, image_alt, featured, intro, highlights, sections, closing, status, publish_date, seo_keywords };
}

const lit = (s: string) => `'${s.replace(/'/g, "''")}'`;

/** Insert-only SQL. ON CONFLICT DO NOTHING so an existing slug is never touched. */
export function insertSql(row: LetterRow): string {
  const cols = ["slug", "title", "excerpt", "category", "date", "read_time", "image", "image_alt", "featured", "intro", "highlights", "sections", "closing", "status", "publish_date", "seo_keywords"];
  const vals = [
    lit(row.slug), lit(row.title), lit(row.excerpt), lit(row.category), lit(row.date), lit(row.read_time), lit(row.image), lit(row.image_alt),
    String(row.featured), lit(row.intro), `${lit(JSON.stringify(row.highlights))}::jsonb`, `${lit(JSON.stringify(row.sections))}::jsonb`,
    lit(row.closing), lit(row.status), `${lit(row.publish_date)}::timestamptz`, `ARRAY[${row.seo_keywords.map(lit).join(",")}]::text[]`,
  ];
  return `insert into public.blog_posts (${cols.join(", ")})\nvalues (${vals.join(", ")})\non conflict (slug) do nothing\nreturning id, slug;`;
}
