import { Resend } from "resend";

export const FROM = "Drew Amato <drew@mymully.com>";
export const REPLY_TO = "drew@mail.mymully.com";

export interface PlainTextEmail {
  to: string;
  subject: string;
  text: string;
  idempotencyKey?: string;
  tags?: { name: string; value: string }[];
}

function getResendClient(): Resend {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("Missing required env var: RESEND_API_KEY");
  }
  return new Resend(apiKey);
}

/**
 * Converts plain text to minimal HTML so Resend can inject its tracking pixel
 * (open tracking) and wrap links (click tracking). The email still ships with
 * a plain-text part — clients that prefer text render that instead.
 */
function toTrackableHtml(text: string): string {
  const escaped = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  // Wrap bare URLs in anchor tags so Resend can track clicks.
  const linked = escaped.replace(
    /https?:\/\/[^\s<>"]+/g,
    (url) => `<a href="${url}" style="color:#2d5016">${url}</a>`
  );

  const paragraphs = linked
    .split(/\n\n+/)
    .map((p) => `<p style="margin:0 0 1em 0;line-height:1.6">${p.replace(/\n/g, "<br>")}</p>`)
    .join("");

  return `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body style="font-family:Georgia,serif;font-size:16px;color:#333;max-width:580px;margin:0 auto;padding:20px">${paragraphs}</body></html>`;
}

export async function sendPlainText(email: PlainTextEmail): Promise<string | null> {
  const resend = getResendClient();
  const { data, error } = await resend.emails.send(
    {
      from: FROM,
      replyTo: REPLY_TO,
      to: email.to,
      subject: email.subject,
      text: email.text,
      html: toTrackableHtml(email.text),
      ...(email.tags ? { tags: email.tags } : {}),
    },
    email.idempotencyKey ? { idempotencyKey: email.idempotencyKey } : undefined
  );
  if (error) {
    throw new Error(`Resend error: ${JSON.stringify(error)}`);
  }
  return data?.id ?? null;
}
