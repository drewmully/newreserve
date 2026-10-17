/**
 * POST /api/admin/returns/decide
 *
 * body:
 *   { action: "approve", returnId, notifyCustomer? }
 *   { action: "decline", returnId, declineReason, declineNote?, notifyCustomer? }
 *   { action: "exchange", orderId, returnId?, requestId?, returning[], sending[], notifyCustomer? }
 *     returning — items coming back (fulfillment line + qty + reason)
 *     sending   — products/sizes slotted in to ship out (variantId + qty)
 *
 * Every decision is written to Firestore `return_decisions` (who, what,
 * when, Shopify result) so the daily view has an audit trail.
 */

import { NextRequest, NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { requireAdmin } from "@/app/api/_lib/adminAuth";
import { adminDb } from "@/lib/firebase-admin";
import {
  approveReturn,
  buildExchangeInput,
  createExchangeReturn,
  declineReturn,
  type DeclineReason,
  type ExchangeOutItem,
  type ExchangeReturnItem,
} from "@/lib/returnsAdmin";
import { sendPlainText } from "@/lib/email/resend";

export const dynamic = "force-dynamic";

const DECLINE_REASONS: DeclineReason[] = ["FINAL_SALE", "OTHER", "RETURN_PERIOD_ENDED"];

interface Body {
  action: "approve" | "decline" | "exchange";
  returnId?: string;
  orderId?: string;
  orderName?: string;
  returnName?: string;
  requestId?: string;
  customerEmail?: string | null;
  declineReason?: DeclineReason;
  declineNote?: string;
  notifyCustomer?: boolean;
  returning?: ExchangeReturnItem[];
  sending?: ExchangeOutItem[];
  exchangeSummary?: string;
}

const posInt = (n: unknown) => Number.isInteger(n) && (n as number) > 0;

function validReturning(r: unknown): r is ExchangeReturnItem[] {
  return Array.isArray(r) && r.length > 0 &&
    r.every((x) => x && typeof x.fulfillmentLineItemId === "string" && posInt(x.quantity));
}

function validSending(s: unknown): s is ExchangeOutItem[] {
  return Array.isArray(s) && s.length > 0 &&
    s.every((x) => x && typeof x.variantId === "string" && x.variantId.startsWith("gid://shopify/ProductVariant/") && posInt(x.quantity));
}

export async function POST(req: NextRequest) {
  const guard = await requireAdmin(req);
  if (!guard.ok) return guard.response;

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const notify = body.notifyCustomer !== false;
  const log = {
    action: body.action,
    by: guard.email,
    returnId: body.returnId ?? null,
    returnName: body.returnName ?? null,
    orderId: body.orderId ?? null,
    orderName: body.orderName ?? null,
    requestId: body.requestId ?? null,
    notifyCustomer: notify,
    createdAt: FieldValue.serverTimestamp(),
  };

  try {
    if (body.action === "approve") {
      if (!body.returnId) return NextResponse.json({ error: "returnId required" }, { status: 400 });
      const result = await approveReturn(body.returnId, notify);
      await adminDb.collection("return_decisions").add({ ...log, result });
      return NextResponse.json({ ok: true, result });
    }

    if (body.action === "decline") {
      if (!body.returnId) return NextResponse.json({ error: "returnId required" }, { status: 400 });
      const reason = DECLINE_REASONS.includes(body.declineReason as DeclineReason)
        ? (body.declineReason as DeclineReason)
        : "OTHER";
      const result = await declineReturn(body.returnId, reason, body.declineNote ?? null, notify);
      await adminDb
        .collection("return_decisions")
        .add({ ...log, declineReason: reason, declineNote: body.declineNote ?? null, result });
      return NextResponse.json({ ok: true, result });
    }

    if (body.action === "exchange") {
      if (!body.orderId || !validReturning(body.returning) || !validSending(body.sending)) {
        return NextResponse.json(
          { error: "Pick what's coming back and slot in at least one product to send out." },
          { status: 400 },
        );
      }
      // Validate the full Shopify input before touching the customer's request.
      buildExchangeInput(body.orderId, body.returning, body.sending);
      // A customer's REQUESTED return can't take exchange items, so release
      // those items first (silent decline), then open the exchange return.
      if (body.returnId) {
        await declineReturn(
          body.returnId,
          "OTHER",
          `Converted to an exchange by ${guard.email} from the admin returns queue.`,
          false,
        );
      }
      let created;
      try {
        created = await createExchangeReturn(body.orderId, body.returning, body.sending);
      } catch (err) {
        await adminDb.collection("return_decisions").add({
          ...log,
          action: "exchange_failed",
          error: (err as Error).message,
          returning: body.returning,
          sending: body.sending,
        });
        throw new Error(
          `${(err as Error).message}${body.returnId ? " (the original request was released; retry the exchange from this order)" : ""}`,
        );
      }

      if (body.requestId) {
        await adminDb.collection("customer_requests").doc(body.requestId).set(
          { status: "resolved", resolvedBy: guard.email, resolvedAt: FieldValue.serverTimestamp(), exchangeReturnId: created?.id ?? null },
          { merge: true },
        );
      }

      if (notify && body.customerEmail) {
        await sendPlainText({
          to: body.customerEmail,
          replyTo: "info@mymully.com",
          subject: `Your exchange for ${body.orderName ?? "your order"} is approved`,
          text:
            `Good news: your exchange is approved.\n\n` +
            (body.exchangeSummary ? `${body.exchangeSummary}\n\n` : "") +
            `We'll send return instructions shortly, and your replacement ships once it's on its way back to us. ` +
            `Reply to this email with any questions.\n\n— The Mully team`,
          sendClass: "transactional",
          category: "returns_exchange_approved",
        }).catch((e) => console.error("[admin/returns/decide] exchange email failed", e));
      }

      await adminDb.collection("return_decisions").add({
        ...log,
        returning: body.returning,
        sending: body.sending,
        exchangeSummary: body.exchangeSummary ?? null,
        exchangeReturnId: created?.id ?? null,
        exchangeReturnName: created?.name ?? null,
      });
      return NextResponse.json({ ok: true, result: created });
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (err) {
    console.error("[admin/returns/decide] failed", err);
    return NextResponse.json({ error: (err as Error).message }, { status: 422 });
  }
}
