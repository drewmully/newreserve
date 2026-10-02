/** Customer Account API, not Admin API. Validated against Shopify's schema.
 * Headless channel permission: customer_write_subscription_contracts.
 * Access tokens are customer-scoped and must never be sent to the browser. */
export const CUSTOMER_IDENTITY_QUERY = `
  query CustomerIdentity { customer { id emailAddress { emailAddress } } }
`;
export const CUSTOMER_CONTRACTS_QUERY = `
  query OutfitSubscriptions($after: String) {
    customer {
      id
      subscriptionContracts(first: 50, after: $after) {
        nodes {
          id status nextBillingDate
          billingPolicy { interval intervalCount { count } }
          lines(first: 50) {
            nodes { id title sku quantity currentPrice { amount currencyCode } }
            pageInfo { hasNextPage endCursor }
          }
        }
        pageInfo { hasNextPage endCursor }
      }
    }
  }
`;
export const CUSTOMER_CONTRACT_ACTIONS = {
  pause: `mutation Pause($id: ID!) { subscriptionContractPause(subscriptionContractId: $id) { contract { id status } userErrors { field message } } }`,
  resume: `mutation Resume($id: ID!) { subscriptionContractActivate(subscriptionContractId: $id) { contract { id status } userErrors { field message } } }`,
  cancel: `mutation Cancel($id: ID!) { subscriptionContractCancel(subscriptionContractId: $id) { contract { id status } userErrors { field message } } }`,
} as const;
export type CustomerContractAction = keyof typeof CUSTOMER_CONTRACT_ACTIONS;
export interface CustomerContract {
  id: string;
  status: string;
  nextBillingDate: string | null;
  billingPolicy: { interval: string; intervalCount: { count: number } | null };
  lines: {
    nodes: Array<{ id: string; title: string; sku: string | null; quantity: number; currentPrice: { amount: string; currencyCode: string } }>;
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
  };
}
export function isOutfitContract(contract: CustomerContract): boolean {
  // Customer Account API does not expose variantId on subscription lines.
  // This is the catalog SKU of product 10250499719360; never match by price.
  return !contract.lines.pageInfo.hasNextPage && contract.lines.nodes.some(line => line.sku === "RES-MEM-SEAS");
}
export function canActOnContract(action: CustomerContractAction, status: string): boolean {
  if (action === "pause") return status === "ACTIVE";
  if (action === "resume") return status === "PAUSED";
  return ["ACTIVE", "PAUSED", "FAILED"].includes(status);
}
export function customerContractForUi(contract: CustomerContract) {
  const lines = contract.lines.nodes;
  const currencies = new Set(lines.map(line => line.currentPrice.currencyCode));
  return {
    id: contract.id,
    status: contract.status,
    title: lines.map(line => line.title).join(", "),
    price: currencies.size === 1 ? lines.reduce((sum, line) => sum + Number(line.currentPrice.amount) * line.quantity, 0) : null,
    currency: currencies.size === 1 ? lines[0]?.currentPrice.currencyCode : null,
    nextBillingDateEpoch: contract.nextBillingDate ? Date.parse(contract.nextBillingDate) / 1000 : null,
    interval: contract.billingPolicy.interval,
    intervalCount: contract.billingPolicy.intervalCount?.count,
  };
}
