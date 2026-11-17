/** Copy for the passwordless sign-in email sent by /api/auth/send-login-link. */

export const LOGIN_LINK_SUBJECT = "Your Mully sign-in link";

/**
 * Text-only on purpose. Resend click tracking is a domain-level setting (the
 * SDK has no per-send toggle) and only rewrites links inside an HTML body; a
 * wrapped link gets pre-fetched by mailbox link scanners, which burns the
 * single-use oobCode. `sendPlainText({ disableTracking: true })` sends no
 * HTML part and skips UTM rewriting, so the link arrives byte-for-byte.
 */
export function loginLinkEmailText(link: string): string {
  return [
    "Hi,",
    "",
    "Here's your link to sign in to Mully:",
    "",
    link,
    "",
    "This link works once and expires within an hour. If it stops working, request a fresh one at mymully.com/login.",
    "",
    "Didn't request this? You can safely ignore this email. Your account stays as it is.",
    "",
    "Mully",
  ].join("\n");
}
