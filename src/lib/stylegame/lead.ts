/**
 * Style Game lead persistence.
 *
 * One row in `stylegame_lead` per quiz play. Written first from
 * POST /api/stylegame/played at the finale, then updated from the
 * shopify orders-paid webhook when the order carries `funnel=stylegame`.
 *
 * Identity stitching order (strongest first):
 *   1. mully_anon_id cookie (present on both game plays and cart attributes)
 *   2. shopify_order_id (present on all paid orders)
 *   3. customer_email (fallback for direct-checkout leads)
 *
 * All writes go through the service role — the anon key never touches this
 * table. Callers are expected to be Next.js server routes.
 */

import { getSupabaseService } from "@/app/api/_lib/supabaseService";

export const STYLEGAME_SELLING_PLAN_ID = "3671163072"; // Shopify SellingPlan
export const STYLEGAME_CART_ATTR_KEY = "funnel"; // value = "stylegame"

export interface QuizResult {
  profile?: string | null;
  name?: string | null;
  confidence?: number | null;
  pcts?: {
    prep?: string | number | null;
    modern?: string | number | null;
    classic?: string | number | null;
    athletic?: string | number | null;
  } | null;
  color?: number | null;
  fit?: number | null;
  gift?: boolean | null;
}

/**
 * One entry in the click-by-click pick log captured by the game's
 * `window._sgOnPick` hook. The shape is deliberately loose so we can add
 * new signals to `o` without breaking the DB payload — everything lands
 * inside `stylegame_lead.picks` as jsonb.
 */
export interface StylegamePick {
  seq?: number | null;
  step?: number | null;
  screen?: string | null;
  w?: number | null;
  t_ms?: number | null;
  o?: {
    v?: number[] | null;
    c?: number | null;
    p?: number | null;
    f?: number | null;
    fit?: number | null;
    t?: string | null;
    k?: string | null;
    z?: number | null;
  } | null;
}

export interface UpsertPlayedInput {
  mully_anon_id?: string | null;
  quiz_result: QuizResult;
  picks?: StylegamePick[] | null;
  utm_source?: string | null;
  utm_medium?: string | null;
  utm_campaign?: string | null;
  utm_content?: string | null;
  utm_term?: string | null;
  referer?: string | null;
  user_agent?: string | null;
}

function toInt(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : parseInt(String(value), 10);
  return Number.isFinite(n) ? n : null;
}

