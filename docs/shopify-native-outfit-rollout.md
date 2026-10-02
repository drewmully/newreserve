# Shopify-native outfit subscriptions

## Scope

Only the outfit-builder subscription changes to product `10250499719360`, variant `50408581267648`, selling plan `6627721408`, SKU `RES-MEM-SEAS`, at USD 299.95 every three months. Selected garments remain visible first-shipment instructions, not additional priced subscription lines. Existing Loop subscriptions and other subscription entry points remain unchanged.

The existing MyMully account UX reads Shopify-native contracts and offers pause, resume, and cancellation through the authenticated customer's Customer Account API. Shopify Subscriptions remains the billing application. This does not migrate contracts or enable the older Admin API migration scaffold.

## Required merchant configuration

Configure a public Customer Account API client in the Shopify Headless channel:

- Enable `customer_read_customers` and `customer_write_subscription_contracts`.
- Register exactly `https://www.mymully.com/api/shopify-customer/callback`.
- Provide its public client ID as server environment variable `SHOPIFY_CUSTOMER_ACCOUNT_CLIENT_ID`.
- Generate a dedicated random 32-byte key, base64 encoded, as server environment variable `SHOPIFY_CUSTOMER_SESSION_SECRET`. Do not expose it to the browser, source control, or logs.
- Keep `SHOPIFY_NATIVE_SUBSCRIPTIONS_ENABLED` unset or `false` until the launch checks below pass. This flag gates only new outfit subscriptions.
- Do not set the unrelated global `SUBSCRIPTIONS_BACKEND=shopify` flag.

The client ID is public configuration, not an Admin API token. A Shopify-hosted subscription management URL is not needed. Shopify authentication may require email verification; the customer returns to MyMully to manage their subscription. Shopify documents these permissions in its [API access scopes](https://shopify.dev/docs/api/usage/access-scopes) and the public-client flow in [Customer Account API authentication](https://shopify.dev/docs/storefronts/headless/building-with-the-customer-account-api/authenticate-customers).

## Identity and security

- Firebase bearer authentication is required before connection or contract operations.
- The OAuth authorization-code flow uses S256 PKCE, high-entropy state, a secure HttpOnly same-site cookie, a fixed callback, and one-use ten-minute server state.
- Verified Firebase and Shopify email addresses must match. Existing Shopify customer IDs must also match before linkage.
- OAuth credentials are AES-256-GCM encrypted in Admin-only `shopify_customer_sessions` documents. One-use PKCE state is in `shopify_customer_oauth_states`. Verify deployed Firestore rules deny all client access to both collections; repository rules default to deny.
- Refresh-token rotation is serialized with a server-side lease.
- Each mutation obtains the current customer's contract list and requires the requested ID to belong to that customer and contain the specific native SKU. Do not reuse this SKU for Loop contracts.
- Readiness fails closed without configuration plus explicit enablement. This is a rollout control, not a replacement for Shopify's selling-plan rules.

## Required launch verification

1. Repository checks and production build pass. Obtain deployment approval before merge and production changes.
2. Configure the public client and encryption key, keeping new enrollment disabled.
3. Use an authorized test customer's Firebase sign-in and Shopify verification to test the complete redirect and return flow. Verify correct customer ID binding, encrypted storage, refresh, and absence of tokens in browser responses.
4. Confirm live contract status, renewal date, and price inside MyMully. Pause, resume, or cancel only an explicitly authorized test contract; no real customer mutations are implied by this rollout.
5. Verify paid-order account provisioning with an authorized test transaction or signed test webhook. Unit tests use mocks and do not prove live webhook delivery.
6. Confirm existing Loop management, guest/returning-customer checkout, and ordinary retail checkout remain unchanged.
7. Correct the product description's rounded `$299` wording to `$299.95` after approval. Preserve product status, selling-plan cadence, and price.
8. Enable `SHOPIFY_NATIVE_SUBSCRIPTIONS_ENABLED=true` only after the live checks succeed. Verify the checkout has exactly the new subscription variant and selling plan at $299.95, plus selected first-shipment details. Do not submit payment without approval.

## Verification completed during implementation

The Storefront cart was inspected with the new variant, plan, $299.95 price, and visible first-shipment details before adding the enrollment gate. No payment was submitted. Customer API query and action shapes were validated against the documented schema. Focused tests cover checkout, order provisioning, legacy state, account UI, OAuth security, refresh handling, ownership, and failure cases.

Live OAuth and contract actions remain unverified until merchant configuration is supplied. Automated tests use mocked providers. No customer email, paid test order, or real contract mutation was performed.

## Limits and rollback

The paid-order receipt provides account linkage, not authoritative active-contract status. The management modal obtains live status from Shopify. There is no new background lifecycle-to-tier reconciliation job in this change. Native plan changes, billing-method editing, address editing, and skip actions are not included.

Disable `SHOPIFY_NATIVE_SUBSCRIPTIONS_ENABLED` to stop new outfit enrollment while retaining account management for existing native customers. Do not disable account management after customers have enrolled. Keep the session encryption key stable; rotating it requires reconnecting existing customer sessions. Existing Loop routes remain unchanged.
