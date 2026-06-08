/**
 * Shared template type. A template is a pure function from optional firstName
 * (and optional per-recipient context) to a rendered { subject, text } pair.
 *
 * `ctx.profileId` is plumbed through for the `reserve` flow so nurture emails
 * can link directly to the recipient's personalized reveal page
 * (/lp/reserve/reveal/{profileId}) instead of dumping them on the generic LP.
 * Templates that don't need context simply ignore it.
 */
export interface EmailTemplateContext {
  profileId?: string;
}

export type EmailTemplate = (
  firstName: string | null,
  ctx?: EmailTemplateContext,
) => { subject: string; text: string };
