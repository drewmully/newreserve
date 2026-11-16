/** Builders for the Admin GraphQL order shape used by src/lib/returns/eligibility.ts. */
export const DAY = 24 * 60 * 60 * 1000;
export const NOW = new Date("2026-11-16T15:00:00.000Z");
export const daysAgo = (n: number, from = NOW) => new Date(from.getTime() - n * DAY).toISOString();

export interface LineOpts {
  id: number;
  title?: string;
  variantTitle?: string | null;
  quantity?: number;
  refundableQuantity?: number;
  price?: string;
  image?: string | null;
  productImage?: string | null;
  attrs?: Array<{ key: string; value: string | null }>;
  sellingPlan?: boolean;
}

export function line(o: LineOpts) {
  return {
    id: `gid://shopify/LineItem/${o.id}`,
    title: o.title ?? `Item ${o.id}`,
    variantTitle: o.variantTitle ?? "M",
    sku: `SKU-${o.id}`,
    quantity: o.quantity ?? 1,
    refundableQuantity: o.refundableQuantity ?? o.quantity ?? 1,
    originalUnitPriceSet: { shopMoney: { amount: o.price ?? "40.00" } },
    image: o.image === null ? null : { url: o.image ?? `https://cdn.shopify.com/${o.id}.jpg` },
    product: { featuredImage: o.productImage ? { url: o.productImage } : null },
    customAttributes: o.attrs ?? [],
    sellingPlan: o.sellingPlan ? { sellingPlanId: "gid://shopify/SellingPlan/1" } : null,
  };
}

export function fulfillment(
  id: number,
  items: Array<{ fli: number; lineItem: number; quantity?: number }>,
  opts: { createdAt?: string; deliveredAt?: string | null; status?: string } = {}
) {
  return {
    id: `gid://shopify/Fulfillment/${id}`,
    status: opts.status ?? "SUCCESS",
    createdAt: opts.createdAt ?? daysAgo(12),
    deliveredAt: opts.deliveredAt === undefined ? daysAgo(10) : opts.deliveredAt,
    fulfillmentLineItems: {
      nodes: items.map((i) => ({
        id: `gid://shopify/FulfillmentLineItem/${i.fli}`,
        quantity: i.quantity ?? 1,
        lineItem: { id: `gid://shopify/LineItem/${i.lineItem}` },
      })),
    },
  };
}

export function ret(status: string, items: Array<{ fli: number; lineItem: number; quantity: number }>) {
  return {
    status,
    returnLineItems: {
      nodes: items.map((i) => ({
        quantity: i.quantity,
        fulfillmentLineItem: {
          id: `gid://shopify/FulfillmentLineItem/${i.fli}`,
          lineItem: { id: `gid://shopify/LineItem/${i.lineItem}` },
        },
      })),
    },
  };
}

export function order(opts: {
  id?: number;
  name?: string;
  email?: string | null;
  createdAt?: string;
  tags?: string[];
  lineItems: ReturnType<typeof line>[];
  fulfillments?: ReturnType<typeof fulfillment>[];
  returns?: ReturnType<typeof ret>[];
}) {
  return {
    id: `gid://shopify/Order/${opts.id ?? 11}`,
    legacyResourceId: String(opts.id ?? 11),
    name: opts.name ?? "#1234",
    email: opts.email === undefined ? "Member@Example.com" : opts.email,
    createdAt: opts.createdAt ?? daysAgo(14),
    tags: opts.tags ?? [],
    lineItems: { nodes: opts.lineItems },
    fulfillments: opts.fulfillments ?? [],
    returns: { nodes: opts.returns ?? [] },
  };
}

/** fetch() mock response helper. */
export const jsonRes = (body: unknown, ok = true, status = 200) => ({
  ok,
  status,
  json: async () => body,
  text: async () => JSON.stringify(body),
});
