/**
 * GET /api/admin/email-templates
 *
 * Returns all email templates rendered with firstName=null (preview mode).
 * Auth: Firebase Bearer token (admin email allowlist).
 */

import { NextRequest, NextResponse } from "next/server";
import { adminAuth } from "@/lib/firebase-admin";
import { isAllowedAdminEmail } from "@/lib/adminEmailAllowlist";
import { FLOW_STEPS } from "@/lib/email/sequences";
import { ACCESS_TEMPLATES } from "@/lib/email/templates/access";
import { MEMBER_TEMPLATES } from "@/lib/email/templates/member";
import { RESERVE_TEMPLATES } from "@/lib/email/templates/reserve";

async function verifyAdmin(request: NextRequest): Promise<void> {
  const header = request.headers.get("Authorization") ?? "";
  const token = header.replace(/^Bearer\s+/i, "").trim();
  if (!token) throw new Error("Missing Authorization header");
  const decoded = await adminAuth.verifyIdToken(token, true);
  if (!decoded.email || !isAllowedAdminEmail(decoded.email)) {
    throw new Error("Forbidden");
  }
}

const ALL_TEMPLATES = {
  access: ACCESS_TEMPLATES,
  member: MEMBER_TEMPLATES,
  reserve: RESERVE_TEMPLATES,
} as const;

export interface TemplateStep {
  step: number;
  subject: string;
  text: string;
  delayDays: number;
  triggerType: "schedule" | "event";
}

export async function GET(request: NextRequest) {
  try {
    await verifyAdmin(request);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unauthorized";
    return NextResponse.json({ error: msg }, { status: msg === "Forbidden" ? 403 : 401 });
  }

  const flows: Record<string, { steps: TemplateStep[] }> = {};

  for (const [flowName, steps] of Object.entries(FLOW_STEPS)) {
    const templates = ALL_TEMPLATES[flowName as keyof typeof ALL_TEMPLATES];
    flows[flowName] = {
      steps: steps.map((s) => {
        const tpl = templates?.[s.step] as ((n: string | null) => { subject: string; text: string }) | undefined;
        const rendered = tpl ? tpl(null) : { subject: "[missing]", text: "[missing]" };
        return {
          step: s.step,
          subject: rendered.subject,
          text: rendered.text,
          delayDays: s.delayDays,
          triggerType: s.triggerType,
        };
      }),
    };
  }

  return NextResponse.json({ flows });
}
