import { createHash } from "node:crypto";
import { evidenceDigest } from "./evidenceIntake";
import { mappingPolicy, type PipelinePolicy } from "./shopifyPipeline";
import { mapPilotSource } from "./shopifyPilotMapping";
import type { PilotSource } from "./shopifyPilotSource";
import type { AgreementDocument } from "./shopifyAgreements";
import { mapRefundClockOriginalPurchase } from "./refundClockOriginalPurchasePreparation";
import { normalizeCommerce } from "./commerce";
import { normalizeLedger, normalizePayment } from "./financial";
import { reportDates } from "./commerceCandidate";
import { validateCandidateGraph, type Candidate } from "./certification";
import { decimal, micros, nyDate, type Row } from "./primitives";
import { shopifyId, shopifyShop, sourceArray, sourceObject, sourceString } from "./shopifySource";
import contracts from "./lean-contracts.json";
import type { FullBuildEvidence } from "./fullReportBuild";
import { consumeScopedCustomerPurchases, type ScopedCustomerPurchaseBinding,
  type ScopedCustomerPurchaseTarget } from "./customerScopedPurchaseConsumer";

export type SalesEventWindowScope = {
  projectRef: string; shop: string; fromDate: string; throughDate: string;
  sourceTimezone: "America/New_York"; sourceCurrency: "USD";
};
export type RetainedEventJson = {
  json: string; sha256: string; evidenceRef: string; startedAt: string; finishedAt: string;
};
export type SalesEventWindowSource = {
  source: RetainedEventJson;
  sourceType: "native_shopify"; apiVersion: "2026-07";
  /** Present only for the separately proved sole-return clock bridge. */
  agreements?: RetainedEventJson;
};
export type SalesEventWindowInput = {
  version: 1; scope: SalesEventWindowScope; digest: string;
  locator: RetainedEventJson & { sourceType: "shopify_connector"; apiVersion: null };
  paymentControls: RetainedEventJson & {
    sourceType: "shopify_connector"; apiVersion: null; captureBasis: "bounded_interval" | "recorded_interval";
  };
  sources: SalesEventWindowSource[];
  /** Enumerated IDs/revisions remain metadata. They are NOT financial exclusions. */
  metadata: RetainedEventJson;
  businessPolicy: Pick<PipelinePolicy, "decision" | "productClasses" |
    "financialApprovalRef" | "saleClock" | "refundClock">;
  /** Selected-order conclusions become daily only after paid-window composition. */
  customers?: { packetJson: string; binding: ScopedCustomerPurchaseBinding };
};
export type SalesEventWindowBinding = { version: 1; digest: string };
const zero = BigInt(0);
const columns = ["order_id", "second", "is_sales_reversal", "orders", "quantity_ordered", "reversed_quantity",
  "gross_sales", "discounts", "sales_reversals", "net_sales", "shipping_charges", "taxes", "duties",
  "additional_fees", "total_sales"] as const;
const types = ["IDENTITY", "SECOND_TIMESTAMP", "BOOLEAN", "INTEGER", "INTEGER", "INTEGER",
  ...Array(9).fill("MONEY")];
const paymentColumns = ["order_id", "transaction_id", "second", "payment_gateway", "transaction_kind",
  "transaction_status", "transaction_currency", "gross_payments", "refunded_payments", "net_payments", "transactions"];
