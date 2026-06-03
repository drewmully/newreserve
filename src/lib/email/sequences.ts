/**
 * Email sequence engine.
 * Manages drip state in Firestore collection: email_sequences/{uid}
 */

import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { adminDb } from "@/lib/firebase-admin";
import { FREE_TEMPLATES } from "./templates/free";
import { ACCESS_TEMPLATES } from "./templates/access";
import { MEMBER_TEMPLATES } from "./templates/member";
import { BACK9_TEMPLATES } from "./templates/back9";
import { RESERVE_TEMPLATES } from "./templates/reserve";
import { sendPlainText } from "./resend";

export type EmailFlow = "free" | "access" | "member" | "back9" | "reserve";
export type SequenceStatus = "active" | "paused" | "completed";

export type SkipCondition =
  | "has_community_post"
  | "has_club_application"
  | "has_concierge_request"
  | "has_v1_activated";

export interface EmailStepConfig {
  step: number;
  // "schedule": fires automatically based on delayDays from flow start
  // "event": must be triggered externally (e.g. box ship, delivery confirmation)
  triggerType: "schedule" | "event";
  delayDays: number;
  skipCondition?: SkipCondition;
}

export const FLOW_STEPS: Record<EmailFlow, EmailStepConfig[]> = {
  free: [
    { step: 0, triggerType: "schedule", delayDays: 0 },
    { step: 1, triggerType: "schedule", delayDays: 3, skipCondition: "has_community_post" },
    { step: 2, triggerType: "schedule", delayDays: 7 },
    { step: 3, triggerType: "schedule", delayDays: 14 },
    { step: 4, triggerType: "schedule", delayDays: 21 },
  ],
  access: [
    { step: 0, triggerType: "schedule", delayDays: 0 },
    { step: 1, triggerType: "schedule", delayDays: 3, skipCondition: "has_club_application" },
    { step: 2, triggerType: "schedule", delayDays: 7 },
    { step: 3, triggerType: "schedule", delayDays: 14 },
    { step: 4, triggerType: "schedule", delayDays: 30 },
  ],
  member: [
    { step: 0, triggerType: "schedule", delayDays: 0 },
    { step: 1, triggerType: "schedule", delayDays: 2, skipCondition: "has_concierge_request" },
    { step: 2, triggerType: "schedule", delayDays: 5, skipCondition: "has_v1_activated" },
    // Steps 3 & 4 are event-driven — triggered externally by box ship / delivery
    { step: 3, triggerType: "event", delayDays: 0 },
    { step: 4, triggerType: "event", delayDays: 0 },
    { step: 5, triggerType: "schedule", delayDays: 45 },
  ],
  back9: [
    { step: 0, triggerType: "schedule", delayDays: 0 },
    { step: 1, triggerType: "schedule", delayDays: 2 },
    { step: 2, triggerType: "schedule", delayDays: 5 },
    { step: 3, triggerType: "schedule", delayDays: 10 },
    { step: 4, triggerType: "schedule", delayDays: 16 },
    { step: 5, triggerType: "schedule", delayDays: 22 },
  ],
  // Mully Reserve pre-checkout acquisition nurture. Started by /api/quiz/complete
  // when a visitor finishes the style quiz with email consent and is NOT an
  // active subscriber. Halted by the Shopify orders/paid webhook when the same
  // email converts (see markProfilesConvertedByEmail + the webhook handler).
  reserve: [
    { step: 0, triggerType: "schedule", delayDays: 0 },   // immediate reveal
    { step: 1, triggerType: "schedule", delayDays: 2 },   // care + service
    { step: 2, triggerType: "schedule", delayDays: 5 },   // value math
    { step: 3, triggerType: "schedule", delayDays: 9 },   // "have a guy" + gift reminder
  ],
};

const TEMPLATES = {
  free: FREE_TEMPLATES,
  access: ACCESS_TEMPLATES,
  member: MEMBER_TEMPLATES,
  back9: BACK9_TEMPLATES,
  reserve: RESERVE_TEMPLATES,
};

export interface EmailSequenceDoc {
  flow: EmailFlow;
  status: SequenceStatus;
  nextStep: number;
  startedAt: Timestamp;
  nextSendAt: Timestamp | null;
  lastSentStep: number;
  skippedSteps: number[];
  tags: string[];
  email: string;
  firstName: string | null;
  pausedReason?: "reply";
}

