/**
 * GET /api/admin/intercom-insights
 *
 * Customer support analytics from the mully-hub Intercom mirror.
 *
 * Pulls from Supabase tables:
 *   - hub_thread (status, category, first_response_at, replied_at, last_message_at)
 *   - hub_message (direction, channel, body_text, sent_at)
 *   - hub_conversation_analysis (topic_label, outcome, customer_intent_summary, confidence)
 *
 * Returns:
 *   - volume_by_day:    new threads per day in window
 *   - top_topics:       AI-labeled topic distribution (last N days)
 *   - outcome_breakdown: resolved/awaiting/refunded/cancelled mix
 *   - response_time:    median + p90 first-response latency (minutes)
 *   - cancellation_surge: 7d vs 30d cancel-intent rate, flag if elevated
 *   - refund_intents:   threads with refund_issued outcome (count + recent samples)
 *   - active_now:       open threads awaiting our reply
 *   - top_pain_points:  customer_intent_summary samples grouped by topic
 *
 * Query params:
 *   - days: lookback (default 30, max 90)
 *
 * Auth: same Firebase admin allowlist as the rest of /admin.
 */

import { NextRequest, NextResponse } from "next/server";
import { adminAuth } from "@/lib/firebase-admin";
import { isAllowedAdminEmail } from "@/lib/adminEmailAllowlist";
import { getSupabaseService } from "@/app/api/_lib/supabaseService";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function verifyAdmin(request: NextRequest): Promise<boolean> {
  const header = request.headers.get("authorization") ?? "";
  const token = header.replace(/^Bearer\s+/i, "").trim();
  if (!token) return false;
  try {
    const decoded = await adminAuth.verifyIdToken(token);
    return !!decoded.email && isAllowedAdminEmail(decoded.email);
  } catch {
    return false;
  }
}

interface VolumeRow {
  day: string;
  new_threads: number;
  inbound_messages: number;
  outbound_messages: number;
}
interface TopicRow {
  topic_label: string | null;
  count: number;
  avg_confidence: number | null;
}
interface OutcomeRow {
  outcome: string | null;
  count: number;
}
interface PainPoint {
  topic_label: string | null;
  outcome: string | null;
  customer_intent_summary: string | null;
  created_at: string;
  customer_email: string | null;
}

