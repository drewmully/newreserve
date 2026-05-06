/**
 * GET /api/admin/sequences
 *
 * Returns email sequence performance metrics for the admin CRM.
 *
 * "Sent" is derived from email_sequences.lastSentStep (source of truth, per
 * unique user). Using email_events for sent counts caused inflated numbers
 * due to resets and flow switches. Open/click still comes from email_events
 * (populated by Resend webhook at /api/email/events).
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

const isTestEmail = (email: unknown) =>
  typeof email === "string" && /^leo(\+[^@]*)?@mullybox\.com$/i.test(email);

export async function GET(request: NextRequest) {
  try {
    await verifyAdmin(request);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unauthorized";
    return NextResponse.json({ error: msg }, { status: msg === "Forbidden" ? 403 : 401 });
  }

  try {
    const [eventsSnap, repliesSnap, seqSnap] = await Promise.all([
      adminDb.collection("email_events").get(),
      adminDb.collection("email_replies").get(),
      adminDb.collection("email_sequences").get(),
    ]);

    // ── 1. Sent counts + user distribution from email_sequences ──────────────
    // "sent at step N" = number of unique users whose lastSentStep >= N.
    // This always produces a funnel shape and survives resets/flow switches.
    const sentCounts: Record<string, Record<string, number>> = {};
    const userCounts: Record<string, { active: number; paused: number; completed: number }> = {};

    for (const doc of seqSnap.docs) {
      const d = doc.data() as Record<string, unknown>;
      if (isTestEmail(d.email)) continue;
      const flow = d.flow as string | undefined;
      const status = d.status as string | undefined;
      const lastSentStep = typeof d.lastSentStep === "number" ? d.lastSentStep : -1;
      if (!flow) continue;

      userCounts[flow] ??= { active: 0, paused: 0, completed: 0 };
      if (status === "active") userCounts[flow].active++;
      else if (status === "paused") userCounts[flow].paused++;
      else if (status === "completed") userCounts[flow].completed++;

      sentCounts[flow] ??= {};
      for (let i = 0; i <= lastSentStep; i++) {
        const key = String(i);
        sentCounts[flow][key] = (sentCounts[flow][key] ?? 0) + 1;
      }
    }

    // ── 2. Open/click from email_events (Resend webhook) ─────────────────────
    const engagementCounts: Record<string, Record<string, Record<string, number>>> = {};

    for (const doc of eventsSnap.docs) {
      const d = doc.data() as Record<string, unknown>;
      if (isTestEmail(d.email)) continue;
      const eventType = d.event_type as string | undefined;
      if (eventType !== "opened" && eventType !== "clicked") continue;
      const tags = d.tags as Record<string, string> | null | undefined;
      if (!tags?.flow || tags.step === undefined) continue;

      const flow = tags.flow;
      const step = tags.step;
      engagementCounts[flow] ??= {};
      engagementCounts[flow][step] ??= {};
      engagementCounts[flow][step][eventType] = (engagementCounts[flow][step][eventType] ?? 0) + 1;
    }

    // ── 3. Reply counts from email_replies ────────────────────────────────────
    const replyCounts: Record<string, Record<string, number>> = {};

    for (const doc of repliesSnap.docs) {
      const d = doc.data() as Record<string, unknown>;
      if (isTestEmail(d.email)) continue;
      const flow = d.flow as string | undefined;
      const step = d.lastSentStep as number | undefined;
      if (!flow || step === undefined || step === null) continue;
      const stepKey = String(step);
      replyCounts[flow] ??= {};
      replyCounts[flow][stepKey] = (replyCounts[flow][stepKey] ?? 0) + 1;
    }

    // ── 4. Build response ─────────────────────────────────────────────────────
    const flows: Record<string, FlowMetrics> = {};
    for (const [flowName, steps] of Object.entries(FLOW_STEPS) as [EmailFlow, typeof FLOW_STEPS[EmailFlow]][]) {
      const uc = userCounts[flowName] ?? { active: 0, paused: 0, completed: 0 };
      flows[flowName] = {
        users: { ...uc, total: uc.active + uc.paused + uc.completed },
        steps: steps.map((s) => {
          const stepKey = String(s.step);
          const ec = engagementCounts[flowName]?.[stepKey] ?? {};
          return {
            step: s.step,
            delayDays: s.delayDays,
            triggerType: s.triggerType,
            sent: sentCounts[flowName]?.[stepKey] ?? 0,
            opened: ec["opened"] ?? 0,
            clicked: ec["clicked"] ?? 0,
            replied: replyCounts[flowName]?.[stepKey] ?? 0,
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
