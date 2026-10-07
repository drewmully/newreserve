import { timingSafeEqual } from "node:crypto";
import { captureGoogleAutomatic, type GoogleCaptureClaim } from "./googleAutomaticCapture";
import { googleSpendAuthFromEnv } from "./googleSpendSource";
import { boundedPipelineClient, pipelineRpc } from "./shopifyPipeline";
import type { AnalyticsRpcClient } from "./rpcStore";
import { sourceObject } from "./shopifySource";

const project = "xnfjdbpjuaezxjgargto";
const path = "/api/analytics/ingest/google-commission";
const headers = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
const fail = () => Response.json({ state: "unavailable" }, { status: 503, headers });
const same = (a: string, b: string) => Buffer.byteLength(a) === Buffer.byteLength(b) &&
  timingSafeEqual(Buffer.from(a), Buffer.from(b));

/** A single commissioning capture, not standing operation or registration.
 * The database consumes authority before native I/O. An uncertain response is
 * never retried, reset, failed over to another credential, or reported as zero.
 */
export async function googleCommissioningPost(req: Request, env: Record<string, string | undefined>,
  rawClient: AnalyticsRpcClient, request: typeof fetch = fetch) {
  if (env.LEAN_GOOGLE_COMMISSION_ENABLED !== "true" || env.VERCEL_ENV !== "production" ||
    env.VERCEL_GIT_COMMIT_REF !== "main") return new Response(null, { status: 404, headers });
  const url = new URL(req.url);
  if (req.method !== "POST" || url.pathname !== path || url.search) return new Response(null, { status: 400, headers });
  const secret = env.LEAN_GOOGLE_COMMISSION_SECRET ?? "";
  if (!/^[!-~]{32,512}$/.test(secret) || [env.LEAN_GOOGLE_AUTOMATIC_PRODUCER_SECRET,
    env.LEAN_GOOGLE_AUTOMATIC_OBSERVER_SECRET, env.LEAN_ANALYTICS_FULL_SECRET,
    env.LEAN_GOOGLE_DELIVERY_SECRET, env.LEAN_ANALYTICS_MONITOR_SECRET]
    .some(s => s !== undefined && s === secret)) return fail();
  if (!same(req.headers.get("authorization") ?? "", `Bearer ${secret}`))
    return new Response(null, { status: 401, headers });
  const grant = env.LEAN_GOOGLE_COMMISSION_GRANT_ID ?? "", revision = env.LEAN_GOOGLE_COMMISSION_REVISION ?? "";
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(grant) || !/^[1-9]\d{0,18}$/.test(revision) ||
    BigInt(revision) > BigInt("9223372036854775807") || env.LEAN_ANALYTICS_PIPELINE_PROJECT_REF !== project ||
    env.LEAN_ANALYTICS_SUPABASE_URL !== `https://${project}.supabase.co`) return fail();
  const signal = AbortSignal.any([req.signal, AbortSignal.timeout(85000)]);
  const client = boundedPipelineClient(rawClient, signal);
  try {
    const reader = req.body?.getReader();
    if (!reader) throw new Error("commission_body");
    let size = 0; const chunks: Uint8Array[] = [];
    let rejectAbort: (reason: Error) => void = () => {};
    const aborted = new Promise<never>((_, reject) => { rejectAbort = reject; });
    void aborted.catch(() => {});
    const onAbort = () => rejectAbort(new Error("commission_abort"));
    signal.addEventListener("abort", onAbort, { once: true });
    try {
      for (;;) {
        signal.throwIfAborted();
        const part = await Promise.race([reader.read(), aborted]);
        signal.throwIfAborted();
        if (part.done) break;
        size += part.value.length;
        if (size > 256) throw new Error("commission_body_budget");
        chunks.push(part.value);
      }
    } finally { signal.removeEventListener("abort", onAbort); void reader.cancel().catch(() => {}); reader.releaseLock(); }
    const input = sourceObject(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks))));
    if (Object.keys(input).length !== 1 || input.action !== "capture") throw new Error("commission_action");
    const auth = googleSpendAuthFromEnv(env), developerToken = env.LEAN_GOOGLE_ADS_DEVELOPER_TOKEN ?? "";
    if (auth.mode !== "service_account" || !auth.serviceAccountJsonBase64 || !auth.subject || !developerToken.trim())
      throw new Error("commission_credentials");
    const args = { p_grant: grant, p_revision: revision, p_capability: secret };
    const claim = sourceObject(await pipelineRpc(client, "lean_google_commission_claim", args));
    if (claim.state !== "capture" || claim.grantId !== grant || claim.revision !== revision ||
      claim.projectRef !== project || claim.shop !== "mullybox-store.myshopify.com" ||
      claim.accountId !== "4335795219" || claim.loginCustomerId !== "9552995078" ||
      !Number.isInteger(claim.sourceDeadlineSeconds) || Number(claim.sourceDeadlineSeconds) < 1 ||
      Number(claim.sourceDeadlineSeconds) > 60 ||
      ![claim.startedAt, claim.deadline, claim.expiresAt].every(v => typeof v === "string" &&
        /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(v) && Number.isFinite(Date.parse(v))) ||
      Date.parse(String(claim.startedAt)) > Date.now() ||
      Date.parse(String(claim.deadline)) - Date.parse(String(claim.startedAt)) > 80000 ||
      Date.parse(String(claim.deadline)) > Date.parse(String(claim.expiresAt)))
      throw new Error("commission_claim_binding");
    const capture = await captureGoogleAutomatic(claim as unknown as GoogleCaptureClaim,
      auth, developerToken, request, signal);
    signal.throwIfAborted();
    // No capture or credential material is returned by this endpoint. The
    // unchanged reader validates all aggregate columns before private storage.
    const result = sourceObject(await pipelineRpc(client, "lean_google_commission_commit", { ...args, p_capture: capture }));
    if (result.state !== "captured" || result.grantId !== grant || result.revision !== revision ||
      result.cycleId !== claim.cycleId || typeof result.captureSha256 !== "string" ||
      !/^[a-f0-9]{64}$/.test(result.captureSha256) || result.registered !== false || result.selected !== false)
      throw new Error("commission_commit_response");
    return Response.json({ state: "captured", grantId: grant, revision, cycleId: result.cycleId,
      captureSha256: result.captureSha256, registered: false, selected: false }, { headers });
  } catch { return fail(); }
}