// ─── Template text helper ─────────────────────────────────────────────────────

/**
 * Returns the plain-text body of a sent drip email given its flow and step index.
 * Used to reconstruct thread context when generating AI reply drafts.
 */
export function getSentEmailText(
  flow: EmailFlow,
  stepIndex: number,
  firstName: string | null
): string | null {
  const template = TEMPLATES[flow]?.[stepIndex];
  if (!template) return null;
  return template(firstName).text;
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

function seqRef(uid: string) {
  return adminDb.collection("email_sequences").doc(uid);
}

function sendAtFromStart(startedAt: Timestamp, delayDays: number): Timestamp {
  return Timestamp.fromMillis(
    startedAt.toMillis() + delayDays * 24 * 60 * 60 * 1000
  );
}

function findNextScheduled(
  steps: EmailStepConfig[],
  fromStep: number,
  startedAt: Timestamp
): { stepIndex: number; sendAt: Timestamp } | null {
  for (let i = fromStep; i < steps.length; i++) {
    if (steps[i].triggerType === "schedule") {
      return {
        stepIndex: i,
        sendAt: sendAtFromStart(startedAt, steps[i].delayDays),
      };
    }
  }
  return null;
}

// ─── Skip condition checks ────────────────────────────────────────────────────

export async function checkSkip(
  uid: string,
  condition: SkipCondition
): Promise<boolean> {
  switch (condition) {
    case "has_community_post": {
      const snap = await adminDb
        .collection("communityPosts")
        .where("authorId", "==", uid)
        .limit(1)
        .get();
      return !snap.empty;
    }
    case "has_club_application": {
      const snap = await adminDb.collection("registry_applications").doc(uid).get();
      return snap.exists && snap.data()?.status !== "none";
    }
    case "has_concierge_request": {
      const snap = await adminDb
        .collection("concierge_requests")
        .where("user_id", "==", uid)
        .limit(1)
        .get();
      return !snap.empty;
    }
    case "has_v1_activated": {
      const snap = await adminDb
        .collection("benefit_actions")
        .where("user_id", "==", uid)
        .where("benefit", "==", "v1_virtual_coaching")
        .limit(1)
        .get();
      return !snap.empty;
    }
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Starts (or switches) a user's email flow.
 * Overwrites any in-progress flow — call this when a user upgrades tiers.
 */
export async function startFlow(
  uid: string,
  email: string,
  firstName: string | null,
  flow: EmailFlow
): Promise<void> {
  const steps = FLOW_STEPS[flow];
  const now = Timestamp.now();
  const firstScheduled = steps.find((s) => s.triggerType === "schedule");

  const docData: EmailSequenceDoc = {
    flow,
    status: "active",
    nextStep: 0,
    startedAt: now,
    // delayDays:0 → nextSendAt = now → cron picks it up immediately
    nextSendAt: firstScheduled
      ? sendAtFromStart(now, firstScheduled.delayDays)
      : null,
    lastSentStep: -1,
    skippedSteps: [],
    tags: [],
    email,
    firstName,
  };

  await seqRef(uid).set(docData);
}

/**
 * Processes a single user's pending step: checks skip conditions, sends the
 * email, then advances state and schedules the next step.
 *
 * Called by the cron endpoint after querying for due sequences.
 */
export async function processSequence(uid: string): Promise<void> {
  const ref = seqRef(uid);
  const snap = await ref.get();
  if (!snap.exists) return;

  const seq = snap.data() as EmailSequenceDoc;
  if (seq.status !== "active") return;

  const steps = FLOW_STEPS[seq.flow];
  const templates = TEMPLATES[seq.flow];
  const step = seq.nextStep;

  if (step >= steps.length) {
    await ref.update({ status: "completed", nextSendAt: null });
    return;
  }

  const config = steps[step];

  // Event-driven step landed in the cron queue somehow — skip it and
  // schedule the next timed step. Do NOT send it.
  if (config.triggerType === "event") {
    const next = findNextScheduled(steps, step + 1, seq.startedAt);
    await ref.update({
      nextStep: step + 1,
      nextSendAt: next?.sendAt ?? null,
      status: next ? "active" : "completed",
    });
    return;
  }

  // Check skip condition — if met, advance and reschedule without sending.
  if (config.skipCondition) {
    const shouldSkip = await checkSkip(uid, config.skipCondition);
    if (shouldSkip) {
      const next = findNextScheduled(steps, step + 1, seq.startedAt);
      await ref.update({
        skippedSteps: FieldValue.arrayUnion(step),
        nextStep: step + 1,
        nextSendAt: next?.sendAt ?? null,
        status: next ? "active" : "completed",
      });
      return;
    }
  }

  // Send the email for this step.
  const template = templates[step];
  if (!template) {
    await ref.update({ status: "completed", nextSendAt: null });
    return;
  }

  const { subject, text } = template(seq.firstName);
  const emailId = await sendPlainText({
    to: seq.email,
    subject,
    text,
    // utmCampaign auto-derives to `flow_{seq.flow}` from the tags below.
    // utmContent identifies which step in the flow drove the click — lets
    // us A/B step copy and see which email actually converts.
    utmContent: `step_${step}`,
    tags: [
      { name: "flow", value: seq.flow },
      { name: "step", value: String(step) },
    ],
  });

  // Write sent event directly so funnel stats work without Resend webhook.
  adminDb.collection("email_events").add({
    event_type: "sent",
    email_id: emailId,
    email: seq.email,
    uid,
    subject,
    created_at: FieldValue.serverTimestamp(),
    tags: { flow: seq.flow, step: String(step) },
  }).catch((err: unknown) => {
    console.error("[sequences] Failed to write sent event:", err);
  });

  // Advance to the next step.
  const nextStep = step + 1;
  const next = findNextScheduled(steps, nextStep, seq.startedAt);

  await ref.update({
    lastSentStep: step,
    nextStep,
    status: next ? "active" : "completed",
    nextSendAt: next?.sendAt ?? null,
  });
}

/**
 * Pauses a sequence when a reply is detected.
 */
export async function pauseForReply(uid: string): Promise<void> {
  await seqRef(uid).update({
    status: "paused",
    pausedReason: "reply",
  });
}

/**
 * Resumes a paused sequence. Schedules the next step 24h from now
 * so there's a buffer after a reply exchange.
 */
export async function resumeSequence(uid: string): Promise<void> {
  const snap = await seqRef(uid).get();
  if (!snap.exists) return;
  const seq = snap.data() as EmailSequenceDoc;
  if (seq.status !== "paused") return;

  const steps = FLOW_STEPS[seq.flow];
  const next = findNextScheduled(steps, seq.nextStep, seq.startedAt);

  await seqRef(uid).update({
    status: "active",
    pausedReason: FieldValue.delete(),
    // Resume 24h from now, not from original schedule
    nextSendAt: next
      ? Timestamp.fromMillis(Date.now() + 24 * 60 * 60 * 1000)
      : null,
  });
}

/**
 * Ends a sequence immediately (e.g. after a personal reply from Drew).
 */
export async function completeSequence(uid: string): Promise<void> {
  const snap = await seqRef(uid).get();
  if (!snap.exists) return;
  await seqRef(uid).update({ status: "completed", nextSendAt: null });
}

/**
 * Triggers an event-based step manually (e.g. box_preview at step 3,
 * post_box at step 4 for member flow).
 * Idempotent: won't re-send if the step was already sent.
 */
export async function triggerEventStep(
  uid: string,
  stepIndex: number
): Promise<void> {
  const ref = seqRef(uid);
  const snap = await ref.get();
  if (!snap.exists) return;

  const seq = snap.data() as EmailSequenceDoc;
  if (seq.status !== "active") return;

  const steps = FLOW_STEPS[seq.flow];
  const config = steps[stepIndex];
  if (!config || config.triggerType !== "event") return;
  if (seq.lastSentStep >= stepIndex) return;

  const templates = TEMPLATES[seq.flow];
  const template = templates[stepIndex];
  if (!template) return;

  const { subject, text } = template(seq.firstName);
  await sendPlainText({
    to: seq.email,
    subject,
    text,
    utmContent: `step_${stepIndex}`,
    tags: [
      { name: "flow", value: seq.flow },
      { name: "step", value: String(stepIndex) },
    ],
  });

  await ref.update({ lastSentStep: stepIndex });
}
