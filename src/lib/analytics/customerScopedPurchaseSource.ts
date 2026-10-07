import { canonicalJson, evidenceDigest } from "./evidenceIntake";
import { nyDate } from "./primitives";
import { mapShopifyTransactions } from "./shopifyMapping";
import {
  readShopifyAnalyticsOrder, SHOPIFY_FINANCIAL_CUSTOMER_QUERY,
  SHOPIFY_ANALYTICS_API_VERSION, shopifyId, sourceArray, sourceObject, sourceString,
  type ShopifyOrderDocument,
} from "./shopifySource";

export const CUSTOMER_PURCHASE_SCHEMA = "shopify-current-customer-orders-v1";
export const CUSTOMER_PURCHASE_PAGE_QUERY = `query CustomerPurchaseInventory($search: String!, $cursor: String) {
  orders(first: 25, after: $cursor, query: $search, sortKey: CREATED_AT) {
    nodes { id createdAt updatedAt customer { id } }
    pageInfo { hasNextPage endCursor }
  }
}`;
export const CUSTOMER_PURCHASE_COUNT_QUERY = `query CustomerPurchaseCount($search: String!) {
  ordersCount(query: $search, limit: 101) { count precision }
}`;
export const CUSTOMER_PURCHASE_ACCESS_QUERY = `query CustomerPurchaseAccess {
  shop { myshopifyDomain }
  currentAppInstallation { id app { id } accessScopes { handle } }
}`;

/** Current visible Shopify membership only. This is not a 040 manifest, stored
 * processing authority, migration attestation or permission for a runtime job.
 * The caller supplies the actual current project authorization reference.
 */
