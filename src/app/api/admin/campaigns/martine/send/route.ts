/**
 * POST /api/admin/campaigns/martine/send
 *
 * Sends a batch of the Martine reactivation email.
 *
 * Auth: `Authorization: Bearer $CRON_SECRET`
 *
 * Query params:
 *   - batch   (required, 1..4)   Which daily batch to send.
 *   - limit   (optional, default 500) Max recipients to send this invocation.
 *   - dry     (optional, "1")    Skip Resend calls, mark rows as skipped(dry).
 *   - only    (optional, email)  Send only to this one email (test override).
 *
 * Behaviour:
 *   - Picks up to `limit` `campaign_recipients` rows where
 *       campaign_key = 'martine_reactivation_2026_07'
 *       AND status = 'queued'
 *       AND status_reason = 'batch:{batch}'
 *   - For each row: sends via Resend (custom From/ReplyTo for Martine),
 *     upserts sent_at/resend_message_id, moves status to 'sent' or 'failed'.
 *   - Throttled to ~4 req/sec (Resend allows 10/s on default paid; we stay
 *     under to leave headroom for transactional sends from the app).
 *
 * Runtime: nodejs, maxDuration 300s. 500 recipients × 250ms/send = ~2min,
 * well under the limit.
 */

import { NextRequest, NextResponse } from "next/server";
import { getSupabaseService } from "@/app/api/_lib/supabaseService";
import { sendPlainText } from "@/lib/email/resend";

export const runtime = "nodejs";
export const maxDuration = 300;
export const dynamic = "force-dynamic";

const CAMPAIGN_KEY = "martine_reactivation_2026_07";
// Sender identity note: we send from info@mymully.com (root domain, warm
// reputation) rather than Martine@mail.mymully.com. The initial batch 1
// (2026-07-10) went out from the subdomain persona and got 0/403 opens on a
// Gmail-heavy list — classic cold-persona spam-foldering. The Martine persona
// stays in the body/signature and CTA; only the envelope From changes. That
// identity is now the global FROM/REPLY_TO in @/lib/email/resend.
const SUBJECT_VARIANTS = [
  "A note from your new curator",
  "Your new Senior Curator, Martine",
];

const THROTTLE_MS = 250; // 4/sec

function authorized(req: NextRequest): boolean {
  const header = req.headers.get("Authorization") ?? "";
  const token = header.replace(/^Bearer\s+/i, "").trim();
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && token === cronSecret) return true;
  const ua = req.headers.get("user-agent") ?? "";
  if (cronSecret && ua.includes("vercel-cron")) return true;
  return false;
}

function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h;
}

function pickSubject(email: string): string {
  return SUBJECT_VARIANTS[fnv1a(email.toLowerCase().trim()) % SUBJECT_VARIANTS.length];
}

