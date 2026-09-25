# Combined workbook + private history bridge review

This branch contains an ordinary, two-parent merge, not a replacement or squash:

- Workbook PR 197: `8f0f9dd9b86aced0972c1eb77dd65f467fd5f755`.
- Private bridge PR 198: `76bcd6f3d3f56f1a29fc96728adfb1826157cef4`.
- Merge commit: `342e3bdc2c01cb5fce9bc99dfaf93c53c2b0f058`.
- Normal follow-up merge `3b8114294eb7c5cdf20d80cfcea2f465903d885b`
  incorporates PR 197's fixture cleanup at
  `b6294c1bb0719f31bde22fc6efcb22bb96830cb6`.

The only textual merge conflict was the additive Vercel deployment map. Every
existing guard was retained and `review/workbook-history-combined-041=false`
was committed before publication. Existing crons, SQL 038–040 and their guards
remain unchanged. Nothing is merged to main, activated or deployed here.

The standard Shopify reader retains existing customer/cart/native-offer
metadata. The bridge's separate fixed financial projection remains byte-for-byte
the one reviewed in PR 198: no address, contact, custom attributes or discount
application data. Customer ID is selected only by its explicit separate opt-in
projection. Unselected geography stays unknown; it is not fabricated source
evidence. The original `mapShopifyTransactions` export and provider clock fixes
from the workbook stack remain.

Local combined validation: analytics TypeScript and affected-file ESLint pass;
53 mapper tests pass; all 14 bridge tests pass on disposable loopback PostgreSQL
18.6, including saved 019 spend before Shopify traversal and immutable progress
replay. No hosted/source calls or customer credentials are used. CI's real
PostgreSQL 17 bridge test is a dedicated step after ordinary contracts, avoiding
cluster-wide role-reset races between test databases.

Both dedicated fixtures also remove the three fixed reader-role grants left
in the allowlisted disposable control database before dropping those roles.
This reproduces the ordinary suite's sequential leftovers; role dependencies in
any other database still fail closed. No production migration is rewritten.
The combined late-install baseline additionally includes 041, protecting its
functions, table ACLs, triggers and rows while applying each missing 025–037.

Whole-application TypeScript exposed missing `NODE_ENV` fields in five test
fixtures, including the previously reported Google auth fixtures. Only those
synthetic environment objects are corrected; no runtime configuration changes.

See `WORKBOOK_INTEGRATION_REVIEW.md` for the missing 025–037 installation proof
and production blockers, and `HISTORY_REPORT_BRIDGE.md` for 041's bounded
operator and private pending/report semantics. The bridge does not manufacture
historical eligibility, cash policy, customer permission, independent coverage,
SMS linkage or downstream deletion verification.
