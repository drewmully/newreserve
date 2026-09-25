import type { AnalyticsRpcClient } from "./rpcStore";
import { pipelineRpc, validatePipelineTarget } from "./shopifyPipeline";
import { sourceObject, sourceString } from "./shopifySource";
import { runGoogleSpendJob } from "./googleSpendJob";
import type { GoogleSpendAuth } from "./googleSpendSource";

/** A single shared transport budget: OAuth + metadata + at most five pages.
 * Stream bytes before parsing, reject redirects/other hosts and late success.
 */
export function boundedGooglePilotFetch(accountId: string, signal: AbortSignal, fetcher: typeof fetch = fetch): typeof fetch {
  if (!/^\d{10}$/.test(accountId)) throw new Error("spend_pilot_invalid_account");
  let requests = 0, bytes = 0;
  const allowed = new Set(["https://oauth2.googleapis.com/token",
    `https://googleads.googleapis.com/v25/customers/${accountId}/googleAds:search`]);
  return async (url, init) => {
    signal.throwIfAborted();
    if (!allowed.has(String(url)) || init?.method !== "POST" || ++requests > 7)
      throw new Error("spend_pilot_transport_scope");
    const active = AbortSignal.any([signal, ...(init.signal ? [init.signal] : [])]);
    const response = await fetcher(url, { ...init, redirect: "error", signal: active });
    active.throwIfAborted();
    if (!response.ok) throw new Error("spend_pilot_http_failed");
    const reader = response.body?.getReader();
    if (!reader) throw new Error("spend_pilot_missing_body");
    const chunks: Uint8Array[] = [];
    let responseBytes = 0;
    const cancel = () => { void reader.cancel().catch(() => {}); };
    active.addEventListener("abort", cancel, { once: true });
    try {
      while (true) {
        active.throwIfAborted();
        const part = await reader.read();
        active.throwIfAborted();
        if (part.done) break;
        bytes += part.value.byteLength; responseBytes += part.value.byteLength;
        if (bytes > 32 * 1024 * 1024 || responseBytes > 8 * 1024 * 1024)
          throw new Error("spend_pilot_byte_budget");
        chunks.push(part.value);
      }
      return new Response(Buffer.concat(chunks), { status: response.status, headers: response.headers });
    } finally {
      active.removeEventListener("abort", cancel);
      await reader.cancel().catch(() => {});
    }
  };
}

export async function advanceGoogleSpendPilot(input: {
  client: AnalyticsRpcClient; projectRef: string; databaseUrl: string; pilotId: string;
  auth: GoogleSpendAuth; developerToken?: string; now: string; signal: AbortSignal; fetcher?: typeof fetch;
}) {
  validatePipelineTarget(input.projectRef, input.databaseUrl);
  if (!input.pilotId.trim() || input.pilotId.length > 128) throw new Error("spend_pilot_missing_id");
  input.signal.throwIfAborted();
  const next = sourceObject(await pipelineRpc(input.client, "lean_spend_pilot_next", {
    p_pilot: input.pilotId, p_project_ref: input.projectRef,
  }));
  input.signal.throwIfAborted();
  if (["disabled", "expired", "complete", "not_due", "busy", "blocked"].includes(String(next.state)))
    return { state: String(next.state) };
  if (next.state !== "ready") throw new Error("spend_pilot_invalid_next");
  // Do not begin a claim or final write after the shared invocation deadline.
  // SQL separately fences the original lease and absolute manifest expiry.
  const client: AnalyticsRpcClient = { async rpc(name, args) {
    if (name !== "lean_spend_fail") input.signal.throwIfAborted();
    return input.client.rpc(name, args);
  } };
  return runGoogleSpendJob({ ...input, client, runId: sourceString(next.runId),
    fetcher: boundedGooglePilotFetch(sourceString(next.accountId), input.signal, input.fetcher) });
}
