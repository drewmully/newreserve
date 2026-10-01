import { createRequire } from "node:module";
import { runHistoryReportStep } from "./historyReportBridge";
import { PILOT_FINANCIAL_QUERY, PILOT_REFUND_QUERY } from "./shopifyPilotSource";
import { SHOPIFY_FINANCIAL_ORDER_QUERY, SHOPIFY_FINANCIAL_CUSTOMER_QUERY } from "./shopifySource";

type Manifest = {
  approvalId: string; operatorRef: string;
  scope: { jobId: string; expiresAt: string; appId: string; installationId: string };
  report: { runId: string; expiresAt: string; includeCustomerId: boolean;
    queries: { order: string; financial: string; refund: string } };
};
const contract = createRequire(import.meta.url)("../../../scripts/analytics/history-target-contract.cjs") as {
  PROJECT: string; SHOP: string; VERSION: string;
  validateManifest: (m: unknown, env: Record<string, string | undefined>, phase: string) => unknown;
  identity: (data: unknown, m: Manifest, customer: boolean) => void;
};
const project = contract.PROJECT, shop = contract.SHOP;
const identityQuery = `query HistoryTargetIdentity {
  shop { myshopifyDomain } currentAppInstallation { id app { id } accessScopes { handle } }
}`;
export const historyTargetReportQueries = (includeCustomerId: boolean) => ({
  order: includeCustomerId ? SHOPIFY_FINANCIAL_CUSTOMER_QUERY : SHOPIFY_FINANCIAL_ORDER_QUERY,
  financial: PILOT_FINANCIAL_QUERY, refund: PILOT_REFUND_QUERY,
});
export type HistoryTargetReportConfig = {
  enabled: boolean; runId: string; maxSteps: number; maxProviderRequests: number;
};
/** Finite private operator. SQL supplies authority and owns leases/budgets/hash/replay.
 * This only drives existing 041 steps, never registers, enables or publishes them.
 */
