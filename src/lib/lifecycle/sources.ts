/**
 * Live source adapters + the fresh recheck used immediately before dispatch.
 * Read-only against Shopify Admin and Supabase. No PII is logged or stored.
 */
import { getSupabaseService } from "@/app/api/_lib/supabaseService";
import { shopifyGraphQL } from "@/app/api/_lib/shopifyAdmin";
import {
  evaluateOrderEligibility, reconcileMembership, type ContractEvidence, type CoverageEvidence, type ServiceEvidence,
} from "@/lib/klaviyo/eligibility";
import { shopifyId } from "@/lib/klaviyo/orderMatching";
import { buildNativeEvidence, fromRow, type FlowRow } from "./flowBridge";
import { readCustomerOrderHistory, type CustomerOrderHistory } from "./orderHistory";
import type { OutboxRepo, OutboxRow, Recheck, Finish } from "./dispatch";

type Sb = ReturnType<typeof getSupabaseService>;

/** Support-inbox clearance. Channels are only "all" once Drew confirms the list. */
export async function readServiceEvidence(sb: Sb, customerId: string, now = new Date(),
  env: Record<string, string | undefined> = process.env): Promise<ServiceEvidence> {
  const id = shopifyId(customerId, "Customer");
  const base: ServiceEvidence = { customerId: id ?? "", complete: false, allChannels: false,
    checkedAt: now.toISOString(), unresolvedCount: -1, reviewOwner: "unknown" };
  if (!id) return base;
  const [threads, heartbeat] = await Promise.all([
    // Unresolved = anything not closed, including snoozed and archived-but-open.
    sb.from("hub_thread").select("id", { count: "exact", head: true }).eq("customer_id", id).neq("status", "closed"),
    sb.from("hub_message").select("created_at").order("created_at", { ascending: false }).limit(1),
  ]);
  const newest = Date.parse(String((heartbeat.data?.[0] as { created_at?: string } | undefined)?.created_at ?? ""));
  const mirrorFresh = Number.isFinite(newest) && now.getTime() - newest <= 24 * 3_600_000;
  return {
    ...base,
    complete: !threads.error && typeof threads.count === "number" && !heartbeat.error && mirrorFresh,
    allChannels: env.LIFECYCLE_SERVICE_CHANNELS_CONFIRMED === "true",
    unresolvedCount: typeof threads.count === "number" ? threads.count : -1,
    reviewOwner: env.LIFECYCLE_REVIEW_OWNER === "klaviyo" ? "klaviyo" : "unknown",
  };
}

/** Loop contract evidence from the Loop mirror. Coverage needs a fresh sync. */
export async function readLoopEvidence(sb: Sb, customerId: string, now = new Date()) {
  const { data, error } = await sb.from("loop_subscriptions")
    .select("loop_subscription_id,customer_id,status,synced_at").eq("customer_id", customerId);
  const contracts: ContractEvidence[] = [];
  let newestSync = 0;
  for (const r of (data ?? []) as Array<{ loop_subscription_id: unknown; customer_id: unknown; status: unknown; synced_at: unknown }>) {
    const at = Date.parse(String(r.synced_at ?? ""));
    if (Number.isFinite(at)) newestSync = Math.max(newestSync, at);
    const s = String(r.status ?? "").toUpperCase();
    contracts.push({ provider: "loop", contractId: String(r.loop_subscription_id ?? ""), customerId: String(r.customer_id ?? ""),
      status: s === "ACTIVE" ? "active" : s === "PAUSED" ? "paused" : s === "CANCELLED" ? "cancelled" : s === "EXPIRED" ? "expired" : "unknown",
      observedAt: Number.isFinite(at) ? new Date(at).toISOString() : "" });
  }
  // A mirror row proves a contract exists; an EMPTY result proves nothing
  // (never infer nonmembership from absence). Staleness is enforced by the
  // engine's 48h freshness rule on observedAt / checkedAt.
  const proven = !error && contracts.length > 0;
  const coverage: CoverageEvidence = { provider: "loop", customerId, scope: proven ? "all_customer_contracts" : "unknown",
    complete: proven, checkedAt: newestSync ? new Date(Math.min(newestSync, now.getTime())).toISOString() : now.toISOString() };
  return { contracts, coverage, ok: !error };
}

export async function readNativeEvents(sb: Sb, customerId: string) {
  const since = new Date(Date.now() - 400 * 86_400_000).toISOString();
  const [mine, runs] = await Promise.all([
    sb.from("lifecycle_native_subscription_events").select("*").eq("shopify_customer_id", customerId).gte("occurred_at", since).limit(1000),
    sb.from("lifecycle_native_subscription_events").select("*").in("kind", ["snapshot_run", "contract_snapshot"])
      .gte("occurred_at", new Date(Date.now() - 3 * 86_400_000).toISOString()).limit(5000),
  ]);
  if (mine.error || runs.error) return null;
  const all = new Map<string, FlowRow>();
  for (const r of [...(mine.data ?? []), ...(runs.data ?? [])] as FlowRow[]) all.set(r.idempotency_key, r);
  return [...all.values()].map(fromRow);
}

