/**
 * Mully Access paid-order handling (called from the orders/paid webhook).
 *
 * 1. Tags the customer `mully-access` so the "Mully Access members" segment
 *    (10% automatic discount) picks them up. Reserve members are never tagged,
 *    since the tag would move them from 15% to 10%.
 * 2. On the order where they join (Access line + real items), refunds the gap
 *    between the order's existing discount and the 10% member rate, plus the
 *    shipping they paid. Shopify's refund email shows the total.
 *
 * Idempotent per order via Firestore `mully_access_join_refunds/{orderId}`.
 * Any refund failure is recorded and emailed to the team instead of retried.
 */
import { adminDb } from "@/lib/firebase-admin";
import { shopifyGraphQL } from "@/app/api/_lib/shopifyAdmin";
import { sendPlainText } from "@/lib/email/resend";
import { MULLY_ACCESS_MONTHLY } from "@/lib/membershipConfig";
import { isJoinOrder, quoteJoinRefund, type JoinRefundLine } from "@/lib/mullyAccess/joinRefund";

const ALERT_TO = "drew@mullybox.com";

interface OrderLike {
  id: number;
  name: string;
  email: string | null;
  currency: string;
  customer?: { id: number } | null;
  line_items: Array<{
    variant_id: number | null;
    price: string;
    quantity: number;
    total_discount: string;
    requires_shipping: boolean;
    discount_allocations?: Array<{ amount: string }> | null;
  }>;
}

const money = (n: number) => `$${n.toFixed(2)}`;

export function orderHasMullyAccess(order: Pick<OrderLike, "line_items">): boolean {
  return order.line_items.some(li => li.variant_id === MULLY_ACCESS_MONTHLY.variantId);
}

function toLines(order: OrderLike): JoinRefundLine[] {
  return order.line_items.map(li => {
    const allocated = li.discount_allocations?.reduce((t, a) => t + Number(a.amount || 0), 0);
    return {
      variantId: li.variant_id,
      price: Number(li.price) || 0,
      quantity: li.quantity,
      discount: allocated ?? (Number(li.total_discount) || 0),
      requiresShipping: li.requires_shipping,
    };
  });
}

async function addTags(id: string, tags: string[]): Promise<void> {
  const r = await shopifyGraphQL<{ tagsAdd: { userErrors: Array<{ message: string }> } }>(
    `mutation MullyAccessTag($id: ID!, $tags: [String!]!) { tagsAdd(id: $id, tags: $tags) { userErrors { message } } }`,
    { id, tags },
  );
  if (r.tagsAdd.userErrors.length) throw new Error(r.tagsAdd.userErrors.map(e => e.message).join("; "));
}

/** Removes the Access tag, e.g. when a customer upgrades to Reserve. */
export async function removeMullyAccessTag(customerId: number | string): Promise<void> {
  const id = `gid://shopify/Customer/${String(customerId).match(/(\d+)$/)?.[1] ?? customerId}`;
  const r = await shopifyGraphQL<{ tagsRemove: { userErrors: Array<{ message: string }> } }>(
    `mutation MullyAccessUntag($id: ID!, $tags: [String!]!) { tagsRemove(id: $id, tags: $tags) { userErrors { message } } }`,
    { id, tags: [MULLY_ACCESS_MONTHLY.customerTag] },
  );
  if (r.tagsRemove.userErrors.length) throw new Error(r.tagsRemove.userErrors.map(e => e.message).join("; "));
}

interface SuggestedRefund {
  order: {
    suggestedRefund: {
      shipping: { amountSet: { shopMoney: { amount: string } } };
      suggestedTransactions: Array<{
        gateway: string | null;
        parentTransaction: { id: string } | null;
        amountSet: { shopMoney: { amount: string } };
      }>;
    };
    totalReceivedSet: { shopMoney: { amount: string } };
  } | null;
}

