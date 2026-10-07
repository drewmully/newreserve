import { createHash } from "node:crypto";
import { readPilotSource, PILOT_FINANCIAL_QUERY, PILOT_REFUND_QUERY } from "./shopifyPilotSource";
import { readShopifyAgreements, SHOPIFY_AGREEMENTS_QUERY } from "./shopifyAgreements";
import { boundedShopifyPilotFetch } from "./shopifyBoundedPilot";
import { verifyHistoryAccess, HISTORY_ACCESS_QUERY } from "./shopifyHistory";
import { SHOPIFY_FINANCIAL_CUSTOMER_QUERY, shopifyId, shopifyShop, sourceArray, sourceObject } from "./shopifySource";
import { bindSalesEventWindow } from "./salesEventWindowPreparation";
import { paymentEventLocatorQuery, prepareSalesEventWindow, salesEventLocatorQuery,
  type RetainedEventJson, type SalesEventWindowInput, type SalesEventWindowSource } from "./salesEventWindowInput";
import { nyDate } from "./primitives";

/** Server-claimed finite source scope. This type alone is never authority.
 * The restricted registration successor must bind the actual claim row.
 */
export type SalesEventCaptureClaim = {
  cycleId: string; projectRef: string; shop: string; reportDate: string;
  startedAt: string; deadline: string; authorizationRef: string;
  businessPolicy: SalesEventWindowInput["businessPolicy"];
};
export type SalesEventNativeRequest = {
  ordinal: number; startedAt: string; finishedAt: string;
  querySha256: string; variablesSha256: string; requestBodySha256: string;
  responseBodySha256: string; responseBytes: number; httpStatus: number; apiVersion: "2026-07" | null;
};
const hash = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
const revisionQuery = "query AnalyticsAgreementRevision($id: ID!) { order(id: $id) { id updatedAt } }";
const querySet = new Set([HISTORY_ACCESS_QUERY, SHOPIFY_FINANCIAL_CUSTOMER_QUERY,
  PILOT_FINANCIAL_QUERY, PILOT_REFUND_QUERY, SHOPIFY_AGREEMENTS_QUERY, revisionQuery]);
const retain = (value: unknown, ref: string, startedAt: string, finishedAt: string): RetainedEventJson => {
  const json = JSON.stringify(value);
  return { json, sha256: hash(json), evidenceRef: ref, startedAt, finishedAt };
};
function refuse(): never { throw new Error("sales_event_capture_refused"); }
function raw(packet: RetainedEventJson, claim: SalesEventCaptureClaim, now: string) {
  if (typeof packet.json !== "string" || Buffer.byteLength(packet.json) > 2000000 || hash(packet.json) !== packet.sha256 ||
      !packet.evidenceRef?.trim() || Date.parse(packet.startedAt) < Date.parse(claim.startedAt) ||
      Date.parse(packet.finishedAt) < Date.parse(packet.startedAt) || Date.parse(packet.finishedAt) > Date.parse(now)) refuse();
  nyDate(packet.startedAt); nyDate(packet.finishedAt);
  return sourceObject(JSON.parse(packet.json));
}
function completeEnvelope(row: Record<string, unknown>) {
  if (Object.hasOwn(row, "error") && row.error !== null ||
      Object.hasOwn(row, "errors") && (!Array.isArray(row.errors) || row.errors.length) ||
      ["is_error", "isError", "truncated", "is_truncated"].some(k => Object.hasOwn(row, k) && row[k] !== false) ||
      Object.hasOwn(row, "success") && row.success !== true) refuse();
  for (const k of ["structured_content_metadata", "content_metadata"])
    if (Object.hasOwn(row, k)) completeEnvelope(sourceObject(row[k]));
}

/** Fixed query recipe for the existing Shopify connector. The parent/operator
 * retains the real responses and intervals, not an asserted completion boolean.
 * Running this function does not call the connector.
 */
export function salesEventCaptureQueries(reportDate: string) {
  return { sales: salesEventLocatorQuery(reportDate, reportDate),
    payments: paymentEventLocatorQuery(reportDate, 21) };
}

