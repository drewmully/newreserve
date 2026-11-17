/**
 * POST /api/auth/send-login-link
 *
 * Emails a Firebase passwordless sign-in link from info@mymully.com through
 * Resend, instead of Firebase's default noreply@mully-reserve.firebaseapp.com
 * sender (which Yahoo/Outlook often junk, and which Firebase rate-caps).
 *
 * Body: { email, continuePath?, paid? }
 *   - continuePath: shop return path for `returnTo` (re-sanitised here).
 *   - paid: keep `paid=1` on a fresh link requested from an expired
 *     post-purchase link.
 *
 * Responses:
 *   200 { ok: true }      — always the same body, whether or not an account
 *                           exists (no account enumeration).
 *   400                   — malformed body / invalid email.
 *   429                   — per-IP or per-email rate limit.
 *   502 / 503             — link generation or delivery failed. The browser
 *                           falls back to Firebase's own sender on 5xx.
 *
 * The continue URL is built server-side on an allowlisted origin only.
 */
import { NextRequest, NextResponse } from "next/server";
import { adminAuth } from "@/lib/firebase-admin";
import { sendPlainText } from "@/lib/email/resend";
import { checkRateLimit } from "@/lib/rateLimit";
import { getClientIp } from "@/app/api/_lib/clientIp";
import { buildLoginContinueUrl, resolveLoginOrigin } from "@/lib/loginLink";
import { isValidEmail, normalizeEmail } from "@/app/login/loginErrors";
import { LOGIN_LINK_SUBJECT, loginLinkEmailText } from "@/lib/email/templates/loginLink";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const HOUR_MS = 60 * 60 * 1000;
const IP_LIMIT = { maxHits: 10, windowMs: HOUR_MS };
const EMAIL_LIMIT = { maxHits: 5, windowMs: HOUR_MS };

const RATE_LIMIT_MESSAGE =
  "Too many sign-in links requested. Please wait a few minutes and try again.";
const DELIVERY_FAILED_MESSAGE = "We couldn't send your sign-in link right now.";

type Body = { email?: unknown; continuePath?: unknown; paid?: unknown };

function json(body: Record<string, unknown>, status: number, headers?: Record<string, string>) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store", ...headers },
  });
}

export async function POST(req: NextRequest) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return json({ error: "Invalid request." }, 400);
  }
  if (!body || typeof body !== "object") return json({ error: "Invalid request." }, 400);

  const email = typeof body.email === "string" ? normalizeEmail(body.email) : "";
  if (!email || !isValidEmail(email)) {
    return json({ error: "Please enter a valid email address.", code: "auth/invalid-email" }, 400);
  }

  const ip = getClientIp(req.headers) ?? "unknown";
  const ipLimit = checkRateLimit("login_link_ip", ip, IP_LIMIT);
  if (!ipLimit.allowed) {
    return json({ error: RATE_LIMIT_MESSAGE, code: "auth/too-many-requests" }, 429, {
      "Retry-After": String(ipLimit.retryAfterSeconds),
    });
  }
  const emailLimit = checkRateLimit("login_link_email", email, EMAIL_LIMIT);
  if (!emailLimit.allowed) {
    return json({ error: RATE_LIMIT_MESSAGE, code: "auth/too-many-requests" }, 429, {
      "Retry-After": String(emailLimit.retryAfterSeconds),
    });
  }

  const origin = resolveLoginOrigin(req.headers.get("origin"), {
    NODE_ENV: process.env.NODE_ENV,
    VERCEL_ENV: process.env.VERCEL_ENV,
    VERCEL_URL: process.env.VERCEL_URL,
    VERCEL_BRANCH_URL: process.env.VERCEL_BRANCH_URL,
  });
  const continueUrl = buildLoginContinueUrl(origin, {
    continuePath: typeof body.continuePath === "string" ? body.continuePath : undefined,
    paid: body.paid === true || body.paid === "1" || body.paid === 1,
  });

  let link: string;
  try {
    // Works for new and existing users alike (signInWithEmailLink creates the
    // account on first use), so nothing here depends on whether one exists.
    link = await adminAuth.generateSignInWithEmailLink(email, {
      url: continueUrl,
      handleCodeInApp: true,
    });
  } catch (err) {
    const code = (err as { code?: string })?.code ?? "unknown";
    console.error(`[send-login-link] generateSignInWithEmailLink failed (${code}):`, err);
    return json({ error: DELIVERY_FAILED_MESSAGE }, 503);
  }

  let messageId: string | null;
  try {
    messageId = await sendPlainText({
      to: email,
      subject: LOGIN_LINK_SUBJECT,
      text: loginLinkEmailText(link),
      disableTracking: true,
      sendClass: "transactional",
      category: "login_link",
      tags: [{ name: "category", value: "login_link" }],
    });
  } catch (err) {
    console.error("[send-login-link] Resend delivery failed:", err);
    return json({ error: DELIVERY_FAILED_MESSAGE }, 502);
  }

  if (!messageId) {
    // The send gate held it back (e.g. this address is on the transactional
    // suppression list after a hard bounce). Let the browser fall back to
    // Firebase's own sender rather than silently sending nothing.
    console.warn("[send-login-link] send gate returned no message id; client will fall back");
    return json({ error: DELIVERY_FAILED_MESSAGE }, 503);
  }

  return json({ ok: true }, 200);
}
