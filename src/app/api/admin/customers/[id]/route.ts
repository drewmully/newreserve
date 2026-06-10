/**
 * GET /api/admin/customers/[id]
 *
 * Returns the full customer dossier needed to pack a box:
 *   - customer_360 row
 *   - customer_facts (sizes, prefs, sourcing notes)
 *   - last 20 orders + line items
 *   - subscribers row (Loop state)
 *   - Firestore customer doc (customers/{firebase_uid} or email lookup)
 *   - Firestore users/{firebase_uid} (fit profile, onboarding, subscriptions)
 *   - Firestore member_knowledge/{firebase_uid} (curated facts)
 *   - Firestore mulligan_submissions/{email} (sizing + style submission)
 *   - Firestore email_replies (last 20 inbound replies — customer's own words)
 *   - Firestore email_feedback (last 20 reactions)
 *   - Firestore concierge_requests (last 10 — explicit asks)
 *   - Supabase hub_thread + hub_message (inbound msgs) + hub_conversation_analysis
 *     filtered for curation-relevant topics (fit, sizing, brand, color,
 *     style, return, swap, dislike, gift, preference, etc.)
 *
 * Auth: Firebase ID token from admin allowlist.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/app/api/_lib/adminAuth";
import { getSupabaseService } from "@/app/api/_lib/supabaseService";

export const runtime = "nodejs";

// Keywords that suggest a message/thread is relevant to curating a box.
// Matched case-insensitively against topic_label, customer_intent_summary,
// outcome, hub_thread.category, and (as a last resort) the inbound message body.
const CURATION_KEYWORDS = [
  "size",
  "sizing",
  "fit",
  "fits",
  "fitting",
  "small",
  "large",
  "medium",
  "tight",
  "loose",
  "shrink",
  "length",
  "inseam",
  "waist",
  "shoe",
  "shoes",
  "glove",
  "shirt",
  "polo",
  "pants",
  "shorts",
  "hat",
  "cap",
  "style",
  "color",
  "colour",
  "vibe",
  "brand",
  "prefer",
  "preference",
  "like",
  "dislike",
  "love",
  "hate",
  "wish",
  "want",
  "request",
  "swap",
  "return",
  "exchange",
  "mulligan",
  "skip",
  "pause",
  "gift",
  "registry",
  "ball",
  "balls",
  "tee",
  "club",
  "putter",
  "driver",
  "wedge",
  "iron",
  "headcover",
  "towel",
  "marker",
  "sourcing",
  "curation",
];

function isCurationRelevant(...fields: Array<string | null | undefined>): boolean {
  const blob = fields.filter(Boolean).join(" ").toLowerCase();
  if (!blob) return false;
  return CURATION_KEYWORDS.some((kw) => blob.includes(kw));
}

type FirestoreDocLike = { id: string; data: Record<string, unknown> };

function toPlain(input: unknown): unknown {
  if (input == null) return null;
  if (Array.isArray(input)) return input.map(toPlain);
  if (typeof input !== "object") return input;
  // Firestore Timestamp: { toDate() } / { seconds, nanoseconds }
  const obj = input as Record<string, unknown>;
  if (typeof (obj as { toDate?: () => Date }).toDate === "function") {
    try {
      return (obj as { toDate: () => Date }).toDate().toISOString();
    } catch {
      // fall through
    }
  }
  if (
    typeof obj.seconds === "number" &&
    typeof obj.nanoseconds === "number" &&
    Object.keys(obj).length === 2
  ) {
    return new Date(obj.seconds * 1000).toISOString();
  }
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    out[k] = toPlain(v);
  }
  return out;
}

async function loadFirestoreBundle(opts: {
  firebaseUid: string | null;
  email: string | null;
}): Promise<{
  customer: Record<string, unknown> | null;
  user: Record<string, unknown> | null;
  member_knowledge: Record<string, unknown> | null;
  mulligan_submission: Record<string, unknown> | null;
  email_replies: FirestoreDocLike[];
  email_feedback: FirestoreDocLike[];
  concierge_requests: FirestoreDocLike[];
}> {
  const empty = {
    customer: null,
    user: null,
    member_knowledge: null,
    mulligan_submission: null,
    email_replies: [] as FirestoreDocLike[],
    email_feedback: [] as FirestoreDocLike[],
    concierge_requests: [] as FirestoreDocLike[],
  };

  try {
    // Lazy import so the route still builds in envs without firebase-admin.
    const { adminDb } = await import("@/lib/firebase-admin");
    const { firebaseUid, email } = opts;
    const lowerEmail = email ? email.toLowerCase() : null;

    // customers/{uid} doc (or fallback by email)
    const customerByUidPromise = firebaseUid
      ? adminDb.collection("customers").doc(firebaseUid).get().catch(() => null)
      : Promise.resolve(null);

    // users/{uid} — fit profile, onboarding, subscriptions
    const userByUidPromise = firebaseUid
      ? adminDb.collection("users").doc(firebaseUid).get().catch(() => null)
      : Promise.resolve(null);

    // member_knowledge/{uid} — curated facts
    const knowledgePromise = firebaseUid
      ? adminDb.collection("member_knowledge").doc(firebaseUid).get().catch(() => null)
      : Promise.resolve(null);

    // mulligan_submissions doc id IS the email
    const mulliganPromise = lowerEmail
      ? adminDb
          .collection("mulligan_submissions")
          .doc(lowerEmail)
          .get()
          .catch(() => null)
      : Promise.resolve(null);

    // email_replies by uid (orderBy createdAt desc, 20)
    const repliesByUidPromise = firebaseUid
      ? adminDb
          .collection("email_replies")
          .where("uid", "==", firebaseUid)
          .orderBy("createdAt", "desc")
          .limit(20)
          .get()
          .catch(() => ({ docs: [] }))
      : Promise.resolve({ docs: [] });

    // email_feedback by uid
    const feedbackByUidPromise = firebaseUid
      ? adminDb
          .collection("email_feedback")
          .where("uid", "==", firebaseUid)
          .orderBy("created_at", "desc")
          .limit(20)
          .get()
          .catch(() => ({ docs: [] }))
      : Promise.resolve({ docs: [] });

    // concierge_requests by user_id (uid) or email
    const conciergeByUidPromise = firebaseUid
      ? adminDb
          .collection("concierge_requests")
          .where("user_id", "==", firebaseUid)
          .orderBy("created_at", "desc")
          .limit(10)
          .get()
          .catch(() => ({ docs: [] }))
      : Promise.resolve({ docs: [] });

    const [
      customerByUid,
      userByUid,
      knowledge,
      mulligan,
      repliesByUid,
      feedbackByUid,
      conciergeByUid,
    ] = await Promise.all([
      customerByUidPromise,
      userByUidPromise,
      knowledgePromise,
      mulliganPromise,
      repliesByUidPromise,
      feedbackByUidPromise,
      conciergeByUidPromise,
    ]);

    let customer: Record<string, unknown> | null =
      customerByUid && customerByUid.exists
        ? (toPlain(customerByUid.data()) as Record<string, unknown>)
        : null;

    // Email fallback for customers collection
    if (!customer && email) {
      const snap = await adminDb
        .collection("customers")
        .where("email", "==", email)
        .limit(1)
        .get()
        .catch(() => ({ empty: true, docs: [] as { data: () => Record<string, unknown> }[] }));
      if (!snap.empty) {
        customer = toPlain(snap.docs[0].data()) as Record<string, unknown>;
      }
    }

    const user: Record<string, unknown> | null =
      userByUid && userByUid.exists
        ? (toPlain(userByUid.data()) as Record<string, unknown>)
        : null;

    const member_knowledge: Record<string, unknown> | null =
      knowledge && knowledge.exists
        ? (toPlain(knowledge.data()) as Record<string, unknown>)
        : null;

    const mulligan_submission: Record<string, unknown> | null =
      mulligan && mulligan.exists
        ? (toPlain(mulligan.data()) as Record<string, unknown>)
        : null;

    // Fallback: email_replies / email_feedback / concierge_requests by email
    // (in case uid is missing or the doc was created from inbound webhook).
    let emailRepliesDocs = repliesByUid.docs;
    if (emailRepliesDocs.length === 0 && email) {
      const snap = await adminDb
        .collection("email_replies")
        .where("email", "==", email)
        .orderBy("createdAt", "desc")
        .limit(20)
        .get()
        .catch(() => ({ docs: [] }));
      emailRepliesDocs = snap.docs;
    }

    let conciergeDocs = conciergeByUid.docs;
    if (conciergeDocs.length === 0 && email) {
      const snap = await adminDb
        .collection("concierge_requests")
        .where("email", "==", email)
        .orderBy("created_at", "desc")
        .limit(10)
        .get()
        .catch(() => ({ docs: [] }));
      conciergeDocs = snap.docs;
    }

    let feedbackDocs = feedbackByUid.docs;
    if (feedbackDocs.length === 0 && email) {
      const snap = await adminDb
        .collection("email_feedback")
        .where("email", "==", email)
        .orderBy("created_at", "desc")
        .limit(20)
        .get()
        .catch(() => ({ docs: [] }));
      feedbackDocs = snap.docs;
    }

    const docToPlain = (d: {
      id: string;
      data: () => Record<string, unknown>;
    }): FirestoreDocLike => ({
      id: d.id,
      data: toPlain(d.data()) as Record<string, unknown>,
    });

    return {
      customer,
      user,
      member_knowledge,
      mulligan_submission,
      email_replies: emailRepliesDocs.map(docToPlain),
      email_feedback: feedbackDocs.map(docToPlain),
      concierge_requests: conciergeDocs.map(docToPlain),
    };
  } catch (err) {
    console.warn("[customers/[id]] firestore bundle failed:", err);
    return empty;
  }
}

interface HubMessageRow {
  id: string | number;
  thread_id: string | number | null;
  direction: string | null;
  channel: string | null;
  body_text: string | null;
  sent_at: string | null;
  created_at: string | null;
}

interface HubThreadRow {
  id: string | number;
  status: string | null;
  category: string | null;
  subject: string | null;
  last_message_at: string | null;
  created_at: string | null;
}

interface HubAnalysisRow {
  thread_id: string | number;
  topic_label: string | null;
  outcome: string | null;
  customer_intent_summary: string | null;
  agent_action_summary: string | null;
  confidence: number | null;
  created_at: string | null;
}

interface CurationCommunication {
  thread_id: string | number | null;
  channel: string | null;
  subject: string | null;
  topic_label: string | null;
  outcome: string | null;
  customer_intent_summary: string | null;
  agent_action_summary: string | null;
  thread_status: string | null;
  thread_category: string | null;
  thread_created_at: string | null;
  last_message_at: string | null;
  messages: Array<{
    id: string | number;
    direction: string | null;
    channel: string | null;
    body_text: string | null;
    sent_at: string | null;
  }>;
  match_reason: "analysis" | "thread_category" | "message_body";
}

async function loadCurationCommunications(opts: {
  supabaseSvc: ReturnType<typeof getSupabaseService>;
  customerId: number;
  email: string | null;
}): Promise<CurationCommunication[]> {
  const { supabaseSvc, customerId, email } = opts;

  try {
    // 1. Pull threads for this customer (by customer_id and, as fallback, by email)
    const threadFilters: string[] = [`customer_id.eq.${customerId}`];
    // hub_thread has a customer_email column in some installs; if not, the
    // OR clause is still safe because PostgREST treats unknown columns as errors,
    // so we use a separate query for the email path.
    const threadByIdPromise = supabaseSvc
      .from("hub_thread")
      .select(
        "id, status, category, subject, last_message_at, created_at, customer_id, customer_email",
      )
      .or(threadFilters.join(","))
      .order("last_message_at", { ascending: false, nullsFirst: false })
      .limit(50);

    const threadByEmailPromise = email
      ? supabaseSvc
          .from("hub_thread")
          .select(
            "id, status, category, subject, last_message_at, created_at, customer_id, customer_email",
          )
          .eq("customer_email", email)
          .order("last_message_at", { ascending: false, nullsFirst: false })
          .limit(50)
      : Promise.resolve({ data: [] as HubThreadRow[], error: null });

    const [byId, byEmail] = await Promise.all([
      threadByIdPromise,
      threadByEmailPromise,
    ]);

    const threadMap = new Map<string, HubThreadRow>();
    for (const row of (byId.data || []) as HubThreadRow[]) {
      threadMap.set(String(row.id), row);
    }
    if (!("error" in byEmail) || !byEmail.error) {
      for (const row of (byEmail.data || []) as HubThreadRow[]) {
        threadMap.set(String(row.id), row);
      }
    }

    if (threadMap.size === 0) return [];
    const threadIds = [...threadMap.keys()];

    // 2. Pull messages + analyses for those threads in parallel.
    const [msgRes, anaRes] = await Promise.all([
      supabaseSvc
        .from("hub_message")
        .select("id, thread_id, direction, channel, body_text, sent_at, created_at")
        .in("thread_id", threadIds)
        .order("sent_at", { ascending: true, nullsFirst: false })
        .limit(500),
      supabaseSvc
        .from("hub_conversation_analysis")
        .select(
          "thread_id, topic_label, outcome, customer_intent_summary, agent_action_summary, confidence, created_at",
        )
        .in("thread_id", threadIds)
        .order("created_at", { ascending: false })
        .limit(500),
    ]);

    const messagesByThread = new Map<string, HubMessageRow[]>();
    for (const m of ((msgRes.data || []) as HubMessageRow[])) {
      const k = String(m.thread_id);
      if (!messagesByThread.has(k)) messagesByThread.set(k, []);
      messagesByThread.get(k)!.push(m);
    }
    const analysisByThread = new Map<string, HubAnalysisRow>();
    for (const a of ((anaRes.data || []) as HubAnalysisRow[])) {
      const k = String(a.thread_id);
      // Keep the most recent analysis per thread (rows already desc by created_at)
      if (!analysisByThread.has(k)) analysisByThread.set(k, a);
    }

    // 3. Score each thread for curation relevance and assemble payload.
    const results: CurationCommunication[] = [];
    for (const [tid, thread] of threadMap.entries()) {
      const analysis = analysisByThread.get(tid) || null;
      const msgs = messagesByThread.get(tid) || [];

      const analysisMatch = isCurationRelevant(
        analysis?.topic_label,
        analysis?.customer_intent_summary,
        analysis?.outcome,
      );
      const categoryMatch = isCurationRelevant(thread.category, thread.subject);
      const inboundBodyBlob = msgs
        .filter((m) => m.direction === "in")
        .map((m) => m.body_text || "")
        .join(" ")
        .slice(0, 4000);
      const bodyMatch = isCurationRelevant(inboundBodyBlob);

      if (!analysisMatch && !categoryMatch && !bodyMatch) continue;

      const trimmedMsgs = msgs
        .filter((m) => m.body_text && m.body_text.trim().length > 0)
        .slice(-12) // most recent 12 in the thread
        .map((m) => ({
          id: m.id,
          direction: m.direction,
          channel: m.channel,
          body_text: m.body_text ? m.body_text.slice(0, 1200) : null,
          sent_at: m.sent_at,
        }));

      results.push({
        thread_id: thread.id,
        channel: msgs[0]?.channel ?? null,
        subject: thread.subject ?? null,
        topic_label: analysis?.topic_label ?? null,
        outcome: analysis?.outcome ?? null,
        customer_intent_summary: analysis?.customer_intent_summary ?? null,
        agent_action_summary: analysis?.agent_action_summary ?? null,
        thread_status: thread.status,
        thread_category: thread.category,
        thread_created_at: thread.created_at,
        last_message_at: thread.last_message_at,
        messages: trimmedMsgs,
        match_reason: analysisMatch
          ? "analysis"
          : categoryMatch
            ? "thread_category"
            : "message_body",
      });
    }

    // Sort by most recent activity, cap total
    results.sort((a, b) => {
      const at = a.last_message_at ? Date.parse(a.last_message_at) : 0;
      const bt = b.last_message_at ? Date.parse(b.last_message_at) : 0;
      return bt - at;
    });
    return results.slice(0, 20);
  } catch (err) {
    console.warn("[customers/[id]] hub comms fetch failed:", err);
    return [];
  }
}

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const guard = await requireAdmin(req);
  if (!guard.ok) return guard.response;
  const { id } = await ctx.params;

  const svc = getSupabaseService();
  const customerId = Number(id);
  if (!Number.isFinite(customerId)) {
    return NextResponse.json({ error: "bad id" }, { status: 400 });
  }

  const [c360, facts, subs] = await Promise.all([
    svc.from("customer_360").select("*").eq("id", customerId).maybeSingle(),
    svc.from("customer_facts").select("*").eq("customer_id", customerId).maybeSingle(),
    svc.from("subscribers").select("*").eq("customer_id", String(customerId)).maybeSingle(),
  ]);

  if (c360.error) {
    return NextResponse.json({ error: `c360: ${c360.error.message}` }, { status: 500 });
  }
  if (!c360.data) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  // Orders are linked by email (no customer_id FK on orders table).
  const email: string | null = c360.data.email ?? null;
  const firebaseUid: string | null =
    typeof c360.data.firebase_uid === "string" ? c360.data.firebase_uid : null;

  let orderRows: Array<Record<string, unknown>> = [];
  let lineItems: Array<Record<string, unknown>> = [];
  const ordersPromise = (async () => {
    if (!email) return;
    const { data: ord } = await svc
      .from("orders")
      .select(
        "id,name,email,financial_status,fulfillment_status,total,subtotal,shipping_amount,discount_code,discount_amount,refunded_amount,currency,shipping_method,tags,source,cancelled_at,paid_at,fulfilled_at,created_at,is_subscription,is_first_order,is_recurring,shipping_city,shipping_province,shipping_country,billing_city,billing_province,billing_country,notes,entity",
      )
      .eq("email", email)
      .order("created_at", { ascending: false })
      .limit(20);
    orderRows = ord || [];
    if (orderRows.length > 0) {
      const orderIds = orderRows.map((o) => o.id);
      const { data: items } = await svc
        .from("order_line_items")
        .select(
          "order_id,sku,product_id,variant_id,selling_plan_name,quantity,price,title,vendor,variant_title,product_type,properties",
        )
        .in("order_id", orderIds);
      lineItems = items || [];
    }
  })();

  // Run all enrichment fetches in parallel for performance.
  const [firestore, communications] = await Promise.all([
    loadFirestoreBundle({ firebaseUid, email }),
    loadCurationCommunications({ supabaseSvc: svc, customerId, email }),
    ordersPromise,
  ]);

  // Group line items by order
  const itemsByOrder = new Map<string, Array<Record<string, unknown>>>();
  for (const li of lineItems) {
    const k = String(li.order_id);
    if (!itemsByOrder.has(k)) itemsByOrder.set(k, []);
    itemsByOrder.get(k)!.push(li);
  }
  const ordersWithItems = orderRows.map((o) => ({
    ...o,
    line_items: itemsByOrder.get(String(o.id)) || [],
  }));

  return NextResponse.json({
    customer_360: c360.data,
    customer_facts: facts.data || null,
    subscriber: subs.data || null,
    orders: ordersWithItems,
    // Back-compat: previous shape exposed `firestore` as the raw customers/{uid} doc.
    firestore: firestore.customer,
    // New, richer enrichment payload:
    enrichment: {
      firestore: {
        customer: firestore.customer,
        user: firestore.user,
        member_knowledge: firestore.member_knowledge,
        mulligan_submission: firestore.mulligan_submission,
        email_replies: firestore.email_replies,
        email_feedback: firestore.email_feedback,
        concierge_requests: firestore.concierge_requests,
      },
      communications,
    },
  });
}
