/**
 * Unit tests for the SMS-agent enrichment routing logic.
 *
 * Every branch of decideSubFlavor is covered, plus a handful of shape checks
 * on computeEnrichment. Fixtures are anonymized but modeled on real
 * abandoned-checkout data from the 2026-07-11 pull.
 */

import { describe, expect, it } from 'vitest';
import {
  classifyCart,
  computeEnrichment,
  decideSubFlavor,
  type CheckoutContext,
  type CustomerFactsRow,
  type CustomerRow,
} from '@/app/api/admin/sms-agent/enrichment/compute';

// ---------- Fixtures ----------

const REVEAL_ATTRS = { style_bucket: 'modern', quiz_profile_id: 'qp_abc123' };

const CART_RESERVE: CheckoutContext = {
  line_item_titles: ['Mully Reserve Member — $250'],
  cart_total: 250,
  custom_attributes: null,
};
const CART_RESERVE_WITH_QUIZ: CheckoutContext = {
  ...CART_RESERVE,
  custom_attributes: REVEAL_ATTRS,
};
const CART_ACCESS: CheckoutContext = {
  line_item_titles: ['Mully Access'],
  cart_total: 99,
  custom_attributes: null,
};
const CART_EDITORIAL: CheckoutContext = {
  line_item_titles: ['Rhone Commuter Pant', 'Rhone Commuter Shorts'],
  cart_total: 264,
  custom_attributes: null,
};

function mkCustomer(overrides: Partial<CustomerRow> = {}): CustomerRow {
  return {
    id: 1,
    email: 'test@example.com',
    first_name: 'Test',
    last_name: 'User',
    phone_e164: null,
    accepts_email_marketing: true,
    accepts_sms_marketing: false,
    is_email_suppressed: false,
    is_sms_suppressed: false,
    subscriber_status: null,
    segment: null,
    total_orders: 0,
    total_spent: 0,
    days_since_last_order: null,
    sms_consent_given_at: null,
    ...overrides,
  };
}

function mkFacts(overrides: Partial<CustomerFactsRow> = {}): CustomerFactsRow {
  return {
    customer_id: 1,
    customer_lifecycle_stage: null,
    engagement_vibe: null,
    ai_summary: null,
    churn_risk_score: null,
    swap_intent_score: null,
    is_subscriber_active: null,
    is_subscriber_lapsed: null,
    is_reserve_eligible: null,
    onboarding_completed: null,
    size_top: null,
    size_bottom: null,
    size_shoe: null,
    fit_notes: null,
    brand_likes: null,
    brand_dislikes: null,
    style_tags: null,
    color_preferences: null,
    colors_avoid: null,
    customer_topic_tags: null,
    reserve_reservation_at: null,
    reserve_founders_tier: null,
    ...overrides,
  };
}

// ---------- classifyCart ----------

describe('classifyCart', () => {
  it('detects Reserve when Mully Reserve is in the title', () => {
    expect(classifyCart(['Mully Reserve Member — $250'])).toBe('reserve');
  });
  it('detects Access when Mully Access is in the title but no Reserve', () => {
    expect(classifyCart(['Mully Access'])).toBe('access');
  });
  it('prefers Reserve when both Reserve and Access are present', () => {
    expect(classifyCart(['Mully Reserve', 'Mully Access'])).toBe('reserve');
  });
  it('falls back to editorial for apparel-only carts', () => {
    expect(classifyCart(['Rhone Commuter Pant', 'FootJoy polo'])).toBe('editorial');
  });
  it('is case-insensitive', () => {
    expect(classifyCart(['MULLY RESERVE MEMBER'])).toBe('reserve');
  });
  it('classifies empty carts as editorial (skip-by-fallthrough)', () => {
    expect(classifyCart([])).toBe('editorial');
  });
});

// ---------- decideSubFlavor branches ----------