export type CustomerPurchaseReadPlan = {
  projectRef: "xnfjdbpjuaezxjgargto";
  shop: "mullybox-store.myshopify.com";
  authorizationRef: string;
  appId: string; installationId: string;
  expiresAt: string;
  members: { customerGid: string; anchorOrderGids: string[] }[];
  maxRequests: number; maxBytes: number;
};
export type CustomerPurchaseHeader = {
  id: string; customerGid: string; createdAt: string; updatedAt: string;
};
type PageReceipt = {
  cursor: string | null; endCursor: string | null; hasNextPage: boolean;
  orders: CustomerPurchaseHeader[];
};
type InventoryRead = { count: number; pages: PageReceipt[]; orders: CustomerPurchaseHeader[] };
export type CustomerPurchaseObservation = {
  schemaVersion: typeof CUSTOMER_PURCHASE_SCHEMA;
  scope: CustomerPurchaseReadPlan;
  startedAt: string; capturedAt: string; requests: number; responseBytes: number;
  queryHashes: { inventory: string; count: string; hydration: string };
  members: {
    customerGid: string; inventory: InventoryRead; recheck: InventoryRead;
    sources: {
      document: ShopifyOrderDocument; documentDigest: string; capturedAt: string;
      sourceRef: string; hydration: "read" | "retained";
      successfulPayments: { transactionGid: string; kind: "sale" | "capture"; processedAt: string | null }[];
      requiresOriginalPurchaseReview: boolean;
    }[];
  }[];
  coverage: "current_shopify_customer_membership";
  pagination: "exhausted_and_rechecked";
  historicalOwnership: "not_asserted"; deletedOrderCoverage: "not_asserted";
  migrationCoverage: "not_asserted"; productionAdmission: false;
  digest: string;
};
function fail(code: string): never { throw new Error(`customer_purchase_${code}`); }
const same = (a: unknown, b: unknown) => canonicalJson(a) === canonicalJson(b);
const instant = (value: string) => {
  nyDate(value);
  return value.replace(/(?:\.(\d+))?Z$/, (_, digits: string | undefined) => `.${(digits ?? "").padEnd(6, "0")}Z`);
};
const text = (value: unknown) => typeof value === "string" && !!value.trim() && value.length <= 512;
const exactKeys = (value: object, fields: string[]) => {
  if (!same(Object.keys(value).sort(), [...fields].sort())) fail("schema");
};
/** Reject extra retained fields as well as making a fixed privacy-minimal query. */
function projection(document: ShopifyOrderDocument) {
  exactKeys(document, ["shop", "apiVersion", "projection", "order"]);
  const order = document.order;
  exactKeys(order, ["id", "customer", "createdAt", "updatedAt", "currencyCode", "edited", "taxesIncluded",
    "test", "cancelledAt", "originalTotalPriceSet", "subtotalPriceSet", "transactionsCount", "transactions", "lineItems"]);
  const money = (value: unknown) => {
    const outer = sourceObject(value); exactKeys(outer, ["shopMoney"]);
    exactKeys(sourceObject(outer.shopMoney), ["amount", "currencyCode"]);
  };
  money(order.originalTotalPriceSet); money(order.subtotalPriceSet);
  exactKeys(sourceObject(order.transactionsCount), ["count", "precision"]);
  for (const value of sourceArray(order.transactions)) {
    const t = sourceObject(value);
    exactKeys(t, ["id", "kind", "status", "gateway", "test", "createdAt", "processedAt", "amountSet", "parentTransaction"]);
    money(t.amountSet);
    if (t.parentTransaction !== null) exactKeys(sourceObject(t.parentTransaction), ["id", "gateway"]);
  }
  const lines = sourceObject(order.lineItems);
  exactKeys(lines, ["nodes", "pageInfo"]);
  exactKeys(sourceObject(lines.pageInfo), ["hasNextPage", "endCursor"]);
  for (const value of sourceArray(lines.nodes)) {
    const line = sourceObject(value);
    exactKeys(line, ["id", "sku", "quantity", "isGiftCard", "product", "originalUnitPriceSet", "originalTotalSet", "discountAllocations"]);
    if (line.product !== null) exactKeys(sourceObject(line.product), ["id"]);
    money(line.originalUnitPriceSet); money(line.originalTotalSet);
    for (const discount of sourceArray(line.discountAllocations)) {
      const d = sourceObject(discount); exactKeys(d, ["allocatedAmountSet"]); money(d.allocatedAmountSet);
    }
  }
}
export function customerPurchaseSearch(customerGid: string) {
  const id = shopifyId(customerGid, "Customer");
  return `customer_id:${id}`;
}
function header(value: unknown, customerGid: string, now: string): CustomerPurchaseHeader {
  const row = sourceObject(value);
  exactKeys(row, ["id", "customer", "createdAt", "updatedAt"]);
  shopifyId(row.id, "Order");
  const customer = sourceObject(row.customer); // Null/omission is NOT a guest.
  exactKeys(customer, ["id"]);
  if (customer.id !== customerGid) fail("owner_changed");
  const createdAt = sourceString(row.createdAt), updatedAt = sourceString(row.updatedAt);
  if (instant(createdAt) > instant(now) || instant(updatedAt) < instant(createdAt) ||
      instant(updatedAt) > instant(now)) fail("order_clock");
  return { id: sourceString(row.id), customerGid, createdAt, updatedAt };
}
const sorted = (rows: CustomerPurchaseHeader[]) => [...rows].sort((a, b) => a.id.localeCompare(b.id));

/** Finite read-only acquisition. Every page must finish; >100/member, changed
 * membership/revision, missing anchors or exhausted budgets return no packet.
 * All network use is confined to fixed read queries at the exact shop/version.
 * No retry, database call, file write, registration or scheduling.
 */
