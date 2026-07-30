/**
 * GET /api/admin/events/coverage[?format=csv]
 *
 * The proof-of-fire report. One row per canonical event, answering the only
 * question that matters: did this event type verifiably fire, and did it reach
 * a customer?
 *
 * Every verdict here is computed. None is hand-written — a hand-written status
 * is exactly how two finished member emails sat "ready" for months without ever
 * being sent to a human being.
 *
 * REGISTERED_BUT_SILENT is the dangerous one: the subscription exists, so
 * everything looks wired, and nothing has ever arrived.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/app/api/_lib/adminAuth";
import { getSupabaseService } from "@/app/api/_lib/supabaseService";
import {
  CANONICAL_EVENTS,
  providerForEvent,
  type CanonicalEvent,
} from "@/lib/events/catalog";
import { expectedCanonicalEvents } from "@/lib/events/desired-topics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Verdict = "LIVE" | "REGISTERED_BUT_SILENT" | "DEAD" | "ARRIVING_UNRESOLVED";

interface CoverageAggregate {
  event_name: string;
  first_seen_at: string | null;
  last_seen_at: string | null;
  count_24h: number;
  count_7d: number;
  count_30d: number;
  resolved_count_30d: number;
  unresolvable_count_30d: number;
  total_count: number;
}

export interface CoverageRow {
  event_name: CanonicalEvent;
  provider: "shopify" | "loop" | "resend";
  expected: boolean;
  /** Null for loop and resend: Stage A has no registration mechanism for them. */
  registered: boolean | null;
  first_seen_at: string | null;
  last_seen_at: string | null;
  count_24h: number;
  count_7d: number;
  count_30d: number;
  resolved_pct: number;
  unresolvable_count: number;
  verdict: Verdict;
}

/**
 * Verdict rules, in evaluation order.
 *
 * `registered === null` (Loop, Resend) falls through to receipt-based judgement,
 * because "not registered" would otherwise brand every healthy Loop event DEAD.
 */
export function computeVerdict(input: {
  registered: boolean | null;
  count30d: number;
  resolvedPct: number;
}): Verdict {
  if (input.registered === true && input.count30d === 0) return "REGISTERED_BUT_SILENT";
  if (input.count30d > 0 && input.resolvedPct === 0) return "ARRIVING_UNRESOLVED";
  if (input.count30d > 0 && input.resolvedPct > 0 && input.registered !== false) return "LIVE";
  return "DEAD";
}

function toCsv(rows: CoverageRow[]): string {
  const header = [
    "event_name",
    "provider",
    "expected",
    "registered",
    "first_seen_at",
    "last_seen_at",
    "count_24h",
    "count_7d",
    "count_30d",
    "resolved_pct",
    "unresolvable_count",
    "verdict",
  ];

  const escape = (value: unknown): string => {
    const str = value === null || value === undefined ? "" : String(value);
    return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
  };

  return [
    header.join(","),
    ...rows.map((row) =>
      [
        row.event_name,
        row.provider,
        row.expected,
        row.registered === null ? "" : row.registered,
        row.first_seen_at,
        row.last_seen_at,
        row.count_24h,
        row.count_7d,
        row.count_30d,
        row.resolved_pct,
        row.unresolvable_count,
        row.verdict,
      ]
        .map(escape)
        .join(","),
    ),
  ].join("\n");
}

export async function GET(request: NextRequest) {
  const guard = await requireAdmin(request);
  if (!guard.ok) return guard.response;

  const sb = getSupabaseService();

  const { data: aggData, error: aggError } = await sb.rpc("event_backbone_coverage");
  if (aggError) {
    return NextResponse.json(
      { error: "coverage_query_failed", detail: aggError.message },
      { status: 500 },
    );
  }

  const aggregates = new Map<string, CoverageAggregate>();
  for (const row of (aggData ?? []) as CoverageAggregate[]) {
    aggregates.set(row.event_name, row);
  }

  // Registration comes from the most recent topic-drift snapshot.
  const { data: snapshotData } = await sb
    .from("event_topic_expectation")
    .select("topic,registered,verdict,checked_at")
    .order("checked_at", { ascending: false })
    .limit(500);

  const snapshotRows = (snapshotData ?? []) as {
    topic: string;
    registered: boolean | null;
    checked_at: string;
  }[];
  const latestCheckedAt = snapshotRows[0]?.checked_at ?? null;
  const registeredTopics = new Map<string, boolean>();
  for (const row of snapshotRows) {
    if (row.checked_at !== latestCheckedAt) continue;
    if (!registeredTopics.has(row.topic)) {
      registeredTopics.set(row.topic, row.registered === true);
    }
  }

  const expected = expectedCanonicalEvents();

  // Canonical event → the Shopify topic whose registration governs it.
  const { SHOPIFY_TOPIC_TO_EVENT } = await import("@/lib/events/catalog");
  const topicForEvent = new Map<string, string>();
  for (const [topic, event] of Object.entries(SHOPIFY_TOPIC_TO_EVENT)) {
    if (!topicForEvent.has(event)) topicForEvent.set(event, topic);
  }
  // shipment.delivered is derived from fulfillments/update, so it inherits it.
  topicForEvent.set("shipment.delivered", "fulfillments/update");

  const rows: CoverageRow[] = CANONICAL_EVENTS.map((eventName) => {
    const agg = aggregates.get(eventName);
    const provider = providerForEvent(eventName);

    const count30d = Number(agg?.count_30d ?? 0);
    const resolved = Number(agg?.resolved_count_30d ?? 0);
    const resolvedPct = count30d === 0 ? 0 : Math.round((resolved / count30d) * 1000) / 10;

    let registered: boolean | null = null;
    if (provider === "shopify") {
      const topic = topicForEvent.get(eventName);
      registered =
        latestCheckedAt === null || topic === undefined
          ? null
          : (registeredTopics.get(topic) ?? false);
    }

    return {
      event_name: eventName,
      provider,
      expected: expected.has(eventName),
      registered,
      first_seen_at: agg?.first_seen_at ?? null,
      last_seen_at: agg?.last_seen_at ?? null,
      count_24h: Number(agg?.count_24h ?? 0),
      count_7d: Number(agg?.count_7d ?? 0),
      count_30d: count30d,
      resolved_pct: resolvedPct,
      unresolvable_count: Number(agg?.unresolvable_count_30d ?? 0),
      verdict: computeVerdict({ registered, count30d, resolvedPct }),
    };
  });

  if (request.nextUrl.searchParams.get("format") === "csv") {
    return new NextResponse(toCsv(rows), {
      status: 200,
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": 'attachment; filename="event-coverage.csv"',
      },
    });
  }

  const tally = rows.reduce<Record<Verdict, number>>(
    (acc, row) => {
      acc[row.verdict] += 1;
      return acc;
    },
    { LIVE: 0, REGISTERED_BUT_SILENT: 0, DEAD: 0, ARRIVING_UNRESOLVED: 0 },
  );

  return NextResponse.json({
    summary: `${tally.LIVE} LIVE, ${tally.REGISTERED_BUT_SILENT} REGISTERED_BUT_SILENT, ${tally.DEAD} DEAD, ${tally.ARRIVING_UNRESOLVED} ARRIVING_UNRESOLVED`,
    registration_snapshot_at: latestCheckedAt,
    note:
      latestCheckedAt === null
        ? "No topic-drift snapshot exists yet, so `registered` is null for every Shopify event. Run /api/admin/events/topic-drift first."
        : "`registered` is null for loop and resend events: Stage A has no registration mechanism for those providers.",
    rows,
  });
}
