import { NextRequest, NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { Resend } from "resend";
import { adminAuth, adminDb } from "@/lib/firebase-admin";
import { getLoopRawSubscriptions } from "@/app/api/_lib/loopAdmin";
import { resolveMemberTierFromVariantId } from "@/lib/membershipConfig";
import { appendV1GoogleSheetSignup } from "@/lib/v1GoogleSheet";
import {
  isActionableBenefitKey,
  PAID_MEMBER_TIERS,
  type ActionableBenefitKey,
  type MemberTier,
} from "@/lib/benefits";

type BenefitAction = "toggle" | "request";

interface BenefitInteractionBody {
  benefit?: unknown;
  action?: unknown;
  enabled?: unknown;
  subject?: unknown;
  message?: unknown;
  source?: unknown;
  golfers?: unknown;
  budgetPerGolfer?: unknown;
  dates?: unknown;
  destination?: unknown;
  notes?: unknown;
}

interface ConciergeRequest {
  subject: string;
  message: string;
}

interface FarSureRequest {
  golfers: number;
  budgetPerGolfer: string;
  dates: string;
  destination: string;
  notes: string;
}

let resendClient: Resend | null | undefined;

function getResendClient(): Resend | null {
  if (!process.env.RESEND_API_KEY) return null;
  if (resendClient === undefined) {
    resendClient = new Resend(process.env.RESEND_API_KEY);
  }
  return resendClient;
}

const ADMIN_EMAIL = "info@Mullybox.com";

const BENEFIT_ALLOWED_TIERS: Record<ActionableBenefitKey, readonly MemberTier[]> = {
  v1_virtual_coaching: PAID_MEMBER_TIERS,
  concierge_support: PAID_MEMBER_TIERS,
  far_sure_golf_tours_credit: PAID_MEMBER_TIERS,
};

const TIER_RANK: Record<MemberTier, number> = {
  free: 0,
  access: 1,
  member: 2,
  black: 3,
};

async function verifyAuth(req: NextRequest): Promise<string | null> {
  const header = req.headers.get("Authorization");
  if (!header?.startsWith("Bearer ")) return null;
  try {
    const decoded = await adminAuth.verifyIdToken(header.slice(7));
    return decoded.uid;
  } catch {
    return null;
  }
}

function normalizeTier(raw: unknown): MemberTier {
  if (raw === "access" || raw === "member" || raw === "black") return raw;
  return "free";
}

function trimText(raw: unknown): string {
  return String(raw ?? "").trim();
}

function escapeHtml(raw: unknown): string {
  return trimText(raw).replace(/[&<>"']/g, (char) => {
    switch (char) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      case "'":
        return "&#39;";
      default:
        return char;
    }
  });
}

function escapeHtmlOrDash(raw: unknown): string {
  const value = trimText(raw);
  return value ? escapeHtml(value) : "-";
}

function firstText(...values: unknown[]): string {
  for (const value of values) {
    const text = trimText(value);
    if (text) return text;
  }
  return "";
}

function resolveV1SignupName(userData: Record<string, unknown>): {
  firstName: string;
  lastName: string;
  fullName: string;
} {
  const firstName = firstText(userData.firstName, userData.first_name);
  const lastName = firstText(userData.lastName, userData.last_name);
  const explicitFullName = firstText(
    userData.fullName,
    userData.full_name,
    userData.name,
    userData.displayName
  );
  const username = firstText(userData.username);
  const fullName = explicitFullName || [firstName, lastName].filter(Boolean).join(" ") || username;

  if (firstName || lastName || !fullName) {
    return { firstName, lastName, fullName };
  }

  const [derivedFirstName = "", ...rest] = fullName.split(/\s+/);
  return {
    firstName: derivedFirstName,
    lastName: rest.join(" "),
    fullName,
  };
}

