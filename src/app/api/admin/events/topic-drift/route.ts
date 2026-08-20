/**
 * GET /api/admin/events/topic-drift
 *
 * Diffs the declarative desired-topic list (src/lib/events/desired-topics.ts)
 * against the webhook subscriptions Shopify actually reports, writes a snapshot
 * into public.event_topic_expectation, and returns the table.
 *
 * REPORT ONLY. There is deliberately no mutation code in this file — no
 * webhookSubscriptionCreate, no update, no delete. Creating the missing
 * registrations is a follow-up PR, after the owner has read this report.
 *
 * Caveat worth knowing when reading the output: webhookSubscriptions only
 * returns subscriptions owned by the app whose token is making the call. An
 * empty result is not proof that no subscriptions exist — it can equally mean
 * the token belongs to a different app than the one holding the subscriptions.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/app/api/_lib/adminAuth";
import { shopifyGraphQL } from "@/app/api/_lib/shopifyAdmin";
import { getSupabaseService } from "@/app/api/_lib/supabaseService";
import {
  DESIRED_SHOPIFY_TOPICS,
  desiredTopicUri,
} from "@/lib/events/desired-topics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Verdict = "ok" | "missing" | "wrong_uri" | "unexpected";

interface DriftRow {
  provider: "shopify";
  topic: string;
  expected: boolean;
  registered: boolean;
  registered_uri: string | null;
  verdict: Verdict;
  detail: string;
}

interface SubscriptionNode {
  id: string;
  topic: string;
  uri: string | null;
}

interface SubscriptionsResponse {
  webhookSubscriptions: {
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
    nodes: SubscriptionNode[];
  };
}

/**
 * Shopify's WebhookSubscriptionTopic enum is the slash topic upper-cased with
 * separators replaced: "orders/paid" → "ORDERS_PAID".
 */
function topicToEnum(topic: string): string {
  return topic.toUpperCase().replace(/[/-]/g, "_");
}

const SUBSCRIPTIONS_QUERY = `
  query BackboneWebhookSubscriptions($cursor: String) {
    webhookSubscriptions(first: 100, after: $cursor) {
      pageInfo { hasNextPage endCursor }
      nodes {
        id
        topic
        uri
      }
    }
  }
`;

async function fetchAllSubscriptions(): Promise<SubscriptionNode[]> {
  const all: SubscriptionNode[] = [];
  let cursor: string | null = null;

  // Bounded so a pagination bug cannot spin forever.
  for (let page = 0; page < 20; page++) {
    const data: SubscriptionsResponse = await shopifyGraphQL<SubscriptionsResponse>(
      SUBSCRIPTIONS_QUERY,
      { cursor },
    );
    all.push(...data.webhookSubscriptions.nodes);
    if (!data.webhookSubscriptions.pageInfo.hasNextPage) break;
    cursor = data.webhookSubscriptions.pageInfo.endCursor;
    if (!cursor) break;
  }

  return all;
}

export async function GET(request: NextRequest) {
  const guard = await requireAdmin(request);
  if (!guard.ok) return guard.response;

  let subscriptions: SubscriptionNode[];
  try {
    subscriptions = await fetchAllSubscriptions();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: "shopify_query_failed", detail: message },
      { status: 502 },
    );
  }

  const registeredByEnum = new Map<string, SubscriptionNode>();
  for (const node of subscriptions) {
    registeredByEnum.set(node.topic, node);
  }

  const rows: DriftRow[] = [];
  const seenEnums = new Set<string>();

  for (const desired of DESIRED_SHOPIFY_TOPICS) {
    const wantedUri = desiredTopicUri(desired);
    const enumTopic = topicToEnum(desired.topic);
    seenEnums.add(enumTopic);

    const found = registeredByEnum.get(enumTopic);
    if (!found) {
      rows.push({
        provider: "shopify",
        topic: desired.topic,
        expected: true,
        registered: false,
        registered_uri: null,
        verdict: "missing",
        detail: `No subscription reported for ${enumTopic}. Wanted ${wantedUri}.`,
      });
      continue;
    }

    const sameUri = (found.uri ?? "").replace(/\/+$/, "") === wantedUri.replace(/\/+$/, "");
    rows.push({
      provider: "shopify",
      topic: desired.topic,
      expected: true,
      registered: true,
      registered_uri: found.uri,
      verdict: sameUri ? "ok" : "wrong_uri",
      detail: sameUri
        ? `Registered at ${found.uri}.`
        : `Registered at ${found.uri ?? "(none)"} but expected ${wantedUri}.`,
    });
  }

  for (const [enumTopic, node] of registeredByEnum) {
    if (seenEnums.has(enumTopic)) continue;
    rows.push({
      provider: "shopify",
      topic: enumTopic,
      expected: false,
      registered: true,
      registered_uri: node.uri,
      verdict: "unexpected",
      detail: `Registered at ${node.uri ?? "(none)"} but not in the desired-topic list.`,
    });
  }

  const checkedAt = new Date().toISOString();
  let snapshotError: string | null = null;
  try {
    const sb = getSupabaseService();
    const { error } = await sb.from("event_topic_expectation").insert(
      rows.map((row) => ({
        checked_at: checkedAt,
        provider: row.provider,
        topic: row.topic,
        expected: row.expected,
        registered: row.registered,
        registered_uri: row.registered_uri,
        verdict: row.verdict,
        detail: row.detail,
      })),
    );
    if (error) snapshotError = error.message;
  } catch (err) {
    snapshotError = err instanceof Error ? err.message : String(err);
  }

  const tally = rows.reduce<Record<Verdict, number>>(
    (acc, row) => {
      acc[row.verdict] += 1;
      return acc;
    },
    { ok: 0, missing: 0, wrong_uri: 0, unexpected: 0 },
  );

  return NextResponse.json({
    summary: `${tally.ok} ok, ${tally.missing} missing, ${tally.wrong_uri} wrong_uri, ${tally.unexpected} unexpected`,
    checked_at: checkedAt,
    note: "Report only — this endpoint never creates or modifies a webhook subscription. webhookSubscriptions returns only subscriptions owned by the querying app, so an empty result is not proof of absence.",
    snapshot_error: snapshotError,
    rows,
  });
}
