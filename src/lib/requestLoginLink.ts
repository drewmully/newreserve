/**
 * Browser-side delivery of a passwordless sign-in link.
 *
 * Primary path: POST /api/auth/send-login-link, which emails the link from
 * info@mymully.com through Resend. If that route is unavailable (5xx,
 * network error, timeout, unexpected status) we fall back to Firebase's own
 * `sendSignInLinkToEmail`, so sign-in is never worse than before. A 400
 * (bad email) or 429 (rate limited) is a real answer and is NOT retried via
 * Firebase — that would bypass the rate limit.
 *
 * Kept free of Firebase imports (the fallback is injected) so it can be unit
 * tested directly.
 */
import type { LoginLinkTarget } from "./loginLink";

export const LOGIN_LINK_ENDPOINT = "/api/auth/send-login-link";
const REQUEST_TIMEOUT_MS = 15_000;

/** Error shaped like a Firebase AuthError so mapAuthError() handles it. */
export class LoginLinkError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "LoginLinkError";
    this.code = code;
  }
}

export type LoginLinkDelivery = "resend" | "firebase";

export interface RequestLoginLinkDeps {
  fetchImpl?: typeof fetch;
  /** Firebase `sendSignInLinkToEmail` with the same continue URL. */
  firebaseFallback: () => Promise<void>;
  onFallback?: (reason: string) => void;
  timeoutMs?: number;
}

export async function requestLoginLink(
  email: string,
  target: LoginLinkTarget,
  deps: RequestLoginLinkDeps
): Promise<LoginLinkDelivery> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
  const timer = controller
    ? setTimeout(() => controller.abort(), deps.timeoutMs ?? REQUEST_TIMEOUT_MS)
    : null;

  let fallbackReason: string;
  try {
    const res = await fetchImpl(LOGIN_LINK_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, ...target }),
      signal: controller?.signal,
    });
    if (res.ok) {
      // Only trust the route's own JSON answer; a 200 HTML page (e.g. a
      // rewrite or proxy error page) means nothing was sent.
      const body = (await res.json().catch(() => null)) as { ok?: unknown } | null;
      if (body?.ok === true) return "resend";
      fallbackReason = "unexpected 200 response";
    } else {
      if (res.status === 400) {
        throw new LoginLinkError("auth/invalid-email", "Invalid email address.");
      }
      if (res.status === 429) {
        throw new LoginLinkError("auth/too-many-requests", "Too many sign-in link requests.");
      }
      fallbackReason = `status ${res.status}`;
    }
  } catch (err) {
    if (err instanceof LoginLinkError) throw err;
    fallbackReason = err instanceof Error ? `${err.name}: ${err.message}` : "network error";
  } finally {
    if (timer) clearTimeout(timer);
  }

  deps.onFallback?.(fallbackReason);
  await deps.firebaseFallback();
  return "firebase";
}
