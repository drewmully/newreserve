/**
 * Sponsorship attribution and badge evaluation, server-side only.
 *
 * Called from the orders-paid webhook AFTER the order is validated.
 * Reads/writes go through the Supabase service-role client. All operations
 * are idempotent on shopify_order_id and on (sponsor_customer_id, badge,
 * earned_at).
 */
import { getSupabaseService } from "@/app/api/_lib/supabaseService";
import {
  evaluateNewBadges,
  parseSponsorshipCode,
  SPONSORSHIP_BADGES,
  type SponsorshipBadge,
  verifySponsorshipCode,
} from "@/lib/sponsorship";
import { resolveMemberTierFromVariantId } from "@/lib/membershipConfig";
import {
  sendBadgeEarnedEmail,
  sendSponsorAttributedEmail,
  sendSponsoredWelcomeEmail,
} from "@/lib/email/sponsorship";

interface ShopifyOrderForSponsorship {
  id: number;
  email: string | null;
  total_price: string;
  customer?: { id: number; email: string | null; first_name?: string | null };
  line_items: { variant_id: number | null }[];
  note_attributes?: Array<{ name: string; value: string }>;
}

interface CustomerRow {
  id: number;
  email: string | null;
  first_name: string | null;
}

/** Reads the mully_sponsor cart attribute off the Shopify order. */
export function readSponsorshipCode(order: ShopifyOrderForSponsorship): string | null {
  const attr = order.note_attributes?.find(
    (a) => a.name === "mully_sponsor" || a.name.toLowerCase() === "mully_sponsor",
  );
  if (!attr || !attr.value) return null;
  return attr.value.trim();
}

/**
 * Resolves the sponsor customer row given a sponsorship code. We search
 * customers whose first_name matches the prefix and whose computed
 * suffix equals the code's suffix. The HMAC suffix is short (4 chars
 * over a 30-char alphabet, ~810k entropy), but combined with the prefix
 * collisions are essentially zero in our population.
 */
async function resolveSponsorCustomer(code: string): Promise<CustomerRow | null> {
  const parsed = parseSponsorshipCode(code);
  if (!parsed) return null;

  const supabase = getSupabaseService();

  // For "MULLY-XXXX" we search any customer with that suffix, since the
  // fallback prefix is used when no first name is available.
  const prefixIsFallback = parsed.prefix === "MULLY";

  // Pull a small candidate window. In practice the prefix narrows this
  // to a tractable number.
  let query = supabase
    .from("customers")
    .select("id, email, first_name")
    .limit(200);

  if (!prefixIsFallback) {
    // Postgres ILIKE on text. The prefix is uppercase, customers.first_name
    // is mixed case, so we use ilike.
    query = query.ilike("first_name", `${parsed.prefix.slice(0, 8)}%`);
  }

  const { data, error } = await query;
  if (error || !data) return null;

  for (const row of data as CustomerRow[]) {
    if (verifySponsorshipCode(code, row.id)) {
      return row;
    }
  }
  return null;
}

/** Resolves the sponsored member's customer row from the order. */
async function resolveSponsoredCustomer(
  order: ShopifyOrderForSponsorship,
): Promise<CustomerRow | null> {
  const supabase = getSupabaseService();
  const email = (order.customer?.email ?? order.email ?? "").toLowerCase().trim();
  if (!email) return null;

  const { data } = await supabase
    .from("customers")
    .select("id, email, first_name")
    .ilike("email", email)
    .limit(1)
    .maybeSingle();

  return (data as CustomerRow | null) ?? null;
}

/** Detects whether this order represents a paid membership purchase. */
function isPaidMembershipOrder(order: ShopifyOrderForSponsorship): {
  isPaid: boolean;
  tier: string | null;
} {
  // We treat the order as a paid sponsorship if the cart includes any of
  // the membership selling-plan variants.
  for (const li of order.line_items ?? []) {
    const tier = resolveMemberTierFromVariantId(li.variant_id);
    // resolveMemberTierFromVariantId returns a paid tier or undefined,
    // so any non-null value is a paid membership.
    if (tier) {
      return { isPaid: true, tier };
    }
  }
  return { isPaid: false, tier: null };
}

