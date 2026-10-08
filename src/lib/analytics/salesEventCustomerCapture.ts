import { createHash } from "node:crypto";
import { readCustomerScopedPurchases, CUSTOMER_PURCHASE_ACCESS_QUERY } from "./customerScopedPurchaseSource";
import { compileCustomerCyclePacket, type CustomerSourceCycle, type CustomerCycleIdentityReceipt } from "./customerScopedPurchasePacket";
import { compileCustomerOperationPacket, validateCustomerSourceOperation, type CustomerSourceOperation } from "./customerScopedPurchaseOperation";
import { SCOPED_CUSTOMER_DEFINITION, SCOPED_CUSTOMER_BUSINESS_EVIDENCE } from "./customerScopedPurchaseConsumer";
import { prepareSalesEventWindow, type SalesEventWindowInput } from "./salesEventWindowInput";
import { sourceArray, sourceObject, sourceString, shopifyId } from "./shopifySource";
import { evidenceDigest } from "./evidenceIntake";
const hash = (v: string | Buffer) => createHash("sha256").update(v).digest("hex");

/** The operator must verify actual emitted-file hashes before invoking this
 * helper. It never asserts those hashes from a credential or an old bundle.
 * No retained anchors: all documents are freshly read and revisions compared.
 */
export async function captureSalesEventCustomers(options: {
  source: SalesEventWindowInput; accessToken: string;
  fetcher?: typeof fetch; now?: () => string;
} & ({ cycle: CustomerSourceCycle; operation?: never } | { operation: CustomerSourceOperation; cycle?: never })) {
  const clock = options.now ?? (() => new Date().toISOString()), began = clock();
  let requests = 0, responseBytes = 0, largestResponseBytes = 0;
  let identity: CustomerCycleIdentityReceipt | null = null, stage = "scope";
  try {
    if (Object.hasOwn(options, "operation") && Object.hasOwn(options, "cycle")) throw Error();
    if (Object.hasOwn(options, "operation")) validateCustomerSourceOperation(options.operation!);
    const c = options.operation ?? options.cycle;
    const captureId = options.operation ? options.operation.operationId : options.cycle.cycleId;
    if (c.maxRequests !== 65 || c.maxResponseBytes !== 1048576 || c.maxTotalBytes !== 16777216 || c.maxActiveMs !== 120000 ||
        c.projectRef !== options.source.scope.projectRef || c.shop !== options.source.scope.shop ||
        c.reportDate !== options.source.scope.fromDate || c.reportDate !== options.source.scope.throughDate ||
        Date.parse(began) < Date.parse(c.startedAt) || Date.parse(began) >= Date.parse(c.deadline) ||
        Date.parse(c.deadline) - Date.parse(c.startedAt) > 300000 || !options.accessToken.trim()) throw Error();
    const prepared = prepareSalesEventWindow(options.source, { ...options.source.scope,
      publication: `private:${captureId}`, asOf: began });
    const originals = prepared.paidWindowProof.originalOrderGids;
    if (!originals.length) return { state: "not_required" as const, requests: 0 };
    const members = new Map<string, string[]>();
    for (const row of prepared.sourceRows.filter(r => originals.includes(String(r.source.commerce.order.id)))) {
      const customer = sourceString(sourceObject(row.source.commerce.order.customer).id);
      shopifyId(customer, "Customer");
      members.set(customer, [...members.get(customer) ?? [], String(row.source.commerce.order.id)]);
    }
    if (members.size > 4) throw Error();
    const signal = AbortSignal.timeout(Math.ceil(Math.min(c.maxActiveMs, Date.parse(c.deadline) - Date.parse(began))));
    const fetcher: typeof fetch = async (url, init) => {
      signal.throwIfAborted();
      if (++requests > c.maxRequests || String(url) !== `https://${c.shop}/admin/api/2026-07/graphql.json` || init?.method !== "POST") throw Error();
      const startedAt = clock();
      const response = await (options.fetcher ?? fetch)(url, { ...init, redirect: "error",
        signal: AbortSignal.any([signal, ...(init.signal ? [init.signal] : [])]) });
      const reader = response.body?.getReader(); if (!reader || !response.ok) throw Error();
      const chunks: Uint8Array[] = []; let size = 0;
      const cancel = () => { void reader.cancel().catch(() => {}); };
      signal.addEventListener("abort", cancel, { once: true });
      try {
        for (;;) {
          signal.throwIfAborted(); const part = await reader.read(); signal.throwIfAborted(); if (part.done) break;
          size += part.value.length; responseBytes += part.value.length;
          if (size > c.maxResponseBytes || responseBytes > c.maxTotalBytes) throw Error();
          chunks.push(part.value);
        }
      } finally { signal.removeEventListener("abort", cancel); await reader.cancel().catch(() => {}); reader.releaseLock(); }
      largestResponseBytes = Math.max(largestResponseBytes, size);
      const bytes = Buffer.concat(chunks), request = sourceObject(JSON.parse(String(init.body)));
      if (bytes.includes(Buffer.from(options.accessToken))) throw Error();
      if (request.query === CUSTOMER_PURCHASE_ACCESS_QUERY && !identity) {
        if (requests !== 1 || response.headers.get("X-Shopify-API-Version") !== "2026-07") throw Error();
        const body = sourceObject(JSON.parse(bytes.toString("utf8"))), data = sourceObject(body.data);
        if (body.errors !== undefined && (!Array.isArray(body.errors) || body.errors.length)) throw Error();
        const app = sourceObject(data.currentAppInstallation), handles = new Set(sourceArray(app.accessScopes)
          .map(s => sourceString(sourceObject(s).handle)));
        identity = { startedAt, finishedAt: clock(), querySha256: hash(CUSTOMER_PURCHASE_ACCESS_QUERY),
          requestBodySha256: hash(String(init.body)), responseBodySha256: hash(bytes), httpStatus: 200, apiVersion: "2026-07",
          shop: sourceString(sourceObject(data.shop).myshopifyDomain), appId: sourceString(sourceObject(app.app).id),
          installationId: sourceString(app.id), capabilities: { read_orders: handles.has("read_orders"),
            write_orders: handles.has("write_orders"), read_all_orders: handles.has("read_all_orders"),
            read_customers: handles.has("read_customers"), read_products: handles.has("read_products") } };
      }
      return new Response(bytes, { status: response.status, headers: response.headers });
    };
    stage = "customer_source";
    const source = await readCustomerScopedPurchases({ accessToken: options.accessToken, fetcher, signal, now: clock,
      plan: { projectRef: c.projectRef as "xnfjdbpjuaezxjgargto", shop: c.shop as "mullybox-store.myshopify.com",
        authorizationRef: c.authorizationRef, appId: c.appId, installationId: c.installationId,
        expiresAt: c.deadline, members: [...members].map(([customerGid, anchorOrderGids]) => ({ customerGid, anchorOrderGids })),
        maxRequests: 64, maxBytes: c.maxTotalBytes } });
    if (!identity) throw Error();
    // Complete customer membership must still refer to the actual new anchor
    // document, not merely the same order ID with an old revision.
    for (const row of prepared.sourceRows.filter(r => originals.includes(String(r.source.commerce.order.id)))) {
      const actual = source.members.flatMap(m => m.sources).find(s => s.document.order.id === row.source.commerce.order.id);
      if (!actual || evidenceDigest(actual.document) !== evidenceDigest(row.source.commerce)) throw Error();
    }
    stage = "packet";
    const packetInput = { source, identityReceipt: identity,
      sharedUsage: { requests, responseBytes, largestResponseBytes, activeMs: Date.parse(clock()) - Date.parse(began) },
      definition: { definition: SCOPED_CUSTOMER_DEFINITION, businessEvidence: SCOPED_CUSTOMER_BUSINESS_EVIDENCE } as const };
    const customers = options.operation
      ? compileCustomerOperationPacket({ ...packetInput, operation: options.operation })
      : compileCustomerCyclePacket({ ...packetInput, cycle: options.cycle });
    const result = { state: "source_complete" as const, customers, startedAt: began, finishedAt: clock(),
      requests, responseBytes, largestResponseBytes, sourceOnly: true, enabled: false, registered: false };
    if (JSON.stringify(result).includes(options.accessToken)) throw Error();
    return result;
  } catch {
    return { state: "held" as const, stage, startedAt: began, finishedAt: clock(), requests,
      responseBytes, largestResponseBytes, sourceOnly: true, enabled: false, registered: false };
  }
}
