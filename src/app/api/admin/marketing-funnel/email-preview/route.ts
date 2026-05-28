/**
 * GET /api/admin/marketing-funnel/email-preview?flow=free&step=0
 *
 * Returns the rendered subject + body for a given drip flow + step,
 * so the dashboard can show admins what an email actually looks like.
 *
 * Auth: Firebase Bearer token, admin email allowlist.
 */

import { NextRequest, NextResponse } from "next/server";
import { adminAuth } from "@/lib/firebase-admin";
import { isAllowedAdminEmail } from "@/lib/adminEmailAllowlist";
import type { EmailFlow } from "@/lib/email/sequences";
import { FREE_TEMPLATES } from "@/lib/email/templates/free";
import { ACCESS_TEMPLATES } from "@/lib/email/templates/access";
import { MEMBER_TEMPLATES } from "@/lib/email/templates/member";
import { BACK9_TEMPLATES } from "@/lib/email/templates/back9";

export const runtime = "nodejs";

type EmailTemplate = (firstName: string | null) => { subject: string; text: string };

const TEMPLATES: Record<EmailFlow, EmailTemplate[]> = {
  free: FREE_TEMPLATES,
  access: ACCESS_TEMPLATES,
  member: MEMBER_TEMPLATES,
  back9: BACK9_TEMPLATES,
};

async function verifyAdmin(request: NextRequest): Promise<void> {
  const header = request.headers.get("Authorization") ?? "";
  const token = header.replace(/^Bearer\s+/i, "").trim();
  if (!token) throw new Error("Missing Authorization header");
  const decoded = await adminAuth.verifyIdToken(token, true);
  if (!decoded.email || !isAllowedAdminEmail(decoded.email)) {
    throw new Error("Forbidden");
  }
}

export async function GET(request: NextRequest) {
  try {
    await verifyAdmin(request);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unauthorized";
    return NextResponse.json(
      { error: msg },
      { status: msg === "Forbidden" ? 403 : 401 }
    );
  }

  const url = new URL(request.url);
  const flow = url.searchParams.get("flow") as EmailFlow | null;
  const stepRaw = url.searchParams.get("step");
  const firstName = url.searchParams.get("firstName");

  if (!flow || !(flow in TEMPLATES)) {
    return NextResponse.json({ error: "Invalid flow" }, { status: 400 });
  }
  const step = Number(stepRaw);
  if (!Number.isFinite(step) || step < 0) {
    return NextResponse.json({ error: "Invalid step" }, { status: 400 });
  }
  const templates = TEMPLATES[flow];
  if (step >= templates.length) {
    return NextResponse.json({ error: "Step out of range" }, { status: 400 });
  }

  try {
    const rendered = templates[step](firstName || null);
    return NextResponse.json({
      flow,
      step,
      subject: rendered.subject,
      text: rendered.text,
    });
  } catch (err) {
    console.error("[email-preview] render failed:", err);
    const msg = err instanceof Error ? err.message : "Render error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
