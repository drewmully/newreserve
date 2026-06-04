/**
 * Shared template type. A template is a pure function from optional firstName
 * to a rendered { subject, text } pair.
 */
export type EmailTemplate = (
  firstName: string | null,
) => { subject: string; text: string };