function htmlEscape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderGreeting(firstName: string | null): string {
  const clean = (firstName ?? "").trim();
  if (clean && /^[A-Za-z][A-Za-z' -]{0,40}$/.test(clean)) {
    // Capitalize first letter
    const cap = clean.charAt(0).toUpperCase() + clean.slice(1);
    return `Hi ${htmlEscape(cap)},`;
  }
  return "Hi there,";
}

const EMAIL_HTML_TEMPLATE = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="x-apple-disable-message-reformatting">
<title>A note from Martine</title>
<style>
  body,table,td,a { -webkit-text-size-adjust:100%; -ms-text-size-adjust:100%; }
  table,td { mso-table-lspace:0pt; mso-table-rspace:0pt; }
  img { -ms-interpolation-mode:bicubic; border:0; outline:none; text-decoration:none; display:block; }
  body { margin:0; padding:0; width:100% !important; height:100% !important; background:#F4F1EC; }
  body, table, td, p, a, li { font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Helvetica Neue", Helvetica, Arial, sans-serif; color:#1A1A1A; }
  h1 { font-family: Georgia, "Times New Roman", Times, serif; font-weight:normal; }
  .wrapper { width:100%; background:#F4F1EC; padding:40px 16px; }
  .container { max-width:560px; margin:0 auto; background:#FFFFFF; border-radius:8px; overflow:hidden; }
  .padded { padding:32px 40px; }
  .divider { height:1px; background:#EDE7DE; margin:0 40px; }
  .cta { display:inline-block; background:#1A1A1A; color:#FFFFFF !important; text-decoration:none; padding:14px 28px; border-radius:999px; font-size:15px; font-weight:600; letter-spacing:0.2px; }
  .cta:hover { background:#2a2a2a; }
  .sig-photo { width:64px; height:64px; border-radius:50%; }
  @media only screen and (max-width:600px) { .padded { padding:24px 24px !important; } .divider { margin:0 24px !important; } h1 { font-size:26px !important; line-height:1.25 !important; } }
</style>
</head>
<body style="margin:0;padding:0;background:#F4F1EC;">
<div class="wrapper">
  <table role="presentation" class="container" width="100%" cellpadding="0" cellspacing="0" border="0" align="center" style="max-width:560px;margin:0 auto;background:#FFFFFF;border-radius:8px;overflow:hidden;">
    <tr>
      <td align="center" style="padding:40px 40px 24px 40px;background:#FFFFFF;">
        <img src="https://www.mymully.com/team/martine-square.webp" width="140" height="140" alt="Martine" style="width:140px;height:140px;border-radius:50%;display:block;margin:0 auto;">
      </td>
    </tr>
    <tr>
      <td class="padded" style="padding:0 40px 8px 40px;text-align:center;">
        <h1 style="font-family:Georgia,serif;font-size:30px;line-height:1.2;color:#1A1A1A;margin:0;font-weight:normal;">A note from your new stylist.</h1>
      </td>
    </tr>
    <tr>
      <td class="padded" style="padding:24px 40px 8px 40px;">
        <p style="margin:0 0 18px 0;font-size:16px;line-height:1.55;color:#1A1A1A;">{{greeting}}</p>
        <p style="margin:0 0 18px 0;font-size:16px;line-height:1.55;color:#1A1A1A;">I&rsquo;m Martine. I&rsquo;m a Senior Curator at Mully, and your account was just handed to me. Nice to meet you.</p>
        <p style="margin:0 0 18px 0;font-size:16px;line-height:1.55;color:#1A1A1A;">My job is pretty specific: I get to know a member&rsquo;s size, style, and the pieces they actually reach for, and then I hand-pick things I think they&rsquo;ll love. Every quarter, from live inventory. No random product, no filler.</p>
        <p style="margin:0 0 18px 0;font-size:16px;line-height:1.55;color:#1A1A1A;">You were a member with us before, and I wanted to reach out personally. Mully looks pretty different now than it did back then. It&rsquo;s worth another look.</p>
        <p style="margin:0 0 18px 0;font-size:16px;line-height:1.55;color:#1A1A1A;">My service is included for Mully members, but I&rsquo;d like to offer you a <strong>free style consult</strong> anyway. No obligation. We text back and forth about what you play in, what you like, what you&rsquo;re looking for, and I put together a few recommendations that fit.</p>
        <p style="margin:0 0 8px 0;font-size:16px;line-height:1.55;color:#1A1A1A;">Easiest way to do this is over text. Tap below and it&rsquo;ll open a message to my line with a note already started.</p>
      </td>
    </tr>
    <tr>
      <td align="center" style="padding:16px 40px 32px 40px;">
        <a href="https://mymully.com/text-martine" class="cta" style="display:inline-block;background:#1A1A1A;color:#FFFFFF;text-decoration:none;padding:14px 28px;border-radius:999px;font-size:15px;font-weight:600;letter-spacing:0.2px;font-family:-apple-system,BlinkMacSystemFont,'SF Pro Text','Helvetica Neue',Helvetica,Arial,sans-serif;">Text Martine</a>
        <p style="margin:14px 0 0 0;font-size:13px;color:#6B6B6B;line-height:1.5;">Or text me directly at <a href="https://mymully.com/text-martine" style="color:#6B6B6B;text-decoration:underline;">949-329-9066</a>.</p>
      </td>
    </tr>
    <tr><td><div class="divider" style="height:1px;background:#EDE7DE;margin:0 40px;"></div></td></tr>
    <tr>
      <td class="padded" style="padding:24px 40px 32px 40px;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
          <tr>
            <td width="80" valign="top" style="padding-right:16px;">
              <img src="https://www.mymully.com/team/martine-square.webp" width="64" height="64" alt="Martine" class="sig-photo" style="width:64px;height:64px;border-radius:50%;display:block;">
            </td>
            <td valign="top">
              <p style="margin:0;font-size:15px;color:#1A1A1A;line-height:1.4;"><strong>Martine Jordan</strong><br><span style="color:#6B6B6B;">Senior Curator, Mully</span><br><a href="https://mymully.com/text-martine" style="color:#1A1A1A;text-decoration:underline;">949-329-9066</a></p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
    <tr>
      <td style="padding:20px 40px 32px 40px;background:#FAF7F2;text-align:center;">
        <p style="margin:0 0 6px 0;font-size:12px;color:#8A8A8A;line-height:1.5;">This inbox isn&rsquo;t monitored. Replies won&rsquo;t reach me directly. Text me at <a href="https://mymully.com/text-martine" style="color:#8A8A8A;text-decoration:underline;">949-329-9066</a> and I&rsquo;ll get right back to you.</p>
        <p style="margin:0;font-size:12px;color:#8A8A8A;line-height:1.5;">Mully &middot; <a href="https://mymully.com" style="color:#8A8A8A;text-decoration:underline;">mymully.com</a> &middot; <a href="{{unsubscribe_url}}" style="color:#8A8A8A;text-decoration:underline;">unsubscribe</a></p>
      </td>
    </tr>
  </table>
</div>
</body>
</html>`;

const EMAIL_TEXT_TEMPLATE = `{{greeting}}

I'm Martine. I'm a Senior Curator at Mully, and your account was just handed to me. Nice to meet you.

My job is pretty specific: I get to know a member's size, style, and the pieces they actually reach for, and then I hand-pick things I think they'll love. Every quarter, from live inventory. No random product, no filler.

You were a member with us before, and I wanted to reach out personally. Mully looks pretty different now than it did back then. It's worth another look.

My service is included for Mully members, but I'd like to offer you a free style consult anyway. No obligation. We text back and forth about what you play in, what you like, what you're looking for, and I put together a few recommendations that fit.

Easiest way to do this is over text: https://mymully.com/text-martine or 949-329-9066

Martine Jordan
Senior Curator, Mully
949-329-9066

---
This inbox isn't monitored. Text me at 949-329-9066 or https://mymully.com/text-martine
Mully · https://mymully.com · unsubscribe: {{unsubscribe_url}}`;

function renderEmail(recipient: {
  email: string;
  first_name: string | null;
  id: string;
}): { html: string; text: string; subject: string } {
  const greeting = renderGreeting(recipient.first_name);
  const greetingText = greeting.replace(/&(#\d+|[a-z]+);/g, (m, e) => (e === "rsquo" ? "'" : m));
  const unsubUrl = `https://mymully.com/unsubscribe?rid=${encodeURIComponent(recipient.id)}`;
  const html = EMAIL_HTML_TEMPLATE.replace("{{greeting}}", greeting).replace(
    "{{unsubscribe_url}}",
    unsubUrl
  );
  const text = EMAIL_TEXT_TEMPLATE.replace("{{greeting}}", greetingText).replace(
    "{{unsubscribe_url}}",
    unsubUrl
  );
  return { html, text, subject: pickSubject(recipient.email) };
}

interface Recipient {
  id: string;
  email: string;
  first_name: string | null;
}

async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export async function POST(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const batchParam = url.searchParams.get("batch");
  const batch = batchParam ? parseInt(batchParam, 10) : NaN;
  if (!batch || batch < 1 || batch > 4) {
    return NextResponse.json({ error: "batch (1..4) required" }, { status: 400 });
  }

  const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "500", 10), 500);
  const dry = url.searchParams.get("dry") === "1";
  const only = url.searchParams.get("only");

  const sb = getSupabaseService();
  if (!process.env.RESEND_API_KEY && !dry) {
    return NextResponse.json({ error: "RESEND_API_KEY missing" }, { status: 500 });
  }

  // Fetch queued rows
  let query = sb
    .from("campaign_recipients")
    .select("id,email,first_name")
    .eq("campaign_key", CAMPAIGN_KEY)
    .eq("status", "queued")
    .eq("status_reason", `batch:${batch}`)
    .order("created_at", { ascending: true })
    .limit(limit);
  if (only) query = query.eq("email", only.toLowerCase());
  const { data: rows, error } = await query;
  if (error) {
    return NextResponse.json({ error: `query failed: ${error.message}` }, { status: 500 });
  }
  const recipients = (rows ?? []) as Recipient[];

  const result = {
    campaign: CAMPAIGN_KEY,
    batch,
    dry,
    picked: recipients.length,
    sent: 0,
    failed: 0,
    skipped: 0,
    errors: [] as { email: string; error: string }[],
  };

  for (const r of recipients) {
    const { html, text, subject } = renderEmail(r);
    if (dry) {
      await sb
        .from("campaign_recipients")
        .update({
          status: "skipped",
          status_reason: "dry_run",
          updated_at: new Date().toISOString(),
        })
        .eq("id", r.id);
      result.skipped++;
      continue;
    }
    try {
      const messageId = await sendPlainText({
        to: r.email,
        subject,
        text,
        // Designed responsive layout with its own unsubscribe link — pass it
        // through instead of letting the text-to-HTML path regenerate it.
        html,
        sendClass: "campaign",
        category: "martine_reactivation",
        // idempotency key includes send attempt derived from FROM identity
        // so a From-address change (e.g. Martine@mail.mymully.com -> info@mymully.com)
        // does not get deduped by Resend as a repeat send.
        idempotencyKey: `${CAMPAIGN_KEY}:v2:${r.id}`,
        tags: [
          { name: "campaign", value: "martine_reactivation" },
          { name: "batch", value: `d${batch}` },
        ],
      });
      // null means the send gate denied this recipient (suppressed, no consent,
      // frequency cap). Not a failure — record it as skipped so a retry of the
      // batch does not keep re-attempting them.
      if (!messageId) {
        await sb
          .from("campaign_recipients")
          .update({
            status: "skipped",
            status_reason: "send_gate_denied",
            updated_at: new Date().toISOString(),
          })
          .eq("id", r.id);
        result.skipped++;
        continue;
      }
      await sb
        .from("campaign_recipients")
        .update({
          status: "sent",
          resend_message_id: messageId,
          sent_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          status_reason: `batch:${batch}`,
        })
        .eq("id", r.id);
      result.sent++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await sb
        .from("campaign_recipients")
        .update({
          status: "failed",
          status_reason: `send_failed: ${msg}`.slice(0, 500),
          updated_at: new Date().toISOString(),
        })
        .eq("id", r.id);
      result.failed++;
      result.errors.push({ email: r.email, error: msg });
    }
    await sleep(THROTTLE_MS);
  }

  // Update campaign counter (aggregate from DB, not just this batch)
  if (result.sent > 0 || result.failed > 0) {
    const { data: agg } = await sb
      .from("campaign_recipients")
      .select("status")
      .eq("campaign_key", CAMPAIGN_KEY);
    if (agg) {
      let sent = 0,
        failed = 0,
        skipped = 0;
      for (const r of agg) {
        if (r.status === "sent") sent++;
        else if (r.status === "failed") failed++;
        else if (r.status === "skipped") skipped++;
      }
      await sb
        .from("campaigns")
        .update({
          sent_count: sent,
          failed_count: failed,
          skipped_count: skipped,
          last_sent_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("key", CAMPAIGN_KEY);
    }
  }

  return NextResponse.json(result);
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const sb = getSupabaseService();
  const { data, error } = await sb
    .from("campaign_recipients")
    .select("status, status_reason")
    .eq("campaign_key", CAMPAIGN_KEY);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const counts: Record<string, Record<string, number>> = {};
  for (const row of data ?? []) {
    const status = row.status as string;
    const reason = (row.status_reason as string) ?? "";
    if (!counts[status]) counts[status] = {};
    counts[status][reason] = (counts[status][reason] ?? 0) + 1;
  }
  return NextResponse.json({ campaign: CAMPAIGN_KEY, counts });
}
