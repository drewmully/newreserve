/**
 * POST /api/contact
 *
 * Public contact form (/contact). Emails the support inbox with subject
 * "Website Customer Inquiry". Reply-To is the shopper so a reply goes
 * straight back to them. Nothing is stored.
 *
 * Body: { email, message, orderNumber?, issueType?, company? (honeypot) }
 */
import { NextRequest, NextResponse } from "next/server";
import { sendPlainText } from "@/lib/email/resend";
import { checkRateLimit } from "@/lib/rateLimit";
import { getClientIp } from "@/app/api/_lib/clientIp";
import { CONTACT_ISSUE_TYPES } from "@/lib/contactIssueTypes";

export const runtime = "nodejs";

const SUPPORT_INBOX = "info@mullybox.com";
const SUBJECT = "Website Customer Inquiry";
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type Body = {
  email?: unknown;
  message?: unknown;
  orderNumber?: unknown;
  issueType?: unknown;
  company?: unknown;
};

const str = (v: unknown, max: number) =>
  typeof v === "string" ? v.trim().slice(0, max) : "";

export async function POST(req: NextRequest) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  // Honeypot: bots fill hidden fields. Pretend success, send nothing.
  if (str(body.company, 200)) return NextResponse.json({ ok: true });

  const email = str(body.email, 254).toLowerCase();
  const message = str(body.message, 5000);
  const orderNumber = str(body.orderNumber, 40);
  const issueRaw = str(body.issueType, 60);
  const issueType = (CONTACT_ISSUE_TYPES as readonly string[]).includes(issueRaw)
    ? issueRaw
    : "";

  if (!EMAIL_RE.test(email)) {
    return NextResponse.json({ error: "Enter a valid email." }, { status: 400 });
  }
  if (message.length < 2) {
    return NextResponse.json({ error: "Add a short note." }, { status: 400 });
  }

  const ip = getClientIp(req.headers) ?? "unknown";
  const limit = checkRateLimit("contact_form_ip", ip, { maxHits: 5, windowMs: 10 * 60 * 1000 });
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "Too many messages. Try again in a few minutes." },
      { status: 429 }
    );
  }

  const text = [
    `Email: ${email}`,
    `Issue type: ${issueType || "Not given"}`,
    `Order number: ${orderNumber || "Not given"}`,
    "",
    message,
    "",
    "Sent from mymully.com/contact",
  ].join("\n");

  try {
    await sendPlainText({
      to: SUPPORT_INBOX,
      replyTo: email,
      subject: SUBJECT,
      text,
      sendClass: "transactional",
      category: "website_contact_form",
      disableTracking: true,
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[contact] send failed:", err);
    return NextResponse.json(
      { error: "We could not send that. Email info@mullybox.com instead." },
      { status: 500 }
    );
  }
}
