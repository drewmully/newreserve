/**
 * GET /api/account/sponsorship
 *
 * Returns the signed-in customer's sponsorship board state:
 *   - their stateless sponsorship code and shareable link
 *   - aggregate progress (lifetime count, year count, last-30-days count)
 *   - per-badge state with progress toward the threshold
 *   - history feed of recent sponsorships
 *
 * Auth: Authorization: Bearer <Firebase ID token>. We resolve the
 * customer row off the user document's shopify_customer_id (preferred)
 * or email (fallback).
 */
import { NextRequest, NextResponse } from "next/server";
import { adminAuth, adminDb } from "@/lib/firebase-admin";
import { getSupabaseService } from "@/app/api/_lib/supabaseService";
import {
  buildSponsorshipCode,
  SPONSORSHIP_BADGE_ORDER,
  SPONSORSHIP_BADGES,
  type SponsorshipBadge,
} from "@/lib/sponsorship";

interface CustomerRow {
  id: number;
  email: string | null;
  first_name: string | null;
}

async function verifyFirebaseBearer(request: NextRequest): Promise<string> {
  const header = request.headers.get("Authorization") ?? "";
  const token = header.replace(/^Bearer\s+/i, "").trim();
  if (!token) throw new Error("Missing Authorization header");
  const decoded = await adminAuth.verifyIdToken(token, true);
  return decoded.uid;
}

async function resolveCustomerForUid(uid: string): Promise<CustomerRow | null> {
  const userSnap = await adminDb.collection("users").doc(uid).get();
  const userData = userSnap.exists ? (userSnap.data() ?? {}) : {};
  const email = (userData.email as string | undefined)?.toLowerCase() ?? null;
  const shopifyCustomerId = (userData.shopify_customer_id as string | undefined) ?? null;

  const supabase = getSupabaseService();

  if (shopifyCustomerId) {
    const numeric = shopifyCustomerId.replace(/[^0-9]/g, "");
    if (numeric) {
      const { data } = await supabase
        .from("customers")
        .select("id, email, first_name")
        .eq("id", Number(numeric))
        .maybeSingle();
      if (data) return data as CustomerRow;
    }
  }

  if (email) {
    const { data } = await supabase
      .from("customers")
      .select("id, email, first_name")
      .ilike("email", email)
      .limit(1)
      .maybeSingle();
    if (data) return data as CustomerRow;
  }

  return null;
}

export async function GET(request: NextRequest) {
  let uid: string;
  try {
    uid = await verifyFirebaseBearer(request);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 401 });
  }

  const customer = await resolveCustomerForUid(uid);
  if (!customer) {
    return NextResponse.json(
      { error: "No customer record yet. Complete onboarding first." },
      { status: 404 },
    );
  }

  const code = buildSponsorshipCode({
    customerId: customer.id,
    firstName: customer.first_name,
  });
  const link = `${process.env.NEXT_PUBLIC_SITE_URL ?? "https://mymully.com"}/s/${code}`;

  const supabase = getSupabaseService();

  const [
    { data: progress },
    { data: rewards },
    { data: history },
  ] = await Promise.all([
    supabase
      .from("v_sponsor_progress")
      .select("*")
      .eq("sponsor_customer_id", customer.id)
      .maybeSingle(),
    supabase
      .from("sponsorship_rewards")
      .select("*")
      .eq("sponsor_customer_id", customer.id)
      .neq("status", "voided")
      .order("earned_at", { ascending: false }),
    supabase
      .from("sponsorships")
      .select("id, sponsored_email, attributed_at, order_total, tier_at_signup")
      .eq("sponsor_customer_id", customer.id)
      .order("attributed_at", { ascending: false })
      .limit(50),
  ]);

  const total = (progress?.total_sponsorships as number | undefined) ?? 0;
  const yearCount = (progress?.year_sponsorships as number | undefined) ?? 0;
  const last30 = (progress?.last30_sponsorships as number | undefined) ?? 0;

  const earnedByBadge: Record<string, number> = {};
  for (const r of (rewards ?? []) as Array<{ badge: SponsorshipBadge; status: string }>) {
    earnedByBadge[r.badge] = (earnedByBadge[r.badge] ?? 0) + 1;
  }

  const badges = SPONSORSHIP_BADGE_ORDER.map((key) => {
    const def = SPONSORSHIP_BADGES[key];
    let current = 0;
    const earned = (earnedByBadge[key] ?? 0) > 0;
    switch (key) {
      case "first_dozen":
        current = Math.min(total, 1);
        break;
      case "foursome":
        current = Math.min(last30, def.threshold);
        // Foursome can be re-earned, so "earned" means at least one window
        // has closed this 30-day rolling window. We surface count too.
        break;
      case "path_to_black":
        current = Math.min(total, def.threshold);
        break;
      case "the_18":
        current = Math.min(yearCount, def.threshold);
        break;
    }
    return {
      key,
      title: def.title,
      shortTitle: def.shortTitle,
      tagline: def.tagline,
      description: def.description,
      window: def.window,
      reward: def.reward,
      threshold: def.threshold,
      current,
      progress: Math.min(1, current / def.threshold),
      earned,
      earnedCount: earnedByBadge[key] ?? 0,
    };
  });

  return NextResponse.json({
    code,
    link,
    progress: {
      total,
      yearCount,
      last30,
      firstSponsorshipAt: progress?.first_sponsorship_at ?? null,
      lastSponsorshipAt: progress?.last_sponsorship_at ?? null,
    },
    badges,
    history: (history ?? []).map((h) => ({
      id: h.id,
      sponsoredEmail: h.sponsored_email,
      attributedAt: h.attributed_at,
      orderTotal: Number(h.order_total),
      tier: h.tier_at_signup,
    })),
  });
}