function toNum(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * Normalize the client-supplied picks array before it hits jsonb. Keeps only
 * the shape we documented in `StylegamePick`, caps at 200 entries and 60/40
 * chars on the human-readable option labels. Anything unrecognized is dropped
 * silently rather than throwing — a bad picks payload should never fail the
 * played endpoint.
 */
function sanitizePicks(
  raw: StylegamePick[] | null | undefined
): StylegamePick[] | null {
  if (!Array.isArray(raw)) return null;
  const out: StylegamePick[] = [];
  for (const p of raw.slice(0, 200)) {
    if (!p || typeof p !== "object") continue;
    const src = (p.o && typeof p.o === "object") ? p.o : {};
    const cleanO: NonNullable<StylegamePick["o"]> = {};
    if (Array.isArray(src.v) && src.v.length === 4) {
      cleanO.v = src.v.map((n) => toNum(n) ?? 0);
    }
    if (src.c != null) cleanO.c = toNum(src.c);
    if (src.p != null) cleanO.p = toNum(src.p);
    if (src.f != null) cleanO.f = toNum(src.f);
    if (src.fit !== undefined) cleanO.fit = toNum(src.fit);
    if (src.t != null) cleanO.t = String(src.t).slice(0, 60);
    if (src.k != null) cleanO.k = String(src.k).slice(0, 40);
    if (src.z != null) cleanO.z = toNum(src.z);
    // Drop entries that carry no scoring signal AND no identifying metadata
    // — keeps garbage out of jsonb without failing the whole request.
    if (
      Object.keys(cleanO).length === 0 &&
      p.seq == null &&
      p.step == null &&
      !p.screen
    ) {
      continue;
    }
    out.push({
      seq: toInt(p.seq),
      step: toInt(p.step),
      screen: p.screen != null ? String(p.screen).slice(0, 40) : null,
      w: toNum(p.w),
      t_ms: toInt(p.t_ms),
      o: cleanO,
    });
  }
  return out.length > 0 ? out : null;
}

/**
 * Insert a `played` row. Idempotent when called with the same anon_id
 * inside a short window (5 minutes) — reuses the most recent row instead
 * of creating a duplicate, so a double-fire of the finale event doesn't
 * pollute the table.
 */
export async function insertPlayedLead(
  input: UpsertPlayedInput
): Promise<{ id: string; created: boolean }> {
  const sb = getSupabaseService();
  const anon = input.mully_anon_id ?? null;

  // Look for a recent duplicate under the same anon_id.
  if (anon) {
    const { data: recent } = await sb
      .from("stylegame_lead")
      .select("id, played_at, status")
      .eq("mully_anon_id", anon)
      .gte("played_at", new Date(Date.now() - 5 * 60_000).toISOString())
      .order("played_at", { ascending: false })
      .limit(1);
    if (recent && recent.length > 0) {
      return { id: recent[0].id, created: false };
    }
  }

  const r = input.quiz_result || {};
  const pcts = r.pcts || {};
  const row = {
    mully_anon_id: anon,
    profile_key: r.profile ?? null,
    profile_name: r.name ?? null,
    confidence: toInt(r.confidence),
    pct_prep: toInt(pcts.prep),
    pct_modern: toInt(pcts.modern),
    pct_classic: toInt(pcts.classic),
    pct_athletic: toInt(pcts.athletic),
    color_zone: toInt(r.color),
    fit: toInt(r.fit),
    gift: !!r.gift,
    quiz_result_json: r as unknown as Record<string, unknown>,
    picks: sanitizePicks(input.picks),
    utm_source: input.utm_source ?? null,
    utm_medium: input.utm_medium ?? null,
    utm_campaign: input.utm_campaign ?? null,
    utm_content: input.utm_content ?? null,
    utm_term: input.utm_term ?? null,
    referer: input.referer ?? null,
    user_agent: input.user_agent ?? null,
    status: "played" as const,
  };

  const { data, error } = await sb
    .from("stylegame_lead")
    .insert(row)
    .select("id")
    .single();
  if (error) throw error;
  return { id: data.id, created: true };
}

interface OrderNoteAttribute {
  name: string;
  value: string;
}
interface OrderCustomer {
  id?: number | string | null;
  email?: string | null;
}
interface OrderLineItem {
  properties?: Array<{ name: string; value: string }> | null;
  selling_plan_allocation?: {
    selling_plan?: { id?: number | string | null } | null;
  } | null;
}
interface ShopifyOrderShape {
  id: number | string;
  name?: string | null;
  email?: string | null;
  customer?: OrderCustomer | null;
  note_attributes?: OrderNoteAttribute[] | null;
  line_items?: OrderLineItem[] | null;
}

export function isStylegameOrder(order: ShopifyOrderShape): boolean {
  const attr = order.note_attributes?.find((a) => a.name === STYLEGAME_CART_ATTR_KEY);
  if (attr?.value === "stylegame") return true;
  // Fallback: any line item on the Style Game selling plan.
  const lineHit = order.line_items?.some(
    (li) =>
      String(li.selling_plan_allocation?.selling_plan?.id ?? "") ===
      STYLEGAME_SELLING_PLAN_ID
  );
  return !!lineHit;
}

/**
 * Link a paid Shopify order to its `stylegame_lead` row.
 *
 * Match order (best first):
 *   1. mully_anon_id from order attributes → most recent 'played' row for that anon
 *   2. customer_email → most recent 'played' row for that email
 *   3. None matched → INSERT a new row (direct-checkout path, quiz_result blob from order attrs)
 *
 * Idempotent by `shopify_order_id` (unique index).
 */
export async function linkOrderToLead(
  order: ShopifyOrderShape
): Promise<{ id: string; matched: "anon" | "email" | "created" | "already" }> {
  const sb = getSupabaseService();

  // Short-circuit: was this order already linked?
  const { data: alreadyLinked } = await sb
    .from("stylegame_lead")
    .select("id")
    .eq("shopify_order_id", order.id as number)
    .limit(1);
  if (alreadyLinked && alreadyLinked.length > 0) {
    return { id: alreadyLinked[0].id, matched: "already" };
  }

  const attrs = order.note_attributes ?? [];
  const readAttr = (key: string) =>
    attrs.find((a) => a.name === key)?.value ?? null;

  const anon = readAttr("mully_anon_id");
  const email = order.email ?? order.customer?.email ?? null;
  const stylegameResultRaw = readAttr("stylegame_result");
  let quizResult: QuizResult = {};
  if (stylegameResultRaw) {
    try {
      quizResult = JSON.parse(stylegameResultRaw);
    } catch {
      // ignore malformed
    }
  }

  const updatePayload = {
    shopify_order_id: order.id as number,
    shopify_order_name: order.name ?? null,
    shopify_customer_id: order.customer?.id
      ? Number(order.customer.id)
      : null,
    customer_email: email,
    status: "paid" as const,
    paid_at: new Date().toISOString(),
  };

  // (1) anon match
  if (anon) {
    const { data: byAnon } = await sb
      .from("stylegame_lead")
      .select("id")
      .eq("mully_anon_id", anon)
      .eq("status", "played")
      .order("played_at", { ascending: false })
      .limit(1);
    if (byAnon && byAnon.length > 0) {
      const { error } = await sb
        .from("stylegame_lead")
        .update(updatePayload)
        .eq("id", byAnon[0].id);
      if (error) throw error;
      return { id: byAnon[0].id, matched: "anon" };
    }
  }

  // (2) email match
  if (email) {
    const { data: byEmail } = await sb
      .from("stylegame_lead")
      .select("id")
      .eq("customer_email", email)
      .in("status", ["played"])
      .order("played_at", { ascending: false })
      .limit(1);
    if (byEmail && byEmail.length > 0) {
      const { error } = await sb
        .from("stylegame_lead")
        .update(updatePayload)
        .eq("id", byEmail[0].id);
      if (error) throw error;
      return { id: byEmail[0].id, matched: "email" };
    }
  }

  // (3) no match — create from order attributes.
  const pcts = quizResult.pcts || {};
  const insertRow = {
    ...updatePayload,
    mully_anon_id: anon,
    profile_key: quizResult.profile ?? readAttr("stylegame_profile"),
    profile_name:
      quizResult.name ?? readAttr("stylegame_profile_name"),
    confidence: toInt(quizResult.confidence),
    pct_prep: toInt(pcts.prep),
    pct_modern: toInt(pcts.modern),
    pct_classic: toInt(pcts.classic),
    pct_athletic: toInt(pcts.athletic),
    color_zone: toInt(quizResult.color),
    fit: toInt(quizResult.fit),
    gift: !!quizResult.gift || readAttr("gift") === "1",
    quiz_result_json: quizResult as unknown as Record<string, unknown>,
    utm_source: readAttr("utm_source"),
    utm_medium: readAttr("utm_medium"),
    utm_campaign: readAttr("utm_campaign"),
    utm_content: readAttr("utm_content"),
    utm_term: readAttr("utm_term"),
  };
  const { data: created, error: createErr } = await sb
    .from("stylegame_lead")
    .insert(insertRow)
    .select("id")
    .single();
  if (createErr) throw createErr;
  return { id: created.id, matched: "created" };
}

/**
 * Mark a lead's Loop subscription paused. Records `loop_subscription_id`
 * and `next_billing_date` on the row so the stylist UI knows the current
 * pause horizon.
 */
export async function recordLeadLoopPause(
  leadId: string,
  loopSubscriptionId: string,
  nextBillingEpochSeconds: number
): Promise<void> {
  const sb = getSupabaseService();
  const { error } = await sb
    .from("stylegame_lead")
    .update({
      loop_subscription_id: loopSubscriptionId,
      next_billing_date: new Date(
        nextBillingEpochSeconds * 1000
      ).toISOString(),
    })
    .eq("id", leadId);
  if (error) throw error;
}

// ---------------------------------------------------------------------------
// Phase 4: stylist approval workflow
// ---------------------------------------------------------------------------

/**
 * Shape of a single stylist pick. Kept loose because the stylist can
 * hand-enter these; we only require enough to identify what shipped.
 */
export interface StylistPick {
  variant_id?: string; // numeric or GID; either is fine
  title?: string;
  sku?: string;
  size?: string;
  color?: string;
  msrp?: number;
  [k: string]: unknown;
}

/**
 * Load a single lead row for the approval flow. Returns the whole row so
 * the caller can validate status, presence of loop_subscription_id, etc.
 */
export async function getLeadById(
  leadId: string,
): Promise<Record<string, unknown> | null> {
  const sb = getSupabaseService();
  const { data, error } = await sb
    .from("stylegame_lead")
    .select("*")
    .eq("id", leadId)
    .maybeSingle();
  if (error) throw error;
  return (data as Record<string, unknown> | null) ?? null;
}

/**
 * Persist stylist approval on the row. Sets status='approved', stamps
 * approved_at, stores picks + notes, and updates next_billing_date to the
 * new imminent-bill epoch the caller passed to Loop.
 *
 * Idempotent: safe to re-run with the same picks. Does NOT change status
 * back from later terminal states (billed/declined/refunded).
 */
export async function markLeadApproved(params: {
  leadId: string;
  picks: StylistPick[];
  stylistNotes?: string | null;
  nextBillingEpochSeconds: number;
}): Promise<void> {
  const sb = getSupabaseService();
  const { leadId, picks, stylistNotes, nextBillingEpochSeconds } = params;
  const { error } = await sb
    .from("stylegame_lead")
    .update({
      status: "approved",
      approved_at: new Date().toISOString(),
      picks: picks as unknown as Record<string, unknown>[],
      stylist_notes: stylistNotes ?? null,
      next_billing_date: new Date(
        nextBillingEpochSeconds * 1000,
      ).toISOString(),
    })
    .eq("id", leadId)
    .in("status", ["paid", "approved"]); // only advance from paid; re-run from approved is fine
  if (error) throw error;
}

/**
 * Persist stylist decline on the row. Sets status='declined' and stores
 * any reason as stylist_notes. Loop cancellation is handled at the route
 * level so we can fail loud on either side without half-writing state.
 */
export async function markLeadDeclined(params: {
  leadId: string;
  reason?: string | null;
}): Promise<void> {
  const sb = getSupabaseService();
  const { leadId, reason } = params;
  const { error } = await sb
    .from("stylegame_lead")
    .update({
      status: "declined",
      stylist_notes: reason ?? null,
    })
    .eq("id", leadId)
    .in("status", ["paid", "played", "declined"]); // block already-approved rows from being force-declined
  if (error) throw error;
}
