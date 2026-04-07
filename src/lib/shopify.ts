/**
 * Shopify Storefront API client — usable from Server and Client Components.
 *
 * Required env vars:
 *   NEXT_PUBLIC_SHOPIFY_STOREFRONT_TOKEN — public Storefront access token
 *   NEXT_PUBLIC_SHOPIFY_STORE_DOMAIN     — e.g. "my-store.myshopify.com"
 *
 * Collections used:
 *   reserve-pro-shop   — main Pro Shop
 *   private-releases   — exclusive member drops
 */

export const PRO_SHOP_COLLECTION_HANDLE =
  process.env.NEXT_PUBLIC_SHOPIFY_PRO_SHOP_COLLECTION_HANDLE ??
  "reserve-pro-shop";
export const PRIVATE_RELEASES_COLLECTION_HANDLE =
  process.env.NEXT_PUBLIC_SHOPIFY_PRIVATE_RELEASES_COLLECTION_HANDLE ??
  "private-releases";

function requireEnv(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(
      `Missing required env var: ${name}. ` +
        "Add it to your .env.local (client) and deployment environment."
    );
  }
  return value;
}

// process.env.LITERAL_NAME must appear here for Next.js build-time substitution.
const DOMAIN = requireEnv(
  "NEXT_PUBLIC_SHOPIFY_STORE_DOMAIN",
  process.env.NEXT_PUBLIC_SHOPIFY_STORE_DOMAIN
);
const TOKEN = requireEnv(
  "NEXT_PUBLIC_SHOPIFY_STOREFRONT_TOKEN",
  process.env.NEXT_PUBLIC_SHOPIFY_STOREFRONT_TOKEN
);
const ENDPOINT = `https://${DOMAIN}/api/2024-10/graphql.json`;

async function storefrontFetch<T>(
  query: string,
  variables?: Record<string, unknown>,
  revalidate?: number
): Promise<T> {
  const opts: RequestInit & { next?: { revalidate?: number } } = {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Storefront-Access-Token": TOKEN,
    },
    body: JSON.stringify({ query, variables }),
  };

  if (revalidate !== undefined) {
    opts.next = { revalidate };
  }

  const res = await fetch(ENDPOINT, opts);
  if (!res.ok) {
    throw new Error(`Shopify Storefront ${res.status}: ${await res.text()}`);
  }

  const json = (await res.json()) as {
    data: T;
    errors?: { message: string }[];
  };

  if (json.errors?.length) {
    throw new Error(`Shopify GQL errors: ${JSON.stringify(json.errors)}`);
  }

  return json.data;
}

// ─── Public types ─────────────────────────────────────────────────────────────

export interface ShopifyProduct {
  slug: string;
  name: string;
  brand: string;
  collection: string;
  /** Retail / compare-at price */
  price: number;
  /** Member / reserve price (Shopify variant price) */
  reservePrice: number;
  images: string[];
  description: string;
  material: string;
  aboutBrand: string;
  whyWeLikeIt: string;
  sizing: string;
  options: ShopifyProductOption[];
  variants: ShopifyProductVariant[];
  /** First variant GID — required for cart mutations. Undefined if Shopify returned no variants. */
  variantId: string | undefined;
  /** Shopify collection handles this product belongs to (filled when merging collection queries). */
  sourceCollections?: string[];
}

export interface ShopifyProductOption {
  name: string;
  values: string[];
}

export interface ShopifySelectedOption {
  name: string;
  value: string;
}

export interface ShopifyProductVariant {
  id: string;
  title: string;
  price: number;
  reservePrice: number;
  availableForSale: boolean;
  selectedOptions: ShopifySelectedOption[];
}

export interface CartLineInput {
  merchandiseId: string;
  quantity: number;
  attributes?: Array<{ key: string; value: string }>;
}

export interface CartLineUpdateInput {
  id: string;
  quantity: number;
}

export interface BuyerIdentityInput {
  email?: string;
  phone?: string;
  countryCode?: string;
}

export interface CartAttributeInput {
  key: string;
  value: string;
}

export interface ShopifyCartLine {
  id: string;
  variantId: string;
  productSlug: string;
  productName: string;
  brand: string;
  price: number;
  image?: string;
  quantity: number;
}