const ORDER_EMAIL_QUERY = `query MullyLifecycleOrderContact($id: ID!) { order(id: $id) { id email customer { id } } }`;

/** Fresh, complete recheck for one outbox row. Any missing source => hold. */
export async function recheckOutboxRow(row: OutboxRow, deps: {
  sb?: Sb; gql?: (q: string, v: Record<string, unknown>) => Promise<unknown>;
  consent?: (email: string) => Promise<{ subscribed: boolean; marketable: boolean; internal: boolean }>;
} = {}): Promise<Recheck> {
  const sb = deps.sb ?? getSupabaseService();
  const gql = deps.gql ?? ((q, v) => shopifyGraphQL(q, v));
  if (!deps.consent) return { eligible: false, holds: ["consent_adapter_not_configured"], email: null };
  const now = new Date();
  const history: CustomerOrderHistory = await readCustomerOrderHistory(row.shopify_customer_id, gql, () => now);
  const order = history.orders.find((o) => o.orderId === row.shopify_order_id);
  if (!order) return { eligible: false, holds: ["order_not_in_customer_history"], email: null };
  const contact = await gql(ORDER_EMAIL_QUERY, { id: `gid://shopify/Order/${row.shopify_order_id}` }) as { order?: { email?: string | null; customer?: { id?: string } } };
  const email = typeof contact?.order?.email === "string" ? contact.order.email.trim().toLowerCase() : null;
  if (!email || shopifyId(contact.order?.customer?.id, "Customer") !== row.shopify_customer_id) {
    return { eligible: false, holds: ["order_contact_unverified"], email: null };
  }
  const [loop, events, service, consent] = await Promise.all([
    readLoopEvidence(sb, row.shopify_customer_id, now), readNativeEvents(sb, row.shopify_customer_id),
    readServiceEvidence(sb, row.shopify_customer_id, now), deps.consent(email),
  ]);
  if (!events) return { eligible: false, holds: ["native_events_read_failed"], email: null };
  const native = buildNativeEvidence(row.shopify_customer_id, events, history, now);
  const membership = reconcileMembership(row.shopify_customer_id, [...loop.contracts, ...native.contracts],
    [loop.coverage, ...native.coverage], now);
  const decision = evaluateOrderEligibility({
    kind: row.program, customerId: row.shopify_customer_id, order: order.classifierOrder, orderCheckedAt: history.checkedAt,
    fulfillments: order.classifierFulfillments, fulfillmentsCheckedAt: history.checkedAt, fulfillmentsComplete: !order.truncated,
    membership, service, history: history.history,
    emailSubscribed: consent.subscribed, emailMarketable: consent.marketable, internal: consent.internal, now,
  });
  const holds = [...decision.holds, ...(row.program.startsWith("member_") ? native.holds : [])];
  if (decision.dedupeKey !== row.dedupe_key) holds.push("dedupe_key_mismatch");
  return { eligible: decision.auditCandidate && holds.length === 0, holds: [...new Set(holds)].sort(), email };
}

/** Supabase-backed outbox. Every finish is fenced by the claim's lease token. */
export function supabaseOutboxRepo(sb: Sb = getSupabaseService()): OutboxRepo {
  return {
    async enqueue(row) {
      const { data, error } = await sb.from("lifecycle_dispatch_outbox")
        .upsert(row, { onConflict: "dedupe_key", ignoreDuplicates: true }).select("id");
      if (error) throw new Error("outbox_enqueue_failed");
      return data && data.length ? "inserted" : "duplicate";
    },
    async claim(limit, leaseSeconds) {
      const { data, error } = await sb.rpc("lifecycle_outbox_claim", { p_limit: limit, p_lease_seconds: leaseSeconds });
      if (error) throw new Error("outbox_claim_failed");
      return (data ?? []) as OutboxRow[];
    },
    async finish(id, leaseToken, result: Finish) {
      const patch: Record<string, unknown> = { state: result.state, lease_until: null, lease_token: null, updated_at: new Date().toISOString() };
      if (result.state === "sent") patch.sent_at = new Date().toISOString();
      if (result.state === "held") patch.last_holds = result.holds;
      if (result.state === "failed") { patch.last_error = result.error; patch.next_attempt_at = result.retryAt; }
      if (result.state === "dead") patch.last_error = result.error;
      const { data, error } = await sb.from("lifecycle_dispatch_outbox").update(patch)
        .eq("id", id).eq("lease_token", leaseToken).eq("state", "claimed").select("id");
      return !error && !!data?.length;
    },
  };
}
