# Shopify subscription access: limited production verification

This isolated change is authorized by Drew's October 8 instruction to change production for the subscription-access check. It does not merge draft PR #284 or activate lifecycle flows.

## Scope

- Run a read-only check during a production build, using the existing `SHOPIFY_SUBSCRIPTIONS_TOKEN` inside Vercel.
- Verify the exact Mullybox shop and the public client identity of `mully-subscriptions-api`.
- Check granted contract scopes, then inspect at most five contracts if a suitable scope is present.
- Emit only sanitized booleans, aggregate counts and allowlisted failure codes into build logs.
- Skip previews, local builds and all builds at or after **October 9, 2026 at 02:00 UTC / October 8 at 10 p.m. EDT**.

The diagnostic uses the existing `npm run build` lifecycle through `prebuild`. It does not change project environment settings. Network failures do not prevent the normal storefront build; a failure is a verification result, not an instruction to retry or change credentials.

## Safety boundaries

There is no public endpoint, customer-level output, customer-account token, alternate Admin-token fallback, raw response logging or secret export. The two requests are fixed GraphQL queries to the exact store host, with redirects blocked and a twelve-second timeout each. No mutation, webhook registration, billing attempt, migration, profile update, consent change or email send is possible through this script.

Do not use `CRON_SECRET`, call migration routes, reinstall an app or switch `SUBSCRIPTIONS_BACKEND` for this test.

## Interpretation

Shopify's [SubscriptionContract documentation](https://shopify.dev/docs/api/admin-graphql/latest/objects/SubscriptionContract) requires `read_own_subscription_contracts` or `write_own_subscription_contracts`. A successful read, including an empty list, does not establish coverage of contracts owned by other apps.

This probe intentionally reports `storewideCoverageVerified: false`, `nativeShopifyCoverageVerified: false`, `billingHistoryVerified: false` and `dispatchEligible: false` on every successful sample. It is not the production lifecycle adapter or a paid-cycle backfill.

## Verification and rollback

Run `node --test scripts/diagnose-shopify-subscriptions.test.cjs`. Tests use synthetic credentials and mocked responses; they do not contact Shopify. Both GraphQL queries were validated against Shopify's schema before implementation.

After release, read the sanitized `[shopify-subscriptions-access]` build-log entry and verify the deployment is Ready on the expected commit and production domain. Remove `prebuild` or revert this isolated commit to remove the build hook; there is no data migration to reverse. The time cutoff independently stops network access even if the hook remains.