export interface ShopifyCart {
  id: string;
  checkoutUrl: string;
  lines: ShopifyCartLine[];
  totalAmount: number;
  currency: string;
}

interface CollectionProductsGroup {
  handle: string;
  products: ShopifyProduct[];
}

// ─── Raw GQL shapes ───────────────────────────────────────────────────────────

interface RawVariant {
  id: string;
  title: string;
  price: { amount: string; currencyCode: string };
  compareAtPrice: { amount: string; currencyCode: string } | null;
  availableForSale: boolean;
  selectedOptions: Array<{ name: string; value: string }>;
}

interface RawProduct {
  handle: string;
  title: string;
  vendor: string;
  productType: string;
  description: string;
  options: Array<{ name: string; values: string[] }>;
  variants: { nodes: RawVariant[] };
  images: { nodes: Array<{ url: string }> };
  materialMeta: { value: string } | null;
  aboutBrandMeta: { value: string } | null;
  whyWeLikeItMeta: { value: string } | null;
  sizingMeta: { value: string } | null;
}

interface RawCartLine {
  id: string;
  quantity: number;
  merchandise: {
    id: string;
    price: { amount: string; currencyCode: string };
    product: {
      handle: string;
      title: string;
      vendor: string;
      images: { nodes: Array<{ url: string }> };
    };
  };
}

interface RawCart {
  id: string;
  checkoutUrl: string;
  cost: { totalAmount: { amount: string; currencyCode: string } };
  lines: { nodes: RawCartLine[] };
}

// ─── Mappers ──────────────────────────────────────────────────────────────────

function mapVariant(raw: RawVariant): ShopifyProductVariant {
  const reservePrice = parseFloat(raw.price.amount);
  const price = raw.compareAtPrice
    ? parseFloat(raw.compareAtPrice.amount)
    : reservePrice;

  return {
    id: raw.id,
    title: raw.title,
    price,
    reservePrice,
    availableForSale: raw.availableForSale,
    selectedOptions: raw.selectedOptions,
  };
}

function mapProduct(raw: RawProduct): ShopifyProduct {
  const variants = raw.variants.nodes.map(mapVariant);
  const defaultVariant =
    variants.find((variant) => variant.availableForSale) ?? variants[0];

  return {
    slug: raw.handle,
    name: raw.title,
    brand: raw.vendor,
    collection: raw.productType || "Accessories",
    price: defaultVariant?.price ?? 0,
    reservePrice: defaultVariant?.reservePrice ?? 0,
    images: raw.images.nodes.map((img) => img.url),
    description: raw.description,
    material: raw.materialMeta?.value ?? "",
    aboutBrand: raw.aboutBrandMeta?.value ?? "",
    whyWeLikeIt: raw.whyWeLikeItMeta?.value ?? "",
    sizing: raw.sizingMeta?.value ?? "",
    options: raw.options.map((option) => ({
      name: option.name,
      values: option.values,
    })),
    variants,
    variantId: defaultVariant?.id,
  };
}

function mapCart(raw: RawCart): ShopifyCart {
  return {
    id: raw.id,
    checkoutUrl: raw.checkoutUrl,
    totalAmount: parseFloat(raw.cost.totalAmount.amount),
    currency: raw.cost.totalAmount.currencyCode,
    lines: raw.lines.nodes.map((line) => ({
      id: line.id,
      variantId: line.merchandise.id,
      productSlug: line.merchandise.product.handle,
      productName: line.merchandise.product.title,
      brand: line.merchandise.product.vendor,
      price: parseFloat(line.merchandise.price.amount),
      image: line.merchandise.product.images.nodes[0]?.url,
      quantity: line.quantity,
    })),
  };
}

// ─── GQL field strings ────────────────────────────────────────────────────────

const PRODUCT_FIELDS = `
  handle
  title
  vendor
  productType
  description
  options {
    name
    values
  }
  variants(first: 50) {
    nodes {
      id
      title
      price { amount currencyCode }
      compareAtPrice { amount currencyCode }
      availableForSale
      selectedOptions {
        name
        value
      }
    }
  }
  images(first: 5) {
    nodes { url }
  }
  materialMeta: metafield(namespace: "custom", key: "material") { value }
  aboutBrandMeta: metafield(namespace: "custom", key: "about_brand") { value }
  whyWeLikeItMeta: metafield(namespace: "custom", key: "why_we_like_it") { value }
  sizingMeta: metafield(namespace: "custom", key: "sizing") { value }
`;

