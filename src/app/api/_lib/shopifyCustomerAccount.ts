import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto";
import { adminAuth, adminDb } from "@/lib/firebase-admin";
import { CUSTOMER_CONTRACTS_QUERY, CUSTOMER_IDENTITY_QUERY, type CustomerContract, isOutfitContract } from "@/lib/shopifyCustomerContracts";

// Verified from this shop's public .well-known discovery documents.
const AUTH_URL = "https://shopify.com/authentication/56105304256/oauth/authorize";
const TOKEN_URL = "https://shopify.com/authentication/56105304256/oauth/token";
const GRAPHQL_URL = "https://shopify.com/56105304256/account/customer/api/2026-10/graphql";
export const CUSTOMER_CALLBACK = "https://www.mymully.com/api/shopify-customer/callback";
// Public-client Customer API tokens are bound to a registered JavaScript origin.
// Server-side fetch does not supply this browser header automatically.
export const CUSTOMER_ORIGIN = new URL(CUSTOMER_CALLBACK).origin;
export const CUSTOMER_STATE_COOKIE = "__Host-mully-shopify-state";
const SESSION_COLLECTION = "shopify_customer_sessions"; // Admin SDK only, no client rule grants.
const STATE_COLLECTION = "shopify_customer_oauth_states";

export class CustomerAccountError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}
export function customerApiConfigured() {
  return Boolean(process.env.SHOPIFY_CUSTOMER_ACCOUNT_CLIENT_ID &&
    process.env.SHOPIFY_CUSTOMER_SESSION_SECRET &&
    Buffer.from(process.env.SHOPIFY_CUSTOMER_SESSION_SECRET, "base64").length === 32);
}
export function nativeEnrollmentEnabled() {
  return customerApiConfigured() && process.env.SHOPIFY_NATIVE_SUBSCRIPTIONS_ENABLED === "true";
}
function config() {
  if (!customerApiConfigured()) throw new CustomerAccountError(503, "setup_required", "Subscription management is being connected. Please contact Mully for help.");
  return { clientId: process.env.SHOPIFY_CUSTOMER_ACCOUNT_CLIENT_ID! };
}
export function sealCustomerSession(value: unknown) {
  config();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", Buffer.from(process.env.SHOPIFY_CUSTOMER_SESSION_SECRET!, "base64"), iv);
  const bytes = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), bytes].map(buffer => buffer.toString("base64url")).join(".");
}
export function openCustomerSession<T>(value: string): T {
  config();
  const [iv, tag, bytes] = value.split(".").map(part => Buffer.from(part, "base64url"));
  const decipher = createDecipheriv("aes-256-gcm", Buffer.from(process.env.SHOPIFY_CUSTOMER_SESSION_SECRET!, "base64"), iv);
  decipher.setAuthTag(tag);
  return JSON.parse(Buffer.concat([decipher.update(bytes), decipher.final()]).toString("utf8"));
}
interface Tokens { accessToken: string; refreshToken: string | null; expiresAt: number }
interface LinkedSession extends Tokens { customerId: string }
function sessionRef(uid: string) { return adminDb.collection(SESSION_COLLECTION).doc(uid); }
function stateRef(state: string) { return adminDb.collection(STATE_COLLECTION).doc(createHash("sha256").update(state).digest("hex")); }