async function issueJoinRefund(order: OrderLike, productRefund: number) {
  const orderId = `gid://shopify/Order/${order.id}`;
  // Ask Shopify for the refundable shipping and the payment to refund against.
  const suggested = await shopifyGraphQL<SuggestedRefund>(
    `query MullyAccessSuggested($id: ID!) {
      order(id: $id) {
        totalReceivedSet { shopMoney { amount } }
        suggestedRefund(refundShipping: true, suggestFullRefund: false) {
          shipping { amountSet { shopMoney { amount } } }
          suggestedTransactions { gateway parentTransaction { id } amountSet { shopMoney { amount } } }
        }
      }
    }`,
    { id: orderId },
  );
  if (!suggested.order) throw new Error("order not found");
  const shipping = Number(suggested.order.suggestedRefund.shipping.amountSet.shopMoney.amount) || 0;
  const received = Number(suggested.order.totalReceivedSet.shopMoney.amount) || 0;
  const total = Math.round(Math.min(received, productRefund + shipping) * 100) / 100;
  if (total <= 0) return { total: 0, shipping, product: productRefund };

  const parent = suggested.order.suggestedRefund.suggestedTransactions.find(t => t.parentTransaction?.id && t.gateway);
  if (!parent?.parentTransaction || !parent.gateway) throw new Error("no refundable payment transaction");

  const result = await shopifyGraphQL<{ refundCreate: { refund: { id: string } | null; userErrors: Array<{ message: string }> } }>(
    `mutation MullyAccessRefund($input: RefundInput!) {
      refundCreate(input: $input) { refund { id } userErrors { message } }
    }`,
    {
      input: {
        orderId,
        notify: true,
        note: `Mully Access welcome refund: ${money(productRefund)} member savings + ${money(shipping)} shipping`,
        shipping: shipping > 0 ? { fullRefund: true } : undefined,
        transactions: [{
          orderId,
          parentId: parent.parentTransaction.id,
          gateway: parent.gateway,
          kind: "REFUND",
          amount: total.toFixed(2),
        }],
      },
    },
  );
  if (result.refundCreate.userErrors.length || !result.refundCreate.refund) {
    throw new Error(result.refundCreate.userErrors.map(e => e.message).join("; ") || "refund not created");
  }
  return { total, shipping, product: productRefund, refundId: result.refundCreate.refund.id };
}

export async function handleMullyAccessPaidOrder(
  order: OrderLike,
  opts: { priorTier?: string | null } = {},
): Promise<void> {
  if (!orderHasMullyAccess(order)) return;
  const isReserve = opts.priorTier === "member" || opts.priorTier === "black";

  if (order.customer?.id && !isReserve) {
    try {
      await addTags(`gid://shopify/Customer/${order.customer.id}`, [MULLY_ACCESS_MONTHLY.customerTag]);
    } catch (err) {
      console.error("[mully-access] customer tag failed:", err);
    }
  }

  const lines = toLines(order);
  if (!isJoinOrder(lines, MULLY_ACCESS_MONTHLY.variantId) || isReserve) return;

  const ref = adminDb.collection("mully_access_join_refunds").doc(String(order.id));
  try {
    await ref.create({ order_id: String(order.id), order_name: order.name, status: "pending", created_at: Date.now() });
  } catch {
    return; // Already handled (webhook retry or duplicate delivery).
  }

  const quote = quoteJoinRefund(lines, MULLY_ACCESS_MONTHLY.variantId, MULLY_ACCESS_MONTHLY.discountRate);
  try {
    const refund = await issueJoinRefund(order, quote.productRefund);
    await ref.update({ status: "refunded", quote, refund, updated_at: Date.now() });
    try {
      await addTags(`gid://shopify/Order/${order.id}`, [MULLY_ACCESS_MONTHLY.joinOrderTag]);
    } catch (err) {
      console.error("[mully-access] order tag failed:", err);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[mully-access] join refund failed for ${order.name}:`, message);
    await ref.update({ status: "failed", quote, error: message, updated_at: Date.now() }).catch(() => {});
    await sendPlainText({
      to: ALERT_TO,
      subject: `Mully Access refund needed: ${order.name}`,
      text: `The automatic Mully Access welcome refund failed for ${order.name} (${order.email ?? "no email"}).\n\nRefund manually in Shopify: ${money(quote.productRefund)} member savings plus the shipping charged.\n\nError: ${message}`,
      disableTracking: true,
      sendClass: "transactional",
      category: "mully_access_refund_alert",
    }).catch(() => {});
  }
}
