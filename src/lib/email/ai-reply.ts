/**
 * AI reply engine for email flows.
 * Uses Claude to draft responses to member replies, with structured tool calls
 * for tagging, feedback logging, and task creation.
 */

import Anthropic from "@anthropic-ai/sdk";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { adminDb } from "@/lib/firebase-admin";
import { EmailFlow } from "./sequences";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ─── Types ────────────────────────────────────────────────────────────────────

export interface MemberContext {
  uid: string;
  email: string;
  firstName: string | null;
  tier: string;
  isLegacy?: boolean;
  legacyPlan?: string | null;
  flow: EmailFlow;
  lastSentStep: number;
  tags: string[];
  memberNotes?: string[];
  storeCredit?: number | null;
  handicap?: string | null;
  vibeCheck?: string | null;
  hasPrivateClub?: boolean | null;
  fitProfile?: {
    shirtSize?: string;
    gloveHand?: string;
    gloveSize?: string;
    waistSize?: string;
    pantsInseam?: string;
    shoeSize?: string;
  } | null;
  recentOrders?: Array<{ name: string; total: string; date: string; items: string[] }>;
  emailTags?: string[];
  segments?: string[];
  subscriptionStatus?: string;
}

export interface ToolCallResult {
  name: string;
  input: Record<string, unknown>;
}

export interface AiReplyResult {
  draft: string;
  toolCalls: ToolCallResult[];
}

// ─── System prompt ────────────────────────────────────────────────────────────

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "mymully.com";

