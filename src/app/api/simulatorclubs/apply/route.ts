/**
 * POST /api/simulatorclubs/apply
 *
 * Lead-capture endpoint for the Mully Starter Kit onboarding flow.
 *
 * Called on every step. Upserts on lower(email). The first call (step 1)
 * inserts a new row; subsequent steps update by email. If the user bails at
 * any step, we still have their row and step_completed value.
 *
 * Optional Resend notification fires only when step_completed advances to 1
 * (so we don't email Drew on every field tweak inside a single step).
 *
 * Body (JSON, all fields optional except email):
 *   email, step                              // step 1..5 (the step being saved)
 *   clubName, contactName, contactTitle, phone, city, state
 *   bayCount, memberCountRange, staffingType, currentMerch
 *   memberDemographic, brandsWorn (string[])
 *   logoUrl, accentColor, wantsStorefront (boolean), clubWebsite, emailListSize
 *   shopifyCheckoutUrl, converted (boolean)
 */
import { NextResponse } from "next/server";
import { getSupabaseService } from "@/app/api/_lib/supabaseService";
import { sendPlainText } from "@/lib/email/resend";

export const runtime = "nodejs";

type ApplyBody = {
  email?: string;
  step?: number;

  clubName?: string;
  contactName?: string;
  contactTitle?: string;
  phone?: string;
  city?: string;
  state?: string;

  bayCount?: number | string;
  locationCount?: number | string;
  memberCountRange?: string;
  staffingType?: string;
  currentMerch?: string;

  sizeBreakdown?: Record<string, number>;
  memberDemographic?: string;
  brandsWorn?: string[];

  logoUrl?: string;
  accentColor?: string;
  wantsStorefront?: boolean;
  clubWebsite?: string;
  emailListSize?: number | string;

  shopifyCheckoutUrl?: string;
  converted?: boolean;
};

function toInt(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : parseInt(String(v), 10);
  return Number.isFinite(n) ? n : null;
}

export async function POST(req: Request) {
  let body: ApplyBody;
  try {
    body = (await req.json()) as ApplyBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const email = body.email?.trim().toLowerCase();
  if (!email) {
    return NextResponse.json({ error: "Email is required" }, { status: 400 });
  }

  const step = Math.min(5, Math.max(0, toInt(body.step) ?? 0));

  // Build the row payload - only include fields that were actually sent.
  // This lets each step submit a partial payload without nulling earlier data.
  const row: Record<string, unknown> = { email };

  if (body.clubName !== undefined) row.club_name = body.clubName?.trim() || null;
  if (body.contactName !== undefined) row.contact_name = body.contactName?.trim() || null;
  if (body.contactTitle !== undefined) row.contact_title = body.contactTitle?.trim() || null;
  if (body.phone !== undefined) row.phone = body.phone?.trim() || null;
  if (body.city !== undefined) row.city = body.city?.trim() || null;
  if (body.state !== undefined) row.state = body.state?.trim() || null;

  if (body.bayCount !== undefined) row.bay_count = toInt(body.bayCount);
  if (body.locationCount !== undefined) {
    const n = toInt(body.locationCount);
    // Server-side clamp: 1..25, fallback to 1 when missing/invalid.
    row.location_count = n === null ? 1 : Math.min(25, Math.max(1, n));
  }
  if (body.memberCountRange !== undefined) row.member_count_range = body.memberCountRange || null;
  if (body.staffingType !== undefined) row.staffing_type = body.staffingType || null;
  if (body.currentMerch !== undefined) row.current_merch = body.currentMerch || null;

  if (body.sizeBreakdown !== undefined) row.size_breakdown = body.sizeBreakdown ?? null;
  if (body.memberDemographic !== undefined) row.member_demographic = body.memberDemographic || null;
  if (body.brandsWorn !== undefined) row.brands_worn = Array.isArray(body.brandsWorn) ? body.brandsWorn : null;

  if (body.logoUrl !== undefined) row.logo_url = body.logoUrl || null;
  if (body.accentColor !== undefined) row.accent_color = body.accentColor || null;
  if (body.wantsStorefront !== undefined) row.wants_storefront = !!body.wantsStorefront;
  if (body.clubWebsite !== undefined) row.club_website = body.clubWebsite?.trim() || null;
  if (body.emailListSize !== undefined) row.email_list_size = toInt(body.emailListSize);

  if (body.shopifyCheckoutUrl !== undefined) row.shopify_checkout_url = body.shopifyCheckoutUrl || null;
  if (body.converted !== undefined) row.converted = !!body.converted;

  const sb = getSupabaseService();

  // Fetch existing row (if any) so we can decide whether to bump step_completed
  // and whether this is the first time we've seen this lead.
  const { data: existing } = await sb
    .from("simulator_club_applications")
    .select("id, step_completed, club_name, contact_name")
    .eq("email", email)
    .maybeSingle();

  // step_completed only ever advances forward; we never lower it.
  const nextStepCompleted = Math.max(existing?.step_completed ?? 0, step);
  row.step_completed = nextStepCompleted;

  const isFirstStep1 = !existing && step >= 1;

  let saved;
  if (existing) {
    const { data, error } = await sb
      .from("simulator_club_applications")
      .update(row)
      .eq("id", existing.id)
      .select("id, step_completed")
      .single();
    if (error) {
      console.error("[simulatorclubs/apply] update failed", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    saved = data;
  } else {
    const { data, error } = await sb
      .from("simulator_club_applications")
      .insert(row)
      .select("id, step_completed")
      .single();
    if (error) {
      console.error("[simulatorclubs/apply] insert failed", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    saved = data;
  }

  // Fire a Resend alert to Drew the FIRST time we see this lead (step 1) and
  // again at step 5 (they finished onboarding and were sent to Shopify checkout).
  if (isFirstStep1 || step === 5) {
    const subject =
      step === 5
        ? `Starter Kit checkout started - ${row.club_name ?? email}`
        : `New Starter Kit lead - ${row.club_name ?? email}`;

    const lines = [
      step === 5
        ? "A new Mully Starter Kit application reached step 5 and was sent to Shopify checkout."
        : "A new Mully Starter Kit lead just submitted step 1.",
      "",
      `Club:    ${row.club_name ?? "(not provided)"}`,
      `Contact: ${row.contact_name ?? "(not provided)"} ${row.contact_title ? `(${row.contact_title})` : ""}`,
      `Email:   ${email}`,
      `Phone:   ${row.phone ?? "(not provided)"}`,
      `Location:${row.city ?? "(not provided)"}${row.state ? `, ${row.state}` : ""}`,
      row.location_count !== undefined
        ? `Locations:${row.location_count} (kits = ${row.location_count} × $2,000 = $${Number(row.location_count) * 2000})`
        : "",
      "",
      `Step completed: ${nextStepCompleted}/5`,
      `Application id: ${saved?.id}`,
      step === 5 && row.shopify_checkout_url
        ? `Checkout URL:   ${row.shopify_checkout_url}`
        : "",
    ]
      .filter(Boolean)
      .join("\n");

    try {
      await sendPlainText({
        to: "drew@mymully.com",
        subject,
        text: lines,
        sendClass: "transactional",
        category: "simulatorclubs_apply",
        tags: [
          { name: "flow", value: "simulatorclubs_apply" },
          { name: "step", value: String(step) },
        ],
      });
    } catch (err) {
      // Don't fail the request if email send fails - the row is saved.
      console.warn("[simulatorclubs/apply] resend notify failed", err);
    }
  }

  return NextResponse.json({
    ok: true,
    id: saved?.id,
    stepCompleted: saved?.step_completed ?? nextStepCompleted,
  });
}
