import { Resend } from "resend";

const resend = new Resend(process.env.RESEND_API_KEY);

export const FROM = "Drew Amato <drew@reserve.mymully.com>";
export const REPLY_TO = "drew@reserve.mymully.com";

export interface PlainTextEmail {
  to: string;
  subject: string;
  text: string;
}

export async function sendPlainText(email: PlainTextEmail): Promise<void> {
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