export async function runHistoryTargetReportOperator(
  env: Record<string, string | undefined>, config: HistoryTargetReportConfig,
  request: typeof fetch = fetch, stop?: AbortSignal,
) {
  if (config.enabled !== true) return { status: "disabled" };
  if (Object.keys(config).sort().join(",") !== "enabled,maxProviderRequests,maxSteps,runId" ||
    !/^[a-zA-Z0-9_-]{1,100}$/.test(config.runId) ||
    env.LEAN_ANALYTICS_PIPELINE_PROJECT_REF !== project || env.LEAN_SHOPIFY_SHOP_DOMAIN !== shop ||
    env.LEAN_ANALYTICS_SUPABASE_URL !== `https://${project}.supabase.co` ||
    !env.LEAN_ANALYTICS_SUPABASE_SERVICE_ROLE_KEY?.trim() || !env.LEAN_SHOPIFY_ANALYTICS_READ_TOKEN?.trim() ||
    !env.LEAN_HISTORY_TARGET_OPERATOR_REF?.trim() ||
    !Number.isInteger(config.maxSteps) || config.maxSteps < 1 || config.maxSteps > 100 ||
    !Number.isInteger(config.maxProviderRequests) || config.maxProviderRequests < 1 || config.maxProviderRequests > 800)
    throw new Error("history_target_operator_scope");
  const started = Date.now(), deadline = AbortSignal.any([AbortSignal.timeout(540000), ...(stop ? [stop] : [])]);
  const sourceUrl = `https://${shop}/admin/api/2026-07/graphql.json`;
  const base = `https://${project}.supabase.co/rest/v1/rpc/`;
  const allowedRpc = ["lean_history_target_authority", "lean_history_report_claim",
    "lean_history_report_retain", "lean_history_report_order", "lean_history_report_day"];
  let calls = 0, rpcs = 0, sourceBytes = 0, dbBytes = 0, steps = 0, last = "not_started";
  let manifest: Manifest;
  async function transport(url: string, init: RequestInit, source: boolean) {
    deadline.throwIfAborted();
    if (source ? ++calls > config.maxProviderRequests : ++rpcs > 6000)
      throw new Error("history_target_request_budget");
    const size = Buffer.byteLength(String(init.body ?? ""));
    dbBytes += source ? 0 : size;
    if (size > 20000000 || dbBytes > 268435456) throw new Error("history_target_byte_budget");
    const expiry = manifest ? Date.parse(manifest.report.expiresAt) - Date.now() : 540000;
    if (expiry <= 0) throw new Error("history_target_approval_expired");
    const signal = AbortSignal.any([deadline, AbortSignal.timeout(Math.min(20000, expiry)),
      ...(init.signal ? [init.signal] : [])]);
    const response = await request(url, { ...init, redirect: "error", signal });
    if (!response.ok) throw new Error("history_target_transport_failed");
    if (source && response.headers.get("X-Shopify-API-Version") !== contract.VERSION)
      throw new Error("history_target_api_version");
    const reader = response.body?.getReader(); if (!reader) throw new Error("history_target_empty");
    const chunks: Uint8Array[] = []; let bytes = 0;
    const cancel = () => { void reader.cancel().catch(() => {}); };
    signal.addEventListener("abort", cancel, { once: true });
    try {
      for (;;) {
        signal.throwIfAborted(); const p = await reader.read(); signal.throwIfAborted();
        if (p.done) break;
        bytes += p.value.length;
        if (source) sourceBytes += p.value.length; else dbBytes += p.value.length;
        if (bytes > 20000000 || sourceBytes > 67108864 || dbBytes > 268435456)
          throw new Error("history_target_byte_budget");
        chunks.push(p.value);
      }
    } finally { signal.removeEventListener("abort", cancel); await reader.cancel().catch(() => {}); }
    return new Response(Buffer.concat(chunks), { status: response.status, headers: response.headers });
  }
  async function rpc(name: string, args: Record<string, unknown>) {
    if (!allowedRpc.includes(name) || args.p_project !== project ||
      (name === "lean_history_target_authority" ? args.p_id !== config.runId : args.p_run !== config.runId))
      throw new Error("history_target_rpc_binding");
    return (await transport(base + name, {
      method: "POST", headers: { "Content-Type": "application/json",
        apikey: env.LEAN_ANALYTICS_SUPABASE_SERVICE_ROLE_KEY!,
        Authorization: `Bearer ${env.LEAN_ANALYTICS_SUPABASE_SERVICE_ROLE_KEY}` }, body: JSON.stringify(args),
    }, false)).json();
  }
  async function authority() {
    const m = await rpc("lean_history_target_authority", { p_kind: "report", p_id: config.runId,
      p_project: project, p_operator: env.LEAN_HISTORY_TARGET_OPERATOR_REF }) as Manifest;
    contract.validateManifest(m, env, "report");
    const queries = historyTargetReportQueries(m.report.includeCustomerId);
    if (m.report.runId !== config.runId || typeof m.report.includeCustomerId !== "boolean" ||
      Object.keys(queries).some(k => queries[k as keyof typeof queries] !== m.report.queries[k as keyof typeof queries]))
      throw new Error("history_target_query_projection");
    if (manifest && manifest.approvalId !== m.approvalId) throw new Error("history_target_approval_changed");
    manifest = m;
  }
  await authority();
  const bounded: typeof fetch = async (url, init) => {
    if (String(url) !== sourceUrl || init?.method !== "POST" || typeof init.body !== "string")
      throw new Error("history_target_source_destination");
    const body = JSON.parse(init.body);
    if (!Object.values(manifest.report.queries).includes(body.query))
      throw new Error("history_target_query_projection");
    await authority();
    return transport(sourceUrl, init, true);
  };
  const client = { async rpc(name: string, args: Record<string, unknown>) {
    await authority();
    const data = await rpc(name, args);
    if (name === "lean_history_report_claim" && data.state === "order") {
      if (data.shop !== shop || data.includeCustomerId !== manifest.report.includeCustomerId ||
        data.sourceJob !== manifest.scope.jobId) throw new Error("history_target_claim_binding");
      if (data.canRead === true && data.source === null && data.lineCount <= 500) {
        await authority();
        const response = await transport(sourceUrl, {
          method: "POST", headers: { "Content-Type": "application/json",
            "X-Shopify-Access-Token": env.LEAN_SHOPIFY_ANALYTICS_READ_TOKEN! },
          body: JSON.stringify({ query: identityQuery, variables: {} }),
        }, true);
        const body = await response.json();
        if (body.errors !== undefined && (!Array.isArray(body.errors) || body.errors.length))
          throw new Error("history_target_identity_failed");
        contract.identity(body.data, manifest, manifest.report.includeCustomerId);
      }
    }
    return { data, error: null };
  } };
  while (steps < config.maxSteps && Date.now() - started < 480000 && calls + 8 <= config.maxProviderRequests &&
    sourceBytes + 8388608 <= 67108864 && dbBytes + 48000000 <= 268435456) {
    deadline.throwIfAborted();
    const result = await runHistoryReportStep({ projectRef: project, databaseUrl: `https://${project}.supabase.co`,
      runId: config.runId, accessToken: env.LEAN_SHOPIFY_ANALYTICS_READ_TOKEN!, fetcher: bounded, client });
    steps++; last = result.state;
    if (!["order_written", "report_written"].includes(last)) break;
  }
  return { status: last === "complete" ? "complete_unverified" : "bounded_step_finished",
    lastState: last, steps, providerRequests: calls, databaseRequests: rpcs, sourceBytes, databaseBytes: dbBytes, certified: false };
}
