/**
 * Returns & customer-request queue (server-only).
 *
 * Powers /admin/returns: one daily view of every Shopify return request
 * waiting on a decision, approved returns that were never closed, saved
 * customer exchange requests, and (when the token has payments scope)
 * open chargebacks. Decisions run through the Admin API with the app's
 * SHOPIFY_ADMIN_TOKEN so nobody has to open Shopify Admin to act.
 */

const API_VERSION = "2026-07";

function storeDomain(): string {
  const d = process.env.SHOPIFY_STORE_DOMAIN ?? process.env.NEXT_PUBLIC_SHOPIFY_STORE_DOMAIN;
  if (!d) throw new Error("Missing SHOPIFY_STORE_DOMAIN");
  return d;
}

function adminToken(): string {
  const t = process.env.SHOPIFY_ADMIN_TOKEN ?? process.env.SHOPIFY_CLIENT_SECRET;
  if (!t) throw new Error("Missing Shopify Admin credentials.");
  return t;
}

export class ShopifyAdminError extends Error {
  constructor(message: string, public readonly accessDenied = false) {
    super(message);
  }
}

export async function adminGraphql<T>(
  query: string,
  variables?: Record<string, unknown>,
  fetcher: typeof fetch = fetch,
): Promise<T> {
  const res = await fetcher(`https://${storeDomain()}/admin/api/${API_VERSION}/graphql.json`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": adminToken() },
    body: JSON.stringify({ query, variables }),
    cache: "no-store",
  });
  if (!res.ok) throw new ShopifyAdminError(`Shopify ${res.status}: ${await res.text()}`);
  const json = (await res.json()) as { data: T; errors?: { message: string }[] };
  if (json.errors?.length) {
    const msg = json.errors.map((e) => e.message).join("; ");
    throw new ShopifyAdminError(msg, /access denied/i.test(msg));
  }
  return json.data;
}

export function shopifyAdminUrl(gid: string): string {
  const handle = (process.env.SHOPIFY_ADMIN_STORE_HANDLE ?? storeDomain().replace(".myshopify.com", ""));
  const id = gid.split("/").pop();
  return `https://admin.shopify.com/store/${handle}/orders/${id}`;
}

// ─── Queries ──────────────────────────────────────────────────────────────────

export const RETURN_QUEUE_QUERY = `query ReturnQueue($q: String!, $after: String) {
  orders(first: 50, after: $after, query: $q, sortKey: CREATED_AT, reverse: true) {
    pageInfo { hasNextPage endCursor }
    nodes {
      id
      name
      createdAt
      displayFinancialStatus
      displayFulfillmentStatus
      tags
      totalPriceSet { shopMoney { amount } }
      customer { id displayName email numberOfOrders }
      returns(first: 10) {
        nodes {
          id
          name
          status
          createdAt
          requestApprovedAt
          totalQuantity
          returnLineItems(first: 20) {
            nodes {
              ... on ReturnLineItem {
                id
                quantity
                returnReason
                customerNote
                fulfillmentLineItem {
                  id
                  lineItem {
                    id
                    title
                    variantTitle
                    sku
                    product { id }
                    originalUnitPriceSet { shopMoney { amount } }
                  }
                }
              }
            }
          }
          exchangeLineItems(first: 10) {
            nodes { lineItems { title variantTitle } }
          }
        }
      }
    }
  }
}`;

export const ORDER_LOOKUP_QUERY = `query ReturnOrderLookup($q: String!) {
  orders(first: 1, query: $q) {
    nodes {
      id
      name
      customer { displayName email }
      fulfillments(first: 10) {
        fulfillmentLineItems(first: 50) {
          nodes {
            id
            quantity
            lineItem {
              id
              title
              variantTitle
              sku
              product { id }
              originalUnitPriceSet { shopMoney { amount } }
            }
          }
        }
      }
    }
  }
}`;

export const VARIANT_SEARCH_QUERY = `query ReturnVariantSearch($q: String!) {
  productVariants(first: 25, query: $q) {
    nodes {
      id
      title
      sku
      price
      inventoryQuantity
      availableForSale
      product { id title status }
    }
  }
}`;

export const PRODUCT_SEARCH_QUERY = `query ReturnProductSearch($q: String!) {
  products(first: 12, query: $q, sortKey: RELEVANCE) {
    nodes {
      id
      title
      vendor
      featuredMedia { preview { image { url } } }
      variants(first: 50) {
        nodes { id title sku price inventoryQuantity availableForSale }
      }
    }
  }
}`;

