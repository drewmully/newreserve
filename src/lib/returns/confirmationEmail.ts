/**
 * "We got your return request" email (server-only).
 *
 * Shopify's returnRequest mutation sends nothing to the customer; Shopify's
 * own emails only start when the request is approved in Admin (approval /
 * label). So this is the single acknowledgement, not a duplicate.
 */
import { sendPlainText } from "@/lib/email/resend";
import { RESOLUTION_LABELS, type OrderReturnType, type ReturnResolution } from "./policy";

export interface ReturnConfirmationInput {
  to: string;
  returnId: string;
  orderName: string;
  orderType: OrderReturnType;
  items: Array<{
    title: string;
    variantTitle: string;
    quantity: number;
    reason: string;
    resolution: ReturnResolution | "mixed";
  }>;
  itemsCreditAmount: number;
  shippingCost: number;
  estimatedCreditAmount: number;
  estimatedRefundAmount: number;
  estimatedStoreCreditAmount: number;
}

const money = (n: number) => `$${n.toFixed(2)}`;

function resolutionLabel(r: ReturnResolution | "mixed"): string {
  return r === "mixed" ? "Part refund, part store credit" : RESOLUTION_LABELS[r];
}

export function buildReturnConfirmationText(input: ReturnConfirmationInput): { subject: string; text: string } {
  const lines = input.items.map((i) => {
    const variant = i.variantTitle ? ` (${i.variantTitle})` : "";
    return `- ${i.title}${variant} x ${i.quantity}: ${i.reason}. ${resolutionLabel(i.resolution)}`;
  });
  const hasRefund = input.estimatedRefundAmount > 0 || input.items.some((i) => i.resolution !== "store_credit");
  const hasCredit = input.estimatedStoreCreditAmount > 0 || input.items.some((i) => i.resolution !== "refund_original_payment");

  const totals: string[] = [];
  if (hasRefund) totals.push(`Estimated refund to original payment: ${money(input.estimatedRefundAmount)}`);
  if (hasCredit) totals.push(`Estimated store credit: ${money(input.estimatedStoreCreditAmount)}`);

  const resolutionLines: string[] = [];
  if (hasRefund) resolutionLines.push("refund your original payment method for refund items");
  if (hasCredit) resolutionLines.push("add store credit to your Mully Pro Shop account for store credit items");

  const text = [
    "Hi there,",
    "",
    `We received your return request for order ${input.orderName}. It's now under review by our team.`,
    "",
    "Items:",
    ...lines,
    "",
    `Return value: ${money(input.itemsCreditAmount)}`,
    `Return shipping: ${input.shippingCost === 0 ? "Free" : `-${money(input.shippingCost)}`}`,
    ...totals,
    "",
    "What happens next:",
    "1. We review your request. You'll get an email from us when it's approved, with your return shipping instructions.",
    "2. Please don't send anything back until you have those instructions. Items must be unworn and unwashed, with tags attached.",
    `3. Once your items arrive and pass inspection, we'll ${resolutionLines.join(" and ")}.`,
    "",
    "Questions? Just reply to this email or write to info@mymully.com and include your order number.",
    "",
    "Mully",
  ].join("\n");

  return { subject: `We received your return request for ${input.orderName}`, text };
}

export async function sendReturnRequestConfirmation(input: ReturnConfirmationInput): Promise<string | null> {
  const { subject, text } = buildReturnConfirmationText(input);
  return sendPlainText({
    to: input.to,
    subject,
    text,
    sendClass: "transactional",
    category: "returns_request_confirmation",
    idempotencyKey: `returns-request-${input.returnId.split("/").pop()}`,
    tags: [{ name: "category", value: "returns_request_confirmation" }],
  });
}