interface ProcessSponsorshipResult {
  status: "skipped" | "duplicate" | "attributed";
  reason?: string;
  sponsorshipId?: number;
  newBadges?: SponsorshipBadge[];
}

/**
 * Top-level entry point. Safe to call on every orders-paid webhook.
 * Returns a structured result so the caller can log clearly.
 */
export async function processSponsorship(
  order: ShopifyOrderForSponsorship,
): Promise<ProcessSponsorshipResult> {
  const code = readSponsorshipCode(order);
  if (!code) return { status: "skipped", reason: "no_sponsor_code" };

  const { isPaid, tier } = isPaidMembershipOrder(order);
  if (!isPaid) return { status: "skipped", reason: "not_paid_membership" };

  const supabase = getSupabaseService();

  // Idempotency check: have we already attributed this order?
  const { data: existing } = await supabase
    .from("sponsorships")
    .select("id")
    .eq("shopify_order_id", order.id)
    .maybeSingle();
  if (existing) {
    return { status: "duplicate", sponsorshipId: existing.id as number };
  }

  const sponsor = await resolveSponsorCustomer(code);
  if (!sponsor) return { status: "skipped", reason: "sponsor_not_found" };

  const sponsored = await resolveSponsoredCustomer(order);
  const sponsoredEmail = (
    order.customer?.email ??
    order.email ??
    ""
  ).toLowerCase();

  // Guard rail: a customer cannot sponsor themselves.
  if (sponsored && sponsored.id === sponsor.id) {
    return { status: "skipped", reason: "self_sponsorship" };
  }

  // Insert the sponsorship row.
  const { data: inserted, error: insertErr } = await supabase
    .from("sponsorships")
    .insert({
      sponsor_customer_id: sponsor.id,
      sponsored_customer_id: sponsored?.id ?? null,
      sponsored_email: sponsoredEmail,
      shopify_order_id: order.id,
      order_total: Number(order.total_price) || 0,
      is_paid_member: true,
      tier_at_signup: tier,
      sponsorship_code: code,
    })
    .select("id")
    .single();

  if (insertErr || !inserted) {
    // If a concurrent webhook beat us to it, treat as duplicate.
    if (insertErr?.code === "23505") {
      return { status: "duplicate" };
    }
    throw new Error(
      `[sponsorship] insert failed: ${insertErr?.message ?? "unknown"}`,
    );
  }

  const sponsorshipId = inserted.id as number;

  // Evaluate badges.
  const newBadges = await evaluateAndPersistBadges(sponsor.id, sponsorshipId);

  // Notifications. Failures are logged but do not fail the webhook, the
  // attribution row is already written and is the source of truth.
  await fireNotifications({
    sponsor,
    sponsored,
    sponsorshipId,
    sponsoredEmail,
    newBadges,
  }).catch((err) => {
    console.error("[sponsorship] notification dispatch failed:", err);
  });

  return {
    status: "attributed",
    sponsorshipId,
    newBadges,
  };
}

