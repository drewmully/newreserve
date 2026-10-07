import { timingSafeEqual } from "node:crypto";
import { googleSpendAuthFromEnv, authorizeGoogleSpend, GOOGLE_ACCOUNT_QUERY, GOOGLE_ADS_VERSION } from "./googleSpendSource";
import { captureGoogleAutomatic, googleAutomaticDigest, type GoogleCaptureClaim } from "./googleAutomaticCapture";
import { pipelineRpc } from "./shopifyPipeline";
import type { AnalyticsRpcClient } from "./rpcStore";
import { sourceObject, sourceString } from "./shopifySource";
import { observeGoogleAutomatic } from "./googleAutomaticObserver";
import { prepareAutomaticMeta } from "./googleAutomaticMeta";

const project = "xnfjdbpjuaezxjgargto", uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const headers = { "Cache-Control": "no-store" };
const unavailable = () => Response.json({ state: "unavailable" }, { status: 503, headers });
const same = (a: string, b: string) => Buffer.byteLength(a) === Buffer.byteLength(b) &&
  timingSafeEqual(Buffer.from(a), Buffer.from(b));

/** Explicit setup source. Never use aliases, OAuth fallback or dedicated copies. */
export function googleAutomaticSetupCredentials(env: Record<string, string | undefined>) {
  const serviceAccountJsonBase64 = env.GOOGLE_ADS_SERVICE_ACCOUNT_JSON_BASE64 ?? "";
  const subject = env.GOOGLE_ADS_IMPERSONATE_EMAIL;
  const developerToken = env.GOOGLE_ADS_DEVELOPER_TOKEN ?? "";
  if (!serviceAccountJsonBase64 || serviceAccountJsonBase64.length > 32768 ||
    !developerToken.trim() || !subject || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(subject))
    throw new Error("automatic_setup_unconfigured");
  const account = sourceObject(JSON.parse(Buffer.from(serviceAccountJsonBase64, "base64").toString("utf8")));
  if (account.type !== "service_account" || !sourceString(account.client_email).includes("@") ||
    !sourceString(account.private_key).startsWith("-----BEGIN PRIVATE KEY-----"))
    throw new Error("automatic_setup_identity");
  const auth = { mode: "service_account" as const, serviceAccountJsonBase64, subject };
  return { auth, developerToken, credentialSha256: googleAutomaticDigest({ auth, developerToken }),
    identitySha256: googleAutomaticDigest({ serviceAccount: account.client_email, subject }) };
}

async function boundedJson(response: Response, limit: number, signal: AbortSignal, countBytes?: (n: number) => void) {
  if (!response.ok || !response.body) throw new Error("automatic_transport");
  const reader = response.body.getReader(), chunks: Uint8Array[] = []; let bytes = 0;
  try {
    for (;;) {
      signal.throwIfAborted(); const part = await reader.read(); signal.throwIfAborted();
      if (part.done) break;
      bytes += part.value.length; if (bytes > limit) throw new Error("automatic_response_budget");
      countBytes?.(part.value.length);
      chunks.push(part.value);
    }
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)));
  } finally { void reader.cancel().catch(() => {}); reader.releaseLock(); }
}

