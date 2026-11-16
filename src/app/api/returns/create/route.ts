import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit } from "@/lib/rateLimit";
import {
  allocateReturnQuantity,
  loadOrderEligibility,
  shopifyAdminGraphQL,
} from "@/lib/returns/eligibility";
import {
  RESOLUTION_LABELS,
  RETURN_REASON_MAP,
  type ReturnResolution,
  isAllowedReturnReason,
  outsideWindowMessage,
  returnShippingCostByTier,
} from "@/lib/returns/policy";
import { returnTokenError, verifyReturnToken } from "@/lib/returns/token";
import { resolveReturnTier } from "@/lib/returns/tier";
import { sendReturnRequestConfirmation } from "@/lib/returns/confirmationEmail";

const GENERIC_ERROR =
  "We couldn't submit your return right now. Please try again, or email info@mymully.com and we'll help.";
const MAX_ITEMS = 50;
const MAX_QTY = 100;

type ItemResolution = ReturnResolution | "mixed";

function combine(parts: ReturnResolution[]): ItemResolution {
  return parts.every((r) => r === parts[0]) ? parts[0] : "mixed";
}

interface ReturnItemInput {
  lineItemId: string;
  quantity: number;
  reason: string;
}

function getClientIp(request: NextRequest): string {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    request.headers.get("x-real-ip") ??
    "unknown"
  );
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function bad(error: string, status = 400, code?: string) {
  return NextResponse.json(code ? { error, code } : { error }, { status });
}

/** Validates shape only; ownership/eligibility are checked against Shopify. */
function parseItems(raw: unknown): ReturnItemInput[] | null {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > MAX_ITEMS) return null;
  const seen = new Set<string>();
  const out: ReturnItemInput[] = [];
  for (const it of raw) {
    if (!it || typeof it !== "object") return null;
    const { lineItemId, quantity, reason } = it as Record<string, unknown>;
    const id = typeof lineItemId === "string" || typeof lineItemId === "number" ? String(lineItemId) : "";
    if (!/^\d{1,20}$/.test(id) || seen.has(id)) return null;
    if (typeof quantity !== "number" || !Number.isInteger(quantity) || quantity < 1 || quantity > MAX_QTY) return null;
    if (!isAllowedReturnReason(reason)) return null;
    seen.add(id);
    out.push({ lineItemId: id, quantity, reason });
  }
  return out;
}