export async function readCustomerScopedPurchases(options: {
  plan: CustomerPurchaseReadPlan; accessToken: string; fetcher?: typeof fetch;
  signal?: AbortSignal; now?: () => string;
  retained?: { document: ShopifyOrderDocument; capturedAt: string; evidenceRef: string }[];
}): Promise<CustomerPurchaseObservation> {
  const plan = structuredClone(options.plan), clock = options.now ?? (() => new Date().toISOString());
  const startedAt = clock();
  exactKeys(plan, ["projectRef", "shop", "authorizationRef", "appId", "installationId",
    "expiresAt", "members", "maxRequests", "maxBytes"]);
  if (plan.projectRef !== "xnfjdbpjuaezxjgargto" || plan.shop !== "mullybox-store.myshopify.com" ||
      !text(plan.authorizationRef) || !options.accessToken.trim() ||
      !/^gid:\/\/shopify\/App\/[1-9]\d*$/.test(plan.appId) ||
      !/^gid:\/\/shopify\/AppInstallation\/[1-9]\d*$/.test(plan.installationId) ||
      !Array.isArray(plan.members) || !plan.members.length || plan.members.length > 4 ||
      !Number.isSafeInteger(plan.maxRequests) || plan.maxRequests < 1 || plan.maxRequests > 1250 ||
      !Number.isSafeInteger(plan.maxBytes) || plan.maxBytes < 1 || plan.maxBytes > 67108864 ||
      instant(plan.expiresAt) <= instant(startedAt) ||
      Date.parse(plan.expiresAt) - Date.parse(startedAt) > 900000) fail("scope");
  const customers = new Set<string>(), anchors = new Set<string>();
  const retained = new Map<string, NonNullable<typeof options.retained>[number]>();
  if (options.retained && (!Array.isArray(options.retained) || options.retained.length > 400 ||
      Buffer.byteLength(canonicalJson(options.retained)) > 67108864)) fail("retained_scope");
  for (const item of structuredClone(options.retained ?? [])) {
    const doc = item.document, id = sourceString(doc.order.id);
    shopifyId(id, "Order");
    if (retained.has(id) || doc.shop !== plan.shop || doc.apiVersion !== SHOPIFY_ANALYTICS_API_VERSION ||
        doc.projection !== "financial_customer_id" || !text(item.evidenceRef) ||
        instant(item.capturedAt) > instant(startedAt) ||
        instant(sourceString(doc.order.updatedAt)) > instant(item.capturedAt)) fail("retained_scope");
    retained.set(id, item);
  }
  for (const member of plan.members) {
    exactKeys(member, ["customerGid", "anchorOrderGids"]);
    shopifyId(member.customerGid, "Customer");
    if (customers.has(member.customerGid) || !Array.isArray(member.anchorOrderGids) ||
        !member.anchorOrderGids.length || member.anchorOrderGids.length > 100) fail("member_scope");
    customers.add(member.customerGid);
    for (const id of member.anchorOrderGids) {
      shopifyId(id, "Order");
      if (anchors.has(id)) fail("duplicate_anchor");
      anchors.add(id);
    }
  }
  const deadline = AbortSignal.any([AbortSignal.timeout(Math.min(120000,
    Date.parse(plan.expiresAt) - Date.parse(startedAt))), ...(options.signal ? [options.signal] : [])]);
  const url = `https://${plan.shop}/admin/api/${SHOPIFY_ANALYTICS_API_VERSION}/graphql.json`;
  const fetcher = options.fetcher ?? fetch;
  let requests = 0, responseBytes = 0, lastClock = startedAt;
  function check() {
    deadline.throwIfAborted();
    const now = clock();
    if (instant(now) < instant(lastClock) || instant(now) >= instant(plan.expiresAt) ||
        Date.parse(now) - Date.parse(startedAt) >= 120000) fail("clock");
    lastClock = now;
    return now;
  }
  const queries = [CUSTOMER_PURCHASE_PAGE_QUERY, CUSTOMER_PURCHASE_COUNT_QUERY,
    CUSTOMER_PURCHASE_ACCESS_QUERY, SHOPIFY_FINANCIAL_CUSTOMER_QUERY];
  const allowedSearches = new Set(plan.members.map(m => customerPurchaseSearch(m.customerGid)));
  const allowedOrderIds = new Set<string>();
  const bounded: typeof fetch = async (destination, init) => {
    check();
    if (String(destination) !== url || init?.method !== "POST" || typeof init.body !== "string")
      fail("request_target");
    const body = sourceObject(JSON.parse(init.body));
    if (!queries.includes(String(body.query))) fail("request_query");
    const vars = sourceObject(body.variables);
    if (body.query === SHOPIFY_FINANCIAL_CUSTOMER_QUERY ? !allowedOrderIds.has(String(vars.id)) :
      body.query !== CUSTOMER_PURCHASE_ACCESS_QUERY && !allowedSearches.has(String(vars.search))) fail("request_scope");
    if (++requests > plan.maxRequests) fail("request_budget");
    const signal = AbortSignal.any([deadline, AbortSignal.timeout(15000), ...(init.signal ? [init.signal] : [])]);
    let response: Response;
    try { response = await fetcher(destination, { ...init, redirect: "error", signal }); }
    catch { fail("transport"); }
    if (!response!.ok || response!.headers.get("X-Shopify-API-Version") !== SHOPIFY_ANALYTICS_API_VERSION)
      fail("http_or_version");
    const reader = response!.body?.getReader(); if (!reader) fail("response");
    const chunks: Uint8Array[] = []; let bytes = 0;
    const cancel = () => { void reader!.cancel().catch(() => {}); };
    signal.addEventListener("abort", cancel, { once: true });
    try {
      for (;;) {
        check(); signal.throwIfAborted();
        const part = await reader!.read();
        check(); signal.throwIfAborted();
        if (part.done) break;
        bytes += part.value.length; responseBytes += part.value.length;
        if (bytes > 8388608 || responseBytes > plan.maxBytes) fail("byte_budget");
        chunks.push(part.value);
      }
    } finally {
      signal.removeEventListener("abort", cancel);
      await reader!.cancel().catch(() => {});
    }
    return new Response(Buffer.concat(chunks), { status: 200, headers: response!.headers });
  };
  async function request(query: string, variables: Record<string, unknown>) {
    const response = await bounded(url, { method: "POST", headers: {
      "Content-Type": "application/json", "X-Shopify-Access-Token": options.accessToken,
    }, body: JSON.stringify({ query, variables }) });
    const body = sourceObject(await response.json());
    if (body.errors !== undefined && (!Array.isArray(body.errors) || body.errors.length)) fail("graphql");
    return sourceObject(body.data);
  }
  async function access() {
    const data = await request(CUSTOMER_PURCHASE_ACCESS_QUERY, {});
    const app = sourceObject(data.currentAppInstallation);
    if (sourceObject(data.shop).myshopifyDomain !== plan.shop || app.id !== plan.installationId ||
        sourceObject(app.app).id !== plan.appId) fail("source_identity");
    const scopes = new Set(sourceArray(app.accessScopes).map(v => sourceString(sourceObject(v).handle)));
    if (["read_orders", "read_all_orders", "read_customers", "read_products"].some(s => !scopes.has(s))) fail("access");
  }
  async function inventory(customerGid: string): Promise<InventoryRead> {
    const search = customerPurchaseSearch(customerGid);
    const control = sourceObject((await request(CUSTOMER_PURCHASE_COUNT_QUERY, { search })).ordersCount);
    if (control.precision !== "EXACT" || !Number.isSafeInteger(control.count) ||
        Number(control.count) < 0 || Number(control.count) > 100) fail("member_count_bound");
    const orders: CustomerPurchaseHeader[] = [], pages: PageReceipt[] = [];
    const cursors = new Set<string>(), ids = new Set<string>();
    let cursor: string | null = null, previous = "";
    for (let page = 0; page < 4; page++) {
      const data = await request(CUSTOMER_PURCHASE_PAGE_QUERY, { search, cursor });
      const connection = sourceObject(data.orders), info = sourceObject(connection.pageInfo);
      const rows = sourceArray(connection.nodes).map(v => header(v, customerGid, check()));
      if (rows.length > 25 || typeof info.hasNextPage !== "boolean" ||
          info.endCursor !== null && (typeof info.endCursor !== "string" || !info.endCursor ||
            info.endCursor.length > 4096)) fail("page");
      for (const row of rows) {
        if (ids.has(row.id) || instant(row.createdAt) < previous) fail("duplicate_or_unsorted");
        ids.add(row.id); previous = instant(row.createdAt); orders.push(row);
      }
      pages.push({ cursor, endCursor: info.endCursor as string | null,
        hasNextPage: info.hasNextPage as boolean, orders: rows });
      if (orders.length > 100) fail("member_count_bound");
      if (!info.hasNextPage) {
        if (orders.length !== control.count) fail("count_mismatch");
        return { count: orders.length, pages, orders: sorted(orders) };
      }
      if (!rows.length || typeof info.endCursor !== "string" || cursors.has(info.endCursor) ||
          info.endCursor === cursor) fail("cursor");
      cursors.add(info.endCursor); cursor = info.endCursor;
    }
    return fail("incomplete_pagination");
  }
  await access();
  const members: CustomerPurchaseObservation["members"] = [];
  for (const member of plan.members) {
    const observed = await inventory(member.customerGid);
    if (member.anchorOrderGids.some(id => !observed.orders.some(o => o.id === id))) fail("missing_anchor");
    for (const row of observed.orders) {
      if (allowedOrderIds.has(row.id)) fail("cross_customer_order");
      allowedOrderIds.add(row.id);
    }
    members.push({ customerGid: member.customerGid, inventory: observed, recheck: observed, sources: [] });
  }
  if ([...retained.keys()].some(id => !allowedOrderIds.has(id))) fail("retained_scope");
  for (const member of members) for (const row of member.inventory.orders) {
    const saved = retained.get(row.id);
    const document = saved?.document ?? await readShopifyAnalyticsOrder({
      shop: plan.shop, accessToken: options.accessToken,
      fetcher: bounded, signal: deadline, maxLinePages: 2, projection: "financial_customer_id",
    }, row.id);
    const order = document.order;
    projection(document);
    const lines = sourceObject(order.lineItems);
    if (sourceObject(lines.pageInfo).hasNextPage !== false || sourceArray(lines.nodes).length > 500)
      fail("incomplete_lines");
    const lineIds = sourceArray(lines.nodes).map(v => shopifyId(sourceObject(v).id, "LineItem"));
    if (new Set(lineIds).size !== lineIds.length) fail("duplicate_line");
    const observed = header({ id: order.id, customer: order.customer,
      createdAt: order.createdAt, updatedAt: order.updatedAt }, member.customerGid, check());
    if (!same(observed, row)) fail("hydration_revision");
    if (typeof order.test !== "boolean" || typeof order.edited !== "boolean" ||
        !/^[A-Z]{3}$/.test(String(order.currencyCode))) fail("schema");
    const transactions = mapShopifyTransactions(order, plan.shop, shopifyId(order.id, "Order"),
      String(order.currencyCode), order.test);
    const successfulPayments = transactions.filter(t => !order.test &&
      t.payment.status === "succeeded" && ["sale", "capture"].includes(t.payment.kind))
      .map(t => {
        if (t.processedAt && instant(t.processedAt) > instant(row.updatedAt)) fail("payment_clock");
        return { transactionGid: `gid://shopify/OrderTransaction/${t.payment.id}`,
          kind: t.payment.kind as "sale" | "capture", processedAt: t.processedAt };
      });
    const documentDigest = evidenceDigest(document);
    member.sources.push({ document, documentDigest, capturedAt: saved?.capturedAt ?? check(),
      sourceRef: saved?.evidenceRef ?? `observed-customer-order:sha256:${documentDigest}`,
      hydration: saved ? "retained" : "read", successfulPayments,
      requiresOriginalPurchaseReview: order.edited });
  }
  await access();
  for (const member of members) {
    member.recheck = await inventory(member.customerGid);
    if (!same(member.inventory.orders, member.recheck.orders)) fail("inventory_changed");
  }
  const payload: Omit<CustomerPurchaseObservation, "digest"> = {
    schemaVersion: CUSTOMER_PURCHASE_SCHEMA, scope: plan, startedAt, capturedAt: check(), requests, responseBytes,
    queryHashes: { inventory: evidenceDigest(CUSTOMER_PURCHASE_PAGE_QUERY),
      count: evidenceDigest(CUSTOMER_PURCHASE_COUNT_QUERY), hydration: evidenceDigest(SHOPIFY_FINANCIAL_CUSTOMER_QUERY) },
    members, coverage: "current_shopify_customer_membership",
    pagination: "exhausted_and_rechecked", historicalOwnership: "not_asserted",
    deletedOrderCoverage: "not_asserted", migrationCoverage: "not_asserted", productionAdmission: false,
  };
  if (Buffer.byteLength(canonicalJson(payload)) > 67108864) fail("output_budget");
  return { ...payload, digest: evidenceDigest(payload) };
}