function buildSystemPrompt(ctx: MemberContext): string {
  const isBack9Legacy = ctx.isLegacy && ctx.legacyPlan === "back9";

  const tierLabel = isBack9Legacy
    ? "Back 9 Legacy (Member-level access, legacy pricing)"
    : ctx.tier === "member"
    ? "Reserve Member ($249/quarter)"
    : ctx.tier === "access"
    ? "Reserve Access ($99/quarter)"
    : "Free member";

  const notesSection =
    ctx.memberNotes && ctx.memberNotes.length > 0
      ? `\nMEMBER NOTES (from prior interactions — use this context to personalize your reply)\n${ctx.memberNotes.map((n) => `- ${n}`).join("\n")}`
      : "";

  const creditDollars = ctx.storeCredit != null ? ctx.storeCredit / 100 : null;
  const creditSection =
    creditDollars != null && creditDollars > 0
      ? `\n- Store credit balance: $${creditDollars.toFixed(2)} — look for natural opportunities to mention browsing the Pro Shop or upcoming Drops`
      : "";

  const legacySection = isBack9Legacy
    ? `\n- LEGACY NOTE: This member is on the Back 9 Legacy plan (discontinued). They have Member-level access but legacy pricing. If the conversation naturally allows, mention the current Reserve Member plan. Do not force the upsell. Be helpful first.`
    : "";

  const profileLines: string[] = [];
  if (ctx.handicap) profileLines.push(`- Handicap: ${ctx.handicap}`);
  if (ctx.vibeCheck) profileLines.push(`- Vibe: ${ctx.vibeCheck}`);
  if (ctx.hasPrivateClub != null) profileLines.push(`- Private club member: ${ctx.hasPrivateClub ? "yes" : "no"}`);
  if (ctx.fitProfile?.shirtSize) profileLines.push(`- Shirt size: ${ctx.fitProfile.shirtSize}`);
  if (ctx.fitProfile?.waistSize) profileLines.push(`- Waist: ${ctx.fitProfile.waistSize}`);
  if (ctx.fitProfile?.shoeSize) profileLines.push(`- Shoe: ${ctx.fitProfile.shoeSize}`);
  const profileSection = profileLines.length > 0 ? `\nMEMBER PROFILE\n${profileLines.join("\n")}` : "";

  const ordersSection =
    ctx.recentOrders && ctx.recentOrders.length > 0
      ? `\nRECENT ORDERS (last ${ctx.recentOrders.length})\n${ctx.recentOrders
          .map((o) => `- ${o.name} (${o.date}, ${o.total}): ${o.items.join(", ")}`)
          .join("\n")}`
      : "";

  const tagsSection =
    ctx.emailTags && ctx.emailTags.length > 0
      ? `\n- Email tags: ${ctx.emailTags.join(", ")}`
      : "";

  const segmentsSection =
    ctx.segments && ctx.segments.length > 0
      ? `\n- Segments: ${ctx.segments.join(", ")}`
      : "";

  return `You are Drew Amato, CEO and co-founder of Mully Reserve. You are responding to a reply from a member in your automated email drip sequence. Draft a reply on Drew's behalf.

MEMBER CONTEXT
- Name: ${ctx.firstName ?? "unknown"}
- Email: ${ctx.email}
- Tier: ${tierLabel}
- Subscription status: ${ctx.subscriptionStatus ?? "unknown"}
- Email flow: ${ctx.flow}
- Last email sent: step ${ctx.lastSentStep}
- Tags: ${ctx.tags.length > 0 ? ctx.tags.join(", ") : "none"}${creditSection}${legacySection}${tagsSection}${segmentsSection}${profileSection}${ordersSection}${notesSection}

BRAND VOICE RULES
- Speak as Drew Amato. First person, founder energy. Not corporate.
- Warm, knowledgeable, casual-professional. Like a friend who knows golf inside out.
- Never pushy. Build rapport, ask questions, let them sell themselves.
- Use contractions. Short sentences. Write like you talk.
- Always end with a question or soft next step to keep the conversation going.
- Never use exclamation marks more than once per reply. Never use emoji.
- NEVER use em-dashes. Use periods, commas, or start a new sentence instead.
- If first name is unknown, use "Hey there," as the greeting.
- Plain text only. No markdown, no bullet points with asterisks.
- Sign off as: Drew

MULLY PRODUCT REFERENCE

Membership Tiers:
- Free ($0): Community access, Pro Shop browsing only, no discounts, no Drops, no Club network, no Benefits.
- Reserve Access ($99/quarter): 15% off Pro Shop, free 2-day shipping, Drops access with member pricing, Private Club network, Benefits portal with free V1+ coaching ($60 value).
- Reserve Member ($249/quarter): Everything in Access, plus quarterly Curated Box (value exceeds membership cost), priority concierge support, first-priority on limited releases.

Pro Shop: Curated premium golf products. Only stocks items we'd personally use. Apparel, gear, accessories. Access/Member get 15% off and free expedited shipping.

Drops: Limited-edition collabs with premium brands. Extremely limited stock. Access and Member get exclusive access and member pricing. First drop May 15th.

Community: Forum for all members. Gear Talk, Guest Play, Events, General. Think Reddit for golfers.

Private Club Registry: Access and Member only. Members at private clubs can apply to list their club. Connect with other verified members for guest play at private courses. Application review: 1-2 business days.

Benefits Portal: Free V1+ virtual coaching (PGA-certified, swing analysis, personalized drills, video feedback). Concierge support for Reserve Members. Free 2-day shipping, Reserve pricing.

Curated Box (Reserve Members only): Quarterly box of premium golf gear tailored to member profile. Value always exceeds $249 membership cost. Profile refined each quarter from feedback.

Concierge: Tee times, travel recommendations, gifting, sourcing limited gear. Submit via Benefits page.

SITE URL: ${SITE_URL} — use this URL if you need to reference the site. Never invent or guess a URL.

RESPONSE INSTRUCTIONS
- Draft only the reply body. Do not include subject line or headers.
- Keep it concise. 3-5 short paragraphs max.
- After drafting, call the appropriate tools based on what the member said.
- If the member expresses interest in upgrading, call tag_member with "upgrade-interested".
- If the member expresses dissatisfaction or hints at cancelling, call tag_member with "churn-risk" and create_task for human review.
- If the member gives product feedback, call log_feedback.
- Always call at least tag_member to classify intent.`;
}

// ─── Tools ───────────────────────────────────────────────────────────────────

