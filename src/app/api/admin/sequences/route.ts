/**
 * GET /api/admin/sequences
 *
 * Returns email sequence performance metrics for the admin CRM.
 * Aggregates email_events (by flow+step tag) and email_replies (by flow+step).
 * Also returns current user distribution across flows from email_sequences.
 *
 * Auth: Firebase Bearer token (admin email allowlist).
 */

import { NextRequest, NextResponse } from "next/server";
import { adminAuth, adminDb } from "@/lib/firebase-admin";
import { isAllowedAdminEmail } from "@/lib/adminEmailAllowlist";
import { FLOW_STEPS, type EmailFlow } from "@/lib/email/sequences";

async function verifyAdmin(request: NextRequest): Promise<void> {
  const header = request.headers.get("Authorization") ?? "";
  const token = header.replace(/^Bearer\s+/i, "").trim();
  if (!token) throw new Error("Missing Authorization header");
  const decoded = await adminAuth.verifyIdToken(token, true);
  if (!decoded.email || !isAllowedAdminEmail(decoded.email)) {
    throw new Error("Forbidden");
  }
}

interface StepMetrics {
  step: number;
  delayDays: number;
  triggerType: "schedule" | "event";
  sent: number;
  opened: number;
  clicked: number;
  replied: number;
}

interface FlowMetrics {
  users: { active: number; paused: number; completed: number; total: number };
  steps: StepMetrics[];
}

export async function GET(request: NextRequest) {
  try {
    await verifyAdmin(request);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unauthorized";
    return NextResponse.json({ error: msg }, { status: msg === "Forbidden" ? 403 : 401 });
  }

  try {
    // Fetch all three collections in parallel
    const [eventsSnap, repliesSnap, seqSnap] = await Promise.all([
      adminDb.collection("email_events").get(),
      adminDb.collection("email_replies").get(),
      adminDb.collection("email_sequences").get(),
    ]);

    // Aggregate email events by flow+step+event_type
    const isTestEmail = (email: unknown) =>
      typeof email === "string" && /^leo(\+[^@]*)?@mullybox\.com$/i.test(email);

    // Events from Resend have tags: { flow: "free", step: "0" }
    const eventCounts: Record<string, Record<string, Record<string, number>>> = {};
    for (const doc of eventsSnap.docs) {
      const d = doc.data() as Record<string, unknown>;
      if (isTestEmail(d.email)) continue;
      const tags = d.tags as Record<string, string> | null | undefined;
      if (!tags?.flow || tags.step === undefined) continue;
      const flow = tags.flow;
      const step = tags.step;
      const eventType = (d.event_type as string) ?? "unknown";

      eventCounts[flow] ??= {};
      eventCounts[flow][step] ??= {};
      eventCounts[flow][step][eventType] = (eventCounts[flow][step][eventType] ?? 0) + 1;
    }

    // Aggregate replies by flow+lastSentStep
    for (const doc of repliesSnap.docs) {
      const d = doc.data() as Record<string, unknown>;
      const flow = d.flow as string | undefined;
      const step = d.lastSentStep as number | undefined;
      if (!flow || step === undefined || step === null) continue;
      const stepKey = String(step);

      eventCounts[flow] ??= {};
      eventCounts[flow][stepKey] ??= {};
      eventCounts[flow][stepKey]["replied"] = (eventCounts[flow][stepKey]["replied"] ?? 0) + 1;
    }

    // User distribution per flow
    const userCounts: Record<string, { active: number; paused: number; completed: number }> = {};
    for (const doc of seqSnap.docs) {
      const d = doc.data() as Record<string, unknown>;
      if (isTestEmail(d.email)) continue;
      const flow = d.flow as string | undefined;
      const status = d.status as string | undefined;
      if (!flow) continue;
      userCounts[flow] ??= { active: 0, paused: 0, completed: 0 };
      if (status === "active") userCounts[flow].active++;
      else if (status === "paused") userCounts[flow].paused++;
      else if (status === "completed") userCounts[flow].completed++;
    }

    // Build response using FLOW_STEPS as the source of truth for step definitions
    const flows: Record<string, FlowMetrics> = {};
    for (const [flowName, steps] of Object.entries(FLOW_STEPS) as [EmailFlow, typeof FLOW_STEPS[EmailFlow]][]) {
      const uc = userCounts[flowName] ?? { active: 0, paused: 0, completed: 0 };
      flows[flowName] = {
        users: { ...uc, total: uc.active + uc.paused + uc.completed },
        steps: steps.map((s) => {
          const stepKey = String(s.step);
          const ec = eventCounts[flowName]?.[stepKey] ?? {};
          return {
            step: s.step,
            delayDays: s.delayDays,
            triggerType: s.triggerType,
            sent: ec["sent"] ?? 0,
            opened: ec["opened"] ?? 0,
            clicked: ec["clicked"] ?? 0,
            replied: ec["replied"] ?? 0,
          };
        }),
      };
    }

    return NextResponse.json({ flows });
  } catch (err) {
    console.error("[admin/sequences] failed:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