function refuse(reason: string): never { throw new Error(`sales_event_window_${reason}`); }
function instant(v: unknown) { const s = sourceString(v); nyDate(s); return s; }
function keys(value: unknown, allowed: string[], required = allowed) {
  const o = sourceObject(value);
  if (Object.keys(o).some(k => !allowed.includes(k)) || required.some(k => !Object.hasOwn(o, k)))
    refuse("shape");
}
export function salesEventLocatorQuery(fromDate: string, throughDate: string) {
  if (reportDates(fromDate, throughDate).length > 31) refuse("date_budget");
  return `FROM sales\nSHOW orders, quantity_ordered, reversed_quantity, gross_sales, discounts, sales_reversals, net_sales, shipping_charges, taxes, duties, additional_fees, total_sales\nGROUP BY order_id, second, is_sales_reversal\nSINCE ${fromDate}\nUNTIL ${throughDate}\nORDER BY second ASC\nLIMIT 21\n`;
}
export function paymentEventLocatorQuery(date: string, limit = 21) {
  reportDates(date, date);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 21) refuse("payment_limit");
  return `FROM payments SHOW gross_payments, refunded_payments, net_payments, transactions GROUP BY order_id, transaction_id, second, payment_gateway, transaction_kind, transaction_status, transaction_currency SINCE ${date} UNTIL ${date} LIMIT ${limit}`;
}
function retained(packet: RetainedEventJson, asOf: string): unknown {
  if (typeof packet.json !== "string" || Buffer.byteLength(packet.json) > 2000000 ||
      !/^[a-f0-9]{64}$/.test(packet.sha256) ||
      createHash("sha256").update(packet.json).digest("hex") !== packet.sha256 ||
      typeof packet.evidenceRef !== "string" || !packet.evidenceRef.trim() || packet.evidenceRef.length > 512)
    refuse("retained_digest");
  if (Date.parse(instant(packet.startedAt)) > Date.parse(instant(packet.finishedAt)) ||
      Date.parse(packet.finishedAt) > Date.parse(asOf)) refuse("capture_clock");
  try { return JSON.parse(packet.json); } catch { return refuse("retained_json"); }
}
/** A hash proves unchanged bytes, not provider success or complete output.
 * Apply at each retained envelope and structured-result level, including the
 * older faithful payment serialization which has no original wire envelope.
 */
function providerComplete(value: unknown): void {
  const row = sourceObject(value);
  if (Object.hasOwn(row, "error") && row.error !== null ||
      Object.hasOwn(row, "errors") && (!Array.isArray(row.errors) || row.errors.length !== 0) ||
      ["is_error", "isError", "truncated", "is_truncated"].some(k => Object.hasOwn(row, k) && row[k] !== false) ||
      Object.hasOwn(row, "success") && row.success !== true)
    refuse("provider_error_or_truncation");
  for (const name of ["structured_content_metadata", "content_metadata"])
    if (Object.hasOwn(row, name)) providerComplete(row[name]);
}
const empty = (): Candidate => Object.fromEntries(contracts.tables.map(t => [t.name, []]));
function append(to: Candidate, from: Candidate) {
  for (const t of contracts.tables) to[t.name].push(...from[t.name]);
}
type LocatorRow = Record<typeof columns[number], string>;
type EventSummary = { identity: string; orderId: string; date: string; reversal: boolean;
  orders: string; quantity: string; reversed: string; components: Record<string, string>;
  locatorClock: string; nativeClocks: string[] };

/** Parses raw retained bytes and remaps native sources. This is not an owner
 * authority check, source acquisition, full-store inventory or lifecycle proof.
 * The separate SQL registration/input fences own operating authority.
 */
