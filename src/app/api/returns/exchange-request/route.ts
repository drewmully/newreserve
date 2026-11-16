import { NextRequest, NextResponse } from "next/server";
import { sendPlainText } from "@/lib/email/resend";
import { checkRateLimit } from "@/lib/rateLimit";
import { RETURN_RULES } from "@/lib/returns/policy";
import { returnTokenError, verifyReturnToken } from "@/lib/returns/token";

const MAX_EXCHANGE_MESSAGE_LENGTH = 2000;

function getClientIp(request: NextRequest): string {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    request.headers.get("x-real-ip") ??
    "unknown"
  );
}

function tooMany(retryAfterSeconds: number) {
  return NextResponse.json(
    { error: "Too many requests. Please try again later.", code: "rate_limited" },
    { status: 429, headers: { "Retry-After": String(retryAfterSeconds) } }
  );
}

export async function POST(request: NextRequest) {
  try {
    let body: Record<string, unknown>;
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    // The return token (from /api/returns/lookup) proves the sender looked
    // the order up with its email. Order name and reply-to come from the
    // signed token, never from the request body.
    const verified = verifyReturnToken(body.returnToken);
    if (!verified.ok) {
      if (verified.reason === "unconfigured") {
        console.error("[returns/exchange-request] RETURNS_TOKEN_SECRET / CRON_SECRET not configured");
      }
      const { status, body: errBody } = returnTokenError(verified.reason);
      return NextResponse.json(errBody, { status });
    }
    const { orderName, email, orderType, orderId } = verified.payload;

    if (!RETURN_RULES[orderType].exchangeAllowed) {
      return NextResponse.json(
        { error: "Exchanges aren't available for this order. Please email info@mymully.com.", code: "exchange_not_allowed" },
        { status: 422 }
      );
    }

    const message = typeof body.message === "string" ? body.message.trim() : "";
    if (!message) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }
    if (message.length > MAX_EXCHANGE_MESSAGE_LENGTH) {
      return NextResponse.json(
        { error: `Please keep your message under ${MAX_EXCHANGE_MESSAGE_LENGTH} characters.`, code: "message_too_long" },
        { status: 400 }
      );
    }

    const ipLimit = checkRateLimit("returns_exchange_ip", getClientIp(request), {
      maxHits: 5,
      windowMs: 60 * 60 * 1000,
    });
    if (!ipLimit.allowed) return tooMany(ipLimit.retryAfterSeconds);
    const orderLimit = checkRateLimit("returns_exchange_order", orderId, {
      maxHits: 3,
      windowMs: 60 * 60 * 1000,
    });
    if (!orderLimit.allowed) return tooMany(orderLimit.retryAfterSeconds);

    await sendPlainText({
      to: "info@mymully.com",
      // Ops replies go straight back to the order's email (verified by the
      // signed return token), not to the shared inbox or a typed address.
      replyTo: email,
      subject: `Exchange Request: ${orderName}`,
      text: `${message}\n\nCustomer email: ${email}\nOrder: ${orderName} (${orderType === "subscription" ? "subscription box" : "Pro Shop"})`,
      sendClass: "transactional",
      category: "returns_exchange_request",
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[returns/exchange-request] failed:", err);
    return NextResponse.json({ error: "Failed to send request" }, { status: 500 });
  }
}
