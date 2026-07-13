/**
 * Pure enrichment logic for the SMS agent's abandoned-checkout pipeline.
 *
 * Given a customer record (from newreserve Supabase), the joined customer_facts
 * row, and the Shopify checkout context (line items + custom attributes),
 * decide:
 *   - which abandoned_checkout sub-flavor to enroll into, and
 *   - which fields the SMS agent needs at reply time.
 *
 * This is separated from the route so it is trivially unit-testable and the
 * routing rules stay in one place — the gameplan §5 table.
 */

// Supabase row shapes (subset — only what enrichment needs)
export interface CustomerRow {
  id: number;
  email: string;
  first_name: string | null;
  last_name: string | null;
  phone_e164: string | null;
  accepts_email_marketing: boolean | null;
  accepts_sms_marketing: boolean | null;
  is_email_suppressed: boolean | null;
  is_sms_suppressed: boolean | null;
  subscriber_status: string | null; // 'active' | 'inactive' | null
  segment: string | null;
  total_orders: number | null;
  total_spent: number | null;
  days_since_last_order: number | null;
  sms_consent_given_at: string | null;
}

export interface CustomerFactsRow {
  customer_id: number;
  customer_lifecycle_stage: string | null; // 'active' | 'churned' | 'lead' | ...
  engagement_vibe: string | null; // 'positive' | 'neutral' | 'negative' | null
  ai_summary: string | null;
  churn_risk_score: number | null;
  swap_intent_score: number | null;
  is_subscriber_active: boolean | null;
  is_subscriber_lapsed: boolean | null;
  is_reserve_eligible: boolean | null;
  onboarding_completed: boolean | null;
  size_top: string | null;
  size_bottom: string | null;
  size_shoe: string | null;
  fit_notes: string | null;
  brand_likes: string[] | null;
  brand_dislikes: string[] | null;
  style_tags: string[] | null;
  color_preferences: string[] | null;
  colors_avoid: string[] | null;
  customer_topic_tags: string[] | null;
  reserve_reservation_at: string | null;
  reserve_founders_tier: string | null;
}

export interface CheckoutContext {
  /** Shopify line-item titles as they appear on the cart. */
  line_item_titles: string[];
  /**
   * Cart total in dollars. Used to distinguish editorial-heavy from
   * subscription checkouts when no Reserve/Access product is present.
   */
  cart_total: number | null;
  /**
   * Shopify checkout customAttributes: quiz_profile_id, style_bucket,
   * utm_source, founding_100_gift, new_user, lp_source, etc.
   */
  custom_attributes: Record<string, string> | null;
}

export type SubFlavor =
  | 'SUPPRESS'
  | 'abandoned_checkout_lapsed'
  | 'abandoned_checkout_active_addon'
  | 'abandoned_checkout_cold_quiz'
  | 'abandoned_checkout'
  | 'SKIP_EDITORIAL_ONLY';

export type CartSlot = 'reserve' | 'access' | 'editorial';

export interface EnrichmentResult {
  found: boolean;
  customer_id: number | null;
  first_name: string | null;
  phone_e164: string | null;
  subscriber_status: string | null;
  segment: string | null;
  lifecycle_stage: string | null;
  total_orders: number | null;
  days_since_last_order: number | null;
  churn_risk_score: number | null;
  engagement_vibe: string | null;
  ai_summary: string | null;
  is_email_suppressed: boolean;
  is_sms_suppressed: boolean;
  in_suppression_list: boolean;
  suppression_reason: string | null;
  style_tags: string[] | null;
  size_top: string | null;
  size_bottom: string | null;
  size_shoe: string | null;
  brand_likes: string[] | null;
  brand_dislikes: string[] | null;
  fit_notes: string | null;
  color_preferences: string[] | null;
  cart_slot: CartSlot;
  style_bucket: string | null;
  quiz_profile_id: string | null;
  sub_flavor: SubFlavor;
  suppress_reasons: string[];
}

/** Detect what kind of product mix is in the checkout cart. */
export function classifyCart(titles: string[]): CartSlot {
  const lower = titles.map((t) => t.toLowerCase());
  if (lower.some((t) => t.includes('reserve'))) return 'reserve';
  // Check Access after Reserve because "Mully Access" and "Reserve" are separate SKUs.
  if (lower.some((t) => t.includes('access'))) return 'access';
  return 'editorial';
}

/**
 * The core decision. All routing rules live here. This function must be
 * deterministic and side-effect free so the tests can pin every branch.
 */