// Shopify search syntax: every word must match the title, vendor, or SKU
// ("rhone polo" → Rhone polos). Characters that break the syntax are dropped.
export function toProductSearch(q: string): string {
  const words = q
    .replace(/[\\():"'*]/g, " ")
    .split(/\s+/)
    .filter((w) => w && !/^(and|or|not)$/i.test(w))
    .slice(0, 5);
  return "status:active AND " + words.map((w) => `(title:*${w}* OR vendor:*${w}* OR sku:${w}*)`).join(" AND ");
}

export const PRODUCT_VARIANTS_QUERY = `query ReturnProductVariants($id: ID!) {
  product(id: $id) {
    id
    title
    vendor
    featuredMedia { preview { image { url } } }
    variants(first: 50) {
      nodes { id title sku price inventoryQuantity availableForSale }
    }
  }
}`;

export const DISPUTES_QUERY = `query ReturnQueueDisputes {
  shopifyPaymentsAccount {
    disputes(first: 25, query: "status:needs_response OR status:under_review") {
      nodes {
        id
        status
        initiatedAt
        evidenceDueBy
        amount { amount }
        reasonDetails { reason }
        order { id name customer { displayName email } }
      }
    }
  }
}`;

export const APPROVE_MUTATION = `mutation QueueApproveReturn($input: ReturnApproveRequestInput!) {
  returnApproveRequest(input: $input) {
    return { id status }
    userErrors { field message }
  }
}`;

export const DECLINE_MUTATION = `mutation QueueDeclineReturn($input: ReturnDeclineRequestInput!) {
  returnDeclineRequest(input: $input) {
    return { id status }
    userErrors { field message }
  }
}`;

export const CREATE_EXCHANGE_MUTATION = `mutation QueueCreateExchange($returnInput: ReturnInput!) {
  returnCreate(returnInput: $returnInput) {
    return { id name status }
    userErrors { field message }
  }
}`;

// ─── Types ────────────────────────────────────────────────────────────────────

export type ReturnReason = string;

export interface RawReturnLine {
  id: string;
  quantity: number;
  returnReason: ReturnReason;
  customerNote: string | null;
  fulfillmentLineItem: {
    id: string;
    lineItem: {
      id: string;
      title: string;
      variantTitle: string | null;
      sku: string | null;
      product: { id: string } | null;
      originalUnitPriceSet: { shopMoney: { amount: string } };
    };
  } | null;
}

export interface RawReturn {
  id: string;
  name: string;
  status: "REQUESTED" | "OPEN" | "CLOSED" | "DECLINED" | "CANCELED";
  createdAt: string;
  requestApprovedAt: string | null;
  totalQuantity: number;
  returnLineItems: { nodes: Partial<RawReturnLine>[] };
  exchangeLineItems: { nodes: { lineItems: { title: string; variantTitle: string | null }[] }[] };
}

export interface RawOrder {
  id: string;
  name: string;
  createdAt: string;
  displayFinancialStatus: string | null;
  displayFulfillmentStatus: string;
  tags: string[];
  totalPriceSet: { shopMoney: { amount: string } };
  customer: { id: string; displayName: string; email: string | null; numberOfOrders: string } | null;
  returns: { nodes: RawReturn[] };
}

export interface QueueLine {
  returnLineItemId: string;
  fulfillmentLineItemId: string | null;
  productId: string | null;
  title: string;
  variantTitle: string | null;
  sku: string | null;
  quantity: number;
  unitPrice: number;
  reason: string;
  customerNote: string | null;
}

export interface QueueItem {
  returnId: string;
  returnName: string;
  status: RawReturn["status"];
  orderId: string;
  orderName: string;
  orderUrl: string;
  orderCreatedAt: string;
  requestedAt: string;
  approvedAt: string | null;
  ageDays: number;
  customerName: string;
  customerEmail: string | null;
  orderTotal: number;
  financialStatus: string | null;
  isSubscription: boolean;
  lines: QueueLine[];
  exchangeItems: string[];
  risk: RiskAssessment;
}

export interface RiskAssessment {
  level: "high" | "medium" | "low";
  flags: string[];
}

// ─── Risk scoring ─────────────────────────────────────────────────────────────

// Phrases that historically precede a chargeback: customer thinks the charge
// is wrong, never got the item, or could not cancel.
const CHARGEBACK_PHRASES: [RegExp, string][] = [
  [/never (received|got|sent|arrived)|not received|didn'?t (receive|arrive)|lost|stolen|delivered (to|in) (the )?wrong/i, "Says item never arrived"],
  [/scam|fraud|unauthori[sz]ed|dispute|chargeback|bank|credit card company/i, "Mentions scam, fraud, or bank"],
  [/didn'?t know|did not know|don'?t (even )?know what|never signed|wasn'?t able to cancel|unable to cancel|can'?t cancel|cancel+ed|canceling|cancelling/i, "Unexpected charge or cancellation issue"],
  [/money back|refund/i, "Asking for money back"],
  [/charged (twice|2)|double charged|accident|2 times|two times/i, "Possible duplicate charge"],
];

export const DECISION_SLA_DAYS = 2;
export const OPEN_RETURN_STALE_DAYS = 14;

export function daysBetween(fromIso: string, now: Date): number {
  return Math.max(0, Math.floor((now.getTime() - new Date(fromIso).getTime()) / 86_400_000));
}

export function assessRisk(input: {
  status: RawReturn["status"];
  ageDays: number;
  notes: string[];
  isSubscription: boolean;
  orderTotal: number;
}): RiskAssessment {
  const flags: string[] = [];
  const text = input.notes.filter(Boolean).join(" \n ");
  for (const [re, label] of CHARGEBACK_PHRASES) if (re.test(text)) flags.push(label);

  if (input.status === "REQUESTED" && input.ageDays > DECISION_SLA_DAYS) {
    flags.push(`Waiting ${input.ageDays} days for a decision`);
  }
  if (input.status === "OPEN" && input.ageDays > OPEN_RETURN_STALE_DAYS) {
    flags.push(`Approved ${input.ageDays} days ago, not closed`);
  }
  if (input.isSubscription && /cancel|didn'?t know|never signed|membership/i.test(text)) {
    flags.push("Subscription renewal dispute");
  }
  if (input.orderTotal >= 250) flags.push("High-value order");

  const severe = flags.some((f) =>
    /never arrived|scam|Unexpected charge|duplicate|renewal dispute/.test(f),
  );
  const slow = flags.some((f) => /Waiting|not closed/.test(f));
  const level: RiskAssessment["level"] = severe || (slow && input.status === "REQUESTED" && input.ageDays > 7)
    ? "high"
    : slow || flags.includes("Asking for money back")
      ? "medium"
      : "low";
  return { level, flags };
}

// ─── Normalization ────────────────────────────────────────────────────────────

export function normalizeOrders(orders: RawOrder[], statuses: RawReturn["status"][], now = new Date()): QueueItem[] {
  const out: QueueItem[] = [];
  for (const o of orders) {
    for (const r of o.returns.nodes) {
      if (!statuses.includes(r.status)) continue;
      const lines: QueueLine[] = r.returnLineItems.nodes
        .filter((l): l is RawReturnLine => typeof l.id === "string")
        .map((l) => ({
          returnLineItemId: l.id,
          fulfillmentLineItemId: l.fulfillmentLineItem?.id ?? null,
          productId: l.fulfillmentLineItem?.lineItem.product?.id ?? null,
          title: l.fulfillmentLineItem?.lineItem.title ?? "Unknown item",
          variantTitle: l.fulfillmentLineItem?.lineItem.variantTitle ?? null,
          sku: l.fulfillmentLineItem?.lineItem.sku ?? null,
          quantity: l.quantity,
          unitPrice: Number(l.fulfillmentLineItem?.lineItem.originalUnitPriceSet.shopMoney.amount ?? 0),
          reason: l.returnReason,
          customerNote: l.customerNote,
        }));
      const since = r.status === "OPEN" ? (r.requestApprovedAt ?? r.createdAt) : r.createdAt;
      const ageDays = daysBetween(since, now);
      const isSubscription = o.tags.some((t) => /subscription|membership_renewal/i.test(t));
      const orderTotal = Number(o.totalPriceSet.shopMoney.amount);
      out.push({
        returnId: r.id,
        returnName: r.name,
        status: r.status,
        orderId: o.id,
        orderName: o.name,
        orderUrl: shopifyAdminUrlSafe(o.id),
        orderCreatedAt: o.createdAt,
        requestedAt: r.createdAt,
        approvedAt: r.requestApprovedAt,
        ageDays,
        customerName: o.customer?.displayName ?? "Unknown customer",
        customerEmail: o.customer?.email ?? null,
        orderTotal,
        financialStatus: o.displayFinancialStatus,
        isSubscription,
        lines,
        exchangeItems: r.exchangeLineItems.nodes.flatMap((e) =>
          e.lineItems.map((li) => [li.title, li.variantTitle].filter(Boolean).join(" — ")),
        ),
        risk: assessRisk({
          status: r.status,
          ageDays,
          notes: lines.map((l) => l.customerNote ?? ""),
          isSubscription,
          orderTotal,
        }),
      });
    }
  }
  return out;
}

function shopifyAdminUrlSafe(gid: string): string {
  try {
    return shopifyAdminUrl(gid);
  } catch {
    return "";
  }
}

const RISK_RANK = { high: 0, medium: 1, low: 2 } as const;

export function sortQueue(items: QueueItem[]): QueueItem[] {
  return [...items].sort(
    (a, b) => RISK_RANK[a.risk.level] - RISK_RANK[b.risk.level] || b.ageDays - a.ageDays,
  );
}

export async function fetchReturnOrders(
  search: string,
  maxPages = 6,
  fetcher: typeof fetch = fetch,
): Promise<{ orders: RawOrder[]; truncated: boolean }> {
  const orders: RawOrder[] = [];
  let after: string | null = null;
  for (let page = 0; page < maxPages; page++) {
    const data: { orders: { pageInfo: { hasNextPage: boolean; endCursor: string | null }; nodes: RawOrder[] } } =
      await adminGraphql(RETURN_QUEUE_QUERY, { q: search, after }, fetcher);
    orders.push(...data.orders.nodes);
    if (!data.orders.pageInfo.hasNextPage) return { orders, truncated: false };
    after = data.orders.pageInfo.endCursor;
  }
  return { orders, truncated: true };
}

// ─── Decisions ────────────────────────────────────────────────────────────────

export type DeclineReason = "FINAL_SALE" | "OTHER" | "RETURN_PERIOD_ENDED";

/** An item the customer is sending back. */
export interface ExchangeReturnItem {
  fulfillmentLineItemId: string;
  quantity: number;
  returnReason: string;
  customerNote?: string | null;
}

/** A product/size the customer is getting instead (slotted in by the admin). */
export interface ExchangeOutItem {
  variantId: string;
  quantity: number;
}

type UserErrors = { field: string[] | null; message: string }[];

function firstError(errors: UserErrors | undefined): string | null {
  return errors?.length ? errors.map((e) => e.message).join("; ") : null;
}

export async function approveReturn(returnId: string, notifyCustomer: boolean) {
  const data = await adminGraphql<{
    returnApproveRequest: { return: { id: string; status: string } | null; userErrors: UserErrors };
  }>(APPROVE_MUTATION, { input: { id: returnId, notifyCustomer } });
  const err = firstError(data.returnApproveRequest.userErrors);
  if (err) throw new ShopifyAdminError(err);
  return data.returnApproveRequest.return;
}

export async function declineReturn(
  returnId: string,
  reason: DeclineReason,
  note: string | null,
  notifyCustomer: boolean,
) {
  const data = await adminGraphql<{
    returnDeclineRequest: { return: { id: string; status: string } | null; userErrors: UserErrors };
  }>(DECLINE_MUTATION, {
    input: { id: returnId, declineReason: reason, declineNote: note || undefined, notifyCustomer },
  });
  const err = firstError(data.returnDeclineRequest.userErrors);
  if (err) throw new ShopifyAdminError(err);
  return data.returnDeclineRequest.return;
}

/**
 * Shopify can't attach exchange items to a customer's REQUESTED return.
 * The documented path for apps that approve outside Shopify Admin is
 * `returnCreate` with exchangeLineItems. So for a requested return we:
 *   1. decline the request silently (customer is not emailed), noting the
 *      replacement return so the audit trail stays readable, then
 *   2. create an OPEN return with the items coming back plus the items
 *      slotted in to send out.
 * What comes back and what goes out are independent lists: a returned
 * quarterly box can be exchanged for two specific items, a polo for a
 * different polo, and so on. Shopify prices exchange items at their
 * current price and nets the difference against the returned value.
 */
export function buildExchangeInput(
  orderId: string,
  returning: ExchangeReturnItem[],
  sending: ExchangeOutItem[],
) {
  if (!returning.length) throw new Error("Pick at least one item the customer is sending back.");
  if (!sending.length) throw new Error("Slot in at least one product to send the customer.");
  const merged = new Map<string, number>();
  for (const s of sending) merged.set(s.variantId, (merged.get(s.variantId) ?? 0) + s.quantity);
  return {
    orderId,
    returnLineItems: returning.map((r) => ({
      fulfillmentLineItemId: r.fulfillmentLineItemId,
      quantity: r.quantity,
      returnReason: !r.returnReason || r.returnReason === "UNKNOWN" ? "OTHER" : r.returnReason,
      customerNote: r.customerNote ? r.customerNote.slice(0, 300) : undefined,
    })),
    exchangeLineItems: [...merged].map(([variantId, quantity]) => ({ variantId, quantity })),
  };
}

export async function createExchangeReturn(
  orderId: string,
  returning: ExchangeReturnItem[],
  sending: ExchangeOutItem[],
) {
  const data = await adminGraphql<{
    returnCreate: { return: { id: string; name: string; status: string } | null; userErrors: UserErrors };
  }>(CREATE_EXCHANGE_MUTATION, { returnInput: buildExchangeInput(orderId, returning, sending) });
  const err = firstError(data.returnCreate.userErrors);
  if (err) throw new ShopifyAdminError(err);
  return data.returnCreate.return;
}