async function tokenRequest(params: Record<string, string>): Promise<Tokens> {
  const { clientId } = config();
  // Shopify confidential clients authenticate the initial exchange AND refresh
  // with HTTP Basic. Keep the secret server-only and never send it to GraphQL.
  // Public clients continue to use the existing PKCE flow without this header.
  const clientSecret = process.env.SHOPIFY_CUSTOMER_ACCOUNT_CLIENT_SECRET;
  const headers: Record<string, string> = {
    "Content-Type": "application/x-www-form-urlencoded",
    Origin: CUSTOMER_ORIGIN,
  };
  if (clientSecret) {
    headers.Authorization = `Basic ${Buffer.from(`${clientId}:${clientSecret}`, "utf8").toString("base64")}`;
  }
  const response = await fetch(TOKEN_URL, {
    method: "POST", cache: "no-store", signal: AbortSignal.timeout(15000),
    headers,
    body: new URLSearchParams({ client_id: clientId, ...params }),
  });
  const data = await response.json();
  if (!response.ok || typeof data.access_token !== "string" || !Number.isFinite(Number(data.expires_in)) || Number(data.expires_in) <= 0) {
    // Do not log raw OAuth responses: they can contain credentials.
    const safeErrors = ["invalid_client", "invalid_grant", "invalid_request", "invalid_scope", "unauthorized_client", "unsupported_grant_type"];
    console.warn("[shopify-customer] token exchange failed", {
      status: response.status,
      error: safeErrors.includes(data.error) ? data.error : "invalid_token_response",
    });
    if (data.error === "invalid_client" || data.error === "unauthorized_client") {
      throw new CustomerAccountError(503, "client_configuration_error", "Shopify account connection needs a storefront configuration update. Please contact Mully; signing in again will not fix this.");
    }
    throw new CustomerAccountError(401, "connect_required", "Please reconnect your Shopify account.");
  }
  return { accessToken: data.access_token, refreshToken: typeof data.refresh_token === "string" ? data.refresh_token : null, expiresAt: Date.now() + Number(data.expires_in) * 1000 };
}
export async function customerGraphQL<T>(accessToken: string, query: string, variables: Record<string, unknown> = {}): Promise<T> {
  const response = await fetch(GRAPHQL_URL, {
    method: "POST", cache: "no-store", signal: AbortSignal.timeout(15000),
    // Shopify Customer Account API uses the access token without "Bearer".
    headers: { "Content-Type": "application/json", Authorization: accessToken, Origin: CUSTOMER_ORIGIN },
    body: JSON.stringify({ query, variables }),
  });
  const data = await response.json();
  if (!response.ok || data.errors?.length || !data.data) {
    // Status and allowlisted error codes only. Never log tokens, response
    // bodies, emails, customer IDs, callback URLs, or authorization codes.
    const safeCodes = ["ACCESS_DENIED", "UNAUTHENTICATED", "THROTTLED"];
    console.warn("[shopify-customer] customer API failed", {
      status: response.status,
      codes: Array.isArray(data.errors)
        ? data.errors.map((error: { extensions?: { code?: string } }) =>
          safeCodes.includes(error.extensions?.code || "") ? error.extensions!.code : "GRAPHQL_ERROR")
        : [],
    });
  }
  if (response.status === 401 || data.errors?.some((error: { extensions?: { code?: string } }) => error.extensions?.code === "UNAUTHENTICATED")) {
    throw new CustomerAccountError(401, "connect_required", "Please reconnect your Shopify account.");
  }
  if (response.status === 403 || data.errors?.some((error: { extensions?: { code?: string } }) => error.extensions?.code === "ACCESS_DENIED")) {
    throw new CustomerAccountError(503, "permissions_required", "Shopify subscription permissions are not enabled yet. Please contact Mully.");
  }
  if (!response.ok || data.errors?.length || !data.data) throw new CustomerAccountError(502, "shopify_unavailable", "Shopify is temporarily unavailable. Please try again.");
  return data.data as T;
}
export async function beginCustomerConnection(uid: string) {
  const { clientId } = config();
  const user = await adminAuth.getUser(uid);
  if (!user.emailVerified || !user.email) throw new CustomerAccountError(403, "verify_email", "Sign in with your Mully email link before connecting Shopify.");
  const state = randomBytes(32).toString("base64url");
  const verifier = randomBytes(32).toString("base64url");
  await stateRef(state).set({ uid, verifier, expiresAt: Date.now() + 10 * 60 * 1000 });
  const url = new URL(AUTH_URL);
  url.search = new URLSearchParams({
    client_id: clientId, response_type: "code", redirect_uri: CUSTOMER_CALLBACK,
    scope: "openid email customer-account-api:full", state,
    code_challenge: createHash("sha256").update(verifier).digest("base64url"), code_challenge_method: "S256",
  }).toString();
  return { state, url: url.toString() };
}
export async function completeCustomerConnection(state: string, code: string) {
  config();
  if (!/^[A-Za-z0-9_-]{43}$/.test(state) || !code || code.length > 4096) throw new CustomerAccountError(400, "invalid_callback", "Invalid account connection.");
  // Consume before exchanging the code, rejecting expired or replayed callbacks.
  const challenge = await adminDb.runTransaction(async tx => {
    const ref = stateRef(state);
    const snap = await tx.get(ref);
    const value = snap.data();
    if (!value || value.expiresAt < Date.now()) throw new CustomerAccountError(400, "expired_callback", "The account connection expired. Please try again.");
    tx.delete(ref);
    return value as { uid: string; verifier: string };
  });
  const tokens = await tokenRequest({ grant_type: "authorization_code", redirect_uri: CUSTOMER_CALLBACK, code, code_verifier: challenge.verifier });
  const { customer } = await customerGraphQL<{ customer: { id: string; emailAddress: { emailAddress: string | null } | null } }>(tokens.accessToken, CUSTOMER_IDENTITY_QUERY);
  const user = await adminAuth.getUser(challenge.uid);
  if (!user.emailVerified || !user.email || user.email.toLowerCase() !== customer.emailAddress?.emailAddress?.toLowerCase()) {
    throw new CustomerAccountError(403, "account_mismatch", "Use the same email for Shopify and MyMully.");
  }
  await adminDb.runTransaction(async tx => {
    const ref = adminDb.collection("users").doc(challenge.uid);
    const snap = await tx.get(ref);
    const existing = snap.data()?.shopify_customer_id;
    if (existing && String(existing).split("/").pop() !== customer.id.split("/").pop()) {
      throw new CustomerAccountError(403, "account_mismatch", "That Shopify account does not match your Mully account.");
    }
    if (!snap.exists) throw new CustomerAccountError(404, "account_missing", "Sign in to Mully first.");
    tx.update(ref, { shopify_customer_id: customer.id });
    tx.set(sessionRef(challenge.uid), { encrypted: sealCustomerSession({ ...tokens, customerId: customer.id }), updatedAt: Date.now() });
  });
}
export async function getLinkedCustomerSession(uid: string): Promise<LinkedSession> {
  config();
  const ref = sessionRef(uid);
  const snap = await ref.get();
  if (!snap.exists) throw new CustomerAccountError(401, "connect_required", "Connect your Shopify account to manage this subscription.");
  let session: LinkedSession;
  try { session = openCustomerSession<LinkedSession>(snap.data()!.encrypted); }
  catch { throw new CustomerAccountError(401, "connect_required", "Please reconnect your Shopify account."); }
  if (session.expiresAt > Date.now() + 60000) return session;
  if (!session.refreshToken) throw new CustomerAccountError(401, "connect_required", "Please reconnect your Shopify account.");
  // Serialize rotating refresh tokens so parallel account requests cannot reuse one.
  const lease = randomBytes(16).toString("hex");
  await adminDb.runTransaction(async tx => {
    const current = (await tx.get(ref)).data();
    if (current?.refreshUntil > Date.now()) throw new CustomerAccountError(409, "refresh_pending", "Your account is reconnecting. Please try again.");
    if (current?.encrypted !== snap.data()?.encrypted) throw new CustomerAccountError(409, "refresh_pending", "Your account has refreshed. Please try again.");
    tx.update(ref, { refreshLease: lease, refreshUntil: Date.now() + 30000 });
  });
  try {
    const renewed = await tokenRequest({ grant_type: "refresh_token", refresh_token: session.refreshToken });
    session = { ...renewed, refreshToken: renewed.refreshToken || session.refreshToken, customerId: session.customerId };
    await adminDb.runTransaction(async tx => {
      const current = (await tx.get(ref)).data();
      if (current?.refreshLease !== lease) throw new CustomerAccountError(409, "refresh_pending", "Please try again.");
      tx.set(ref, { encrypted: sealCustomerSession(session), updatedAt: Date.now() });
    });
    return session;
  } finally {
    await adminDb.runTransaction(async tx => {
      const current = (await tx.get(ref)).data();
      if (current?.refreshLease === lease) tx.update(ref, { refreshUntil: 0, refreshLease: null });
    });
  }
}
export async function getCustomerOutfitContracts(uid: string) {
  const session = await getLinkedCustomerSession(uid);
  const profile = (await adminDb.collection("users").doc(uid).get()).data();
  if (String(profile?.shopify_customer_id).split("/").pop() !== session.customerId.split("/").pop()) {
    throw new CustomerAccountError(403, "account_mismatch", "Reconnect the Shopify account used at checkout.");
  }
  const contracts: CustomerContract[] = [];
  let after: string | null = null;
  for (let page = 0; page < 20; page++) {
    const data: { customer: { id: string; subscriptionContracts: { nodes: CustomerContract[]; pageInfo: { hasNextPage: boolean; endCursor: string | null } } } } =
      await customerGraphQL(session.accessToken, CUSTOMER_CONTRACTS_QUERY, { after });
    if (data.customer.id !== session.customerId) throw new CustomerAccountError(403, "account_mismatch", "The Shopify account does not match.");
    contracts.push(...data.customer.subscriptionContracts.nodes.filter(isOutfitContract));
    if (!data.customer.subscriptionContracts.pageInfo.hasNextPage) return { contracts, session };
    after = data.customer.subscriptionContracts.pageInfo.endCursor;
    if (!after) break;
  }
  throw new CustomerAccountError(502, "incomplete_results", "We could not load all your subscriptions. Please contact Mully.");
}