export async function POST(request: NextRequest) {
  try {
    let body: Record<string, unknown>;
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      return bad("Please look up your order again to continue.", 400);
    }

    // 1. Ownership: the token proves this browser looked the order up with
    //    the order's email in the last 45 minutes.
    const verified = verifyReturnToken(body.returnToken);
    if (!verified.ok) {
      if (verified.reason === "unconfigured") {
        console.error("[returns/create] RETURNS_TOKEN_SECRET / CRON_SECRET not configured");
      }
      const { status, body: errBody } = returnTokenError(verified.reason);
      return NextResponse.json(errBody, { status });
    }
    const token = verified.payload;
    if (body.orderId !== undefined && String(body.orderId) !== token.orderId) {
      console.warn("[returns/create] orderId does not match token", body.orderId, token.orderId);
      return bad("Please look up your order again to continue.", 401, "return_token_invalid");
    }

    const items = parseItems(body.items);
    if (!items) {
      return bad("Please choose at least one item, a quantity and a reason.", 400, "invalid_items");
    }

    const ipLimit = checkRateLimit("returns_create_ip", getClientIp(request), {
      maxHits: 10,
      windowMs: 10 * 60 * 1000,
    });
    if (!ipLimit.allowed) {
      return NextResponse.json(
        { error: "Too many return requests. Please try again later.", code: "rate_limited" },
        { status: 429, headers: { "Retry-After": String(ipLimit.retryAfterSeconds) } }
      );
    }

    // 2. Re-fetch the order and re-check every rule server-side.
    const order = await loadOrderEligibility(token.orderId);
    if (!order) {
      console.error("[returns/create] Order not found:", token.orderId);
      return bad("We couldn't find that order. Please look it up again.", 404, "order_not_found");
    }
    if (!order.email || order.email !== token.email) {
      console.warn("[returns/create] order email no longer matches token", token.orderId);
      return bad("Please look up your order again to continue.", 403, "email_mismatch");
    }

    const linesById = new Map(order.lines.map((l) => [l.lineItemId, l]));
    const returnLineItems: Array<{
      fulfillmentLineItemId: string;
      quantity: number;
      returnReason: string;
      customerNote: string;
    }> = [];
    let itemsCreditAmount = 0;
    let refundValue = 0;
    let storeCreditValue = 0;
    const itemResults: Array<{
      lineItemId: string;
      title: string;
      variantTitle: string;
      quantity: number;
      reason: string;
      resolution: ItemResolution;
    }> = [];

    for (const item of items) {
      const line = linesById.get(item.lineItemId);
      if (!line) {
        console.warn("[returns/create] lineItemId not on order", token.orderId, item.lineItemId);
        return bad("One of these items isn't part of this order. Please look it up again.", 422, "invalid_items");
      }
      if (line.ineligibleReason === "final_sale") {
        return bad(`${line.title} is final sale and can't be returned.`, 422, "final_sale");
      }
      if (line.ineligibleReason === "not_fulfilled") {
        return bad("Some items haven't shipped yet and can't be returned.", 422, "not_fulfilled");
      }
      if (line.ineligibleReason === "outside_window") {
        return bad(outsideWindowMessage(order.rules), 422, "outside_window");
      }
      if (line.ineligibleReason === "already_returned" || item.quantity > line.returnableQty) {
        return bad(
          `You can return up to ${line.returnableQty} of ${line.title}.`,
          422,
          "quantity_exceeded"
        );
      }
      const parts = allocateReturnQuantity(line, item.quantity);
      if (!parts.length) {
        console.error("[returns/create] allocation failed", token.orderId, item);
        return bad(GENERIC_ERROR, 422, "invalid_items");
      }
      for (const p of parts) {
        // Resolution is decided now (request time) and recorded on the
        // Shopify return so whoever approves it knows refund vs credit.
        returnLineItems.push({
          fulfillmentLineItemId: p.fulfillmentLineItemId,
          quantity: p.quantity,
          returnReason: RETURN_REASON_MAP[item.reason] ?? "OTHER",
          customerNote: `${item.reason}. Resolution: ${RESOLUTION_LABELS[p.resolution]}`,
        });
        const value = line.unitPrice * p.quantity;
        if (p.resolution === "refund_original_payment") refundValue += value;
        else storeCreditValue += value;
      }
      itemsCreditAmount += line.unitPrice * item.quantity;
      itemResults.push({
        lineItemId: line.lineItemId,
        title: line.title,
        variantTitle: line.variantTitle,
        quantity: item.quantity,
        reason: item.reason,
        resolution: combine(parts.map((p) => p.resolution)),
      });
    }

    // 3. Submit via returnRequest (→ REQUESTED, awaiting review in Shopify
    //    Admin). returnRequest does NOT email the customer; Shopify's emails
    //    start when the request is approved, so our confirmation below is
    //    the only "we got it" message.
    const orderGid = `gid://shopify/Order/${order.orderId}`;
    const returnRequestData = await shopifyAdminGraphQL<{
      returnRequest: {
        return: { id: string; status: string } | null;
        userErrors: Array<{ field: string[]; message: string }>;
      };
    }>(
      `mutation ReturnRequest($input: ReturnRequestInput!) {
        returnRequest(input: $input) {
          return {
            id
            status
          }
          userErrors { field message }
        }
      }`,
      { input: { orderId: orderGid, returnLineItems } }
    );

    const userErrors = returnRequestData.returnRequest.userErrors;
    if (userErrors.length || !returnRequestData.returnRequest.return) {
      console.error("[returns/create] returnRequest userErrors:", order.orderId, userErrors);
      return bad(GENERIC_ERROR, 422, "shopify_rejected");
    }

    const shopifyReturn = returnRequestData.returnRequest.return;
    console.log("[returns/create] Return requested:", shopifyReturn.id, shopifyReturn.status);

    // 4. Return shipping by tier, computed server-side only.
    const tier = await resolveReturnTier(request, order.email);
    const shippingCost = returnShippingCostByTier(tier);
    const estimatedCreditAmount = Math.max(0, itemsCreditAmount - shippingCost);
    // The flat fee comes off the refund first, then off store credit.
    const feeFromRefund = Math.min(refundValue, shippingCost);
    const estimatedRefundAmount = round2(refundValue - feeFromRefund);
    const estimatedStoreCreditAmount = round2(Math.max(0, storeCreditValue - (shippingCost - feeFromRefund)));
    const resolution: ItemResolution =
      refundValue > 0 && storeCreditValue > 0
        ? "mixed"
        : refundValue > 0
          ? "refund_original_payment"
          : "store_credit";

    // 5. Confirmation email. Never fails the request.
    try {
      await sendReturnRequestConfirmation({
        to: order.email,
        returnId: shopifyReturn.id,
        orderName: order.orderName,
        orderType: order.orderType,
        items: itemResults,
        itemsCreditAmount,
        shippingCost,
        estimatedCreditAmount,
        estimatedRefundAmount,
        estimatedStoreCreditAmount,
      });
    } catch (err) {
      console.error("[returns/create] confirmation email failed:", shopifyReturn.id, err);
    }

    return NextResponse.json({
      returnId: shopifyReturn.id,
      returnStatus: shopifyReturn.status,
      itemsCreditAmount,
      shippingCost,
      estimatedCreditAmount,
      estimatedRefundAmount,
      estimatedStoreCreditAmount,
      orderType: order.orderType,
      resolution,
      items: itemResults.map(({ lineItemId, quantity, resolution: r }) => ({ lineItemId, quantity, resolution: r })),
      status: "submitted",
    });
  } catch (err) {
    console.error("[returns/create] Unhandled error:", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: GENERIC_ERROR }, { status: 500 });
  }
}
