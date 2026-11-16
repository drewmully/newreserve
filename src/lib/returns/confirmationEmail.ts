/**
 * "We got your return request" email (server-only).
 *
 * Shopify's returnRequest mutation sends nothing to the customer; Shopify's
 * own emails only start when the request is approved in Admin (approval /
 * label). So this is the single acknowledgement, not a duplicate.
 */
import { sendPlainText } from "@/lib/email/resend";
import type { OrderReturnType, ReturnRules } from "./policy";

export interface ReturnConfirmationInput {
  to: string;
  returnId: string;
  orderName: string;
  orderType: OrderReturnType;
  rules: ReturnRules;
  items: Array<{ title: string; variantTitle: string; quantity: number; reason: string }>;
  itemsCreditAmount: number;
  shippingCost: number;
  estimatedCreditAmount: number;
}

const money = (n: number) => `$${n.toFixed(2)}`;

export function buildReturnConfirmationText(input: ReturnConfirmationInput): { subject: string; text: string } {
  const lines = input.items.map((i) => {
    const variant = i.variantTitle ? ` (${i.variantTitle})` : "";
    return `- ${i.title}${variant} x ${i.quantity}: ${i.reason}`;
  });
  const isRefund = input.rules.resolution === "refund_original_payment";
  const label = isRefund ? "Estimated refund" : "Estimated store credit";
  const resolutionLine = isRefund
    ? "Once your items arrive and pass inspection (unworn, unwashed, tags attached), we'll refund your original payment method."
    : "Once your items arrive and pass inspection, store credit will be added to your Mully Pro Shop account.";

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
    `${label}: ${money(input.estimatedCreditAmount)}`,
    "",
    "What happens next:",
    "1. We review your request. You'll get an email from us when it's approved, with your return shipping instructions.",
    "2. Please don't send anything back until you have those instructions.",
    `3. ${resolutionLine}`,
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
