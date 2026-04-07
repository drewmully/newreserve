import { Resend } from "resend";

export const FROM = "Drew Amato <drew@reserve.mymully.com>";
export const REPLY_TO = "drew@mail.mymully.com";

export interface PlainTextEmail {
  to: string;
  subject: string;
  text: string;
}

function getResendClient(): Resend {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("Missing required env var: RESEND_API_KEY");
  }
  return new Resend(apiKey);
}

export async function sendPlainText(email: PlainTextEmail): Promise<void> {
  const resend = getResendClient();
  const { error } = await resend.emails.send({
    from: FROM,
    replyTo: REPLY_TO,
    to: email.to,
    subject: email.subject,
    text: email.text,
  });
  if (error) {
    throw new Error(`Resend error: ${JSON.stringify(error)}`);
  }
}