export function prepareSalesEventWindow(input: SalesEventWindowInput, context: {
  publication: string; projectRef: string; shop: string; fromDate: string; throughDate: string; asOf: string;
}) {
  keys(input, ["version", "scope", "digest", "locator", "paymentControls", "sources", "metadata", "businessPolicy", "customers"],
    ["version", "scope", "digest", "locator", "paymentControls", "sources", "metadata", "businessPolicy"]);
  keys(input.scope, ["projectRef", "shop", "fromDate", "throughDate", "sourceTimezone", "sourceCurrency"]);
  const scope = input.scope, dates = reportDates(scope.fromDate, scope.throughDate);
  instant(context.asOf); shopifyShop(scope.shop);
  if (input.version !== 1 || !/^[a-z]{20}$/.test(scope.projectRef) || dates.length > 31 ||
      !context.publication.trim() || scope.projectRef !== context.projectRef || scope.shop !== context.shop ||
      scope.fromDate !== context.fromDate || scope.throughDate !== context.throughDate ||
      scope.sourceTimezone !== "America/New_York" || scope.sourceCurrency !== "USD" ||
      nyDate(context.asOf) <= scope.throughDate ||
      !/^[a-f0-9]{64}$/.test(input.digest))
    refuse("scope");
  // Avoid hashing an undefined property: digest is excluded, not serialized.
  const { digest, ...content } = input;
  if (evidenceDigest(content) !== digest || Buffer.byteLength(JSON.stringify(input)) > 5000000)
    refuse("input_digest");
  keys(input.businessPolicy, ["decision", "productClasses", "financialApprovalRef", "saleClock", "refundClock"]);
  if (input.businessPolicy.saleClock !== "paid_at" || input.businessPolicy.refundClock !== "refund_created_at" ||
      input.businessPolicy.decision.eligibility !== "eligible" || !input.businessPolicy.financialApprovalRef.trim())
    refuse("business_policy");
  keys(input.locator, ["json", "sha256", "evidenceRef", "startedAt", "finishedAt", "sourceType", "apiVersion"]);
  if (input.locator.sourceType !== "shopify_connector" || input.locator.apiVersion !== null)
    refuse("locator_provenance");
  const receipt = sourceObject(retained(input.locator, context.asOf));
  providerComplete(receipt);
  const envelope = sourceObject(receipt.result); providerComplete(envelope);
  const locator = sourceObject(envelope.structured_content); providerComplete(locator);
  const query = salesEventLocatorQuery(scope.fromDate, scope.throughDate);
  if (receipt.sourceType !== "shopify_connector" || receipt.startedAt !== input.locator.startedAt ||
      receipt.finishedAt !== input.locator.finishedAt || receipt.query !== query || locator.query !== query ||
      locator.shopDomain !== scope.shop || sourceObject(locator.chartHint).currencyCode !== "USD")
    refuse("locator_scope");
  const declared = sourceArray(locator.columns).map(sourceObject), rawRows = sourceArray(locator.rows);
  if (declared.length !== columns.length || declared.some((c, i) => c.name !== columns[i] || c.dataType !== types[i]) ||
      locator.rowCount !== rawRows.length || rawRows.length >= 21)
    refuse("locator_sentinel_or_columns");
  const controls: LocatorRow[] = rawRows.map(value => {
    const row = sourceArray(value);
    if (row.length !== columns.length || row.some(v => typeof v !== "string")) refuse("locator_row");
    const r = Object.fromEntries(columns.map((c, i) => [c, row[i]])) as LocatorRow;
    if (!/^[1-9]\d*$/.test(r.order_id) || !["true", "false"].includes(r.is_sales_reversal) ||
        !dates.includes(nyDate(instant(r.second)))) refuse("locator_row_scope");
    for (const c of columns.slice(3)) micros(r[c]);
    if (!["0", "1"].includes(r.orders) || !/^(0|[1-9]\d*)$/.test(r.quantity_ordered) ||
        !/^(0|-[1-9]\d*)$/.test(r.reversed_quantity)) refuse("locator_counts");
    return r;
  });
  const eventKey = (order: string, date: string, reversal: boolean) => JSON.stringify([order, date, reversal]);
  const controlKeys = controls.map(r => eventKey(r.order_id, nyDate(r.second), r.is_sales_reversal === "true"));
  // Multiple changes of the same role in one day need a more detailed independent
  // locator. Do not coalesce them or match using invented one-second tolerances.
  if (new Set(controlKeys).size !== controls.length) refuse("ambiguous_event_identity");
  keys(input.paymentControls, ["json", "sha256", "evidenceRef", "startedAt", "finishedAt",
    "sourceType", "apiVersion", "captureBasis"]);
  if (input.paymentControls.sourceType !== "shopify_connector" || input.paymentControls.apiVersion !== null ||
      !["bounded_interval", "recorded_interval"].includes(input.paymentControls.captureBasis))
    refuse("payment_provenance");
  const paymentBody = sourceObject(retained(input.paymentControls, context.asOf));
  providerComplete(paymentBody);
  const paymentDecl = sourceArray(paymentBody.columns).map(sourceObject);
  if (paymentBody.shopDomain !== scope.shop || paymentDecl.length !== paymentColumns.length ||
      paymentDecl.some((c, i) => c.name !== paymentColumns[i] || c.dataType !==
        (i < 2 ? "IDENTITY" : i === 2 ? "SECOND_TIMESTAMP" : i < 7 ? "STRING" : i === 10 ? "INTEGER" : "MONEY")))
    refuse("payment_columns");
  const results = sourceArray(paymentBody.results).map(sourceObject), paymentRows: string[][] = [];
  if (results.length !== dates.length) refuse("payment_days");
  for (const [index, date] of dates.entries()) {
    const retainedResult = results[index]; providerComplete(retainedResult);
    // New captures may retain the exact tool envelope. Historical faithful
    // structured rows stay supported without inventing omitted envelope flags.
    const result = Object.hasOwn(retainedResult, "structured_content")
      ? sourceObject(retainedResult.structured_content) : retainedResult;
    providerComplete(result);
    const query = sourceString(result.query);
    const limit = Number(/ LIMIT ([1-9][0-9]*)$/.exec(query)?.[1]);
    const rows = sourceArray(result.rows);
    if (query !== paymentEventLocatorQuery(date, limit) || result.rowCount !== rows.length || rows.length >= limit)
      refuse("payment_sentinel_or_query");
    for (const value of rows) {
      const r = sourceArray(value);
      if (r.length !== paymentColumns.length || r.some(v => typeof v !== "string")) refuse("payment_row");
      const row = r as string[];
      if (!/^[1-9]\d*$/.test(row[0]) || !/^[1-9]\d*$/.test(row[1]) || nyDate(instant(row[2])) !== date ||
          !row[3] || !["sale", "capture", "refund"].includes(row[4]) ||
          row[5] !== "success" || row[6] !== "USD" || row[10] !== "1")
        refuse("payment_unhandled_population");
      for (const v of row.slice(7, 10)) micros(v);
      paymentRows.push(row);
    }
  }
  if (new Set(paymentRows.map(r => r[1])).size !== paymentRows.length) refuse("payment_duplicate");
  keys(input.metadata, ["json", "sha256", "evidenceRef", "startedAt", "finishedAt"]);
  const metadata = sourceObject(retained(input.metadata, context.asOf));
  const members = sourceArray(metadata.orders).map(sourceObject);
  if (metadata.projectRef !== scope.projectRef || metadata.shop !== scope.shop || metadata.metadataOnly !== true ||
      metadata.completeOriginalPopulation !== false || metadata.financialHydrationComplete !== false ||
      members.length > 1000 || new Set(members.map(o => o.id)).size !== members.length)
    refuse("metadata_scope");
  instant(metadata.cutoff);
  if (!Array.isArray(input.sources) || input.sources.length > 20)
    refuse("source_budget");
  const selectedIds = new Set([...controls.map(r => r.order_id), ...paymentRows.map(r => r[0])]), seen = new Set<string>();
  const base = empty(), fullFacts = empty(), replacements: FullBuildEvidence["replacements"] = [];
  const sourceRows: { source: PilotSource; evidenceRef: string }[] = [];
  const deferred: { orderGid: string; sourceUpdatedAt: string; evidenceRef: string }[] = [];
  const refundQuantities = new Map<string, bigint>();
  const sourceBindings: { orderGid: string; sourceUpdatedAt: string; sourceSha256: string;
    agreementSha256: string | null; sourceEvidenceRef: string }[] = [];
  for (const row of input.sources) {
    keys(row, ["source", "sourceType", "apiVersion", "agreements"], ["source", "sourceType", "apiVersion"]);
    keys(row.source, ["json", "sha256", "evidenceRef", "startedAt", "finishedAt"]);
    if (row.sourceType !== "native_shopify" || row.apiVersion !== "2026-07") refuse("native_provenance");
    const source = sourceObject(retained(row.source, context.asOf)) as PilotSource;
    const o = sourceObject(source.commerce.order), id = shopifyId(o.id, "Order");
    const member = members.find(m => m.id === o.id);
    if (source.commerce.shop !== scope.shop || source.commerce.apiVersion !== row.apiVersion ||
        !selectedIds.has(id) || seen.has(id) || !member ||
        Date.parse(instant(member.updatedAt)) !== Date.parse(instant(o.updatedAt)) ||
        Date.parse(instant(member.createdAt)) !== Date.parse(instant(o.createdAt)) ||
        Date.parse(String(o.updatedAt)) > Date.parse(row.source.finishedAt))
      refuse("source_membership_revision");
    seen.add(id); sourceRows.push({ source, evidenceRef: row.source.evidenceRef });
    const policy = mappingPolicy(source, input.businessPolicy);
    if (o.edited === true) {
      if (!row.agreements) refuse("edited_original_required");
      keys(row.agreements, ["json", "sha256", "evidenceRef", "startedAt", "finishedAt"]);
      const document = sourceObject(retained(row.agreements, context.asOf)) as AgreementDocument;
      if (Date.parse(instant(document.capturedAt)) < Date.parse(row.agreements.startedAt) ||
          Date.parse(document.capturedAt) > Date.parse(row.agreements.finishedAt)) refuse("agreement_capture");
      const mapped = mapRefundClockOriginalPurchase({ source, document, policy,
        sourceEvidenceRef: row.source.evidenceRef, agreementEvidenceRef: row.agreements.evidenceRef,
        sourceCapturedAt: row.source.finishedAt });
      replacements.push(mapped.replacement);
      deferred.push({ orderGid: String(o.id), sourceUpdatedAt: String(o.updatedAt), evidenceRef: mapped.replacement.evidenceRef });
      const normalized = normalizeCommerce(mapped.replacement.snapshot, mapped.replacement.decision, context.publication);
      for (const t of ["orders", "order_items", "order_item_offers"]) fullFacts[t].push(...normalized[t as keyof typeof normalized]);
      fullFacts.sales_ledger.push(...mapped.replacement.movements.flatMap(m => normalizeLedger(m, context.publication)));
      fullFacts.payments.push(...mapped.replacement.payments.map(p => normalizePayment(p, context.publication)));
    } else {
      if (row.agreements) refuse("unexpected_agreements");
      const mapped = mapPilotSource(source, policy, context.publication, row.source.evidenceRef);
      append(base, mapped.facts); append(fullFacts, mapped.facts);
    }
    for (const refund of source.refunds) {
      const at = instant(refund.createdAt), c = sourceObject(refund.refundLineItems);
      if (sourceObject(c.pageInfo).hasNextPage !== false) refuse("refund_quantity_incomplete");
      const amount = sourceArray(c.nodes).map(sourceObject).reduce((n, l) => {
        if (!Number.isSafeInteger(l.quantity) || Number(l.quantity) <= 0) refuse("refund_quantity");
        return n + BigInt(Number(l.quantity)) * BigInt(1000000);
      }, zero);
      const k = eventKey(id, nyDate(at), true);
      if (refundQuantities.has(k)) refuse("ambiguous_refund_identity");
      refundQuantities.set(k, amount);
    }
    sourceBindings.push({ orderGid: String(o.id), sourceUpdatedAt: String(o.updatedAt),
      sourceSha256: row.source.sha256, agreementSha256: row.agreements?.sha256 ?? null,
      sourceEvidenceRef: row.source.evidenceRef });
  }
  if (seen.size !== selectedIds.size) refuse("missing_selected_source");
  if (validateCandidateGraph(fullFacts, context.publication, "commerce-only", false).length) refuse("source_graph");
  // Independent paid-date membership closes the sales-event/paid-clock midnight
  // counterexample. This is not a chargeback, settlement or cash-lifecycle proof.
  const principalRows = sourceRows.flatMap(({ source }) => sourceArray(source.commerce.order.transactions).map(sourceObject)
    .filter(t => t.status === "SUCCESS" && ["SALE", "CAPTURE", "REFUND"].includes(String(t.kind)) &&
      dates.includes(nyDate(instant(t.processedAt))))
    .map(t => ({ order: source.commerce.order, transaction: t })));
  if (principalRows.length !== paymentRows.length) refuse("paid_population_count");
  for (const r of paymentRows) {
    const match = principalRows.find(p => shopifyId(p.transaction.id, "OrderTransaction") === r[1]);
    if (!match) refuse("paid_population_membership");
    const t = match.transaction, money = sourceObject(sourceObject(t.amountSet).shopMoney);
    const amount = micros(sourceString(money.amount)), refund = r[4] === "refund";
    if (shopifyId(match.order.id, "Order") !== r[0] || t.processedAt !== r[2] || t.gateway !== r[3] ||
        String(t.kind).toLowerCase() !== r[4] || money.currencyCode !== r[6] || amount <= zero ||
        micros(r[7]) !== (refund ? zero : amount) || micros(r[8]) !== (refund ? -amount : zero) ||
        micros(r[9]) !== (refund ? -amount : amount)) refuse("paid_population_projection");
  }
  const originals = fullFacts.orders.filter(o => o.eligibility_status === "eligible" && dates.includes(String(o.purchase_date)));
  const paidIds = new Set(paymentRows.filter(r => r[4] !== "refund").map(r => r[0]));
  if (paidIds.size !== originals.length || originals.some(o => !paidIds.has(String(o.source_order_id))))
    refuse("paid_original_population");
  const groups = new Map<string, Row[]>();
  for (const ledger of fullFacts.sales_ledger.filter(l => dates.includes(String(l.report_date)))) {
    const order = fullFacts.orders.find(o => o.order_id === ledger.order_id)!;
    if (ledger.sales_eligible !== true || !["sale", "discount", "refund", "reversal"].includes(String(ledger.movement_kind)))
      refuse("unsupported_movement");
    const reversal = ["refund", "reversal"].includes(String(ledger.movement_kind));
    const k = eventKey(String(order.source_order_id), String(ledger.report_date), reversal);
    groups.set(k, [...groups.get(k) ?? [], ledger]);
  }
  if (groups.size !== controls.length || controlKeys.some(k => !groups.has(k))) refuse("event_membership");
  const summaries: EventSummary[] = controls.map((r, i) => {
    const rows = groups.get(controlKeys[i])!, date = nyDate(r.second), reversal = r.is_sales_reversal === "true";
    const sum = (component: string) => rows.filter(l => l.component === component)
      .reduce((n, l) => n + micros(String(l.amount_usd)), zero);
    const expected: Record<string, bigint> = {
      gross_sales: sum("merchandise_gross"), discounts: sum("merchandise_discount"),
      sales_reversals: sum("merchandise_refund"), shipping_charges: sum("shipping_net"),
      taxes: sum("tax_net"), duties: sum("duty_net"), additional_fees: sum("fee")
    };
    if (sum("other_sales_adjustment") !== zero || expected.additional_fees !== zero) refuse("unsupported_component");
    expected.net_sales = expected.gross_sales + expected.discounts + expected.sales_reversals;
    expected.total_sales = expected.net_sales + expected.shipping_charges + expected.taxes + expected.duties;
    for (const [field, amount] of Object.entries(expected))
      if (micros(r[field as keyof LocatorRow]) !== amount) refuse("independent_component_mismatch");
    const order = fullFacts.orders.find(o => o.source_order_id === r.order_id)!;
    const purchaseOnDate = !reversal && order.purchase_date === date && order.eligibility_status === "eligible";
    const quantity = purchaseOnDate ? fullFacts.order_items.filter(l => l.order_id === order.order_id)
      .reduce((n, l) => n + micros(String(l.quantity)), zero) : zero;
    const reversed = reversal ? -(refundQuantities.get(controlKeys[i]) ?? zero) : zero;
    if (r.orders !== (purchaseOnDate ? "1" : "0") || micros(r.quantity_ordered) !== quantity ||
        micros(r.reversed_quantity) !== reversed || reversal && reversed === zero)
      refuse("independent_purchase_count");
    return { identity: controlKeys[i], orderId: r.order_id, date, reversal, orders: r.orders,
      quantity: decimal(quantity), reversed: decimal(reversed),
      components: Object.fromEntries(Object.entries(expected).map(([k, v]) => [k, decimal(v)])),
      locatorClock: r.second, nativeClocks: [...new Set(rows.map(l => String(l.effective_at)))].sort() };
  });
  const ref = `sales-event-window:sha256:${input.digest}`;
  let scopedCustomers: ReturnType<typeof consumeScopedCustomerPurchases> | null = null;
  if (input.customers) {
    keys(input.customers, ["packetJson", "binding"]);
    const b = input.customers.binding;
    if (b.projectRef !== scope.projectRef || b.shop !== scope.shop ||
        Date.parse(instant(b.capturedAt)) > Date.parse(context.asOf)) refuse("customer_scope");
    const targets: ScopedCustomerPurchaseTarget[] = originals.map(order => {
      const source = sourceRows.find(r => shopifyId(r.source.commerce.order.id, "Order") === order.source_order_id)!.source;
      const raw = source.commerce.order;
      const customerGid = sourceString(sourceObject(raw.customer).id); shopifyId(customerGid, "Customer");
      return { orderGid: String(raw.id), customerGid, createdAt: String(raw.createdAt),
        updatedAt: String(raw.updatedAt), documentDigest: evidenceDigest(source.commerce) };
    }).sort((a, b) => a.orderGid.localeCompare(b.orderGid));
    if (targets.length) scopedCustomers = consumeScopedCustomerPurchases({ ...input.customers, targets });
  }
  const customerCounts = new Map<string, number | null>();
  for (const date of dates) {
    const dayOrders = originals.filter(o => o.purchase_date === date);
    if (!dayOrders.length) { customerCounts.set(date, 0); continue; }
    const conclusions = dayOrders.map(o => scopedCustomers?.orders.find(c =>
      c.orderGid === `gid://shopify/Order/${o.source_order_id}` && c.paidAt === o.paid_at));
    if (conclusions.some(c => !c || !["returning", "first_observable"].includes(c.status))) {
      customerCounts.set(date, null); continue;
    }
    const customers = new Set(conclusions.map(c => c!.customerGid));
    let newCustomers = 0, complete = true;
    for (const customer of customers) {
      const rows = conclusions.filter(c => c!.customerGid === customer);
      if (rows.some(c => c!.status === "first_observable" && c!.firstEligibleOrderGid === c!.orderGid &&
          c!.firstEligiblePaidAt === c!.paidAt && nyDate(c!.paidAt!) === date)) newCustomers++;
      // Returning alone is not enough when the only prior witness is on this
      // same day and its first-purchase status is unresolved.
      else if (!rows.some(c => c!.status === "returning" && c!.priorEligiblePaidAt &&
          nyDate(c!.priorEligiblePaidAt) < date)) complete = false;
    }
    customerCounts.set(date, complete ? newCustomers : null);
  }
  return { scope, dates, ref, base, fullFacts, replacements, deferred, sourceRows, sourceBindings, summaries,
    paidWindowProof: { independentlyExtracted: true, evidenceRef: input.paymentControls.evidenceRef,
      captureBasis: input.paymentControls.captureBasis, startedAt: input.paymentControls.startedAt,
      finishedAt: input.paymentControls.finishedAt, principalRows: paymentRows.length,
      originalOrderGids: originals.map(o => `gid://shopify/Order/${o.source_order_id}`).sort(),
      cashLifecycleClaimed: false },
    scopedCustomers, customerCounts,
    metadataDisposition: { total: members.length, selectedFinancialSources: seen.size,
      unprocessed: members.filter(m => !seen.has(shopifyId(m.id, "Order"))).map(m => ({
        id: m.id, createdAt: m.createdAt, updatedAt: m.updatedAt, state: "unprocessed_metadata" as const
      })), financialExclusionsClaimed: false, completeOriginalPopulation: false },
    oldestCaptureAt: new Date(Math.min(Date.parse(input.locator.startedAt), Date.parse(input.metadata.startedAt),
      Date.parse(input.paymentControls.startedAt), ...(input.customers ? [Date.parse(input.customers.binding.startedAt)] : []),
      ...input.sources.flatMap(s => [Date.parse(s.source.startedAt), ...(s.agreements ? [Date.parse(s.agreements.startedAt)] : [])]))).toISOString(),
    latestCaptureAt: new Date(Math.max(Date.parse(input.locator.finishedAt), Date.parse(input.metadata.finishedAt),
      Date.parse(input.paymentControls.finishedAt), ...(input.customers ? [Date.parse(input.customers.binding.capturedAt)] : []),
      ...input.sources.flatMap(s => [Date.parse(s.source.finishedAt), ...(s.agreements ? [Date.parse(s.agreements.finishedAt)] : [])]))).toISOString()
  };
}

