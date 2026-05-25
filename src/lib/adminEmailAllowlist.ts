const DEFAULT_ADMIN_EMAILS = [
  "drew@mullybox.com",
  "leo@mullybox.com",
  "jack@mullybox.com",
] as const;

export function getAdminEmailAllowlist(serialized?: string | null): string[] {
  if (!serialized) return [...DEFAULT_ADMIN_EMAILS];

  const emails = serialized
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);

  return emails.length > 0 ? emails : [...DEFAULT_ADMIN_EMAILS];
}

export function isAllowedAdminEmail(
  email: string | null | undefined,
  serialized?: string | null
): boolean {
  if (!email) return false;
  return getAdminEmailAllowlist(serialized).includes(email.trim().toLowerCase());
}

export { DEFAULT_ADMIN_EMAILS };