async function evaluateAndPersistBadges(
  sponsorCustomerId: number,
  triggeringSponsorshipId: number,
): Promise<SponsorshipBadge[]> {
  const supabase = getSupabaseService();

  const [{ data: events }, { data: heldRewards }] = await Promise.all([
    supabase
      .from("sponsorships")
      .select("attributed_at")
      .eq("sponsor_customer_id", sponsorCustomerId)
      .order("attributed_at", { ascending: true }),
    supabase
      .from("sponsorship_rewards")
      .select("badge, earned_at, status")
      .eq("sponsor_customer_id", sponsorCustomerId)
      .neq("status", "voided"),
  ]);

  const eventDates = (events ?? []).map((e) => ({
    attributedAt: new Date(e.attributed_at as string),
  }));
  const heldRewardRows = (heldRewards ?? []) as Array<{
    badge: SponsorshipBadge;
    earned_at: string;
  }>;

  const lifetimeHeld = new Set<SponsorshipBadge>();
  const yearsThe18 = new Set<number>();
  let foursomeCount = 0;
  for (const r of heldRewardRows) {
    lifetimeHeld.add(r.badge);
    if (r.badge === "foursome") foursomeCount += 1;
    if (r.badge === "the_18") {
      yearsThe18.add(new Date(r.earned_at).getUTCFullYear());
    }
  }

  const newBadges = evaluateNewBadges({
    events: eventDates,
    yearBadgesEarned: { the_18: Array.from(yearsThe18) },
    lifetimeBadgesHeld: lifetimeHeld,
    foursomeBadgesCount: foursomeCount,
  });

  if (newBadges.length === 0) return [];

  const rows = newBadges.map((badge) => ({
    sponsor_customer_id: sponsorCustomerId,
    badge,
    triggering_sponsorship_id: triggeringSponsorshipId,
    status: "earned",
    metadata: { name: SPONSORSHIP_BADGES[badge].title },
  }));

  const { error: rewardErr } = await supabase
    .from("sponsorship_rewards")
    .insert(rows);
  if (rewardErr) {
    // Unique constraint collisions are fine, another concurrent webhook
    // won the race. Anything else, surface.
    if (rewardErr.code !== "23505") {
      console.error("[sponsorship] reward insert failed:", rewardErr);
    }
  }

  // Bump the customers.referral_count for quick admin views.
  try {
    await supabase
      .from("customers")
      .update({ referral_count: eventDates.length })
      .eq("id", sponsorCustomerId);
  } catch (err) {
    console.error("[sponsorship] referral_count update failed:", err);
  }

  return newBadges;
}

async function fireNotifications(input: {
  sponsor: CustomerRow;
  sponsored: CustomerRow | null;
  sponsorshipId: number;
  sponsoredEmail: string;
  newBadges: SponsorshipBadge[];
}): Promise<void> {
  const tasks: Array<Promise<unknown>> = [];

  // Sponsor "you got a sponsorship" email.
  if (input.sponsor.email) {
    const supabase = getSupabaseService();
    const { data: countRow } = await supabase
      .from("v_sponsor_progress")
      .select("total_sponsorships")
      .eq("sponsor_customer_id", input.sponsor.id)
      .maybeSingle();
    const total = (countRow?.total_sponsorships as number | undefined) ?? 1;

    tasks.push(
      sendSponsorAttributedEmail({
        to: input.sponsor.email,
        sponsorFirstName: input.sponsor.first_name,
        sponsoredEmail: input.sponsoredEmail,
        sponsorshipId: input.sponsorshipId,
        totalCount: total,
      }),
    );
  }

  // Sponsored "welcome, your sponsor sent you" email.
  if (input.sponsoredEmail) {
    tasks.push(
      sendSponsoredWelcomeEmail({
        to: input.sponsoredEmail,
        sponsorFirstName: input.sponsor.first_name,
        sponsorshipId: input.sponsorshipId,
      }),
    );
  }

  // Per-badge emails.
  for (const badge of input.newBadges) {
    // Look up the reward id we just inserted to use as idempotency seed.
    const supabase = getSupabaseService();
    const { data: rewardRow } = await supabase
      .from("sponsorship_rewards")
      .select("id")
      .eq("sponsor_customer_id", input.sponsor.id)
      .eq("badge", badge)
      .order("earned_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const rewardId = (rewardRow?.id as number | undefined) ?? 0;

    if (input.sponsor.email) {
      tasks.push(
        sendBadgeEarnedEmail({
          to: input.sponsor.email,
          recipientFirstName: input.sponsor.first_name,
          badge,
          rewardId,
          role: "sponsor",
        }),
      );
    }
    // For first_dozen we also send a tailored welcome touch to the
    // sponsored party, but ONLY if the welcome path also exists. We
    // already send sendSponsoredWelcomeEmail above for the general case,
    // so we keep the badge email role-specific to the sponsor for now.
    if (badge === "first_dozen" && input.sponsored?.email) {
      tasks.push(
        sendBadgeEarnedEmail({
          to: input.sponsored.email,
          recipientFirstName: input.sponsored.first_name,
          badge,
          rewardId,
          role: "sponsored",
        }),
      );
    }
  }

  await Promise.allSettled(tasks);
}
