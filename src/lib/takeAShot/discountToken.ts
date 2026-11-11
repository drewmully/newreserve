/**
 * Picks an Admin API token that can write discounts. The main storefront
 * token (SHOPIFY_ADMIN_TOKEN, app "Mully Reserve") has no discount scopes,
 * so Take a Shot tries, in order:
 *
 *   1. SHOPIFY_DISCOUNTS_TOKEN
 *   2. SHOPIFY_SUBSCRIPTIONS_TOKEN
 *   3. client_credentials grant with SHOPIFY_DISCOUNTS_CLIENT_ID / _SECRET
 *
 * and uses the first whose currentAppInstallation.accessScopes includes
 * write_discounts. The choice is cached in memory. Server only. Token values
 * never leave this module (diagnostics report presence and scope only).
 */
import { SHOPIFY_DISCOUNT_API_VERSION } from "./config";

export type TokenSource = "SHOPIFY_DISCOUNTS_TOKEN" | "SHOPIFY_SUBSCRIPTIONS_TOKEN" | "client_credentials";
export const TOKEN_SOURCES: TokenSource[] = ["SHOPIFY_DISCOUNTS_TOKEN", "SHOPIFY_SUBSCRIPTIONS_TOKEN", "client_credentials"];

type Env = Record<string, string | undefined>;
type Fetch = typeof fetch;

export interface TokenProbe { source: TokenSource; present: boolean; appTitle: string | null; hasWriteDiscounts: boolean }

const SCOPES_QUERY = `query TakeAShotScopes { currentAppInstallation { app { title } accessScopes { handle } } }`;

function shopDomain(env: Env): string | null {
  const d = env.SHOPIFY_STORE_DOMAIN?.trim();
  return d ? d.replace(/^https?:\/\//, "").replace(/\/$/, "") : null;
}

type Minted = { token: string; expiresAt: number; scopes: string[] | null };

/**
 * Dev Dashboard app token (e.g. "Mully Discounts"). The grant response
 * includes `scope` (comma-separated) and `expires_in` (86399s), so the scope
 * check needs no extra call and the token is cached until 5 minutes before
 * it expires.
 */
async function clientCredentialsToken(env: Env, f: Fetch): Promise<Minted | null> {
  const id = env.SHOPIFY_DISCOUNTS_CLIENT_ID, secret = env.SHOPIFY_DISCOUNTS_CLIENT_SECRET, shop = shopDomain(env);
  if (!id || !secret || !shop) return null;
  const res = await f(`https://${shop}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "client_credentials", client_id: id, client_secret: secret }).toString(),
  });
  if (!res.ok) return null;
  const json = (await res.json()) as { access_token?: string; expires_in?: number; scope?: string };
  if (!json.access_token) return null;
  const ttl = typeof json.expires_in === "number" ? json.expires_in * 1000 : 23 * 3600_000;
  const scopes = typeof json.scope === "string" ? json.scope.split(/[,\s]+/).map((x) => x.trim()).filter(Boolean) : null;
  return { token: json.access_token, expiresAt: Date.now() + Math.max(60_000, ttl - 5 * 60_000), scopes };
}

async function tokenFor(source: TokenSource, env: Env, f: Fetch): Promise<Minted | null> {
  if (source === "client_credentials") return clientCredentialsToken(env, f);
  const token = env[source]?.trim();
  return token ? { token, expiresAt: Number.POSITIVE_INFINITY, scopes: null } : null;
}

async function probe(token: string, env: Env, f: Fetch): Promise<{ appTitle: string | null; hasWriteDiscounts: boolean }> {
  const shop = shopDomain(env);
  if (!shop) return { appTitle: null, hasWriteDiscounts: false };
  const res = await f(`https://${shop}/admin/api/${SHOPIFY_DISCOUNT_API_VERSION}/graphql.json`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": token },
    body: JSON.stringify({ query: SCOPES_QUERY }),
  });
  if (!res.ok) return { appTitle: null, hasWriteDiscounts: false };
  const json = (await res.json()) as { data?: { currentAppInstallation?: { app?: { title?: string }; accessScopes?: { handle: string }[] } } };
  const inst = json.data?.currentAppInstallation;
  return {
    appTitle: inst?.app?.title ?? null,
    hasWriteDiscounts: Boolean(inst?.accessScopes?.some((s) => s.handle === "write_discounts")),
  };
}

