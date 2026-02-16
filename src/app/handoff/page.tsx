import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Developer Handoff | Mully Reserve",
  description: "Internal developer handoff document for wiring the Mully Reserve frontend to production systems.",
  robots: "noindex, nofollow",
};

export default function HandoffPage() {
  return (
    <div className="min-h-screen bg-white">
      <div className="max-w-4xl mx-auto px-6 md:px-12 py-16 md:py-24">
        {/* Header */}
        <div className="mb-16 pb-8 border-b-2 border-gray-900">
          <p className="text-xs tracking-[0.3em] uppercase text-gray-400 font-medium mb-3">
            Internal Document — Do Not Distribute
          </p>
          <h1 className="text-4xl md:text-5xl font-bold text-gray-900 leading-tight mb-4">
            Mully Reserve
            <br />
            Developer Handoff
          </h1>
          <p className="text-lg text-gray-500 max-w-2xl">
            This document explains how to take the new Mully Reserve frontend
            and wire it to production systems. It covers architecture decisions,
            Shopify integration strategy, migration from the old app, and
            step-by-step implementation priorities.
          </p>
        </div>

        {/* Table of Contents */}
        <nav className="mb-16 p-6 bg-gray-50 rounded-xl">
          <h2 className="text-sm font-bold tracking-wider uppercase text-gray-400 mb-4">
            Contents
          </h2>
          <ol className="space-y-2 text-sm">
            {[
              ["1", "Architecture Overview", "#architecture"],
              ["2", "File Structure & Key Files", "#file-structure"],
              ["3", "Shopify → Shop Page Integration", "#shopify-shop"],
              ["4", "Shopify → Product Page Integration", "#shopify-product"],
              ["5", "Cart Architecture", "#cart"],
              ["6", "Identity & Auth (Firebase)", "#identity"],
              ["7", "Store Credit & Subscriptions", "#wallet"],
              ["8", "Landing Page Migration", "#landing-migration"],
              ["9", "Shop Page Migration", "#shop-migration"],
              ["10", "Environment Variables", "#env-vars"],
              ["11", "API Routes to Build", "#api-routes"],
              ["12", "Analytics Wiring", "#analytics"],
              ["13", "Implementation Priority", "#priority"],
              ["14", "Gotchas & Decisions", "#gotchas"],
            ].map(([num, title, href]) => (
              <li key={num}>
                <a
                  href={href}
                  className="text-gray-700 hover:text-gray-900 transition-colors"
                >
                  <span className="text-gray-300 font-mono mr-3">{num}.</span>
                  {title}
                </a>
              </li>
            ))}
          </ol>
        </nav>

        {/* ─── SECTIONS ─── */}
        <div className="prose prose-gray max-w-none">
          {/* 1. Architecture Overview */}
          <Section id="architecture" number="01" title="Architecture Overview">
            <P>
              The new frontend is a standalone Next.js 16 app (App Router, React 19,
              Tailwind v4) that replaces the landing page and shop of the old app. It
              is designed to be the public-facing layer that sits in front of the
              existing backend systems.
            </P>
            <Diagram
              lines={[
                "┌─────────────────────────────────────────────────────────┐",
                "│                     USER BROWSER                       │",
                "└────────────────────────┬────────────────────────────────┘",
                "                         │",
                "                         ▼",
                "┌─────────────────────────────────────────────────────────┐",
                "│              NEXT.JS APP (this repo)                    │",
                "│                                                         │",
                "│  /              Landing page (static)                   │",
                "│  /shop          Product grid (SSR, Shopify data)        │",
                "│  /shop/[slug]   Product detail (SSR, Shopify data)      │",
                "│  /login         Auth page (Firebase)                    │",
                "│  /account       Protected dashboard                     │",
                "│  /api/*         Server routes (cart, wallet, etc.)      │",
                "└────────┬──────────────┬──────────────┬──────────────────┘",
                "         │              │              │",
                "         ▼              ▼              ▼",
                "┌──────────────┐ ┌────────────┐ ┌───────────────┐",
                "│   Shopify    │ │  Firebase   │ │  Loop / n8n   │",
                "│  Storefront  │ │  Auth +     │ │  Subscriptions│",
                "│  + Admin API │ │  Firestore  │ │  + Automation │",
                "└──────────────┘ └────────────┘ └───────────────┘",
              ]}
            />
            <H3>Key Architectural Decisions</H3>
            <UL>
              <li>
                <strong>Server Components by default.</strong> Product data fetching
                happens server-side. Client Components only where interactivity is
                needed (cart, modals, toggles).
              </li>
              <li>
                <strong>Shopify Storefront API for all public data.</strong> Products,
                collections, images, prices — all fetched server-side via Storefront
                API. No Admin API tokens in the browser.
              </li>
              <li>
                <strong>Shopify Admin API via Next.js API routes only.</strong> Store
                credit, customer resolution, and any write operations go through
                server-side API routes.
              </li>
              <li>
                <strong>Static generation where possible.</strong> The landing page is
                fully static. Shop pages use ISR or SSR depending on how frequently
                products change.
              </li>
              <li>
                <strong>Firebase for identity only.</strong> Firebase Auth handles
                login. Firestore is the internal user database. Shopify is the source
                of truth for products, prices, and orders.
              </li>
            </UL>
          </Section>

          {/* 2. File Structure */}
          <Section id="file-structure" number="02" title="File Structure & Key Files">
            <Code
              lines={[
                "src/app/",
                "├── layout.tsx                  # Root layout, fonts, metadata",
                "├── page.tsx                    # Landing page (static, ~880 lines)",
                "├── globals.css                 # Tailwind theme + animations",
                "├── components/",
                "│   └── ClientComponents.tsx    # ScrollReveal, StatCounter, etc.",
                "├── shop/",
                "│   ├── page.tsx                # Shop grid (server component)",
                "│   ├── products.ts             # ⚠️  PLACEHOLDER DATA — replace with Shopify",
                "│   ├── [slug]/",
                "│   │   └── page.tsx            # Product detail (server component)",
                "│   └── components/",
                "│       └── ShopClient.tsx       # ShopGrid, Accordion, ImageModal, Cart btn",
                "├── handoff/",
                "│   └── page.tsx                # This document",
                "│",
                "# TO BE CREATED:",
                "├── login/page.tsx              # Firebase Auth UI",
                "├── account/page.tsx            # Protected dashboard",
                "├── api/",
                "│   ├── shopify/",
                "│   │   ├── products/route.ts   # Proxy to Storefront API",
                "│   │   ├── cart/route.ts        # Cart CRUD",
                "│   │   └── store-credit/route.ts # Admin API → store credit",
                "│   ├── loop/",
                "│   │   └── subscription/route.ts # Loop subscription status",
                "│   └── auth/",
                "│       └── session/route.ts      # Firebase token verification",
              ]}
            />
            <Callout type="warning" title="products.ts is placeholder data">
              The file <code>src/app/shop/products.ts</code> contains 30 hardcoded
              placeholder products. This entire file gets replaced by Shopify
              Storefront API calls. The <code>Product</code> interface is a good
              starting point but needs to be adapted to match Shopify&rsquo;s data
              shape. See Section 3.
            </Callout>
          </Section>

          {/* 3. Shopify → Shop Page */}
          <Section
            id="shopify-shop"
            number="03"
            title="Shopify → Shop Page Integration"
          >
            <P>
              The shop page currently reads from a static <code>products.ts</code>{" "}
              file. The goal is to replace this with live Shopify Storefront API
              data while keeping the exact same UI.
            </P>

            <H3>Step 1: Define the Shopify GraphQL Query</H3>
            <P>
              Products should be fetched from two Shopify collections:{" "}
              <code>reserve-pro-shop</code> and <code>private-releases</code>.
              Each product needs: title, handle (slug), price, images, vendor
              (brand), product type (collection), and description.
            </P>
            <Code
              lines={[
                "// Storefront API GraphQL query",
                "query ShopProducts($collection: String!) {",
                "  collection(handle: $collection) {",
                "    products(first: 100) {",
                "      edges {",
                "        node {",
                "          id",
                "          title",
                "          handle              # → slug",
                "          vendor               # → brand (e.g., 'Titleist')",
                "          productType          # → collection (e.g., 'Apparel')",
                "          descriptionHtml",
                "          priceRange {",
                "            minVariantPrice {",
                "              amount",
                "              currencyCode",
                "            }",
                "          }",
                "          images(first: 5) {",
                "            edges {",
                "              node {",
                "                url",
                "                altText",
                "              }",
                "            }",
                "          }",
                "          metafields(identifiers: [",
                '            { namespace: "custom", key: "material" },',
                '            { namespace: "custom", key: "about_brand" },',
                '            { namespace: "custom", key: "why_we_like_it" },',
                '            { namespace: "custom", key: "sizing" }',
                "          ]) {",
                "            key",
                "            value",
                "          }",
                "          variants(first: 10) {",
                "            edges {",
                "              node {",
                "                id              # needed for cartLinesAdd",
                "                title",
                "                price { amount currencyCode }",
                "                availableForSale",
                "              }",
                "            }",
                "          }",
                "        }",
                "      }",
                "    }",
                "  }",
                "}",
              ]}
            />

            <H3>Step 2: Create a Shopify Client Utility</H3>
            <Code
              lines={[
                "// src/lib/shopify.ts",
                "",
                "const SHOPIFY_DOMAIN = process.env.SHOPIFY_STORE_DOMAIN;",
                "const STOREFRONT_TOKEN = process.env.SHOPIFY_STOREFRONT_TOKEN;",
                "",
                "export async function shopifyFetch<T>(",
                "  query: string,",
                "  variables?: Record<string, unknown>",
                "): Promise<T> {",
                "  const res = await fetch(",
                "    `https://${SHOPIFY_DOMAIN}/api/2024-01/graphql.json`,",
                "    {",
                "      method: 'POST',",
                "      headers: {",
                "        'Content-Type': 'application/json',",
                "        'X-Shopify-Storefront-Access-Token': STOREFRONT_TOKEN!,",
                "      },",
                "      body: JSON.stringify({ query, variables }),",
                "      next: { revalidate: 300 }, // ISR: revalidate every 5 min",
                "    }",
                "  );",
                "  const json = await res.json();",
                "  return json.data;",
                "}",
              ]}
            />

            <H3>Step 3: Replace products.ts with Live Data</H3>
            <P>
              The shop page (<code>/shop/page.tsx</code>) currently imports from{" "}
              <code>products.ts</code>. Replace this with a server-side fetch:
            </P>
            <Code
              lines={[
                "// src/app/shop/page.tsx (updated)",
                "",
                "import { getShopifyProducts } from '@/lib/shopify';",
                "import { ShopGrid } from './components/ShopClient';",
                "",
                "export default async function ShopPage() {",
                "  const products = await getShopifyProducts();",
                "",
                "  // Extract unique brands and collections from live data",
                "  const brands = [...new Set(products.map(p => p.brand))];",
                "  const collections = [...new Set(products.map(p => p.collection))];",
                "",
                "  return (",
                "    // ... same JSX, but now with live data",
                "    <ShopGrid products={products} brands={brands} collections={collections} />",
                "  );",
                "}",
              ]}
            />

            <H3>Step 4: Map Shopify Fields to Our Interface</H3>
            <P>
              The <code>ShopGrid</code> component expects products shaped like our
              current <code>Product</code> interface. Create a transformer:
            </P>
            <Code
              lines={[
                "// src/lib/shopify-transforms.ts",
                "",
                "interface ShopifyProduct { /* raw Storefront API shape */ }",
                "",
                "export function toProduct(node: ShopifyProduct): Product {",
                "  return {",
                "    slug: node.handle,",
                "    name: node.title,",
                "    brand: node.vendor,",
                "    collection: node.productType,",
                "    price: parseFloat(node.priceRange.minVariantPrice.amount),",
                "    images: node.images.edges.map(e => e.node.url),",
                "    description: node.descriptionHtml,",
                "    // Metafields for accordion data",
                "    material: getMetafield(node, 'material') ?? '',",
                "    aboutBrand: getMetafield(node, 'about_brand') ?? '',",
                "    whyWeLikeIt: getMetafield(node, 'why_we_like_it') ?? '',",
                "    sizing: getMetafield(node, 'sizing') ?? '',",
                "    // Variant IDs needed for cart",
                "    variantId: node.variants.edges[0]?.node.id,",
                "  };",
                "}",
              ]}
            />

            <Callout type="decision" title="Where does brand info come from?">
              The <code>BRAND_INFO</code> and <code>COLLECTION_INFO</code> objects
              (blurbs, descriptions, images for the separator cards) can stay
              hardcoded in the frontend for now — this is editorial content, not
              product data. Long term, consider Shopify metaobjects or a CMS.
            </Callout>
          </Section>

          {/* 4. Shopify → Product Page */}
          <Section
            id="shopify-product"
            number="04"
            title="Shopify → Product Page Integration"
          >
            <P>
              Product detail pages currently use <code>generateStaticParams</code>{" "}
              from the hardcoded product list. This needs to switch to Shopify data.
            </P>

            <H3>Option A: ISR with generateStaticParams (Recommended)</H3>
            <Code
              lines={[
                "// src/app/shop/[slug]/page.tsx",
                "",
                "export async function generateStaticParams() {",
                "  const products = await getShopifyProducts();",
                "  return products.map(p => ({ slug: p.slug }));",
                "}",
                "",
                "export const revalidate = 300; // Rebuild every 5 min",
                "",
                "export default async function ProductPage({ params }) {",
                "  const { slug } = await params;",
                "  const product = await getShopifyProductByHandle(slug);",
                "  if (!product) notFound();",
                "",
                "  // ... same component tree, but with live Shopify data",
                "}",
              ]}
            />

            <H3>Option B: Full SSR (if products change frequently)</H3>
            <Code
              lines={[
                "export const dynamic = 'force-dynamic';",
                "",
                "// No generateStaticParams — every request hits Shopify",
                "// Use this only if products change multiple times per day",
              ]}
            />

            <H3>Accordion Data Strategy</H3>
            <P>
              The product detail page shows 5 accordion sections: Description,
              Material, About the Brand, Why We Like It, and Sizing. This data
              should come from:
            </P>
            <UL>
              <li>
                <strong>Description</strong> → <code>product.descriptionHtml</code>{" "}
                from Shopify
              </li>
              <li>
                <strong>Material</strong> → Shopify metafield{" "}
                <code>custom.material</code>
              </li>
              <li>
                <strong>About the Brand</strong> → Can use the{" "}
                <code>BRAND_INFO</code> lookup by <code>product.vendor</code>, or
                a Shopify metafield
              </li>
              <li>
                <strong>Why We Like It</strong> → Shopify metafield{" "}
                <code>custom.why_we_like_it</code>
              </li>
              <li>
                <strong>Sizing</strong> → Shopify metafield{" "}
                <code>custom.sizing</code>
              </li>
            </UL>
            <Callout type="action" title="Set up Shopify metafields">
              In Shopify Admin → Settings → Custom data → Products, create these
              metafields: <code>material</code>, <code>why_we_like_it</code>,{" "}
              <code>sizing</code>. Type: single-line text or rich text. These get
              populated per-product in the Shopify product editor.
            </Callout>
          </Section>

          {/* 5. Cart */}
          <Section id="cart" number="05" title="Cart Architecture">
            <P>
              The &ldquo;Add to Cart&rdquo; button currently shows a brief UI
              confirmation but doesn&rsquo;t persist anything. Here&rsquo;s how to
              wire it to Shopify.
            </P>

            <Diagram
              lines={[
                "User clicks 'Add to Cart'",
                "        │",
                "        ▼",
                "┌──────────────────────────┐",
                "│  Cart exists in state?    │",
                "│  (localStorage + context) │",
                "└──────┬─────────┬─────────┘",
                "       │ No      │ Yes",
                "       ▼         ▼",
                "  cartCreate    cartLinesAdd",
                "  (Storefront)  (Storefront)",
                "       │         │",
                "       ▼         ▼",
                "  Store cart_id in:",
                "  - React Context (runtime)",
                "  - localStorage (fast reload)",
                "  - Firestore users/{uid}/cart (cross-device)",
                "       │",
                "       ▼",
                "  Update cart drawer UI",
                "       │",
                "       ▼",
                "  On 'Checkout' → redirect to cart.checkoutUrl",
              ]}
            />

            <H3>Implementation Steps</H3>
            <OL>
              <li>
                Create a <code>CartProvider</code> context that wraps the app
                in <code>layout.tsx</code>
              </li>
              <li>
                On mount, check <code>localStorage</code> for an existing{" "}
                <code>cart_id</code>. If found, fetch the cart from Shopify to
                validate it&rsquo;s still active.
              </li>
              <li>
                The <code>AddToCartButton</code> in{" "}
                <code>ShopClient.tsx</code> needs to accept a{" "}
                <code>variantId</code> prop and call the cart context&rsquo;s{" "}
                <code>addItem</code> method.
              </li>
              <li>
                Build a slide-out cart drawer component that shows line items,
                quantities, and a checkout button.
              </li>
              <li>
                On checkout, redirect to{" "}
                <code>cart.checkoutUrl</code> — this is a Shopify-hosted checkout
                page.
              </li>
            </OL>

            <H3>Shopify Cart Mutations (Storefront API)</H3>
            <Code
              lines={[
                "# Create cart",
                "mutation cartCreate($input: CartInput!) {",
                "  cartCreate(input: $input) {",
                "    cart { id checkoutUrl lines(first: 50) { edges { node { id quantity merchandise { ... on ProductVariant { id title image { url } product { title handle } price { amount } } } } } } }",
                "  }",
                "}",
                "",
                "# Add lines",
                "mutation cartLinesAdd($cartId: ID!, $lines: [CartLineInput!]!) {",
                "  cartLinesAdd(cartId: $cartId, lines: $lines) {",
                "    cart { id checkoutUrl lines(first: 50) { edges { node { id quantity merchandise { ... on ProductVariant { id title price { amount } product { title } } } } } } }",
                "  }",
                "}",
                "",
                "# Bind identity (after login)",
                "mutation cartBuyerIdentityUpdate($cartId: ID!, $buyerIdentity: CartBuyerIdentityInput!) {",
                "  cartBuyerIdentityUpdate(cartId: $cartId, buyerIdentity: $buyerIdentity) {",
                "    cart { id buyerIdentity { email } }",
                "  }",
                "}",
              ]}
            />

            <Callout type="info" title="Cart mutations are client-safe">
              All Storefront API cart operations use the public storefront token
              and can be called directly from the browser. No server proxy needed
              for basic cart CRUD.
            </Callout>
          </Section>

          {/* 6. Identity */}
          <Section id="identity" number="06" title="Identity & Auth (Firebase)">
            <P>
              Firebase Auth is the identity layer. Every login creates or updates
              a Firestore user document. The header currently shows
              &ldquo;Sign In&rdquo; — this needs to toggle to &ldquo;Account&rdquo;
              when authenticated.
            </P>

            <H3>Auth Flow</H3>
            <OL>
              <li>User clicks &ldquo;Sign In&rdquo; → navigates to <code>/login</code></li>
              <li>Firebase Auth UI (email/password or Google)</li>
              <li>On success → create/update Firestore doc at <code>users/{'{uid}'}</code></li>
              <li>Set auth state in React context</li>
              <li>Header switches to &ldquo;Account&rdquo; link</li>
              <li>Cart binds to user via <code>cartBuyerIdentityUpdate</code></li>
            </OL>

            <H3>Firestore User Document</H3>
            <Code
              lines={[
                "// Firestore: users/{uid}",
                "{",
                '  email: "drew@mully.com",',
                "  created_at: Timestamp,",
                "  last_login: Timestamp,",
                '  shopify_customer_id: "gid://shopify/Customer/...",',
                "  store_credit: {",
                "    balance_cents: 5000,",
                '    currency: "USD",',
                "    last_synced: Timestamp",
                "  },",
                "  subscriptions: {",
                "    mullybox_active: true,",
                "    last_checked: Timestamp",
                "  },",
                "  cart: {",
                '    cart_id: "gid://shopify/Cart/...",',
                "    updated_at: Timestamp",
                "  },",
                '  segments: ["reserve_member", "mullybox_subscriber"]',
                "}",
              ]}
            />

            <H3>Auth-Dependent UI Changes</H3>
            <UL>
              <li>
                <strong>Header:</strong> &ldquo;Sign In&rdquo; → &ldquo;Account&rdquo;
                (all pages share this header pattern)
              </li>
              <li>
                <strong>Product pages:</strong> &ldquo;Add to Cart&rdquo; works for
                everyone, but logged-in users get cart persistence across devices
              </li>
              <li>
                <strong>Landing page email form:</strong> Pre-fill email if logged in;
                skip form entirely if already a member
              </li>
            </UL>
          </Section>

          {/* 7. Wallet */}
          <Section
            id="wallet"
            number="07"
            title="Store Credit & Subscriptions"
          >
            <P>
              These are account-level features that show on the account dashboard.
              They don&rsquo;t affect the shop or landing page directly, but the
              infrastructure needs to exist.
            </P>

            <H3>Store Credit (Wallet)</H3>
            <Code
              lines={[
                "// API Route: GET /api/shopify/store-credit",
                "",
                "1. Verify Firebase ID token from Authorization header",
                "2. Load Firestore user doc → get shopify_customer_id",
                "3. If no shopify_customer_id → resolve via Admin API (customer by email)",
                "4. Query Shopify Admin API for store credit balance",
                "5. Cache result in Firestore (store_credit.balance_cents, last_synced)",
                "6. Return { balance_cents, currency } to client",
              ]}
            />

            <H3>Subscription Status (Loop)</H3>
            <Code
              lines={[
                "// API Route: GET /api/loop/subscription-status",
                "",
                "1. Verify Firebase ID token",
                "2. Resolve Shopify customer ID",
                "3. Query Loop API for active subscription",
                "4. Update Firestore subscription fields",
                "5. Return { active: boolean, plan: string } to client",
              ]}
            />
          </Section>

          {/* 8. Landing Page Migration */}
          <Section
            id="landing-migration"
            number="08"
            title="Landing Page Migration"
          >
            <P>
              The landing page (<code>/page.tsx</code>) is almost entirely static
              and self-contained. Migrating it from the old app is straightforward.
            </P>

            <H3>What Stays the Same</H3>
            <UL>
              <li>All visual components, animations, and styling</li>
              <li>The hero section with product images</li>
              <li>Social proof counters</li>
              <li>Benefit cards, philosophy section, membership tiers</li>
              <li>&ldquo;How It Works&rdquo; section</li>
              <li>Recent releases grid</li>
              <li>Footer</li>
            </UL>

            <H3>What Needs Wiring</H3>
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="border-b-2 border-gray-200">
                  <th className="text-left py-3 pr-4 font-semibold text-gray-900">
                    Element
                  </th>
                  <th className="text-left py-3 pr-4 font-semibold text-gray-900">
                    Currently
                  </th>
                  <th className="text-left py-3 font-semibold text-gray-900">
                    Wire To
                  </th>
                </tr>
              </thead>
              <tbody className="text-gray-600">
                <tr className="border-b border-gray-100">
                  <td className="py-3 pr-4">Email signup form</td>
                  <td className="py-3 pr-4">No-op</td>
                  <td className="py-3">
                    Firestore <code>leads</code> collection + SendGrid welcome
                    email
                  </td>
                </tr>
                <tr className="border-b border-gray-100">
                  <td className="py-3 pr-4">Stat counters</td>
                  <td className="py-3 pr-4">Hardcoded (2400+, 40+, etc.)</td>
                  <td className="py-3">
                    Keep hardcoded for now. Optional: Firestore config doc for
                    easy updates without deploys.
                  </td>
                </tr>
                <tr className="border-b border-gray-100">
                  <td className="py-3 pr-4">Recent releases grid</td>
                  <td className="py-3 pr-4">Hardcoded cards</td>
                  <td className="py-3">
                    Shopify Storefront API — fetch latest 3 products from{" "}
                    <code>private-releases</code> collection
                  </td>
                </tr>
                <tr className="border-b border-gray-100">
                  <td className="py-3 pr-4">&ldquo;Sign In&rdquo; header link</td>
                  <td className="py-3 pr-4">Links to <code>/login</code></td>
                  <td className="py-3">
                    Firebase auth state → toggle Sign In / Account
                  </td>
                </tr>
                <tr className="border-b border-gray-100">
                  <td className="py-3 pr-4">Tier &ldquo;Get Started&rdquo; / &ldquo;Join Now&rdquo; buttons</td>
                  <td className="py-3 pr-4">Href <code>#</code></td>
                  <td className="py-3">
                    Scroll to email form, or navigate to <code>/login</code> with
                    tier query param
                  </td>
                </tr>
                <tr className="border-b border-gray-100">
                  <td className="py-3 pr-4">Partner logos</td>
                  <td className="py-3 pr-4">Text names</td>
                  <td className="py-3">Replace with real SVG logos when available</td>
                </tr>
              </tbody>
            </table>
          </Section>

          {/* 9. Shop Page Migration */}
          <Section
            id="shop-migration"
            number="09"
            title="Shop Page Migration"
          >
            <P>
              The shop page is the biggest integration point. Here is the exact
              migration path.
            </P>

            <H3>Phase 1: Replace Static Data (Day 1-2)</H3>
            <OL>
              <li>
                Create <code>src/lib/shopify.ts</code> with the Storefront API
                client (see Section 3)
              </li>
              <li>
                Write <code>getShopifyProducts()</code> that fetches from{" "}
                <code>reserve-pro-shop</code> and <code>private-releases</code>,
                transforms to our <code>Product</code> shape
              </li>
              <li>
                Update <code>/shop/page.tsx</code> to call this instead of
                importing from <code>products.ts</code>
              </li>
              <li>
                Update <code>/shop/[slug]/page.tsx</code> — replace{" "}
                <code>getProductBySlug</code> with{" "}
                <code>getShopifyProductByHandle</code>
              </li>
              <li>
                Update <code>generateStaticParams</code> to pull slugs from
                Shopify
              </li>
              <li>
                Delete <code>products.ts</code> (or keep as fallback during
                development)
              </li>
            </OL>

            <H3>Phase 2: Cart Integration (Day 3-4)</H3>
            <OL>
              <li>
                Create <code>CartProvider</code> context with Shopify Storefront
                cart mutations
              </li>
              <li>
                Update <code>AddToCartButton</code> to accept{" "}
                <code>variantId</code> and call <code>addItem</code>
              </li>
              <li>Build cart drawer component (slide-out panel)</li>
              <li>Wire checkout button to <code>cart.checkoutUrl</code></li>
              <li>
                Add variant selector to product detail page if products have
                multiple variants (size, color)
              </li>
            </OL>

            <H3>Phase 3: Auth + Persistence (Day 5-6)</H3>
            <OL>
              <li>
                Build <code>/login</code> page with Firebase Auth
              </li>
              <li>
                Create <code>AuthProvider</code> context
              </li>
              <li>
                Wire cart persistence to Firestore on login
              </li>
              <li>
                Update header across all pages (Sign In ↔ Account)
              </li>
              <li>
                Bind cart to Shopify buyer identity on login
              </li>
            </OL>

            <H3>Phase 4: Polish (Day 7+)</H3>
            <UL>
              <li>Real product images (replace placeholders)</li>
              <li>Loading states for product grid and detail pages</li>
              <li>Error handling for Shopify API failures</li>
              <li>
                SEO: <code>generateMetadata</code> from live Shopify data
              </li>
              <li>Analytics events (see Section 12)</li>
            </UL>
          </Section>

          {/* 10. Environment Variables */}
          <Section id="env-vars" number="10" title="Environment Variables">
            <Code
              lines={[
                "# .env.local",
                "",
                "# Shopify Storefront API (client-safe, used in browser + server)",
                "NEXT_PUBLIC_SHOPIFY_STORE_DOMAIN=your-store.myshopify.com",
                "NEXT_PUBLIC_SHOPIFY_STOREFRONT_TOKEN=xxxxxxxxxxxx",
                "",
                "# Shopify Admin API (server-only, NEVER expose to browser)",
                "SHOPIFY_ADMIN_TOKEN=shpat_xxxxxxxxxxxx",
                "",
                "# Firebase (client-safe)",
                "NEXT_PUBLIC_FIREBASE_API_KEY=xxxxxxxxxxxx",
                "NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=your-app.firebaseapp.com",
                "NEXT_PUBLIC_FIREBASE_PROJECT_ID=your-project-id",
                "",
                "# Firebase Admin (server-only)",
                "FIREBASE_SERVICE_ACCOUNT_KEY='{...}'",
                "",
                "# Loop (server-only)",
                "LOOP_API_KEY=xxxxxxxxxxxx",
                "",
                "# Analytics",
                "NEXT_PUBLIC_META_PIXEL_ID=xxxxxxxxxxxx",
                "NEXT_PUBLIC_GA_MEASUREMENT_ID=G-XXXXXXXXXX",
                "NEXT_PUBLIC_POSTHOG_KEY=phc_xxxxxxxxxxxx",
              ]}
            />
            <Callout type="warning" title="SHOPIFY_ADMIN_TOKEN is server-only">
              The Admin API token must never appear in client-side code. Only use
              it in API routes (<code>src/app/api/*</code>) and server
              components. Prefix with <code>NEXT_PUBLIC_</code> only for values
              that are safe for the browser.
            </Callout>
          </Section>

          {/* 11. API Routes */}
          <Section id="api-routes" number="11" title="API Routes to Build">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="border-b-2 border-gray-200">
                  <th className="text-left py-3 pr-4 font-semibold text-gray-900">
                    Route
                  </th>
                  <th className="text-left py-3 pr-4 font-semibold text-gray-900">
                    Method
                  </th>
                  <th className="text-left py-3 pr-4 font-semibold text-gray-900">
                    Auth
                  </th>
                  <th className="text-left py-3 font-semibold text-gray-900">
                    Purpose
                  </th>
                </tr>
              </thead>
              <tbody className="text-gray-600">
                {[
                  [
                    "/api/shopify/store-credit",
                    "GET",
                    "Required",
                    "Fetch store credit balance from Admin API",
                  ],
                  [
                    "/api/shopify/resolve-customer",
                    "GET",
                    "Required",
                    "Resolve Shopify customer ID by email",
                  ],
                  [
                    "/api/loop/subscription",
                    "GET",
                    "Required",
                    "Check Mullybox subscription status",
                  ],
                  [
                    "/api/auth/session",
                    "POST",
                    "None",
                    "Verify Firebase token, create/update Firestore user",
                  ],
                  [
                    "/api/leads",
                    "POST",
                    "None",
                    "Save email from landing page signup form",
                  ],
                  [
                    "/api/registry",
                    "POST",
                    "Required",
                    "Submit registry application",
                  ],
                ].map(([route, method, auth, purpose]) => (
                  <tr key={route} className="border-b border-gray-100">
                    <td className="py-3 pr-4">
                      <code className="text-xs">{route}</code>
                    </td>
                    <td className="py-3 pr-4">{method}</td>
                    <td className="py-3 pr-4">{auth}</td>
                    <td className="py-3">{purpose}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <P>
              &ldquo;Auth Required&rdquo; means the route expects a Firebase ID
              token in the <code>Authorization: Bearer</code> header and verifies
              it server-side before processing.
            </P>
          </Section>

          {/* 12. Analytics */}
          <Section id="analytics" number="12" title="Analytics Wiring">
            <H3>Events to Track</H3>
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="border-b-2 border-gray-200">
                  <th className="text-left py-3 pr-4 font-semibold text-gray-900">
                    Event
                  </th>
                  <th className="text-left py-3 pr-4 font-semibold text-gray-900">
                    Trigger
                  </th>
                  <th className="text-left py-3 font-semibold text-gray-900">
                    Platforms
                  </th>
                </tr>
              </thead>
              <tbody className="text-gray-600">
                {[
                  ["PageView", "Every page load", "Meta, GA, PostHog"],
                  ["ViewContent", "Product detail page viewed", "Meta, GA"],
                  ["AddToCart", "Add to Cart clicked", "Meta, GA, PostHog"],
                  ["InitiateCheckout", "Checkout button clicked", "Meta, GA"],
                  ["Purchase", "Shopify webhook (server-side)", "Meta, GA"],
                  ["SignUp", "Email form submitted on landing page", "Meta, GA, PostHog"],
                  ["Login", "Firebase auth success", "PostHog"],
                  ["WalletViewed", "Account page wallet section loaded", "PostHog"],
                  ["BrandCardClicked", "Brand/collection modal opened", "PostHog"],
                  ["ToggleView", "Brand ↔ Collection toggle switched", "PostHog"],
                ].map(([event, trigger, platforms]) => (
                  <tr key={event} className="border-b border-gray-100">
                    <td className="py-3 pr-4 font-medium text-gray-900">
                      {event}
                    </td>
                    <td className="py-3 pr-4">{trigger}</td>
                    <td className="py-3">{platforms}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            <H3>Implementation</H3>
            <P>
              Create a single analytics utility (<code>src/lib/analytics.ts</code>)
              that normalizes events across all platforms. Each event call should
              fan out to Meta Pixel, GA4, and PostHog simultaneously. Include{" "}
              <code>user_id</code> and <code>email</code> (where allowed) on
              every event.
            </P>
          </Section>

          {/* 13. Priority */}
          <Section
            id="priority"
            number="13"
            title="Implementation Priority"
          >
            <P>
              Work in this order. Each phase is deployable independently.
            </P>
            <div className="space-y-4">
              {[
                {
                  phase: "Phase 1",
                  title: "Deploy Static Frontend",
                  days: "Day 1",
                  items: [
                    "Deploy this Next.js app as-is (landing page + shop with placeholder data)",
                    "Point domain to new app",
                    "Verify all pages render correctly",
                    "Old app stays running for /account, /login, etc.",
                  ],
                },
                {
                  phase: "Phase 2",
                  title: "Shopify Product Data",
                  days: "Day 2-3",
                  items: [
                    "Build Shopify Storefront API client",
                    "Replace products.ts with live Shopify data",
                    "Set up Shopify metafields for accordion content",
                    "Verify product pages render with real images and data",
                  ],
                },
                {
                  phase: "Phase 3",
                  title: "Cart & Checkout",
                  days: "Day 4-5",
                  items: [
                    "Build CartProvider with Shopify cart mutations",
                    "Wire Add to Cart buttons",
                    "Build cart drawer",
                    "Wire checkout redirect",
                  ],
                },
                {
                  phase: "Phase 4",
                  title: "Auth & Identity",
                  days: "Day 6-7",
                  items: [
                    "Build /login page with Firebase Auth",
                    "Create AuthProvider context",
                    "Wire cart persistence to Firestore",
                    "Build /account page shell",
                    "Toggle header Sign In / Account",
                  ],
                },
                {
                  phase: "Phase 5",
                  title: "Wallet, Subscriptions, Analytics",
                  days: "Day 8-10",
                  items: [
                    "Build store credit API route + account UI",
                    "Build Loop subscription API route + account UI",
                    "Wire analytics events across all platforms",
                    "Email signup form → Firestore + SendGrid",
                  ],
                },
              ].map((p) => (
                <div
                  key={p.phase}
                  className="border border-gray-200 rounded-lg p-5"
                >
                  <div className="flex items-baseline justify-between mb-2">
                    <h4 className="font-bold text-gray-900">
                      {p.phase}: {p.title}
                    </h4>
                    <span className="text-xs text-gray-400 font-mono">
                      {p.days}
                    </span>
                  </div>
                  <ul className="space-y-1">
                    {p.items.map((item, i) => (
                      <li
                        key={i}
                        className="text-sm text-gray-600 flex items-start gap-2"
                      >
                        <span className="text-gray-300 mt-0.5">&#9744;</span>
                        {item}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </Section>

          {/* 14. Gotchas */}
          <Section
            id="gotchas"
            number="14"
            title="Gotchas & Decisions"
          >
            <div className="space-y-6">
              <Gotcha title="Shopify product handles must match our slugs">
                The current app uses <code>/shop/[slug]</code> where slug comes
                from our <code>products.ts</code> (e.g.,{" "}
                <code>titleist-tour-soft-ball</code>). When switching to
                Shopify, the slug becomes the Shopify product handle. Make sure
                product handles in Shopify are clean, URL-friendly strings.
                Shopify auto-generates handles from product titles — verify
                they&rsquo;re reasonable before going live.
              </Gotcha>

              <Gotcha title="Brand/Collection separator cards are editorial, not Shopify">
                The <code>BRAND_INFO</code> and <code>COLLECTION_INFO</code>{" "}
                objects (blurbs, descriptions, modal content) are hardcoded in
                the frontend. They don&rsquo;t come from Shopify. This is
                intentional — it&rsquo;s curated editorial content. When adding a
                new brand, you need to update both Shopify (add products) and
                the frontend (add brand info).
              </Gotcha>

              <Gotcha title="products.ts can coexist during development">
                You don&rsquo;t have to delete <code>products.ts</code>{" "}
                immediately. During development, you can conditionally fall back
                to placeholder data if the Shopify fetch fails. This lets you
                work on the UI without needing a live Shopify connection.
              </Gotcha>

              <Gotcha title="Cart mutations are client-side, but product fetching is server-side">
                Product data flows: Shopify Storefront API → Next.js server →
                rendered HTML. Cart mutations flow: browser → Shopify Storefront
                API directly. This is the correct split — products are read-heavy
                and benefit from server rendering + caching. Cart operations are
                write-heavy and need to be instant.
              </Gotcha>

              <Gotcha title="The landing page has no Shopify dependency except Recent Releases">
                The only section of the landing page that touches Shopify is
                &ldquo;Recent Releases&rdquo; (currently hardcoded as 3 cards).
                Everything else is static. This means you can deploy the landing
                page immediately, even before Shopify integration is complete.
              </Gotcha>

              <Gotcha title="Header component is duplicated across pages">
                The header (logo + Sign In) is duplicated in{" "}
                <code>page.tsx</code>, <code>shop/page.tsx</code>, and{" "}
                <code>shop/[slug]/page.tsx</code>. When adding auth state, either
                extract this into a shared component in{" "}
                <code>layout.tsx</code> or create a{" "}
                <code>components/Header.tsx</code> that all pages import. This is
                the right time to deduplicate.
              </Gotcha>

              <Gotcha title="Variant selection UI doesn't exist yet">
                The current product detail page has no size/color selector. If
                Shopify products have multiple variants, you&rsquo;ll need to add
                a variant picker component between the price and the Add to Cart
                button. The <code>variantId</code> passed to cart mutations must
                be the selected variant, not just the first one.
              </Gotcha>

              <Gotcha title="next.config.ts uses standalone output">
                The app is configured for Docker deployment with{" "}
                <code>output: &quot;standalone&quot;</code>. This is correct for
                production. If deploying to Vercel instead, you can remove this
                setting.
              </Gotcha>
            </div>
          </Section>
        </div>

        {/* Footer */}
        <div className="mt-20 pt-8 border-t-2 border-gray-900">
          <p className="text-sm text-gray-400">
            Mully Reserve Developer Handoff — Internal Use Only
          </p>
          <p className="text-xs text-gray-300 mt-1">
            Generated from the current codebase. Keep this document updated as
            integration progresses.
          </p>
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════
   LAYOUT COMPONENTS
   ═══════════════════════════════════════════ */

function Section({
  id,
  number,
  title,
  children,
}: {
  id: string;
  number: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="mb-20 scroll-mt-8">
      <div className="flex items-baseline gap-4 mb-6 pb-3 border-b border-gray-200">
        <span className="font-mono text-sm text-gray-300 shrink-0">
          {number}
        </span>
        <h2 className="text-2xl font-bold text-gray-900">{title}</h2>
      </div>
      <div className="space-y-4">{children}</div>
    </section>
  );
}

function P({ children }: { children: React.ReactNode }) {
  return <p className="text-base text-gray-600 leading-relaxed">{children}</p>;
}

function H3({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="text-lg font-semibold text-gray-900 mt-8 mb-3">
      {children}
    </h3>
  );
}

function UL({ children }: { children: React.ReactNode }) {
  return (
    <ul className="space-y-2 text-sm text-gray-600 list-disc list-outside ml-5">
      {children}
    </ul>
  );
}

function OL({ children }: { children: React.ReactNode }) {
  return (
    <ol className="space-y-2 text-sm text-gray-600 list-decimal list-outside ml-5">
      {children}
    </ol>
  );
}

function Code({ lines }: { lines: string[] }) {
  return (
    <pre className="bg-gray-950 text-gray-300 text-xs leading-relaxed rounded-lg p-5 overflow-x-auto my-4">
      <code>{lines.join("\n")}</code>
    </pre>
  );
}

function Diagram({ lines }: { lines: string[] }) {
  return (
    <pre className="bg-gray-50 text-gray-500 text-xs leading-relaxed rounded-lg p-5 overflow-x-auto my-4 font-mono">
      {lines.join("\n")}
    </pre>
  );
}

function Callout({
  type,
  title,
  children,
}: {
  type: "warning" | "info" | "decision" | "action";
  title: string;
  children: React.ReactNode;
}) {
  const styles = {
    warning: "bg-amber-50 border-amber-200 text-amber-900",
    info: "bg-blue-50 border-blue-200 text-blue-900",
    decision: "bg-purple-50 border-purple-200 text-purple-900",
    action: "bg-emerald-50 border-emerald-200 text-emerald-900",
  };

  const labels = {
    warning: "Warning",
    info: "Info",
    decision: "Decision Point",
    action: "Action Required",
  };

  return (
    <div className={`border rounded-lg p-5 my-4 ${styles[type]}`}>
      <div className="flex items-center gap-2 mb-2">
        <span className="text-[10px] tracking-widest uppercase font-bold opacity-60">
          {labels[type]}
        </span>
      </div>
      <p className="font-semibold text-sm mb-1">{title}</p>
      <p className="text-sm opacity-80 leading-relaxed">{children}</p>
    </div>
  );
}

function Gotcha({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="border-l-4 border-gray-900 pl-5">
      <h4 className="font-semibold text-sm text-gray-900 mb-1">{title}</h4>
      <p className="text-sm text-gray-500 leading-relaxed">{children}</p>
    </div>
  );
}
