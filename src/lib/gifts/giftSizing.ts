/**
 * Reserve sizing fields shared by the Gift a Season purchase form (Step 2),
 * the /gift-address update page and the server. Same fields and options as
 * the existing /gift-sizing form (shirt, waist, inseam, shoe, glove size,
 * glove hand, notes) so the stylist sees the usual sizing on every order.
 *
 * Client safe: no server-only imports.
 */

export const SIZING_OPTIONS = {
  shirt: ["S", "M", "L", "XL", "XXL"],
  waist: ["28", "30", "32", "34", "36", "38", "40"],
  inseam: ['28"', '30"', '32"', '34"'],
  shoe: ["7", "7.5", "8", "8.5", "9", "9.5", "10", "10.5", "11", "11.5", "12", "13"],
  glove_size: ["S", "M", "ML", "L", "XL"],
  glove_hand: ["Left", "Right"],
} as const;

export type SizingKey = keyof typeof SIZING_OPTIONS;

export const SIZING_FIELDS: Array<{ key: SizingKey; label: string; short: string }> = [
  { key: "shirt", label: "Shirt size", short: "Shirt" },
  { key: "waist", label: "Pant waist", short: "Waist" },
  { key: "inseam", label: "Pant inseam", short: "Inseam" },
  { key: "shoe", label: "Shoe size (US)", short: "Shoe" },
  { key: "glove_size", label: "Glove size", short: "Glove" },
  { key: "glove_hand", label: "Glove hand", short: "Glove hand" },
];

export interface GiftSizing {
  shirt: string;
  waist: string;
  inseam: string;
  shoe: string;
  glove_size: string;
  glove_hand: string;
  notes: string;
}

export const EMPTY_SIZING: GiftSizing = {
  shirt: "",
  waist: "",
  inseam: "",
  shoe: "",
  glove_size: "",
  glove_hand: "",
  notes: "",
};

export const SIZING_NOTES_MAX = 300;

/**
 * Keep only known keys with allowed values (notes: trimmed free text).
 * Unknown or out-of-range values are dropped, never stored.
 */
export function sanitizeSizing(input: unknown): GiftSizing {
  const out: GiftSizing = { ...EMPTY_SIZING };
  if (!input || typeof input !== "object") return out;
  const src = input as Record<string, unknown>;
  for (const f of SIZING_FIELDS) {
    const v = typeof src[f.key] === "string" ? (src[f.key] as string).trim() : "";
    if ((SIZING_OPTIONS[f.key] as readonly string[]).includes(v)) out[f.key] = v;
  }
  if (typeof src.notes === "string") out.notes = src.notes.trim().slice(0, SIZING_NOTES_MAX);
  return out;
}

/** Fields still missing, as display labels. Same required set as /gift-sizing. */
export function missingSizing(s: GiftSizing): string[] {
  return SIZING_FIELDS.filter((f) => !s[f.key]).map((f) => f.label);
}

export function isSizingComplete(s: GiftSizing): boolean {
  return missingSizing(s).length === 0;
}

/** One-line summary for order notes, admin and emails. */
export function formatSizingLine(s: Partial<GiftSizing> | null | undefined): string {
  if (!s) return "";
  const parts = [
    s.shirt && `Shirt ${s.shirt}`,
    s.waist && `Waist ${s.waist}`,
    s.inseam && `Inseam ${s.inseam}`,
    s.shoe && `Shoe ${s.shoe}`,
    s.glove_size && `Glove ${s.glove_size}${s.glove_hand ? ` ${s.glove_hand}` : ""}`,
  ].filter(Boolean);
  return parts.join(", ");
}

/**
 * Line item properties for the stylist (shown on the Shopify order and the
 * packing slip). Readable keys; blanks are omitted.
 */
export function sizingLineAttributes(s: GiftSizing): Array<{ key: string; value: string }> {
  const attrs = SIZING_FIELDS.map((f) => ({ key: f.short, value: s[f.key] }));
  if (s.notes) attrs.push({ key: "Fit notes", value: s.notes });
  return attrs.filter((a) => a.value !== "");
}

/** Read sizing back from line item properties and/or note attributes. */
export function sizingFromAttributes(
  attrs: Array<{ name?: string; key?: string; value?: string | null }> | null | undefined
): GiftSizing {
  const map = new Map<string, string>();
  for (const a of attrs ?? []) {
    const k = (a.name ?? a.key ?? "").trim().toLowerCase();
    const v = (a.value ?? "").trim();
    if (k && v) map.set(k, v);
  }
  const raw: Record<string, string> = {};
  for (const f of SIZING_FIELDS) {
    raw[f.key] = map.get(f.short.toLowerCase()) ?? map.get(`gift_size_${f.key}`) ?? "";
  }
  raw.notes = map.get("fit notes") ?? map.get("gift_size_notes") ?? "";
  return sanitizeSizing(raw);
}