describe('decideSubFlavor', () => {
  it('SUPPRESS: engagement_vibe=negative is a hard skip (keithwire case)', () => {
    const out = decideSubFlavor({
      customer: mkCustomer({ email: 'keithwire@gmail.com' }),
      facts: mkFacts({
        engagement_vibe: 'negative',
        ai_summary: 'Customer is annoyed by outreach and told the rep to stop contacting them.',
      }),
      in_suppression_list: false,
      cart: CART_ACCESS,
    });
    expect(out.sub_flavor).toBe('SUPPRESS');
    expect(out.suppress_reasons).toContain('engagement_vibe=negative');
  });

  it('SUPPRESS: is_sms_suppressed=true is a hard skip even without engagement_vibe', () => {
    const out = decideSubFlavor({
      customer: mkCustomer({ is_sms_suppressed: true, subscriber_status: 'active' }),
      facts: mkFacts({ is_subscriber_active: true }),
      in_suppression_list: false,
      cart: CART_RESERVE,
    });
    expect(out.sub_flavor).toBe('SUPPRESS');
    expect(out.suppress_reasons).toContain('is_sms_suppressed=true');
  });

  it('SUPPRESS: presence on suppression_list is a hard skip', () => {
    const out = decideSubFlavor({
      customer: mkCustomer(),
      facts: mkFacts(),
      in_suppression_list: true,
      cart: CART_RESERVE,
    });
    expect(out.sub_flavor).toBe('SUPPRESS');
    expect(out.suppress_reasons).toContain('in_suppression_list');
  });

  it('SUPPRESS collects all reasons when multiple apply', () => {
    const out = decideSubFlavor({
      customer: mkCustomer({ is_sms_suppressed: true }),
      facts: mkFacts({ engagement_vibe: 'negative' }),
      in_suppression_list: true,
      cart: CART_RESERVE,
    });
    expect(out.sub_flavor).toBe('SUPPRESS');
    expect(out.suppress_reasons.sort()).toEqual(
      ['engagement_vibe=negative', 'is_sms_suppressed=true', 'in_suppression_list'].sort()
    );
  });

  it('SKIP_EDITORIAL_ONLY: editorial-only cart skips even when member is fine', () => {
    const out = decideSubFlavor({
      customer: mkCustomer({ subscriber_status: 'active', total_orders: 11 }),
      facts: mkFacts({ is_subscriber_active: true, style_tags: ['Mix It Up'] }),
      in_suppression_list: false,
      cart: CART_EDITORIAL,
    });
    expect(out.sub_flavor).toBe('SKIP_EDITORIAL_ONLY');
    expect(out.cart_slot).toBe('editorial');
  });

  it('lapsed: subscriber_status=inactive routes to abandoned_checkout_lapsed', () => {
    const out = decideSubFlavor({
      customer: mkCustomer({
        first_name: 'Singor',
        subscriber_status: 'inactive',
        total_orders: 1,
        days_since_last_order: 403,
      }),
      facts: mkFacts({
        customer_lifecycle_stage: 'churned',
        is_subscriber_lapsed: true,
        churn_risk_score: 55,
      }),
      in_suppression_list: false,
      cart: CART_RESERVE,
    });
    expect(out.sub_flavor).toBe('abandoned_checkout_lapsed');
    expect(out.cart_slot).toBe('reserve');
  });

  it('lapsed: lifecycle_stage=churned alone is enough', () => {
    const out = decideSubFlavor({
      customer: mkCustomer({ total_orders: 3 }),
      facts: mkFacts({ customer_lifecycle_stage: 'churned' }),
      in_suppression_list: false,
      cart: CART_ACCESS,
    });
    expect(out.sub_flavor).toBe('abandoned_checkout_lapsed');
    expect(out.cart_slot).toBe('access');
  });

  it('lapsed beats active-addon when both signals are contradictory', () => {
    // Guardrail: if lifecycle says churned we prefer lapsed even if
    // subscriber_status hasn't caught up yet.
    const out = decideSubFlavor({
      customer: mkCustomer({ subscriber_status: 'active' }),
      facts: mkFacts({ customer_lifecycle_stage: 'churned' }),
      in_suppression_list: false,
      cart: CART_RESERVE,
    });
    expect(out.sub_flavor).toBe('abandoned_checkout_lapsed');
  });

  it('active_addon: active member re-adding Reserve (Manuel/Jeremy case)', () => {
    const out = decideSubFlavor({
      customer: mkCustomer({
        first_name: 'Manuel',
        subscriber_status: 'active',
        total_orders: 19,
      }),
      facts: mkFacts({
        is_subscriber_active: true,
        style_tags: ['Athletic'],
        size_top: 'L',
        customer_lifecycle_stage: 'active',
      }),
      in_suppression_list: false,
      cart: CART_RESERVE,
    });
    expect(out.sub_flavor).toBe('abandoned_checkout_active_addon');
  });

  it('active_addon: active member adding Access is still active_addon', () => {
    const out = decideSubFlavor({
      customer: mkCustomer({ subscriber_status: 'active', total_orders: 5 }),
      facts: mkFacts({ is_subscriber_active: true }),
      in_suppression_list: false,
      cart: CART_ACCESS,
    });
    expect(out.sub_flavor).toBe('abandoned_checkout_active_addon');
  });

  it('cold_quiz: brand new user with style_bucket from reveal (Chandler case)', () => {
    const out = decideSubFlavor({
      customer: mkCustomer({
        first_name: 'chandler',
        subscriber_status: null,
        total_orders: 0,
      }),
      facts: null,
      in_suppression_list: false,
      cart: CART_RESERVE_WITH_QUIZ,
    });
    expect(out.sub_flavor).toBe('abandoned_checkout_cold_quiz');
  });

  it('cold_quiz: works when customer row is absent entirely', () => {
    const out = decideSubFlavor({
      customer: null,
      facts: null,
      in_suppression_list: false,
      cart: CART_RESERVE_WITH_QUIZ,
    });
    expect(out.sub_flavor).toBe('abandoned_checkout_cold_quiz');
  });

  it('default: cold prospect without style_bucket falls to the base segment', () => {
    const out = decideSubFlavor({
      customer: mkCustomer({ total_orders: 0 }),
      facts: null,
      in_suppression_list: false,
      cart: CART_RESERVE,
    });
    expect(out.sub_flavor).toBe('abandoned_checkout');
  });

  it('default: returning (aged) shopper with 1+ order and no active/churned signal', () => {
    const out = decideSubFlavor({
      customer: mkCustomer({
        total_orders: 1,
        days_since_last_order: 200,
        subscriber_status: null,
      }),
      facts: mkFacts({ customer_lifecycle_stage: 'lead' }),
      in_suppression_list: false,
      cart: CART_RESERVE,
    });
    expect(out.sub_flavor).toBe('abandoned_checkout');
  });

  it('style_bucket only helps when total_orders=0 (returning shoppers do not get cold_quiz)', () => {
    const out = decideSubFlavor({
      customer: mkCustomer({ total_orders: 2 }),
      facts: null,
      in_suppression_list: false,
      cart: CART_RESERVE_WITH_QUIZ,
    });
    expect(out.sub_flavor).toBe('abandoned_checkout');
  });

  it('empty style_bucket string is treated as absent', () => {
    const out = decideSubFlavor({
      customer: mkCustomer({ total_orders: 0 }),
      facts: null,
      in_suppression_list: false,
      cart: {
        ...CART_RESERVE,
        custom_attributes: { style_bucket: '   ' },
      },
    });
    expect(out.sub_flavor).toBe('abandoned_checkout');
  });
});

