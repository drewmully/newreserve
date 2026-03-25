import { NextRequest, NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { Resend } from "resend";
import { adminAuth, adminDb } from "@/lib/firebase-admin";
import { getLoopRawSubscriptions } from "@/app/api/_lib/loopAdmin";
import { resolveMemberTierFromVariantId } from "@/lib/membershipConfig";

type MemberTier = "free" | "access" | "member" | "black";
type BenefitKey = "v1_virtual_coaching" | "concierge_support";
type BenefitAction = "toggle" | "request";

interface BenefitInteractionBody {
  benefit: BenefitKey;
  action: BenefitAction;
  enabled?: boolean;
  subject?: string;
  message?: string;
  source?: string;
}

const resend = process.env.RESEND_API_KEY
  ? new Resend(process.env.RESEND_API_KEY)
  : null;

const ADMIN_EMAIL = "info@mullybox.com";

const BENEFIT_ALLOWED_TIERS: Record<BenefitKey, MemberTier[]> = {
  v1_virtual_coaching: ["access", "member", "black"],
  concierge_support: ["member", "black"],
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
  benefit: BenefitKey;
  action: BenefitAction;
  enabled?: boolean;
  subject?: string;
  message?: string;
  source: string;
}): string {
  const actionDetail =
    input.benefit === "v1_virtual_coaching"
      ? `V1+ Virtual Coaching toggled: <strong>${input.enabled ? "ON" : "OFF"}</strong>`
      : `Concierge request submitted`;

  const conciergeBlock =
    input.benefit === "concierge_support"
      ? `
      <tr>
        <td style="padding:8px 0;color:#8a7e72;font-size:12px;">Subject</td>
        <td style="padding:8px 0;color:#1a2e1a;font-size:14px;text-align:right;"><strong>${input.subject ?? "-"}</strong></td>
      </tr>
      <tr>
        <td colspan="2" style="padding-top:10px;color:#333;font-size:14px;line-height:1.6;">
          ${input.message ?? "-"}
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
                  <td style="padding:8px 0;color:#1a2e1a;font-size:14px;text-align:right;"><strong>${input.benefit}</strong></td>
                </tr>
                <tr>
                  <td style="padding:8px 0;color:#8a7e72;font-size:12px;">Action</td>
                  <td style="padding:8px 0;color:#1a2e1a;font-size:14px;text-align:right;"><strong>${input.action}</strong></td>
                </tr>
                <tr>
                  <td style="padding:8px 0;color:#8a7e72;font-size:12px;">Tier</td>
                  <td style="padding:8px 0;color:#1a2e1a;font-size:14px;text-align:right;"><strong>${input.tier}</strong></td>
                </tr>
                <tr>
                  <td style="padding:8px 0;color:#8a7e72;font-size:12px;">Email</td>
                  <td style="padding:8px 0;color:#1a2e1a;font-size:14px;text-align:right;"><strong>${input.email || "-"}</strong></td>
                </tr>
                <tr>
                  <td style="padding:8px 0;color:#8a7e72;font-size:12px;">UID</td>
                  <td style="padding:8px 0;color:#1a2e1a;font-size:12px;text-align:right;"><strong>${input.uid}</strong></td>
                </tr>
                <tr>
                  <td style="padding:8px 0;color:#8a7e72;font-size:12px;">Source</td>
                  <td style="padding:8px 0;color:#1a2e1a;font-size:12px;text-align:right;"><strong>${input.source}</strong></td>
                </tr>
                ${conciergeBlock}
              </table>
              <p style="margin:14px 0 0;color:#aaa;font-size:11px;">Event ID: ${input.eventId}</p>
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

  if (!["v1_virtual_coaching", "concierge_support"].includes(body.benefit)) {
    return NextResponse.json({ error: "Invalid benefit" }, { status: 400 });
  }
  if (!["toggle", "request"].includes(body.action)) {
    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  }

  if (body.benefit === "v1_virtual_coaching" && body.action !== "toggle") {
    return NextResponse.json({ error: "Invalid action for V1+ coaching" }, { status: 400 });
  }
  if (body.benefit === "concierge_support" && body.action !== "request") {
    return NextResponse.json({ error: "Invalid action for concierge support" }, { status: 400 });
  }

  if (body.benefit === "v1_virtual_coaching" && typeof body.enabled !== "boolean") {
    return NextResponse.json({ error: "enabled is required for coaching toggle" }, { status: 400 });
  }

  if (body.benefit === "concierge_support") {
    const subject = String(body.subject ?? "").trim();
    const message = String(body.message ?? "").trim();
    if (!subject || !message) {
      return NextResponse.json({ error: "subject and message are required" }, { status: 400 });
    }
    if (subject.length > 160 || message.length > 2000) {
      return NextResponse.json({ error: "subject or message too long" }, { status: 400 });
    }
  }

  const userRef = adminDb.collection("users").doc(uid);
  const userSnap = await userRef.get();
  if (!userSnap.exists) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  const userData = userSnap.data()!;
  let tier = normalizeTier(userData.tier);
  const email = String(userData.email ?? "");

  let allowed = BENEFIT_ALLOWED_TIERS[body.benefit].includes(tier);
  if (!allowed) {
    const inferredTier = await inferTierFromSubscriptions({
      email,
      userData: userData as Record<string, unknown>,
    });
    if (inferredTier) {
      tier = inferredTier;
      allowed = BENEFIT_ALLOWED_TIERS[body.benefit].includes(tier);

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
  const source = String(body.source ?? "dashboard_benefits");

  const eventPayload: Record<string, unknown> = {
    id: eventRef.id,
    user_id: uid,
    email,
    tier,
    benefit: body.benefit,
    action: body.action,
    source,
    created_at: FieldValue.serverTimestamp(),
  };

  if (body.benefit === "v1_virtual_coaching") {
    eventPayload.enabled = body.enabled;
  }

  if (body.benefit === "concierge_support") {
    eventPayload.subject = String(body.subject ?? "").trim();
    eventPayload.message = String(body.message ?? "").trim();
  }

  await eventRef.set(eventPayload);

  if (body.benefit === "v1_virtual_coaching") {
    await userRef.set(
      {
        benefits: {
          v1_virtual_coaching_enabled: body.enabled,
          v1_virtual_coaching_updated_at: FieldValue.serverTimestamp(),
        },
      },
      { merge: true }
    );
  }

  if (body.benefit === "concierge_support") {
    await adminDb.collection("concierge_requests").doc(eventRef.id).set({
      id: eventRef.id,
      user_id: uid,
      email,
      tier,
      subject: String(body.subject ?? "").trim(),
      message: String(body.message ?? "").trim(),
      status: "pending",
      source,
      created_at: FieldValue.serverTimestamp(),
    });
  }

  if (resend) {
    try {
      await resend.emails.send({
        from: "Mully Benefits <noreply@mymully.com>",
        to: ADMIN_EMAIL,
        subject:
          body.benefit === "concierge_support"
            ? `[Benefits] Concierge request - ${String(body.subject ?? "").trim()}`
            : `[Benefits] V1+ coaching ${body.enabled ? "enabled" : "disabled"}`,
        html: buildEmailHtml({
          eventId: eventRef.id,
          uid,
          email,
          tier,
          benefit: body.benefit,
          action: body.action,
          enabled: body.enabled,
          subject: body.subject,
          message: body.message,
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
