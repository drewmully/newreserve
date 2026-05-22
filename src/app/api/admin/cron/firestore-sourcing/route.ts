/**
 * GET /api/admin/cron/firestore-sourcing
 *
 * Walks Mully Reserve Firestore collections and projects sizing + style +
 * preference data onto `customer_facts` (linked by email -> customers.id).
 *
 * Real-world shape (verified against bone.sa@gmail.com):
 *   - users:
 *       fit_profile: { shirtSize, gloveHand, gloveSize, waistSize,
 *                      pantsInseam, shortsInseam, shoeSize }
 *       onboarding_profile: { birth_month, birth_day, birth_year, handicap,
 *                             private_club_member, club_name, vibe_check,
 *                             putter_type, selected_tier }
 *       subscriptions: { planName, billingInterval, nextBillingDate, ... }
 *       tier
 *   - mulligan_submissions (doc id is email):
 *       fit:   { shirt_size, pants_inseam, shorts_inseam, glove_hand,
 *                glove_size, waist_size, shoe_size }
 *       style: { vibe, color_preference, brand_interest[], putter_type }
 *       gender, first_name, last_name, reactivation_choice
 *   - reserve_card_submissions (collection name) — same general shape
 *
 * Idempotent: each Firestore collection's contribution lives in a tagged
 * block inside customer_facts.sourcing_notes ([firestore-{collection}]).
 * Re-running replaces that block in place, never duplicates.
 *
 * Sizing precedence: Shopify line item properties win (run sizing-extract
 * AFTER this). Where Supabase already has a non-null size, we don't overwrite.
 *
 * Requires FIREBASE_SERVICE_ACCOUNT_BASE64.
 * Auth: CRON_SECRET Bearer.
 */

import { NextRequest, NextResponse } from "next/server";
import { getSupabaseService, withJobRun } from "@/app/api/_lib/supabaseService";

export const runtime = "nodejs";
export const maxDuration = 800;

function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

interface FactsRow {
  customer_id: number;
  size_top: string | null;
  size_bottom: string | null;
  size_shoe: string | null;
  fit_notes: string | null;
  color_preferences: string[] | null;
  colors_avoid: string[] | null;
  brand_likes: string[] | null;
  brand_dislikes: string[] | null;
  style_tags: string[] | null;
  sourcing_notes: string | null;
  sourcing_summary: string | null;
  sourcing_facts_version: number | null;
}

interface SourcingHit {
  collection: string;
  size_top: string | null;
  size_bottom: string | null;
  size_shoe: string | null;
  style_tags: string[];
  // Free-form notes captured verbatim for human review.
  notes: Record<string, string>;
  // Targeted fields with their own customer_facts columns (which are
  // Postgres text[] arrays, not text):
  fit_notes_extra: string[];
  color_preferences: string[];
  brand_likes: string[];
}

function norm(v: unknown): string | null {
  if (v == null) return null;
  if (typeof v === "string") {
    const t = v.trim();
    return t.length === 0 ? null : t;
  }
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return null;
}

function asArr(v: unknown): string[] {
  if (Array.isArray(v)) {
    return v.map((x) => norm(x)).filter((s): s is string => !!s);
  }
  const n = norm(v);
  return n ? [n] : [];
}