/** One-use fixed metadata read. No campaign query, no aggregate and no token output. */
async function nativeSetup(binding: Record<string, unknown>, env: Record<string, string | undefined>,
  request: typeof fetch, signal: AbortSignal) {
  const accountId = sourceString(binding.accountId), loginCustomerId = sourceString(binding.loginCustomerId);
  if (!/^\d{10}$/.test(accountId) || !/^\d{10}$/.test(loginCustomerId)) throw new Error("setup_account");
  const { auth, developerToken, credentialSha256, identitySha256 } = googleAutomaticSetupCredentials(env);
  let requests = 0, bytes = 0;
  const bounded: typeof fetch = async (url, init) => {
    const target = String(url);
    if (++requests > 2 || init?.method !== "POST" || ![
      "https://oauth2.googleapis.com/token",
      `https://googleads.googleapis.com/${GOOGLE_ADS_VERSION}/customers/${accountId}/googleAds:search`,
    ].includes(target)) throw new Error("setup_request_scope");
    const body = await boundedJson(await request(url, { ...init, redirect: "error", signal }),
      32768 - bytes, signal, n => { bytes += n; });
    return Response.json(body);
  };
  const accessToken = await authorizeGoogleSpend({ auth, developerToken, fetcher: bounded, signal });
  const response = await bounded(`https://googleads.googleapis.com/${GOOGLE_ADS_VERSION}/customers/${accountId}/googleAds:search`, {
    method: "POST", redirect: "error", signal,
    headers: { Authorization: `Bearer ${accessToken}`, "developer-token": developerToken,
      "login-customer-id": loginCustomerId, "Content-Type": "application/json" },
    body: JSON.stringify({ query: GOOGLE_ACCOUNT_QUERY }),
  });
  const body = sourceObject(await boundedJson(response, 32768, signal));
  if (body.error || body.nextPageToken || !Array.isArray(body.results) || body.results.length !== 1)
    throw new Error("setup_metadata_shape");
  const customer = sourceObject(sourceObject(body.results[0]).customer);
  if (customer.id !== accountId || customer.currencyCode !== "USD" || customer.timeZone !== "America/New_York")
    throw new Error("setup_metadata_mismatch");
  return { accountId, loginCustomerId, currency: "USD", timezone: "America/New_York",
    credentialBindingRef: sourceString(binding.credentialBindingRef),
    credentialSha256, identitySha256, authMode: "service_account",
    credentialSource: "GOOGLE_ADS_SERVICE_ACCOUNT_JSON_BASE64/GOOGLE_ADS_IMPERSONATE_EMAIL/GOOGLE_ADS_DEVELOPER_TOKEN",
    transport: "native_google_ads", capturedAt: new Date().toISOString() };
}

/** Fixed private scope. No caller-supplied provider credentials, SQL, template,
 * completed flags, source rows, arbitrary run IDs or registration payloads. */