export function decideSubFlavor(input: {
  customer: CustomerRow | null;
  facts: CustomerFactsRow | null;
  in_suppression_list: boolean;
  cart: CheckoutContext;
}): { sub_flavor: SubFlavor; cart_slot: CartSlot; suppress_reasons: string[] } {
  const { customer, facts, in_suppression_list, cart } = input;
  const suppress_reasons: string[] = [];
  const cart_slot = classifyCart(cart.line_item_titles);
  const style_bucket = readAttr(cart.custom_attributes, 'style_bucket');

  // Hard suppression path — never send.
  if (facts?.engagement_vibe === 'negative') {
    suppress_reasons.push('engagement_vibe=negative');
  }
  if (customer?.is_sms_suppressed === true) {
    suppress_reasons.push('is_sms_suppressed=true');
  }
  if (in_suppression_list) {
    suppress_reasons.push('in_suppression_list');
  }
  if (suppress_reasons.length > 0) {
    return { sub_flavor: 'SUPPRESS', cart_slot, suppress_reasons };
  }

  // Editorial-only carts skip outreach — low intent signal.
  if (cart_slot === 'editorial') {
    return { sub_flavor: 'SKIP_EDITORIAL_ONLY', cart_slot, suppress_reasons: [] };
  }

  // Lapsed / churned member re-considering — highest priority routing
  // (customer must exist to be lapsed).
  const isChurned =
    facts?.customer_lifecycle_stage === 'churned' ||
    customer?.subscriber_status === 'inactive' ||
    facts?.is_subscriber_lapsed === true;
  if (isChurned) {
    return { sub_flavor: 'abandoned_checkout_lapsed', cart_slot, suppress_reasons: [] };
  }

  // Active member adding a second Reserve or Access on top.
  const isActive =
    customer?.subscriber_status === 'active' || facts?.is_subscriber_active === true;
  if (isActive) {
    return { sub_flavor: 'abandoned_checkout_active_addon', cart_slot, suppress_reasons: [] };
  }

  // Cold prospect who completed the reveal quiz — style_bucket present in
  // checkout customAttributes. This is the highest-value opener because we
  // have a real signal to mirror back.
  const noOrders = (customer?.total_orders ?? 0) === 0;
  if (noOrders && style_bucket) {
    return { sub_flavor: 'abandoned_checkout_cold_quiz', cart_slot, suppress_reasons: [] };
  }

  // Everyone else — the default abandoned_checkout segment already in the
  // mully-sms-agent repo.
  return { sub_flavor: 'abandoned_checkout', cart_slot, suppress_reasons: [] };
}

function readAttr(
  attrs: Record<string, string> | null,
  key: string
): string | null {
  if (!attrs) return null;
  const v = attrs[key];
  return v && v.trim().length > 0 ? v.trim() : null;
}

/** Build the wire response shape from raw DB rows + cart context. */
export function computeEnrichment(input: {
  customer: CustomerRow | null;
  facts: CustomerFactsRow | null;
  in_suppression_list: boolean;
  suppression_reason: string | null;
  cart: CheckoutContext;
}): EnrichmentResult {
  const { customer, facts, in_suppression_list, suppression_reason, cart } = input;
  const decision = decideSubFlavor({
    customer,
    facts,
    in_suppression_list,
    cart,
  });

  return {
    found: !!customer,
    customer_id: customer?.id ?? null,
    first_name: customer?.first_name ?? null,
    phone_e164: customer?.phone_e164 ?? null,
    subscriber_status: customer?.subscriber_status ?? null,
    segment: customer?.segment ?? null,
    lifecycle_stage: facts?.customer_lifecycle_stage ?? null,
    total_orders: customer?.total_orders ?? null,
    days_since_last_order: customer?.days_since_last_order ?? null,
    churn_risk_score: facts?.churn_risk_score ?? null,
    engagement_vibe: facts?.engagement_vibe ?? null,
    ai_summary: facts?.ai_summary ?? null,
    is_email_suppressed: customer?.is_email_suppressed === true,
    is_sms_suppressed: customer?.is_sms_suppressed === true,
    in_suppression_list,
    suppression_reason,
    style_tags: facts?.style_tags ?? null,
    size_top: facts?.size_top ?? null,
    size_bottom: facts?.size_bottom ?? null,
    size_shoe: facts?.size_shoe ?? null,
    brand_likes: facts?.brand_likes ?? null,
    brand_dislikes: facts?.brand_dislikes ?? null,
    fit_notes: facts?.fit_notes ?? null,
    color_preferences: facts?.color_preferences ?? null,
    cart_slot: decision.cart_slot,
    style_bucket: readAttr(cart.custom_attributes, 'style_bucket'),
    quiz_profile_id: readAttr(cart.custom_attributes, 'quiz_profile_id'),
    sub_flavor: decision.sub_flavor,
    suppress_reasons: decision.suppress_reasons,
  };
}
