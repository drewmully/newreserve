/**
 * GET /api/admin/cron/firestore-sourcing
 *
 * Walks Mully Reserve Firestore collections (`users`, `mulligan_submissions`,
 * `reserve_card`) and pulls sizing/preference fields onto Supabase customer_facts.
 *
 * Linking by email (lowercased) -> customers.id. Non-overwriting:
 *   - sizing columns (size_top, size_bottom, size_shoe) only fill if Supabase
 *     value is null (Shopify line item data wins because Drew confirmed
 *     line-item properties are the highest-fidelity sizing source).
 *   - style_tags merged additively.
 *   - sourcing_notes append a [firestore-{collection}] tagged block per source,
 *     idempotently (re-running replaces only the prior block of the same tag).
 *
 * Requires FIREBASE_SERVICE_ACCOUNT_BASE64.
 *
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
  style_tags: string[] | null;
  sourcing_notes: string | null;
  sourcing_facts_version: number | null;
}

interface SourcingHit {
  collection: string;
  size_top: string | null;
  size_bottom: string | null;
  size_shoe: string | null;
  style_tags: string[];
  // Free-form notes captured verbatim for human review (Glove Hand, Gender, etc.)
  notes: Record<string, string>;
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

// Heuristic field extractors — Mully Reserve schema isn't uniform across
// collections, so we accept multiple aliases.
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
  };

  // shirt / top size
  hit.size_top =
    norm(d.shirtSize) ||
    norm(d.shirt_size) ||
    norm(d.topSize) ||
    norm(d.top_size) ||
    norm((d.sizes as Record<string, unknown> | undefined)?.shirt) ||
    norm((d.sizes as Record<string, unknown> | undefined)?.top) ||
    null;

  // pant / bottom
  hit.size_bottom =
    norm(d.pantSize) ||
    norm(d.pant_size) ||
    norm(d.bottomSize) ||
    norm(d.bottom_size) ||
    norm(d.waistSize) ||
    norm((d.sizes as Record<string, unknown> | undefined)?.pant) ||
    norm((d.sizes as Record<string, unknown> | undefined)?.bottom) ||
    null;

  // shoe
  hit.size_shoe =
    norm(d.shoeSize) ||
    norm(d.shoe_size) ||
    norm((d.sizes as Record<string, unknown> | undefined)?.shoe) ||
    null;

  // style
  const styleVals = [
    ...asArr(d.style),
    ...asArr(d.styles),
    ...asArr(d.stylePreferences),
    ...asArr(d.style_preferences),
    ...asArr(d.preferredStyle),
  ];
  hit.style_tags = Array.from(new Set(styleVals));

  // free-form notes
  const noteFields: Array<[string, unknown]> = [
    ["Gender", d.gender ?? d.golferGender],
    ["Glove Hand", d.gloveHand ?? d.glove_hand ?? d.dominantHand],
    ["Glove Size", d.gloveSize ?? d.glove_size],
    ["Hat Size", d.hatSize ?? d.hat_size],
    ["Handicap", d.handicap],
    ["Favorite Brands", d.favoriteBrands ?? d.brandsLiked ?? d.brand_likes],
    ["Avoid Brands", d.avoidBrands ?? d.brand_dislikes],
    ["Colors Liked", d.colorsLiked ?? d.colorPreferences ?? d.color_preferences],
    ["Colors Avoided", d.colorsAvoided ?? d.colors_avoid],
    ["Notes", d.notes ?? d.preferences ?? d.preferenceNotes],
  ];
  for (const [k, raw] of noteFields) {
    if (Array.isArray(raw)) {
      const arr = asArr(raw);
      if (arr.length > 0) hit.notes[k] = arr.join(", ");
    } else {
      const n = norm(raw);
      if (n) hit.notes[k] = n;
    }
  }
  return hit;
}

function notesToText(notes: Record<string, string>): string | null {
  const entries = Object.entries(notes);
  if (entries.length === 0) return null;
  return entries.map(([k, v]) => `${k}: ${v}`).join("\n");
}

function mergeNotes(
  existing: string | null,
  tag: string,
  block: string | null,
): string | null {
  // Strip prior block with this tag, then append fresh.
  let merged = existing ?? "";
  if (merged) {
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

    // Per-collection scan. We capture (email -> latest hit).
    const COLLECTIONS = ["users", "mulligan_submissions", "reserve_card"];
    // email -> collection -> hit
    const byEmail = new Map<string, Map<string, SourcingHit>>();
    const collectionCounts: Record<string, number> = {};

    for (const col of COLLECTIONS) {
      try {
        const snap = await fs.collection(col).get();
        collectionCounts[col] = snap.size;
        for (const doc of snap.docs) {
          const data = doc.data() as Record<string, unknown>;
          const email =
            norm(data.email) ||
            norm(data.userEmail) ||
            norm(data.customerEmail) ||
            null;
          if (!email) continue;
          const lower = email.toLowerCase();
          const hit = extractFromDoc(col, data);
          const hasAny =
            hit.size_top ||
            hit.size_bottom ||
            hit.size_shoe ||
            hit.style_tags.length > 0 ||
            Object.keys(hit.notes).length > 0;
          if (!hasAny) continue;
          let m = byEmail.get(lower);
          if (!m) {
            m = new Map();
            byEmail.set(lower, m);
          }
          // Last write wins per-collection (we don't sort by timestamp; mostly
          // 1 doc per user anyway).
          m.set(col, hit);
        }
      } catch (e) {
        collectionCounts[col] = -1;
        setMeta({ [`${col}_error`]: e instanceof Error ? e.message : String(e) });
      }
    }
    setMeta({ collection_counts: collectionCounts, emails_with_hits: byEmail.size });

    if (byEmail.size === 0) {
      return { collections: collectionCounts, customers_updated: 0 };
    }

    // Resolve emails -> customers.id
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

    // Pull existing customer_facts for these
    const cids = Array.from(emailToCid.values());
    const existing = new Map<number, FactsRow>();
    for (let i = 0; i < cids.length; i += CHUNK) {
      const slice = cids.slice(i, i + CHUNK);
      const { data, error } = await sb
        .from("customer_facts")
        .select(
          "customer_id,size_top,size_bottom,size_shoe,style_tags,sourcing_notes,sourcing_facts_version",
        )
        .in("customer_id", slice);
      if (error) throw new Error(`customer_facts fetch: ${error.message}`);
      for (const r of (data || []) as FactsRow[]) existing.set(r.customer_id, r);
    }

    const now = new Date().toISOString();
    const upserts: Record<string, unknown>[] = [];
    for (const [email, perCol] of byEmail.entries()) {
      const cid = emailToCid.get(email);
      if (!cid) continue;
      const prev = existing.get(cid);

      // Sizing: only fill if Supabase is null (Shopify wins).
      let size_top = prev?.size_top ?? null;
      let size_bottom = prev?.size_bottom ?? null;
      let size_shoe = prev?.size_shoe ?? null;
      const styleSet = new Set<string>(prev?.style_tags ?? []);
      let sourcing = prev?.sourcing_notes ?? null;

      // Iterate collections in a stable priority order so first non-null fills.
      for (const col of COLLECTIONS) {
        const hit = perCol.get(col);
        if (!hit) continue;
        if (!size_top && hit.size_top) size_top = hit.size_top;
        if (!size_bottom && hit.size_bottom) size_bottom = hit.size_bottom;
        if (!size_shoe && hit.size_shoe) size_shoe = hit.size_shoe;
        for (const s of hit.style_tags) styleSet.add(s);
        const block = notesToText(hit.notes);
        if (block) {
          sourcing = mergeNotes(sourcing, `firestore-${col}`, block);
        }
      }

      upserts.push({
        customer_id: cid,
        size_top,
        size_bottom,
        size_shoe,
        style_tags: Array.from(styleSet),
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
