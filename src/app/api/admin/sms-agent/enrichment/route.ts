/**
 * POST /api/admin/sms-agent/enrichment
 *
 * Called by mully-sms-agent's Shopify abandoned-checkout webhook. Given an
 * email (and optional shopify_customer_id + phone_e164 + Shopify checkout
 * context), joins newreserve's customers + customer_facts + suppression_list
 * to compute:
 *   - which abandoned_checkout sub-flavor the SMS agent should enroll into
 *   - the personalization payload the LLM needs at reply time
 *     (style_tags, size, brand likes, engagement vibe, ai_summary, etc.)
 *
 * Auth: `Authorization: Bearer $SMS_AGENT_ENRICHMENT_SECRET`
 *
 * Request body:
 *   {
 *     email: string,                     // required, canonical join key
 *     shopify_customer_id?: string,      // optional, future use
 *     phone_e164?: string,               // optional, used only for suppression cross-check
 *     cart?: {
 *       line_item_titles?: string[],
 *       cart_total?: number,
 *       custom_attributes?: Record<string,string>,
 *     }
 *   }
 *
 * Response: see EnrichmentResult in ./compute.ts.
 *
 * Latency budget: ~150ms p95. The SMS webhook must remain snappy for Shopify.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseService } from '@/app/api/_lib/supabaseService';
import {
  computeEnrichment,
  type CheckoutContext,
  type CustomerFactsRow,
  type CustomerRow,
  type EnrichmentResult,
} from './compute';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function authorized(req: NextRequest): boolean {
  const header = req.headers.get('Authorization') ?? '';
  const token = header.replace(/^Bearer\s+/i, '').trim();
  const secret = process.env.SMS_AGENT_ENRICHMENT_SECRET;
  return !!(secret && token && token === secret);
}

interface Body {
  email?: unknown;
  shopify_customer_id?: unknown;
  phone_e164?: unknown;
  cart?: {
    line_item_titles?: unknown;
    cart_total?: unknown;
    custom_attributes?: unknown;
  };
}

function parseCart(raw: Body['cart']): CheckoutContext {
  const titles = Array.isArray(raw?.line_item_titles)
    ? raw!.line_item_titles.filter((t): t is string => typeof t === 'string')
    : [];
  const totalRaw = raw?.cart_total;
  const total = typeof totalRaw === 'number' && Number.isFinite(totalRaw) ? totalRaw : null;
  const attrsRaw = raw?.custom_attributes;
  const attrs: Record<string, string> = {};
  if (attrsRaw && typeof attrsRaw === 'object' && !Array.isArray(attrsRaw)) {
    for (const [k, v] of Object.entries(attrsRaw as Record<string, unknown>)) {
      if (typeof v === 'string') attrs[k] = v;
    }
  }
  return {
    line_item_titles: titles,
    cart_total: total,
    custom_attributes: Object.keys(attrs).length ? attrs : null,
  };
}

export async function POST(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }

  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  if (!email) {
    return NextResponse.json({ error: 'email required' }, { status: 400 });
  }

  const phone_e164 =
    typeof body.phone_e164 === 'string' && body.phone_e164.trim().length > 0
      ? body.phone_e164.trim()
      : null;

  const cart = parseCart(body.cart);
  const sb = getSupabaseService();

  // 1. customers row
  const { data: custRow, error: custErr } = await sb
    .from('customers')
    .select(
      'id,email,first_name,last_name,phone_e164,accepts_email_marketing,accepts_sms_marketing,is_email_suppressed,is_sms_suppressed,subscriber_status,segment,total_orders,total_spent,days_since_last_order,sms_consent_given_at'
    )
    .eq('email', email)
    .maybeSingle();

  if (custErr) {
    return NextResponse.json({ error: `customers query failed: ${custErr.message}` }, { status: 500 });
  }
  const customer: CustomerRow | null = custRow as CustomerRow | null;

  // 2. customer_facts row (may be absent for cold prospects)
  let facts: CustomerFactsRow | null = null;
  if (customer) {
    const { data: factsRow, error: factsErr } = await sb
      .from('customer_facts')
      .select(
        'customer_id,customer_lifecycle_stage,engagement_vibe,ai_summary,churn_risk_score,swap_intent_score,is_subscriber_active,is_subscriber_lapsed,is_reserve_eligible,onboarding_completed,size_top,size_bottom,size_shoe,fit_notes,brand_likes,brand_dislikes,style_tags,color_preferences,colors_avoid,customer_topic_tags,reserve_reservation_at,reserve_founders_tier'
      )
      .eq('customer_id', customer.id)
      .maybeSingle();
    if (factsErr) {
      return NextResponse.json({ error: `customer_facts query failed: ${factsErr.message}` }, { status: 500 });
    }
    facts = factsRow as CustomerFactsRow | null;
  }

  // 3. suppression_list — hard drop if the email OR the phone_e164 is on it
  //    with channel='sms' or channel='all'. Email-only suppressions (channel='email')
  //    should NOT block SMS outreach.
  let suppressionQuery = sb
    .from('suppression_list')
    .select('email,phone_e164,channel,reason')
    .in('channel', ['sms', 'all']);
  const identityFilters: string[] = [`email.eq.${email}`];
  if (phone_e164) identityFilters.push(`phone_e164.eq.${phone_e164}`);
  suppressionQuery = suppressionQuery.or(identityFilters.join(','));
  const { data: supRows, error: supErr } = await suppressionQuery.limit(1);
  if (supErr) {
    return NextResponse.json({ error: `suppression query failed: ${supErr.message}` }, { status: 500 });
  }
  const supHit = supRows?.[0] as { reason: string | null } | undefined;
  const in_suppression_list = !!supHit;
  const suppression_reason = supHit?.reason ?? null;

  const result: EnrichmentResult = computeEnrichment({
    customer,
    facts,
    in_suppression_list,
    suppression_reason,
    cart,
  });

  return NextResponse.json(result);
}

// Health check for the mully-sms-agent to verify secret and connectivity
// without doing DB work.
export async function GET(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  return NextResponse.json({ ok: true, service: 'sms-agent-enrichment' });
}