const CART_LINE_FIELDS = `
  id
  quantity
  merchandise {
    ... on ProductVariant {
      id
      price { amount currencyCode }
      product {
        handle
        title
        vendor
        images(first: 1) { nodes { url } }
      }
    }
  }
`;

const CART_FIELDS = `
  id
  checkoutUrl
  cost { totalAmount { amount currencyCode } }
  lines(first: 100) {
    nodes { ${CART_LINE_FIELDS} }
  }
`;

// ─── Product queries ──────────────────────────────────────────────────────────

export async function getCollectionProducts(
  collectionHandle: string
): Promise<ShopifyProduct[]> {
  const query = `
    query CollectionProducts($handle: String!) {
      collection(handle: $handle) {
        products(first: 50) {
          nodes { ${PRODUCT_FIELDS} }
        }
      }
    }
  `;

  const data = await storefrontFetch<{
    collection: { products: { nodes: RawProduct[] } } | null;
  }>(query, { handle: collectionHandle }, 3600);

  return (data.collection?.products.nodes ?? []).map(mapProduct);
}

export async function getProductByHandle(
  handle: string
): Promise<ShopifyProduct | null> {
  const query = `
    query ProductByHandle($handle: String!) {
      product(handle: $handle) { ${PRODUCT_FIELDS} }
    }
  `;

  const data = await storefrontFetch<{ product: RawProduct | null }>(
    query,
    { handle },
    3600
  );

  return data.product ? mapProduct(data.product) : null;
}

/**
 * Merge product lists coming from multiple collection handles.
 * Deduplicates by slug and keeps track of source collection handles.
 */
export function mergeCollectionProductsBySlug(
  groups: CollectionProductsGroup[]
): ShopifyProduct[] {
  const bySlug = new Map<string, ShopifyProduct>();

  for (const group of groups) {
    for (const product of group.products) {
      const existing = bySlug.get(product.slug);
      if (!existing) {
        bySlug.set(product.slug, {
          ...product,
          sourceCollections: [group.handle],
        });
        continue;
      }

      bySlug.set(product.slug, {
        ...existing,
        sourceCollections: Array.from(
          new Set([...(existing.sourceCollections ?? []), group.handle])
        ),
      });
    }
  }

  return Array.from(bySlug.values());
}

// ─── Cart mutations ───────────────────────────────────────────────────────────

export async function cartCreate(
  lines: CartLineInput[],
  buyerIdentity?: BuyerIdentityInput,
  attributes?: CartAttributeInput[]
): Promise<ShopifyCart> {
  const query = `
    mutation CartCreate($input: CartInput!) {
      cartCreate(input: $input) {
        cart { ${CART_FIELDS} }
        userErrors { field message }
      }
    }
  `;

  const data = await storefrontFetch<{
    cartCreate: {
      cart: RawCart | null;
      userErrors: Array<{ field: string[]; message: string }>;
    };
  }>(query, { input: { lines, buyerIdentity, attributes } });

  if (!data.cartCreate.cart) {
    throw new Error(
      `cartCreate failed: ${JSON.stringify(data.cartCreate.userErrors)}`
    );
  }

  return mapCart(data.cartCreate.cart);
}

export async function cartAttributesUpdate(
  cartId: string,
  attributes: CartAttributeInput[]
): Promise<ShopifyCart> {
  const query = `
    mutation CartAttributesUpdate(
      $cartId: ID!
      $attributes: [AttributeInput!]!
    ) {
      cartAttributesUpdate(cartId: $cartId, attributes: $attributes) {
        cart { ${CART_FIELDS} }
        userErrors { field message }
      }
    }
  `;

  const data = await storefrontFetch<{
    cartAttributesUpdate: {
      cart: RawCart | null;
      userErrors: Array<{ field: string[]; message: string }>;
    };
  }>(query, { cartId, attributes });

  if (!data.cartAttributesUpdate.cart) {
    throw new Error(
      `cartAttributesUpdate failed: ${JSON.stringify(data.cartAttributesUpdate.userErrors)}`
    );
  }

  return mapCart(data.cartAttributesUpdate.cart);
}