export async function GET(request: NextRequest) {
  if (!(await verifyAdmin(request))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const rawDays = parseInt(searchParams.get("days") ?? "30", 10);
  const days = Math.min(Math.max(Number.isFinite(rawDays) ? rawDays : 30, 1), 90);

  const sb = getSupabaseService();
  const sinceIso = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  const since7Iso = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  try {
    // --- 1. Threads in window (used for volume, response time, active counts)
    const { data: threads, error: threadErr } = await sb
      .from("hub_thread")
      .select(
        "id, status, category, first_response_at, replied_at, last_message_at, last_message_dir, archived, snooze_until, created_at, customer_id"
      )
      .gte("created_at", sinceIso)
      .order("created_at", { ascending: false })
      .limit(5000);
    if (threadErr) throw new Error(`hub_thread: ${threadErr.message}`);
    const threadList = threads ?? [];

    // --- 2. Messages in window (volume by direction)
    const { data: messages, error: msgErr } = await sb
      .from("hub_message")
      .select("id, direction, sent_at, created_at")
      .gte("created_at", sinceIso)
      .limit(20000);
    if (msgErr) throw new Error(`hub_message: ${msgErr.message}`);
    const msgList = messages ?? [];

    // --- 3. Analyzed conversations (topics, outcomes, pain points)
    const { data: analyses, error: anaErr } = await sb
      .from("hub_conversation_analysis")
      .select(
        "thread_id, customer_email, topic_label, outcome, customer_intent_summary, agent_action_summary, confidence, created_at"
      )
      .gte("created_at", sinceIso)
      .order("created_at", { ascending: false })
      .limit(5000);
    if (anaErr) throw new Error(`hub_conversation_analysis: ${anaErr.message}`);
    const anaList = analyses ?? [];

    // --- volume_by_day
    const volMap: Record<string, VolumeRow> = {};
    for (let i = 0; i < days; i++) {
      const d = new Date(Date.now() - i * 24 * 60 * 60 * 1000);
      const key = d.toISOString().slice(0, 10);
      volMap[key] = { day: key, new_threads: 0, inbound_messages: 0, outbound_messages: 0 };
    }
    for (const t of threadList) {
      const key = (t.created_at as string).slice(0, 10);
      if (volMap[key]) volMap[key].new_threads += 1;
    }
    for (const m of msgList) {
      const key = (m.created_at as string).slice(0, 10);
      if (!volMap[key]) continue;
      if (m.direction === "in") volMap[key].inbound_messages += 1;
      else if (m.direction === "out") volMap[key].outbound_messages += 1;
    }
    const volume_by_day = Object.values(volMap).sort((a, b) => a.day.localeCompare(b.day));

    // --- top_topics
    const topicAgg: Record<string, { count: number; confSum: number; confN: number }> = {};
    for (const a of anaList) {
      const key = a.topic_label ?? "(unlabeled)";
      if (!topicAgg[key]) topicAgg[key] = { count: 0, confSum: 0, confN: 0 };
      topicAgg[key].count += 1;
      if (typeof a.confidence === "number") {
        topicAgg[key].confSum += a.confidence;
        topicAgg[key].confN += 1;
      }
    }
    const top_topics: TopicRow[] = Object.entries(topicAgg)
      .map(([topic_label, v]) => ({
        topic_label,
        count: v.count,
        avg_confidence: v.confN > 0 ? v.confSum / v.confN : null,
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 15);

    // --- outcome_breakdown
    const outcomeAgg: Record<string, number> = {};
    for (const a of anaList) {
      const key = a.outcome ?? "(none)";
      outcomeAgg[key] = (outcomeAgg[key] ?? 0) + 1;
    }
    const outcome_breakdown: OutcomeRow[] = Object.entries(outcomeAgg)
      .map(([outcome, count]) => ({ outcome, count }))
      .sort((a, b) => b.count - a.count);

    // --- response_time (minutes from created_at to first_response_at)
    const responseDeltas: number[] = [];
    for (const t of threadList) {
      if (!t.first_response_at || !t.created_at) continue;
      const delta =
        (new Date(t.first_response_at as string).getTime() -
          new Date(t.created_at as string).getTime()) /
        60000;
      if (delta >= 0 && delta < 60 * 24 * 14) responseDeltas.push(delta);
    }
    responseDeltas.sort((a, b) => a - b);
    const median = (arr: number[]) =>
      arr.length === 0 ? null : arr[Math.floor(arr.length / 2)];
    const pct = (arr: number[], p: number) =>
      arr.length === 0 ? null : arr[Math.min(arr.length - 1, Math.floor(arr.length * p))];
    const response_time = {
      sample_size: responseDeltas.length,
      median_minutes: median(responseDeltas),
      p90_minutes: pct(responseDeltas, 0.9),
      threads_no_response: threadList.filter(
        (t) => !t.first_response_at && !t.archived
      ).length,
    };

    // --- cancellation_surge
    const cancel7d = anaList.filter(
      (a) =>
        (a.outcome === "cancelled" || (a.topic_label ?? "").toLowerCase().includes("cancel")) &&
        a.created_at >= since7Iso
    ).length;
    const cancel30d = anaList.filter(
      (a) =>
        a.outcome === "cancelled" || (a.topic_label ?? "").toLowerCase().includes("cancel")
    ).length;
    const cancel7dRate = cancel7d / 7;
    const cancel30dRate = cancel30d / days;
    const cancellation_surge = {
      cancel_threads_7d: cancel7d,
      cancel_threads_window: cancel30d,
      rate_7d_per_day: cancel7dRate,
      rate_window_per_day: cancel30dRate,
      surge: cancel30dRate > 0 && cancel7dRate / cancel30dRate > 1.5,
    };

    // --- refund_intents
    const refunds = anaList.filter((a) => a.outcome === "refund_issued");
    const refund_intents = {
      count_window: refunds.length,
      recent: refunds.slice(0, 10).map((r) => ({
        thread_id: r.thread_id,
        customer_email: r.customer_email,
        topic_label: r.topic_label,
        intent: r.customer_intent_summary,
        agent_action: r.agent_action_summary,
        created_at: r.created_at,
      })),
    };

    // --- active_now (open threads, last_message_dir = 'in', not archived/snoozed)
    const nowIso = new Date().toISOString();
    const active_now = threadList.filter(
      (t) =>
        !t.archived &&
        t.last_message_dir === "in" &&
        (!t.snooze_until || (t.snooze_until as string) < nowIso) &&
        t.status !== "closed"
    ).length;

    // --- top_pain_points: most recent customer intent summaries by top topic
    const topTopicKeys = top_topics.slice(0, 6).map((t) => t.topic_label);
    const top_pain_points: PainPoint[] = [];
    for (const tk of topTopicKeys) {
      const samples = anaList
        .filter((a) => (a.topic_label ?? "(unlabeled)") === tk && a.customer_intent_summary)
        .slice(0, 3);
      for (const s of samples) {
        top_pain_points.push({
          topic_label: s.topic_label,
          outcome: s.outcome,
          customer_intent_summary: s.customer_intent_summary,
          created_at: s.created_at,
          customer_email: s.customer_email,
        });
      }
    }

    return NextResponse.json({
      window_days: days,
      generated_at: new Date().toISOString(),
      totals: {
        threads: threadList.length,
        analyzed: anaList.length,
        messages: msgList.length,
        active_awaiting_reply: active_now,
      },
      volume_by_day,
      top_topics,
      outcome_breakdown,
      response_time,
      cancellation_surge,
      refund_intents,
      top_pain_points,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: "intercom-insights failed", detail: message },
      { status: 500 }
    );
  }
}