function resolveTierFromLoopSubs(subs: Array<Record<string, unknown>>): MemberTier | null {
  let resolved: MemberTier | null = null;

  for (const sub of subs) {
    if (String(sub.status ?? "").toUpperCase() !== "ACTIVE") continue;

    const candidates: string[] = [];
    const topLevelVariant = sub.shopify_variant_id ?? sub.variant_id;
    if (topLevelVariant != null) candidates.push(String(topLevelVariant));

    const lines = Array.isArray(sub.lines) ? (sub.lines as Array<Record<string, unknown>>) : [];
    for (const line of lines) {
      const lineVariant =
        line.variantShopifyId ?? line.shopify_variant_id ?? line.variant_id;
      if (lineVariant != null) candidates.push(String(lineVariant));
    }

    for (const variantId of candidates) {
      const tier = resolveMemberTierFromVariantId(variantId);
      if (!tier) continue;
      if (!resolved || TIER_RANK[tier] > TIER_RANK[resolved]) {
        resolved = tier;
      }
    }
  }

  return resolved;
}

async function inferTierFromSubscriptions(input: {
  email: string;
  userData: Record<string, unknown>;
}): Promise<MemberTier | null> {
  if (input.email) {
    try {
      const loopSubs = await getLoopRawSubscriptions(input.email);
      const resolved = resolveTierFromLoopSubs(loopSubs as Array<Record<string, unknown>>);
      if (resolved) return resolved;

      // Active sub but unknown variant mapping: still treat as paid Access.
      const hasActive = loopSubs.some(
        (sub) => String((sub as Record<string, unknown>).status ?? "").toUpperCase() === "ACTIVE"
      );
      if (hasActive) return "access";
    } catch (err) {
      console.error("[benefits/interaction] Loop tier inference failed:", err);
    }
  }

  const subscriptions =
    (input.userData.subscriptions as Record<string, unknown> | undefined) ?? {};
  const cachedStatus = String(subscriptions.status ?? "").toLowerCase();
  const cachedActive =
    subscriptions.mullybox_active === true || cachedStatus === "active";
  return cachedActive ? "access" : null;
}