const TOOLS: Anthropic.Tool[] = [
  {
    name: "tag_member",
    description:
      "Add a label to the member's profile. Use to classify reply intent for analytics and follow-up targeting.",
    input_schema: {
      type: "object" as const,
      properties: {
        tag: {
          type: "string",
          enum: [
            "upgrade-interested",
            "churn-risk",
            "positive-sentiment",
            "negative-sentiment",
            "price-sensitive",
            "gear-focused",
            "community-engaged",
            "concierge-request",
            "feedback-given",
            "testimonial-candidate",
          ],
          description: "The tag to apply to the member",
        },
      },
      required: ["tag"],
    },
  },
  {
    name: "log_feedback",
    description:
      "Log structured product or service feedback from the member's reply.",
    input_schema: {
      type: "object" as const,
      properties: {
        category: {
          type: "string",
          enum: [
            "shop",
            "drops",
            "community",
            "club_network",
            "benefits",
            "curated_box",
            "concierge",
            "pricing",
            "shipping",
            "other",
          ],
          description: "Feedback category",
        },
        sentiment: {
          type: "string",
          enum: ["positive", "neutral", "negative"],
        },
        summary: {
          type: "string",
          description: "One-sentence summary of the feedback",
        },
      },
      required: ["category", "sentiment", "summary"],
    },
  },
  {
    name: "create_task",
    description:
      "Flag this reply for human review by creating a task for Drew or the team.",
    input_schema: {
      type: "object" as const,
      properties: {
        reason: {
          type: "string",
          enum: ["churn-risk", "upgrade-opportunity", "complaint", "concierge-request", "other"],
        },
        note: {
          type: "string",
          description: "Short note explaining why human review is needed",
        },
      },
      required: ["reason", "note"],
    },
  },
  {
    name: "trigger_email",
    description:
      "Schedule a specific follow-up email outside the normal drip sequence. Use sparingly.",
    input_schema: {
      type: "object" as const,
      properties: {
        template: {
          type: "string",
          description: "Identifier of the follow-up template to send",
        },
        reason: {
          type: "string",
          description: "Why this follow-up is being triggered",
        },
      },
      required: ["template", "reason"],
    },
  },
];

// ─── Main ─────────────────────────────────────────────────────────────────────

/**
 * Generate a draft reply and tool calls for a member's inbound email.
 * Pass `options.previousDraft` + `options.feedback` to regenerate with human feedback.
 */
export async function generateReplyDraft(
  ctx: MemberContext,
  memberReplyText: string,
  options?: { previousDraft?: string; feedback?: string }
): Promise<AiReplyResult> {
  type Message = { role: "user" | "assistant"; content: string };
  const messages: Message[] = [{ role: "user", content: memberReplyText }];

  if (options?.previousDraft && options?.feedback) {
    messages.push({ role: "assistant", content: options.previousDraft });
    messages.push({
      role: "user",
      content: `Please revise the reply based on this feedback: ${options.feedback}`,
    });
  }

  const response = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 1024,
    system: buildSystemPrompt(ctx),
    tools: TOOLS,
    messages,
  });

  let draft = "";
  const toolCalls: ToolCallResult[] = [];

  for (const block of response.content) {
    if (block.type === "text") {
      draft += block.text;
    } else if (block.type === "tool_use") {
      toolCalls.push({
        name: block.name,
        input: block.input as Record<string, unknown>,
      });
    }
  }

  return { draft: draft.trim(), toolCalls };
}

// ─── Tool execution ───────────────────────────────────────────────────────────

/**
 * Execute tool calls from the AI against Firestore.
 * Called after Drew approves the draft.
 */
export async function executeToolCalls(
  uid: string,
  replyId: string,
  toolCalls: ToolCallResult[]
): Promise<void> {
  for (const call of toolCalls) {
    switch (call.name) {
      case "tag_member": {
        const tag = call.input.tag as string;
        await adminDb
          .collection("email_sequences")
          .doc(uid)
          .update({ tags: FieldValue.arrayUnion(tag) });
        await adminDb
          .collection("users")
          .doc(uid)
          .update({ emailTags: FieldValue.arrayUnion(tag) });
        break;
      }
      case "log_feedback": {
        await adminDb.collection("email_feedback").add({
          uid,
          replyId,
          category: call.input.category,
          sentiment: call.input.sentiment,
          summary: call.input.summary,
          createdAt: Timestamp.now(),
        });
        break;
      }
      case "create_task": {
        await adminDb.collection("review_tasks").add({
          uid,
          replyId,
          reason: call.input.reason,
          note: call.input.note,
          status: "open",
          createdAt: Timestamp.now(),
        });
        break;
      }
      case "trigger_email": {
        await adminDb.collection("email_triggers_pending").add({
          uid,
          replyId,
          template: call.input.template,
          reason: call.input.reason,
          createdAt: Timestamp.now(),
        });
        break;
      }
    }
  }
}

// ─── Member knowledge helpers ─────────────────────────────────────────────────

export async function loadMemberKnowledge(uid: string): Promise<string[]> {
  const snap = await adminDb.collection("member_knowledge").doc(uid).get();
  if (!snap.exists) return [];
  return (snap.data()?.notes as string[]) ?? [];
}

export async function saveMemberNote(uid: string, note: string): Promise<void> {
  const ref = adminDb.collection("member_knowledge").doc(uid);
  await ref.set(
    { notes: FieldValue.arrayUnion(note), updatedAt: Timestamp.now() },
    { merge: true }
  );
}