let cached: { token: string; source: TokenSource; expiresAt: number } | null = null;

/** For tests. */
export function resetDiscountTokenCache() { cached = null; }

/** True when a token with write_discounts is configured (cached after the first check). */
export async function hasDiscountToken(env: Env = process.env, f: Fetch = fetch): Promise<boolean> {
  return Boolean(await getDiscountToken(env, f).catch(() => null));
}

/** The first token with write_discounts, or null when none is configured. */
export async function getDiscountToken(env: Env = process.env, f: Fetch = fetch): Promise<{ token: string; source: TokenSource } | null> {
  if (cached && cached.expiresAt > Date.now()) return { token: cached.token, source: cached.source };
  cached = null;
  for (const source of TOKEN_SOURCES) {
    try {
      const t = await tokenFor(source, env, f);
      if (!t) continue;
      const canWrite = t.scopes ? t.scopes.includes("write_discounts") : (await probe(t.token, env, f)).hasWriteDiscounts;
      if (canWrite) {
        cached = { token: t.token, source, expiresAt: t.expiresAt };
        return { token: t.token, source };
      }
    } catch { /* try the next source */ }
  }
  return null;
}

/** Diagnostics: presence, app title and scope for each source. Never token values. */
export async function probeDiscountTokens(env: Env = process.env, f: Fetch = fetch): Promise<TokenProbe[]> {
  const out: TokenProbe[] = [];
  for (const source of TOKEN_SOURCES) {
    const present = source === "client_credentials"
      ? Boolean(env.SHOPIFY_DISCOUNTS_CLIENT_ID && env.SHOPIFY_DISCOUNTS_CLIENT_SECRET)
      : Boolean(env[source]?.trim());
    let appTitle: string | null = null, hasWriteDiscounts = false;
    if (present) {
      try {
        const t = await tokenFor(source, env, f);
        if (t?.scopes) {
          // Scope comes from the grant itself; the title lookup is best effort.
          hasWriteDiscounts = t.scopes.includes("write_discounts");
          appTitle = await probe(t.token, env, f).then((p) => p.appTitle).catch(() => null);
        } else if (t) ({ appTitle, hasWriteDiscounts } = await probe(t.token, env, f));
      } catch { /* report as not usable */ }
    }
    out.push({ source, present, appTitle, hasWriteDiscounts });
  }
  return out;
}

/**
 * Admin GraphQL with the discount token. A 401 (revoked or expired token)
 * drops the cache and retries once with a fresh token. Error messages never
 * include the token.
 */
export async function discountGraphQL<T>(query: string, variables?: Record<string, unknown>, env: Env = process.env, f: Fetch = fetch): Promise<T> {
  const shop = shopDomain(env);
  let res: Response | null = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    const chosen = await getDiscountToken(env, f);
    if (!chosen) throw new Error("access_denied: no token with write_discounts");
    res = await f(`https://${shop}/admin/api/${SHOPIFY_DISCOUNT_API_VERSION}/graphql.json`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": chosen.token },
      body: JSON.stringify({ query, variables }),
    });
    if (res.status !== 401) break;
    cached = null;
  }
  if (!res) throw new Error("shopify_unavailable");
  if (res.status === 401 || res.status === 403) { cached = null; throw new Error(`access_denied ${res.status}`); }
  if (!res.ok) throw new Error(`shopify ${res.status}`);
  const json = (await res.json()) as { data: T; errors?: { message?: string; extensions?: { code?: string } }[] };
  if (json.errors?.length) {
    const code = json.errors[0]?.extensions?.code ?? "graphql_error";
    if (code === "ACCESS_DENIED") cached = null;
    throw new Error(code === "ACCESS_DENIED" ? "access_denied" : code);
  }
  return json.data;
}