function buildEmailHtml(input: {
  eventId: string;
  uid: string;
  email: string;
  tier: MemberTier;
  benefit: ActionableBenefitKey;
  action: BenefitAction;
  enabled?: boolean;
  conciergeRequest?: ConciergeRequest | null;
  farSureRequest?: FarSureRequest | null;
  source: string;
}): string {
  const actionDetail = (() => {
    if (input.benefit === "v1_virtual_coaching") {
      return "V1+ Virtual Coaching request submitted for review. Member should receive next steps within 1-3 days.";
    }
    if (input.benefit === "far_sure_golf_tours_credit") {
      return "Far &amp; Sure Golf Tours Credit request submitted";
    }
    return "Concierge request submitted";
  })();

  const conciergeBlock =
    input.benefit === "concierge_support" && input.conciergeRequest
      ? `
      <tr>
        <td style="padding:8px 0;color:#8a7e72;font-size:12px;">Subject</td>
        <td style="padding:8px 0;color:#1a2e1a;font-size:14px;text-align:right;"><strong>${escapeHtmlOrDash(input.conciergeRequest.subject)}</strong></td>
      </tr>
      <tr>
        <td colspan="2" style="padding-top:10px;color:#333;font-size:14px;line-height:1.6;">
          ${escapeHtmlOrDash(input.conciergeRequest.message)}
        </td>
      </tr>`
      : "";

  const farSureBlock =
    input.benefit === "far_sure_golf_tours_credit" && input.farSureRequest
      ? `
      <tr>
        <td style="padding:8px 0;color:#8a7e72;font-size:12px;">Golfers</td>
        <td style="padding:8px 0;color:#1a2e1a;font-size:14px;text-align:right;"><strong>${input.farSureRequest.golfers}</strong></td>
      </tr>
      <tr>
        <td style="padding:8px 0;color:#8a7e72;font-size:12px;">Budget per golfer</td>
        <td style="padding:8px 0;color:#1a2e1a;font-size:14px;text-align:right;"><strong>${escapeHtmlOrDash(input.farSureRequest.budgetPerGolfer)}</strong></td>
      </tr>
      <tr>
        <td style="padding:8px 0;color:#8a7e72;font-size:12px;">Dates</td>
        <td style="padding:8px 0;color:#1a2e1a;font-size:14px;text-align:right;"><strong>${escapeHtmlOrDash(input.farSureRequest.dates)}</strong></td>
      </tr>
      <tr>
        <td style="padding:8px 0;color:#8a7e72;font-size:12px;">Destination</td>
        <td style="padding:8px 0;color:#1a2e1a;font-size:14px;text-align:right;"><strong>${escapeHtmlOrDash(input.farSureRequest.destination)}</strong></td>
      </tr>
      <tr>
        <td colspan="2" style="padding-top:10px;color:#333;font-size:14px;line-height:1.6;">
          ${escapeHtmlOrDash(input.farSureRequest.notes)}
        </td>
      </tr>`
      : "";

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Benefits Interaction</title>
</head>
<body style="margin:0;padding:24px;background:#f5f0eb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0">
    <tr>
      <td align="center">
        <table width="620" cellpadding="0" cellspacing="0" style="max-width:620px;background:#fff;border-radius:12px;overflow:hidden;">
          <tr>
            <td style="padding:24px 28px;background:#1a2e1a;color:#f5f0eb;">
              <p style="margin:0;font-size:11px;letter-spacing:2px;text-transform:uppercase;color:#c8d5c8;">Mully Benefits</p>
              <h1 style="margin:8px 0 0;font-size:22px;font-weight:500;">New Benefit Interaction</h1>
            </td>
          </tr>
          <tr>
            <td style="padding:24px 28px;">
              <p style="margin:0 0 16px;color:#333;font-size:14px;line-height:1.6;">${actionDetail}</p>
              <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e8e0d5;border-radius:10px;background:#faf8f5;padding:12px;">
                <tr>
                  <td style="padding:8px 0;color:#8a7e72;font-size:12px;">Benefit</td>
                  <td style="padding:8px 0;color:#1a2e1a;font-size:14px;text-align:right;"><strong>${escapeHtml(input.benefit)}</strong></td>
                </tr>
                <tr>
                  <td style="padding:8px 0;color:#8a7e72;font-size:12px;">Action</td>
                  <td style="padding:8px 0;color:#1a2e1a;font-size:14px;text-align:right;"><strong>${escapeHtml(input.action)}</strong></td>
                </tr>
                <tr>
                  <td style="padding:8px 0;color:#8a7e72;font-size:12px;">Tier</td>
                  <td style="padding:8px 0;color:#1a2e1a;font-size:14px;text-align:right;"><strong>${escapeHtml(input.tier)}</strong></td>
                </tr>
                <tr>
                  <td style="padding:8px 0;color:#8a7e72;font-size:12px;">Email</td>
                  <td style="padding:8px 0;color:#1a2e1a;font-size:14px;text-align:right;"><strong>${escapeHtmlOrDash(input.email)}</strong></td>
                </tr>
                <tr>
                  <td style="padding:8px 0;color:#8a7e72;font-size:12px;">UID</td>
                  <td style="padding:8px 0;color:#1a2e1a;font-size:12px;text-align:right;"><strong>${escapeHtml(input.uid)}</strong></td>
                </tr>
                <tr>
                  <td style="padding:8px 0;color:#8a7e72;font-size:12px;">Source</td>
                  <td style="padding:8px 0;color:#1a2e1a;font-size:12px;text-align:right;"><strong>${escapeHtml(input.source)}</strong></td>
                </tr>
                ${conciergeBlock}
                ${farSureBlock}
              </table>
              <p style="margin:14px 0 0;color:#aaa;font-size:11px;">Event ID: ${escapeHtml(input.eventId)}</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

export async function POST(req: NextRequest) {
  const uid = await verifyAuth(req);
  if (!uid) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: BenefitInteractionBody;
  try {
    body = (await req.json()) as BenefitInteractionBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!body?.benefit || !body?.action) {
    return NextResponse.json({ error: "benefit and action are required" }, { status: 400 });
  }

  if (!isActionableBenefitKey(body.benefit)) {
    return NextResponse.json({ error: "Invalid benefit" }, { status: 400 });
  }
  if (body.action !== "toggle" && body.action !== "request") {
    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  }

  const benefit = body.benefit;
  const action = body.action;

  if (benefit === "v1_virtual_coaching" && action !== "toggle") {
    return NextResponse.json({ error: "Invalid action for V1+ coaching" }, { status: 400 });
  }
  if (benefit === "concierge_support" && action !== "request") {
    return NextResponse.json({ error: "Invalid action for concierge support" }, { status: 400 });
  }
  if (benefit === "far_sure_golf_tours_credit" && action !== "request") {
    return NextResponse.json({ error: "Invalid action for Far & Sure credit" }, { status: 400 });
  }

  if (benefit === "v1_virtual_coaching" && body.enabled !== true) {
    return NextResponse.json({ error: "V1+ coaching can only be requested by toggling it on" }, { status: 400 });
  }

  let conciergeRequest: ConciergeRequest | null = null;
  if (benefit === "concierge_support") {
    const subject = trimText(body.subject);
    const message = trimText(body.message);
    if (!subject || !message) {
      return NextResponse.json({ error: "subject and message are required" }, { status: 400 });
    }
    if (subject.length > 160 || message.length > 2000) {
      return NextResponse.json({ error: "subject or message too long" }, { status: 400 });
    }
    conciergeRequest = { subject, message };
  }

  let farSureRequest: FarSureRequest | null = null;
  if (benefit === "far_sure_golf_tours_credit") {
    const golfers = Number(body.golfers);
    const budgetPerGolfer = trimText(body.budgetPerGolfer);
    const dates = trimText(body.dates);
    const destination = trimText(body.destination);
    const notes = trimText(body.notes);

    if (!Number.isInteger(golfers) || golfers < 1 || golfers > 100) {
      return NextResponse.json({ error: "golfers must be between 1 and 100" }, { status: 400 });
    }
    if (!budgetPerGolfer || !dates || !destination) {
      return NextResponse.json({ error: "budgetPerGolfer, dates, and destination are required" }, { status: 400 });
    }
    if (
      budgetPerGolfer.length > 120 ||
      dates.length > 160 ||
      destination.length > 160 ||
      notes.length > 2000
    ) {
      return NextResponse.json({ error: "travel request fields are too long" }, { status: 400 });
    }

    farSureRequest = { golfers, budgetPerGolfer, dates, destination, notes };
  }

  const userRef = adminDb.collection("users").doc(uid);
  const userSnap = await userRef.get();
  if (!userSnap.exists) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  const userData = userSnap.data()!;
  let tier = normalizeTier(userData.tier);
  const email = String(userData.email ?? "");

  let allowed = BENEFIT_ALLOWED_TIERS[benefit].includes(tier);
  if (!allowed) {
    const inferredTier = await inferTierFromSubscriptions({
      email,
      userData: userData as Record<string, unknown>,
    });
    if (inferredTier) {
      tier = inferredTier;
      allowed = BENEFIT_ALLOWED_TIERS[benefit].includes(tier);

      const storedTier = normalizeTier(userData.tier);
      if (inferredTier !== storedTier) {
        try {
          await userRef.set({ tier: inferredTier }, { merge: true });
        } catch (err) {
          console.error("[benefits/interaction] tier cache update failed:", err);
        }
      }
    }
  }

  if (!allowed) {
    return NextResponse.json({ error: "Tier not allowed for this benefit" }, { status: 403 });
  }

  const eventRef = adminDb.collection("benefit_actions").doc();
  const source = trimText(body.source) || "dashboard_benefits";

  const eventPayload: Record<string, unknown> = {
    id: eventRef.id,
    user_id: uid,
    email,
    tier,
    benefit,
    action,
    source,
    created_at: FieldValue.serverTimestamp(),
  };

  if (benefit === "v1_virtual_coaching") {
    eventPayload.enabled = body.enabled;
    eventPayload.status = "reviewing";
  }

  if (benefit === "concierge_support" && conciergeRequest) {
    eventPayload.subject = conciergeRequest.subject;
    eventPayload.message = conciergeRequest.message;
  }

  if (benefit === "far_sure_golf_tours_credit" && farSureRequest) {
    eventPayload.golfers = farSureRequest.golfers;
    eventPayload.budget_per_golfer = farSureRequest.budgetPerGolfer;
    eventPayload.dates = farSureRequest.dates;
    eventPayload.destination = farSureRequest.destination;
    eventPayload.notes = farSureRequest.notes;
  }

  await eventRef.set(eventPayload);

  if (benefit === "v1_virtual_coaching") {
    await userRef.set(
      {
        benefits: {
          v1_virtual_coaching_enabled: true,
          v1_virtual_coaching_status: "reviewing",
          v1_virtual_coaching_requested_at: FieldValue.serverTimestamp(),
          v1_virtual_coaching_updated_at: FieldValue.serverTimestamp(),
        },
      },
      { merge: true }
    );

    try {
      const signupName = resolveV1SignupName(userData as Record<string, unknown>);
      await appendV1GoogleSheetSignup({
        email,
        ...signupName,
      });
    } catch (err) {
      console.error("[benefits/interaction] V1+ Google Sheet sync failed:", err);
    }
  }

  if (benefit === "concierge_support" && conciergeRequest) {
    await adminDb.collection("concierge_requests").doc(eventRef.id).set({
      id: eventRef.id,
      user_id: uid,
      email,
      tier,
      subject: conciergeRequest.subject,
      message: conciergeRequest.message,
      status: "pending",
      source,
      created_at: FieldValue.serverTimestamp(),
    });
  }

  if (benefit === "far_sure_golf_tours_credit" && farSureRequest) {
    await adminDb.collection("travel_credit_requests").doc(eventRef.id).set({
      id: eventRef.id,
      user_id: uid,
      email,
      tier,
      golfers: farSureRequest.golfers,
      budget_per_golfer: farSureRequest.budgetPerGolfer,
      dates: farSureRequest.dates,
      destination: farSureRequest.destination,
      notes: farSureRequest.notes,
      status: "pending",
      source,
      created_at: FieldValue.serverTimestamp(),
    });
  }

  const resend = getResendClient();
  if (resend) {
    try {
      await resend.emails.send({
        from: "Mully Benefits <noreply@mymully.com>",
        to: ADMIN_EMAIL,
        subject:
          benefit === "concierge_support" && conciergeRequest
            ? `[Benefits] Concierge request - ${conciergeRequest.subject}`
            : benefit === "far_sure_golf_tours_credit" && farSureRequest
              ? `[Benefits] Far & Sure golf tours credit - ${farSureRequest.destination}`
              : "[Benefits] V1+ coaching request submitted",
        html: buildEmailHtml({
          eventId: eventRef.id,
          uid,
          email,
          tier,
          benefit,
          action,
          enabled: typeof body.enabled === "boolean" ? body.enabled : undefined,
          conciergeRequest,
          farSureRequest,
          source,
        }),
      });
    } catch (err) {
      console.error("[benefits/interaction] Resend send failed:", err);
    }
  } else {
    console.warn("[benefits/interaction] RESEND_API_KEY missing - email notification skipped");
  }

  return NextResponse.json({ ok: true, id: eventRef.id });
}
