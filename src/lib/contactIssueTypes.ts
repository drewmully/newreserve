/** Issue types for the public /contact form. Shared by the form and the API. */
export const CONTACT_ISSUE_TYPES = [
  "Order status or shipping",
  "Return or exchange",
  "Sizing or fit",
  "Mully Reserve subscription",
  "Product question",
  "Account or sign-in",
  "Something else",
] as const;

export type ContactIssueType = (typeof CONTACT_ISSUE_TYPES)[number];