// Walks dotted paths like "fit_profile.shirtSize", trying each in turn.
function dig(doc: Record<string, unknown>, path: string): unknown {
  const parts = path.split(".");
  let cur: unknown = doc;
  for (const p of parts) {
    if (cur == null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[p];
  }
  return cur;
}

function firstNorm(doc: Record<string, unknown>, paths: string[]): string | null {
  for (const p of paths) {
    const n = norm(dig(doc, p));
    if (n) return n;
  }
  return null;
}

function firstArr(doc: Record<string, unknown>, paths: string[]): string[] {
  for (const p of paths) {
    const v = dig(doc, p);
    if (Array.isArray(v)) {
      const arr = asArr(v);
      if (arr.length > 0) return arr;
    } else {
      const n = norm(v);
      if (n) return [n];
    }
  }
  return [];
}

function extractFromDoc(
  collection: string,
  d: Record<string, unknown>,
): SourcingHit {
  const hit: SourcingHit = {
    collection,
    size_top: null,
    size_bottom: null,
    size_shoe: null,
    style_tags: [],
    notes: {},
    fit_notes_extra: [],
    color_preferences: [],
    brand_likes: [],
  };

  // -------- Sizes (nested paths first, then flat aliases)
  hit.size_top = firstNorm(d, [
    "fit_profile.shirtSize",
    "fit_profile.shirt_size",
    "fit.shirt_size",
    "fit.shirtSize",
    "shirtSize",
    "shirt_size",
    "topSize",
    "top_size",
    "sizes.shirt",
    "sizes.top",
  ]);
  hit.size_bottom = firstNorm(d, [
    "fit_profile.waistSize",
    "fit_profile.pantSize",
    "fit_profile.pant_size",
    "fit.waist_size",
    "fit.pant_size",
    "waistSize",
    "waist_size",
    "pantSize",
    "pant_size",
    "bottomSize",
    "bottom_size",
    "sizes.pant",
    "sizes.bottom",
  ]);
  hit.size_shoe = firstNorm(d, [
    "fit_profile.shoeSize",
    "fit.shoe_size",
    "shoeSize",
    "shoe_size",
    "sizes.shoe",
  ]);

  // -------- Style tags
  const styleVals: string[] = [];
  // vibe / classic / casual / etc. — single tag per source
  const vibe = firstNorm(d, ["style.vibe", "vibe", "preferredStyle", "style"]);
  if (vibe) styleVals.push(vibe);
  styleVals.push(
    ...firstArr(d, [
      "style.style_tags",
      "stylePreferences",
      "style_preferences",
      "styles",
    ]),
  );
  hit.style_tags = Array.from(new Set(styleVals));

  // -------- Color preferences (Postgres text[] array)
  const colorSet = new Set<string>();
  const colorPref = firstNorm(d, [
    "style.color_preference",
    "colorPreference",
    "color_preference",
  ]);
  if (colorPref) colorSet.add(colorPref);
  for (const c of firstArr(d, [
    "colorsLiked",
    "color_preferences",
    "colorPreferences",
    "color_preferences_list",
  ])) {
    colorSet.add(c);
  }
  hit.color_preferences = Array.from(colorSet);

  // -------- Brand interest (Postgres text[] array)
  hit.brand_likes = firstArr(d, [
    "style.brand_interest",
    "brandInterest",
    "brand_interest",
    "favoriteBrands",
    "brand_likes",
    "brandsLiked",
  ]);

  // -------- Free-form notes block (everything interesting that doesn't map to
  //          a typed column)
  const noteFields: Array<[string, string[]]> = [
    ["Gender", ["gender", "golferGender"]],
    ["Handicap", ["onboarding_profile.handicap", "handicap"]],
    ["Vibe Check", ["onboarding_profile.vibe_check"]],
    ["Putter Type", ["onboarding_profile.putter_type", "style.putter_type"]],
    ["Birthdate", ["onboarding_profile.birthdate_iso"]],
    ["Tier", ["tier", "onboarding_profile.selected_tier"]],
    ["Private Club Member", ["onboarding_profile.private_club_member"]],
    ["Club Name", ["onboarding_profile.club_name"]],
    ["Glove Hand", ["fit_profile.gloveHand", "fit.glove_hand"]],
    ["Glove Size", ["fit_profile.gloveSize", "fit.glove_size"]],
    ["Pants Inseam", ["fit_profile.pantsInseam", "fit.pants_inseam"]],
    ["Shorts Inseam", ["fit_profile.shortsInseam", "fit.shorts_inseam"]],
    ["Waist", ["fit_profile.waistSize", "fit.waist_size"]],
    ["Hat Size", ["fit_profile.hatSize", "hatSize", "hat_size"]],
    ["Plan", ["subscriptions.planName"]],
    ["Billing Interval", ["subscriptions.billingInterval"]],
    ["Next Billing", ["subscriptions.nextBillingDate"]],
    ["Member Since", ["subscriptions.memberSince"]],
    ["Shipping City", ["subscriptions.shippingCity"]],
    ["Shipping State", ["subscriptions.shippingState"]],
    ["Reactivation Choice", ["reactivation_choice"]],
    ["Submitted", ["submitted_at"]],
  ];
  for (const [label, paths] of noteFields) {
    const raw = paths.map((p) => dig(d, p)).find((v) => v !== undefined);
    if (raw == null) continue;
    // Special-case Firestore Timestamp objects
    if (typeof raw === "object" && !Array.isArray(raw)) {
      const tsObj = raw as { _seconds?: number; toDate?: () => Date };
      if (typeof tsObj._seconds === "number") {
        const d2 = new Date(tsObj._seconds * 1000);
        hit.notes[label] = d2.toISOString().slice(0, 10);
        continue;
      }
      if (typeof tsObj.toDate === "function") {
        try {
          hit.notes[label] = tsObj.toDate().toISOString().slice(0, 10);
          continue;
        } catch {
          // fall through
        }
      }
    }
    const arr = Array.isArray(raw) ? asArr(raw) : null;
    if (arr) {
      if (arr.length > 0) hit.notes[label] = arr.join(", ");
    } else {
      const n = norm(raw);
      if (n) hit.notes[label] = n;
    }
  }

  return hit;
}

function notesToText(notes: Record<string, string>): string | null {
  const entries = Object.entries(notes);
  if (entries.length === 0) return null;
  return entries.map(([k, v]) => `${k}: ${v}`).join("\n");
}

function mergeTaggedNotes(
  existing: string | null,
  tag: string,
  block: string | null,
): string | null {
  let merged = existing ?? "";
  if (merged) {
    // Strip prior block with this exact tag, preserve everything else.
    const re = new RegExp(`(^|\\n)\\[${tag}\\][\\s\\S]*?(?=(\\n\\[|$))`, "g");
    merged = merged.replace(re, "").trim();
  }
  if (block && block.trim().length > 0) {
    const tagged = `[${tag}]\n${block.trim()}`;
    merged = merged ? `${merged}\n\n${tagged}` : tagged;
  }
  return merged.length === 0 ? null : merged;
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!process.env.FIREBASE_SERVICE_ACCOUNT_BASE64) {
    return NextResponse.json(
      { skipped: true, reason: "FIREBASE_SERVICE_ACCOUNT_BASE64 not set" },
      { status: 200 },
    );
  }

  const result = await withJobRun("firestore-sourcing", async ({ bumpRows, setMeta }) => {
    const admin = (await import("firebase-admin")).default;
    if (!admin.apps.length) {
      const sa = JSON.parse(
        Buffer.from(process.env.FIREBASE_SERVICE_ACCOUNT_BASE64!, "base64").toString("utf-8"),
      );
      admin.initializeApp({ credential: admin.credential.cert(sa) });
    }
    const fs = admin.firestore();

    // Verified collection names + their email field (mulligan_submissions doc
    // id IS the email, but a top-level "email" field is also present so we
    // can just read it like any other doc).
    const COLLECTIONS: Array<{ id: string; emailPaths: string[] }> = [
      { id: "users", emailPaths: ["email", "userEmail"] },
      { id: "mulligan_submissions", emailPaths: ["email"] },
      { id: "reserve_card_submissions", emailPaths: ["email", "userEmail", "customerEmail"] },
    ];

    // email -> collection -> hit
    const byEmail = new Map<string, Map<string, SourcingHit>>();
    const collectionCounts: Record<string, number> = {};

    for (const { id: col, emailPaths } of COLLECTIONS) {
      try {
        const snap = await fs.collection(col).get();
        collectionCounts[col] = snap.size;
        for (const doc of snap.docs) {
          const data = doc.data() as Record<string, unknown>;
          // Try several possible email fields, then fall back to doc id
          // (mulligan_submissions uses email-as-id).
          let email: string | null = null;
          for (const p of emailPaths) {
            const v = norm(dig(data, p));
            if (v && v.includes("@")) {
              email = v;
              break;
            }
          }
          if (!email && doc.id && doc.id.includes("@")) email = doc.id;
          if (!email) continue;
          const lower = email.toLowerCase();

          const hit = extractFromDoc(col, data);
          const hasAny =
            hit.size_top ||
            hit.size_bottom ||
            hit.size_shoe ||
            hit.style_tags.length > 0 ||
            hit.color_preferences.length > 0 ||
            hit.brand_likes.length > 0 ||
            Object.keys(hit.notes).length > 0;
          if (!hasAny) continue;

          let m = byEmail.get(lower);
          if (!m) {
            m = new Map();
            byEmail.set(lower, m);
          }
          m.set(col, hit);
        }
      } catch (e) {
        collectionCounts[col] = -1;
        setMeta({
          [`${col}_error`]: e instanceof Error ? e.message : String(e),
        });
      }
    }
    setMeta({ collection_counts: collectionCounts, emails_with_hits: byEmail.size });

    if (byEmail.size === 0) {
      return { collections: collectionCounts, customers_updated: 0 };
    }

    // Resolve emails -> customers.id (Supabase emails are stored lowercased)
    const sb = getSupabaseService();
    const emails = Array.from(byEmail.keys());
    const emailToCid = new Map<string, number>();
    const CHUNK = 500;
    for (let i = 0; i < emails.length; i += CHUNK) {
      const slice = emails.slice(i, i + CHUNK);
      const { data, error } = await sb
        .from("customers")
        .select("id,email")
        .in("email", slice);
      if (error) throw new Error(`customers fetch: ${error.message}`);
      for (const r of data || []) {
        if (r.email) emailToCid.set(String(r.email).toLowerCase(), Number(r.id));
      }
    }
    setMeta({ emails_resolved: emailToCid.size });

    // Pull existing customer_facts for everyone we'll touch
    const cids = Array.from(emailToCid.values());
    const existing = new Map<number, FactsRow>();
    for (let i = 0; i < cids.length; i += CHUNK) {
      const slice = cids.slice(i, i + CHUNK);
      const { data, error } = await sb
        .from("customer_facts")
        .select(
          "customer_id,size_top,size_bottom,size_shoe,fit_notes,color_preferences,colors_avoid,brand_likes,brand_dislikes,style_tags,sourcing_notes,sourcing_summary,sourcing_facts_version",
        )
        .in("customer_id", slice);
      if (error) throw new Error(`customer_facts fetch: ${error.message}`);
      for (const r of (data || []) as FactsRow[]) existing.set(r.customer_id, r);
    }

    const now = new Date().toISOString();
    const upserts: Record<string, unknown>[] = [];

    // Collection priority order for "first-non-null-wins" fills.
    const ORDER = ["users", "mulligan_submissions", "reserve_card_submissions"];

    for (const [email, perCol] of byEmail.entries()) {
      const cid = emailToCid.get(email);
      if (!cid) continue;
      const prev = existing.get(cid);

      // Sizing: fill only nulls (Shopify line item properties win — they run
      // after this in the chain).
      let size_top = prev?.size_top ?? null;
      let size_bottom = prev?.size_bottom ?? null;
      let size_shoe = prev?.size_shoe ?? null;
      const styleSet = new Set<string>(prev?.style_tags ?? []);
      const colorSet2 = new Set<string>(prev?.color_preferences ?? []);
      const brandSet = new Set<string>(prev?.brand_likes ?? []);
      let sourcing = prev?.sourcing_notes ?? null;

      for (const col of ORDER) {
        const hit = perCol.get(col);
        if (!hit) continue;
        if (!size_top && hit.size_top) size_top = hit.size_top;
        if (!size_bottom && hit.size_bottom) size_bottom = hit.size_bottom;
        if (!size_shoe && hit.size_shoe) size_shoe = hit.size_shoe;
        for (const s of hit.style_tags) styleSet.add(s);
        for (const c of hit.color_preferences) colorSet2.add(c);
        for (const b of hit.brand_likes) brandSet.add(b);
        const block = notesToText(hit.notes);
        if (block) {
          sourcing = mergeTaggedNotes(sourcing, `firestore-${col}`, block);
        }
      }

      upserts.push({
        customer_id: cid,
        size_top,
        size_bottom,
        size_shoe,
        style_tags: Array.from(styleSet),
        color_preferences: Array.from(colorSet2),
        brand_likes: Array.from(brandSet),
        sourcing_notes: sourcing,
        sourcing_facts_updated_at: now,
        sourcing_facts_version: (prev?.sourcing_facts_version ?? 0) + 1,
      });
    }

    let written = 0;
    for (let i = 0; i < upserts.length; i += CHUNK) {
      const slice = upserts.slice(i, i + CHUNK);
      const { error } = await sb
        .from("customer_facts")
        .upsert(slice, { onConflict: "customer_id" });
      if (error) throw new Error(`customer_facts upsert: ${error.message}`);
      written += slice.length;
    }
    bumpRows(byEmail.size, written);
    return {
      collections: collectionCounts,
      emails_with_hits: byEmail.size,
      emails_resolved: emailToCid.size,
      customers_updated: written,
    };
  });

  return NextResponse.json(result, { status: result.ok ? 200 : 500 });
}
