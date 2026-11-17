/**
 * Shared helpers for building the /login continue URL that an email sign-in
 * link returns to. Pure (no React / Firebase imports) so the browser
 * (`sendOTPEmail`) and the server (`/api/auth/send-login-link`) build exactly
 * the same URL, and both are unit tested directly.
 */
import { safeShopReturn, shopReturnFromLogin } from "./shopLogin";

export const PRIMARY_LOGIN_ORIGIN = "https://www.mymully.com";

export interface LoginLinkTarget {
  /** Sanitised shop return path (`/shop...` or `/`), carried as `returnTo`. */
  continuePath?: string;
  /** Fresh link requested from an expired post-purchase link (/login?paid=1). */
  paid?: boolean;
}

/**
 * What the current page wants the link to return to. Mirrors the original
 * client-side `sendOTPEmail` logic: only /login carries a shop `returnTo` or
 * the `paid=1` marker; every other caller (onboarding, account, set-password
 * gate) gets a plain /login link.
 */
export function loginLinkTargetFromLocation(pathname: string, search: string): LoginLinkTarget {
  if (pathname !== "/login") return {};
  const target: LoginLinkTarget = {};
  const shopReturn = shopReturnFromLogin(search);
  if (shopReturn) target.continuePath = shopReturn;
  // Keeps the paid marker so pending onboarding never re-sends the buyer to
  // checkout. The flag only suppresses the checkout redirect; it grants nothing.
  if (new URLSearchParams(search).get("paid") === "1") target.paid = true;
  return target;
}

/**
 * `${origin}/login` plus the sanitised `returnTo` / `paid=1` params. The
 * return path is re-sanitised here so a server caller never trusts the
 * request body. A paid link keeps its own completion flow, so (exactly like
 * `shopReturnFromLogin`) it never carries a `returnTo`.
 */
export function buildLoginContinueUrl(origin: string, target: LoginLinkTarget): string {
  const destination = new URL("/login", origin);
  const returnTo = target.paid ? null : safeShopReturn(target.continuePath);
  if (returnTo) destination.searchParams.set("returnTo", returnTo);
  if (target.paid) destination.searchParams.set("paid", "1");
  return destination.toString();
}

/** Hosts a sign-in link may ever return to, regardless of environment. */
const PRODUCTION_ORIGINS = new Set(["https://www.mymully.com", "https://mymully.com"]);

function originOf(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    return url.origin;
  } catch {
    return null;
  }
}

export interface AllowedOriginEnv {
  NODE_ENV?: string;
  VERCEL_ENV?: string;
  VERCEL_URL?: string;
  VERCEL_BRANCH_URL?: string;
}

/**
 * The origin to put in the continue URL. The request's own origin is used
 * only when it is on the allowlist (production hosts; this deployment's own
 * Vercel preview URLs; localhost outside production). Anything else —
 * including a spoofed Origin header — falls back to https://www.mymully.com.
 */
export function resolveLoginOrigin(requestOrigin: string | null | undefined, env: AllowedOriginEnv): string {
  const origin = originOf(requestOrigin);
  if (!origin) return PRIMARY_LOGIN_ORIGIN;
  if (PRODUCTION_ORIGINS.has(origin)) return origin;

  if (env.VERCEL_ENV === "preview") {
    const previewOrigins = [env.VERCEL_URL, env.VERCEL_BRANCH_URL]
      .filter((host): host is string => Boolean(host))
      .map((host) => `https://${host}`);
    if (previewOrigins.includes(origin)) return origin;
  }

  const isProduction = env.VERCEL_ENV === "production" || (!env.VERCEL_ENV && env.NODE_ENV === "production");
  if (!isProduction) {
    const url = new URL(origin);
    if (url.hostname === "localhost" || url.hostname === "127.0.0.1") return origin;
  }

  return PRIMARY_LOGIN_ORIGIN;
}