// ---------- computeEnrichment shape ----------

describe('computeEnrichment', () => {
  it('returns found=false when customer is null (cold-quiz path still works)', () => {
    const out = computeEnrichment({
      customer: null,
      facts: null,
      in_suppression_list: false,
      suppression_reason: null,
      cart: CART_RESERVE_WITH_QUIZ,
    });
    expect(out.found).toBe(false);
    expect(out.customer_id).toBeNull();
    expect(out.sub_flavor).toBe('abandoned_checkout_cold_quiz');
    expect(out.style_bucket).toBe('modern');
    expect(out.quiz_profile_id).toBe('qp_abc123');
    expect(out.cart_slot).toBe('reserve');
  });

  it('surfaces engagement_vibe and ai_summary on suppress results', () => {
    const out = computeEnrichment({
      customer: mkCustomer({ email: 'keithwire@gmail.com', first_name: 'Keith' }),
      facts: mkFacts({
        engagement_vibe: 'negative',
        ai_summary: 'annoyed by outreach',
      }),
      in_suppression_list: false,
      suppression_reason: null,
      cart: CART_ACCESS,
    });
    expect(out.sub_flavor).toBe('SUPPRESS');
    expect(out.engagement_vibe).toBe('negative');
    expect(out.ai_summary).toBe('annoyed by outreach');
    expect(out.suppress_reasons).toEqual(['engagement_vibe=negative']);
    expect(out.first_name).toBe('Keith');
  });

  it('passes style_tags, size, brand_likes through for active members', () => {
    const out = computeEnrichment({
      customer: mkCustomer({
        first_name: 'Jeremy',
        subscriber_status: 'active',
        total_orders: 11,
        days_since_last_order: 4,
      }),
      facts: mkFacts({
        is_subscriber_active: true,
        style_tags: ['Mix It Up'],
        size_top: 'L',
        brand_likes: ['Rhone', 'FootJoy'],
        churn_risk_score: 25,
      }),
      in_suppression_list: false,
      suppression_reason: null,
      cart: CART_RESERVE,
    });
    expect(out.sub_flavor).toBe('abandoned_checkout_active_addon');
    expect(out.style_tags).toEqual(['Mix It Up']);
    expect(out.size_top).toBe('L');
    expect(out.brand_likes).toEqual(['Rhone', 'FootJoy']);
    expect(out.churn_risk_score).toBe(25);
  });

  it('carries suppression_reason through when in_suppression_list=true', () => {
    const out = computeEnrichment({
      customer: mkCustomer(),
      facts: mkFacts(),
      in_suppression_list: true,
      suppression_reason: 'hard_bounce',
      cart: CART_RESERVE,
    });
    expect(out.sub_flavor).toBe('SUPPRESS');
    expect(out.in_suppression_list).toBe(true);
    expect(out.suppression_reason).toBe('hard_bounce');
    expect(out.suppress_reasons).toContain('in_suppression_list');
  });
});