export async function cartLinesAdd(
  cartId: string,
  lines: CartLineInput[]
): Promise<ShopifyCart> {
  const query = `
    mutation CartLinesAdd($cartId: ID!, $lines: [CartLineInput!]!) {
      cartLinesAdd(cartId: $cartId, lines: $lines) {
        cart { ${CART_FIELDS} }
        userErrors { field message }
      }
    }
  `;

  const data = await storefrontFetch<{
    cartLinesAdd: {
      cart: RawCart | null;
      userErrors: Array<{ field: string[]; message: string }>;
    };
  }>(query, { cartId, lines });

  if (!data.cartLinesAdd.cart) {
    throw new Error(
      `cartLinesAdd failed: ${JSON.stringify(data.cartLinesAdd.userErrors)}`
    );
  }

  return mapCart(data.cartLinesAdd.cart);
}

export async function cartLinesRemove(
  cartId: string,
  lineIds: string[]
): Promise<ShopifyCart> {
  const query = `
    mutation CartLinesRemove($cartId: ID!, $lineIds: [ID!]!) {
      cartLinesRemove(cartId: $cartId, lineIds: $lineIds) {
        cart { ${CART_FIELDS} }
        userErrors { field message }
      }
    }
  `;

  const data = await storefrontFetch<{
    cartLinesRemove: {
      cart: RawCart | null;
      userErrors: Array<{ field: string[]; message: string }>;
    };
  }>(query, { cartId, lineIds });

  if (!data.cartLinesRemove.cart) {
    throw new Error(
      `cartLinesRemove failed: ${JSON.stringify(data.cartLinesRemove.userErrors)}`
    );
  }

  return mapCart(data.cartLinesRemove.cart);
}

export async function cartLinesUpdate(
  cartId: string,
  lines: CartLineUpdateInput[]
): Promise<ShopifyCart> {
  const query = `
    mutation CartLinesUpdate($cartId: ID!, $lines: [CartLineUpdateInput!]!) {
      cartLinesUpdate(cartId: $cartId, lines: $lines) {
        cart { ${CART_FIELDS} }
        userErrors { field message }
      }
    }
  `;

  const data = await storefrontFetch<{
    cartLinesUpdate: {
      cart: RawCart | null;
      userErrors: Array<{ field: string[]; message: string }>;
    };
  }>(query, { cartId, lines });

  if (!data.cartLinesUpdate.cart) {
    throw new Error(
      `cartLinesUpdate failed: ${JSON.stringify(data.cartLinesUpdate.userErrors)}`
    );
  }

  return mapCart(data.cartLinesUpdate.cart);
}

export async function updateCartBuyerIdentity(
  cartId: string,
  buyerIdentity: BuyerIdentityInput
): Promise<ShopifyCart> {
  const query = `
    mutation CartBuyerIdentityUpdate(
      $cartId: ID!
      $buyerIdentity: CartBuyerIdentityInput!
    ) {
      cartBuyerIdentityUpdate(cartId: $cartId, buyerIdentity: $buyerIdentity) {
        cart { ${CART_FIELDS} }
        userErrors { field message }
      }
    }
  `;

  const data = await storefrontFetch<{
    cartBuyerIdentityUpdate: {
      cart: RawCart | null;
      userErrors: Array<{ field: string[]; message: string }>;
    };
  }>(query, { cartId, buyerIdentity });

  if (!data.cartBuyerIdentityUpdate.cart) {
    throw new Error(
      `cartBuyerIdentityUpdate failed: ${JSON.stringify(data.cartBuyerIdentityUpdate.userErrors)}`
    );
  }

  return mapCart(data.cartBuyerIdentityUpdate.cart);
}

export async function getCart(cartId: string): Promise<ShopifyCart | null> {
  const query = `
    query GetCart($cartId: ID!) {
      cart(id: $cartId) { ${CART_FIELDS} }
    }
  `;

  const data = await storefrontFetch<{ cart: RawCart | null }>(query, {
    cartId,
  });

  return data.cart ? mapCart(data.cart) : null;
}
