/** Only shop routes can bypass member onboarding after a shop-initiated login. */
export function safeShopReturn(value: string | null | undefined): string | null {
  if (!value || value.length > 1500 || /[\\\u0000-\u0020]/.test(value)) return null;
  if (!/^(?:\/shop(?:\/|[?#]|$)|\/(?:[?#]|$))/.test(value) || /%2f|%5c|%0[ad]/i.test(value)) return null;
  try {
    const url = new URL(value, "https://mymully.com");
    if (url.origin !== "https://mymully.com" || (url.pathname !== "/" && !/^\/shop(?:\/|$)/.test(url.pathname))) return null;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return null;
  }
}

export function shopReturnFromLogin(search: string): string | null {
  const params = new URLSearchParams(search);
  // Paid membership links retain their original completion flow.
  if (params.has("paid") || params.has("paid_member")) return null;
  return safeShopReturn(params.get("returnTo")) || "/";
}