export async function googleAutomaticPost(req: Request, env: Record<string, string | undefined>,
  rawClient: AnalyticsRpcClient, request: typeof fetch = fetch) {
  if (env.LEAN_GOOGLE_AUTOMATIC_ENABLED !== "true" || env.VERCEL_ENV !== "production" ||
    env.VERCEL_GIT_COMMIT_REF !== "main") return new Response(null, { status: 404, headers });
  if (req.method !== "POST" || new URL(req.url).search) return new Response(null, { status: 400, headers });
  const producer = env.LEAN_GOOGLE_AUTOMATIC_PRODUCER_SECRET ?? "", observer = env.LEAN_GOOGLE_AUTOMATIC_OBSERVER_SECRET ?? "";
  if (![producer, observer].every(s => /^[!-~]{32,512}$/.test(s)) || producer === observer ||
    [env.LEAN_ANALYTICS_FULL_SECRET, env.LEAN_GOOGLE_DELIVERY_SECRET, env.LEAN_ANALYTICS_MONITOR_SECRET]
      .some(s => s !== undefined && (s === producer || s === observer))) return unavailable();
  const auth = req.headers.get("authorization") ?? "";
  const isProducer = same(auth, `Bearer ${producer}`), isObserver = same(auth, `Bearer ${observer}`);
  if (!isProducer && !isObserver) return new Response(null, { status: 401, headers });
  const grant = env.LEAN_GOOGLE_AUTOMATIC_GRANT_ID ?? "", revision = env.LEAN_GOOGLE_AUTOMATIC_GRANT_REVISION ?? "";
  if (env.LEAN_ANALYTICS_PIPELINE_PROJECT_REF !== project ||
    env.LEAN_ANALYTICS_SUPABASE_URL !== `https://${project}.supabase.co`) return unavailable();
  const signal = AbortSignal.any([req.signal, AbortSignal.timeout(85000)]);
  const client: AnalyticsRpcClient = { rpc(name, parameters) {
    signal.throwIfAborted();
    const result = rawClient.rpc(name, parameters) as ReturnType<AnalyticsRpcClient["rpc"]> & {
      abortSignal?: (s: AbortSignal) => ReturnType<AnalyticsRpcClient["rpc"]>;
    };
    if (!result.abortSignal) throw new Error("automatic_rpc_transport");
    return result.abortSignal(signal);
  } };
  try {
    const input = sourceObject(await boundedJson(new Response(req.body), 4194304, signal));
    const action = sourceString(input.action);
    const id = action === "setup" ? env.LEAN_GOOGLE_AUTOMATIC_SETUP_ID ?? "" : grant;
    const rev = action === "setup" ? env.LEAN_GOOGLE_AUTOMATIC_SETUP_REVISION ?? "" : revision;
    if (!/^[A-Za-z0-9_-]{1,100}$/.test(id) || !/^[1-9]\d{0,18}$/.test(rev) ||
      BigInt(rev) > BigInt("9223372036854775807")) throw new Error("automatic_runtime_binding");
    const args = { p_grant: id, p_revision: rev, p_capability: isProducer ? producer : observer };
    let result: unknown;
    if (action === "state" && Object.keys(input).length === 1) {
      result = await pipelineRpc(client, "lean_google_auto_state", { ...args, p_observer: isObserver });
    } else if (isProducer && action === "setup" && Object.keys(input).length === 1) {
      // Validate the exact existing source before consuming one-use setup.
      googleAutomaticSetupCredentials(env);
      const binding = sourceObject(await pipelineRpc(client, "lean_google_auto_setup", args));
      const receipt = await nativeSetup(binding, env, request,
        AbortSignal.any([signal, AbortSignal.timeout(Math.max(1, Date.parse(sourceString(binding.deadline)) - Date.now()))]));
      result = await pipelineRpc(client, "lean_google_auto_setup", { ...args, p_receipt: receipt });
    } else if (isProducer && action === "capture" && Object.keys(input).length === 2 && uuid.test(sourceString(input.cycleId))) {
      const dedicated = googleSpendAuthFromEnv(env), developerToken = env.LEAN_GOOGLE_ADS_DEVELOPER_TOKEN ?? "";
      if (dedicated.mode !== "service_account" || !dedicated.serviceAccountJsonBase64 || !dedicated.subject || !developerToken)
        throw new Error("automatic_native_unconfigured");
      const claimed = sourceObject(await pipelineRpc(client, "lean_google_auto_claim", { ...args, p_cycle: input.cycleId }));
      if (claimed.state !== "capture") result = claimed;
      else {
        const capture = await captureGoogleAutomatic(claimed as unknown as GoogleCaptureClaim,
          dedicated, developerToken, request, signal);
        result = await pipelineRpc(client, "lean_google_auto_commit", { ...args, p_cycle: input.cycleId, p_capture: capture });
      }
    } else if (isProducer && action === "meta_claim" && Object.keys(input).length === 3 &&
      uuid.test(sourceString(input.cycleId)) && uuid.test(sourceString(input.token))) {
      const claim = sourceObject(await pipelineRpc(client, "lean_google_auto_meta",
        { ...args, p_cycle: input.cycleId, p_token: input.token, p_action: "claim" }));
      result = { ...claim, bindingSha256: googleAutomaticDigest(claim.binding) };
    } else if (isProducer && action === "meta_commit" && Object.keys(input).length === 4 &&
      uuid.test(sourceString(input.cycleId)) && uuid.test(sourceString(input.token))) {
      const claim = await pipelineRpc(client, "lean_google_auto_meta",
        { ...args, p_cycle: input.cycleId, p_token: input.token, p_action: "read" });
      const packet = prepareAutomaticMeta(claim, input.captures);
      result = await pipelineRpc(client, "lean_google_auto_meta",
        { ...args, p_cycle: input.cycleId, p_token: input.token, p_action: "commit", p_packet: packet, p_receipts: input.captures });
    } else if (isObserver && action === "observe_claim" && Object.keys(input).length === 3 &&
      uuid.test(sourceString(input.cycleId)) && uuid.test(sourceString(input.token))) {
      result = await pipelineRpc(client, "lean_google_auto_observe_claim",
        { ...args, p_cycle: input.cycleId, p_token: input.token });
    } else if (isObserver && action === "observe_commit" && Object.keys(input).length === 4 &&
      uuid.test(sourceString(input.cycleId)) && uuid.test(sourceString(input.token))) {
      const observations = sourceObject(input.observations);
      if (Object.keys(observations).sort().join(",") !== "jobsAfter,jobsBefore,sourceAfter,sourceBefore,table")
        throw new Error("automatic_raw_observations");
      const claim = await pipelineRpc(client, "lean_google_auto_observation",
        { ...args, p_cycle: input.cycleId, p_token: input.token });
      let sources = 0, jobs = 0;
      const evidence = await observeGoogleAutomatic(claim, {
        source: async () => sources++ === 0 ? observations.sourceBefore : observations.sourceAfter,
        jobs: async () => jobs++ === 0 ? observations.jobsBefore : observations.jobsAfter,
        query: async () => observations.table,
      });
      result = await pipelineRpc(client, "lean_google_auto_observe_commit",
        { ...args, p_cycle: input.cycleId, p_token: input.token, p_evidence: evidence });
    } else return new Response(null, { status: 400, headers });
    signal.throwIfAborted();
    return Response.json(result, { headers });
  } catch { return unavailable(); }
}