/** Exact native fact correspondence is separate from independent event controls.
 * It is never relabeled as independently extracted canonical-table keys.
 */
export function admitSalesEventWindow(input: SalesEventWindowInput | undefined,
  context: Parameters<typeof prepareSalesEventWindow>[1] & {
    binding?: SalesEventWindowBinding; facts: Candidate;
  }) {
  if (!input && !context.binding) return null;
  if (!input || !context.binding || context.binding.version !== 1 || context.binding.digest !== input.digest)
    refuse("binding");
  const prepared = prepareSalesEventWindow(input, context);
  const fields: Record<string, string[]> = {
    orders: ["order_id", "source_order_id", "shop_id", "source_updated_at", "paid_at", "purchase_date",
      "eligibility_status", "commerce_source", "acquisition_eligible", "source_currency", "report_currency",
      "purchase_merchandise_gross_usd", "purchase_discount_usd", "purchase_merchandise_net_usd"],
    order_items: ["order_item_id", "order_id", "source_line_id", "sku", "product_id", "quantity", "item_class",
      "purchase_value_complete", "source_currency", "report_currency", "unit_price_usd", "purchase_gross_usd",
      "purchase_discount_usd", "purchase_net_usd"],
    sales_ledger: ["ledger_entry_id", "source_movement_id", "order_id", "order_item_id", "component",
      "movement_kind", "effective_at", "report_date", "source_amount", "source_currency", "report_currency",
      "amount_usd", "sales_eligible", "product_allocation_status", "reverses_entry_id"]
  };
  for (const [table, selected] of Object.entries(fields)) {
    const projection = (rows: Row[]) => rows.map(r => selected.map(f =>
      ["source_updated_at", "paid_at", "effective_at"].includes(f) && r[f] !== null
        ? new Date(instant(r[f])).toISOString() : r[f])).map(evidenceDigest).sort();
    if (evidenceDigest(projection(context.facts[table])) !== evidenceDigest(projection(prepared.fullFacts[table])))
      refuse("final_source_fact_mismatch");
  }
  return { dates: new Set(prepared.dates), ref: prepared.ref, digest: input.digest,
    scope: prepared.scope, summaries: prepared.summaries,
    paidWindowProof: prepared.paidWindowProof, customerCounts: prepared.customerCounts,
    metadataDisposition: prepared.metadataDisposition,
    wholeTableReconciliationClaimed: false, cashLifecycleClaimed: false };
}