/** One native acquisition attempt after genuine same-cycle connector locators.
 * Credentials stay in memory. No retries, writes, registration or enablement.
 * Existing native readers and their shared 20-request/8MiB/64MiB guards are used
 * unchanged. The four-order preflight bound is 1 scope + at least 4/order;
 * extra refund/agreement reads still consume that SAME request budget.
 */
export async function captureSalesEventWindowOriginals(options: {
  claim: SalesEventCaptureClaim; locator: SalesEventWindowInput["locator"];
  paymentControls: SalesEventWindowInput["paymentControls"];
  accessToken: string; fetcher?: typeof fetch; now?: () => string;
}) {
  const clock = options.now ?? (() => new Date().toISOString()), startedAt = clock();
  const c = options.claim, requests: SalesEventNativeRequest[] = [];
  let attemptedRequests = 0;
  let stage = "claim";
  try {
    shopifyShop(c.shop); nyDate(c.startedAt); nyDate(c.deadline); nyDate(startedAt);
    if (!/^[a-f0-9-]{36}$/.test(c.cycleId) || !/^[a-z]{20}$/.test(c.projectRef) ||
        !c.authorizationRef.trim() || !options.accessToken.trim() ||
        Date.parse(startedAt) < Date.parse(c.startedAt) || Date.parse(startedAt) >= Date.parse(c.deadline) ||
        Date.parse(c.deadline) - Date.parse(c.startedAt) > 300000 || nyDate(startedAt) <= c.reportDate) refuse();
    const signal = AbortSignal.timeout(Math.ceil(Math.min(240000, Date.parse(c.deadline) - Date.parse(startedAt))));
    stage = "locators";
    const salesReceipt = raw(options.locator, c, startedAt); completeEnvelope(salesReceipt);
    const salesEnvelope = sourceObject(salesReceipt.result); completeEnvelope(salesEnvelope);
    const sales = sourceObject(salesEnvelope.structured_content); completeEnvelope(sales);
    const payments = raw(options.paymentControls, c, startedAt); completeEnvelope(payments);
    const paymentResults = sourceArray(payments.results).map(sourceObject);
    if (paymentResults.length !== 1) refuse();
    completeEnvelope(paymentResults[0]);
    const payment = Object.hasOwn(paymentResults[0], "structured_content")
      ? sourceObject(paymentResults[0].structured_content) : paymentResults[0];
    completeEnvelope(payment);
    const recipe = salesEventCaptureQueries(c.reportDate);
    const saleRows = sourceArray(sales.rows), paymentRows = sourceArray(payment.rows);
    if (salesReceipt.query !== recipe.sales || sales.query !== recipe.sales || payment.query !== recipe.payments ||
        sales.shopDomain !== c.shop || payments.shopDomain !== c.shop || sales.rowCount !== saleRows.length ||
        payment.rowCount !== paymentRows.length || saleRows.length >= 21 || paymentRows.length >= 21) refuse();
    const ids = [...new Set([...saleRows, ...paymentRows].map(row => {
      const id = sourceArray(row)[0];
      if (typeof id !== "string") refuse();
      shopifyId(`gid://shopify/Order/${id}`, "Order"); return `gid://shopify/Order/${id}`;
    }))].sort();
    if (ids.length > 4) refuse();
    const native = boundedShopifyPilotFetch(c.shop, signal, options.fetcher ?? fetch);
    const fetcher: typeof fetch = async (url, init) => {
      const request = sourceObject(JSON.parse(String(init?.body))), query = String(request.query);
      if (!querySet.has(query)) refuse();
      if (attemptedRequests >= 20) refuse();
      attemptedRequests++;
      const began = clock(), response = await native(url, init);
      const bytes = Buffer.from(await response.clone().arrayBuffer());
      signal.throwIfAborted();
      requests.push({ ordinal: requests.length + 1, startedAt: began, finishedAt: clock(),
        querySha256: hash(query), variablesSha256: hash(JSON.stringify(request.variables)),
        requestBodySha256: hash(String(init?.body)), responseBodySha256: hash(bytes), responseBytes: bytes.length,
        httpStatus: response.status, apiVersion: response.headers.get("X-Shopify-API-Version") === "2026-07" ? "2026-07" : null });
      return response;
    };
    stage = "scope";
    await verifyHistoryAccess({ shop: c.shop, accessToken: options.accessToken, fetcher, signal,
      fromTime: `${c.reportDate}T00:00:00Z`, untilTime: startedAt, now: startedAt,
      approvalRef: c.authorizationRef, scanBasis: "updated_at", pageSize: 5, projection: "financial_customer_id" });
    const sources: SalesEventWindowSource[] = [];
    for (const id of ids) {
      stage = "original_source"; signal.throwIfAborted();
      const began = clock();
      const source = await readPilotSource({ shop: c.shop, accessToken: options.accessToken,
        fetcher, signal, projection: "financial_customer_id" }, id);
      const finished = clock();
      const row: SalesEventWindowSource = { source: retain(source,
        `source-cycle:${c.cycleId}:native:${shopifyId(id, "Order")}`, began, finished),
        sourceType: "native_shopify", apiVersion: "2026-07" };
      if (source.commerce.order.edited === true) {
        stage = "original_agreements";
        const began = clock();
        const document = await readShopifyAgreements({ shop: c.shop, accessToken: options.accessToken,
          orderGid: id, sourceUpdatedAt: String(source.commerce.order.updatedAt),
          fetcher, maxRequests: 20 - requests.length, now: () => new Date(clock()) });
        row.agreements = retain(document, `source-cycle:${c.cycleId}:agreements:${shopifyId(id, "Order")}`, began, clock());
      }
      sources.push(row);
    }
    signal.throwIfAborted(); stage = "source_mapping";
    const finishedAt = clock();
    if (Date.parse(finishedAt) >= Date.parse(c.deadline) || requests.some(r => r.apiVersion !== "2026-07" || r.httpStatus !== 200)) refuse();
    // Selected native metadata only. This does not repeat or replace a full
    // created/updated inventory, nor financially clear unselected historical rows.
    const metadata = retain({ projectRef: c.projectRef, shop: c.shop, cutoff: finishedAt,
      metadataOnly: true, completeOriginalPopulation: false, financialHydrationComplete: false,
      scope: "selected_complete_sales_and_paid_locators", orders: sources.map(s => {
        const order = sourceObject(sourceObject(JSON.parse(s.source.json).commerce).order);
        return { id: order.id, createdAt: order.createdAt, updatedAt: order.updatedAt };
      }) }, `source-cycle:${c.cycleId}:selected-metadata`, startedAt, finishedAt);
    const source = bindSalesEventWindow({ version: 1, scope: { projectRef: c.projectRef, shop: c.shop,
      fromDate: c.reportDate, throughDate: c.reportDate, sourceTimezone: "America/New_York", sourceCurrency: "USD" },
      locator: options.locator, paymentControls: options.paymentControls, metadata, sources,
      businessPolicy: c.businessPolicy });
    const prepared = prepareSalesEventWindow(source, { ...source.scope, publication: `private:${c.cycleId}`, asOf: finishedAt });
    const output = { state: "source_complete" as const, source, requests, attemptedRequests, startedAt, finishedAt,
      selectedOrderCount: ids.length, originalOrderGids: prepared.paidWindowProof.originalOrderGids,
      customerPacketRequired: prepared.paidWindowProof.originalOrderGids.length > 0,
      sourceOnly: true, registered: false, enabled: false, lifecycleComplete: false };
    if (JSON.stringify(output).includes(options.accessToken)) refuse();
    return output;
  } catch {
    // Never expose transport/body errors, response headers or credentials.
    return { state: "held" as const, stage, startedAt, finishedAt: clock(), requests, attemptedRequests,
      sourceOnly: true, registered: false, enabled: false, lifecycleComplete: false };
  }
}
