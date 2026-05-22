/**
 * GET /api/admin/cron/sizing-extract
 *
 * Walks `order_line_items.properties` (jsonb of Shopify line item customAttributes)
 * and projects sizing + style + sourcing notes onto `customer_facts`.
 *
 * Order -> customer linking: order_line_items.order_id -> orders.id -> orders.email
 *   -> customers.email -> customers.id.
 *
 * Property mapping (latest non-null per customer wins):
 *   - Shirt Size                       -> customer_facts.size_top
 *   - Pant Size | Bottom Size | Waist  -> customer_facts.size_bottom
 *   - Shoe Size                        -> customer_facts.size_shoe
 *   - Style                            -> appended (unique) to customer_facts.style_tags
 *   - Gender, Glove Hand, Glove Size,
 *     Hat Size, anything else useful   -> serialized into sourcing_notes
 *
 * Idempotent: upsert by customer_id; overlay-merges with existing facts row,
 * never clobbers a non-null sizing field with null.
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

type Props = Record<string, string | null> | null;

interface LineRow {
  order_id: number;
  properties: Props;
}

interface OrderEmailRow {
  id: number;
  email: string | null;
  created_at: string | null;
}

interface CustomerRow {
  id: number;
  email: string | null;
}

interface FactsRow {
  customer_id: number;
  size_top?: string | null;
  size_bottom?: string | null;
  size_shoe?: string | null;
  style_tags?: string[] | null;
  sourcing_notes?: string | null;
  sourcing_facts_version?: number | null;
}

// Normalize string values: trim, collapse whitespace, drop empties.
function norm(v: string | null | undefined): string | null {
  if (v == null) return null;
  const t = String(v).trim();
  return t.length === 0 ? null : t;
}

// Case-insensitive key lookup.
function pick(p: Record<string, string | null>, keys: string[]): string | null {
  const lowerMap: Record<string, string | null> = {};
  for (const k of Object.keys(p)) lowerMap[k.toLowerCase()] = p[k];
  for (const k of keys) {
    const v = lowerMap[k.toLowerCase()];
    const n = norm(v ?? null);
    if (n) return n;
  }
  return null;
}

interface Aggregated {
  size_top: string | null;
  size_bottom: string | null;
  size_shoe: string | null;
  style_tags: Set<string>;
  // Map of free-form note keys -> latest non-null value
  notes: Map<string, string>;
  latestAt: string | null;
}

const NOTE_KEYS = [
  "Gender",
  "Glove Hand",
  "Glove Size",
  "Hat Size",
  "Sock Size",
  "Belt Size",
  "Jacket Size",
  "Inseam",
  "Chest",
  "Waist",
];

function mergeProperties(agg: Aggregated, props: Props, when: string | null) {
  if (!props) return;
  const p = props as Record<string, string | null>;
  const top = pick(p, ["Shirt Size", "Top Size"]);
  const bottom = pick(p, ["Pant Size", "Bottom Size", "Pants Size"]);
  const shoe = pick(p, ["Shoe Size"]);
  const style = pick(p, ["Style"]);

  // "Latest wins" = order with greatest created_at sets it.
  const beats = !agg.latestAt || (when && when > agg.latestAt);
  if (beats) {
    if (top) agg.size_top = top;
    if (bottom) agg.size_bottom = bottom;
    if (shoe) agg.size_shoe = shoe;
    if (when) agg.latestAt = when;
  } else {
    // Fill nulls from older orders.
    if (top && !agg.size_top) agg.size_top = top;
    if (bottom && !agg.size_bottom) agg.size_bottom = bottom;
    if (shoe && !agg.size_shoe) agg.size_shoe = shoe;
  }
  if (style) {
    // Split comma-separated style tags.
    for (const s of style.split(/[,/]/g)) {
      const n = norm(s);
      if (n) agg.style_tags.add(n);
    }
  }
  for (const k of NOTE_KEYS) {
    const v = pick(p, [k]);
    if (v) agg.notes.set(k, v);
  }
}

function notesToText(notes: Map<string, string>): string | null {
  if (notes.size === 0) return null;
  const parts: string[] = [];
  for (const [k, v] of notes.entries()) parts.push(`${k}: ${v}`);
  return parts.join("\n");
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await withJobRun("sizing-extract", async ({ bumpRows, setMeta }) => {
    const sb = getSupabaseService();

    // 1) Pull all line items that have a non-null properties payload.
    //    Page through with range — could be tens of thousands.
    const PAGE = 5000;
    let from = 0;
    const lineItems: LineRow[] = [];
    while (true) {
      const { data, error } = await sb
        .from("order_line_items")
        .select("order_id,properties")
        .not("properties", "is", null)
        .range(from, from + PAGE - 1);
      if (error) throw new Error(`line items page: ${error.message}`);
      if (!data || data.length === 0) break;
      for (const r of data) lineItems.push(r as LineRow);
      if (data.length < PAGE) break;
      from += PAGE;
    }
    setMeta({ line_items_with_props: lineItems.length });

    if (lineItems.length === 0) {
      return { line_items: 0, customers_updated: 0 };
    }

    // 2) Bulk pull orders.email + created_at for all referenced order_ids.
    const orderIds = Array.from(new Set(lineItems.map((l) => l.order_id)));
    const orderMap = new Map<number, OrderEmailRow>();
    {
      const CHUNK = 1000;
      for (let i = 0; i < orderIds.length; i += CHUNK) {
        const slice = orderIds.slice(i, i + CHUNK);
        const { data, error } = await sb
          .from("orders")
          .select("id,email,created_at")
          .in("id", slice);
        if (error) throw new Error(`orders fetch: ${error.message}`);
        for (const r of data || []) orderMap.set(Number(r.id), r as OrderEmailRow);
      }
    }

    // 3) Bulk pull customers.id by lowercased email.
    const emails = Array.from(
      new Set(
        Array.from(orderMap.values())
          .map((o) => (o.email ? o.email.toLowerCase() : null))
          .filter((e): e is string => !!e),
      ),
    );
    const emailToCustomerId = new Map<string, number>();
    {
      const CHUNK = 500;
      for (let i = 0; i < emails.length; i += CHUNK) {
        const slice = emails.slice(i, i + CHUNK);
        const { data, error } = await sb
          .from("customers")
          .select("id,email")
          .in("email", slice);
        if (error) throw new Error(`customers fetch: ${error.message}`);
        for (const r of (data || []) as CustomerRow[]) {
          if (r.email) emailToCustomerId.set(r.email.toLowerCase(), r.id);
        }
      }
    }

    // 4) Aggregate per customer.
    const byCustomer = new Map<number, Aggregated>();
    for (const li of lineItems) {
      const ord = orderMap.get(li.order_id);
      if (!ord || !ord.email) continue;
      const cid = emailToCustomerId.get(ord.email.toLowerCase());
      if (!cid) continue;
      let agg = byCustomer.get(cid);
      if (!agg) {
        agg = {
          size_top: null,
          size_bottom: null,
          size_shoe: null,
          style_tags: new Set<string>(),
          notes: new Map<string, string>(),
          latestAt: null,
        };
        byCustomer.set(cid, agg);
      }
      mergeProperties(agg, li.properties, ord.created_at);
    }
    setMeta({
      orders_fetched: orderMap.size,
      emails_resolved: emailToCustomerId.size,
      customers_with_facts: byCustomer.size,
    });

    if (byCustomer.size === 0) {
      return { line_items: lineItems.length, customers_updated: 0 };
    }

    // 5) Pull existing customer_facts in bulk, overlay-merge, upsert.
    const customerIds = Array.from(byCustomer.keys());
    const existing = new Map<number, FactsRow>();
    {
      const CHUNK = 500;
      for (let i = 0; i < customerIds.length; i += CHUNK) {
        const slice = customerIds.slice(i, i + CHUNK);
        const { data, error } = await sb
          .from("customer_facts")
          .select(
            "customer_id,size_top,size_bottom,size_shoe,style_tags,sourcing_notes,sourcing_facts_version",
          )
          .in("customer_id", slice);
        if (error) throw new Error(`customer_facts fetch: ${error.message}`);
        for (const r of (data || []) as FactsRow[]) existing.set(r.customer_id, r);
      }
    }

    const now = new Date().toISOString();
    const SIZING_TAG = "[shopify-line-properties]";
    const upserts: Record<string, unknown>[] = [];
    for (const [cid, agg] of byCustomer.entries()) {
      const prev = existing.get(cid);
      // Latest-wins for sizing; never null out a previously-set value.
      const size_top = agg.size_top ?? prev?.size_top ?? null;
      const size_bottom = agg.size_bottom ?? prev?.size_bottom ?? null;
      const size_shoe = agg.size_shoe ?? prev?.size_shoe ?? null;
      // Merge style_tags
      const styleSet = new Set<string>(prev?.style_tags ?? []);
      for (const s of agg.style_tags) styleSet.add(s);

      // Merge sourcing_notes: replace any prior shopify-line-properties block,
      // preserve everything else the user wrote by hand.
      const noteBlock = notesToText(agg.notes);
      let merged = prev?.sourcing_notes ?? null;
      if (merged) {
        // Strip any prior block we wrote, preserve the rest.
        const re = new RegExp(
          `(^|\\n)${SIZING_TAG}[\\s\\S]*?(?=(\\n\\[|$))`,
          "g",
        );
        merged = merged.replace(re, "").trim();
        if (merged.length === 0) merged = null;
      }
      if (noteBlock) {
        const tagged = `${SIZING_TAG}\n${noteBlock}`;
        merged = merged ? `${merged}\n\n${tagged}` : tagged;
      }

      upserts.push({
        customer_id: cid,
        size_top,
        size_bottom,
        size_shoe,
        style_tags: Array.from(styleSet),
        sourcing_notes: merged,
        sourcing_facts_updated_at: now,
        sourcing_facts_version: (prev?.sourcing_facts_version ?? 0) + 1,
      });
    }

    // 6) Upsert in chunks.
    let written = 0;
    {
      const CHUNK = 500;
      for (let i = 0; i < upserts.length; i += CHUNK) {
        const slice = upserts.slice(i, i + CHUNK);
        const { error } = await sb
          .from("customer_facts")
          .upsert(slice, { onConflict: "customer_id" });
        if (error) throw new Error(`customer_facts upsert: ${error.message}`);
        written += slice.length;
      }
    }
    bumpRows(lineItems.length, written);
    return {
      line_items: lineItems.length,
      orders_resolved: orderMap.size,
      customers_updated: written,
    };
  });

  return NextResponse.json(result, { status: result.ok ? 200 : 500 });
}
