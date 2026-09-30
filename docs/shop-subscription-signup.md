# Mully Reserve clarity and preference-first signup

## Public launch approval

Drew approved deployment without a password on September 30, 2026 at 4:09 PM EDT. The former client-side shop curtain is removed from the landing, product, collection, and gift pages. Login/account authentication and subscription entry-point access behavior are unchanged.

## Subscription and checkout

- The outfit summary says “Subscribe & save”, “$250 / season”, “4 shipments a year”, and explains that Mully uses the $250 seasonal budget to curate new styles.
- Explicit terms state that $250 is charged today and automatically every three months, plus tax/shipping, until cancellation before the next renewal.
- Mobile Reserve pricing remains exclusive to the final review step. At 320×568 the redundant tiny outfit board is hidden to preserve readable terms and a 44px CTA.
- The sole purchased line is the existing quarterly Reserve variant and selling plan. No additional garment charges or discounts.
- Display-only line properties list the top, bottom, and layer with exact color/size/inseam under “First shipment only”. The original order-level packing metadata is retained.
- Display properties may be retained by the subscription provider on renewals. They are not physical inventory lines and must not drive renewal fulfillment.
- Real Shopify checkout from the local build showed all three selections and a $250 subtotal. No order or renewal was placed.

## Membership artwork and Shopify release

`public/shop-redesign/reserve-membership.png` is 1200×1200 generic service artwork using Mully's existing real course photograph and loaded Playfair/Inter typography. It does not promise a particular garment assortment.

After the approved deployment publishes this file, update product `8501257044160`:

- Title: **Mully Reserve | Seasonal Styling Subscription**
- Description: **Mully Reserve is a seasonal styling subscription with a $250 budget for each curated shipment. Start with your selected outfit when enrolling through the outfit builder. Then our team curates new styles for you every three months, four shipments per year. Automatically renews at $250 per shipment, plus applicable tax and shipping. Cancel before your next renewal.**
- Use `https://www.mymully.com/shop-redesign/reserve-membership.png` as the primary/variant image.
- Preserve price, selling plan, variant ID, inventory settings, and UNLISTED status. This shared product's image/title also appears in other Reserve checkout entry points.

## Popup design and behavior

The reference supplied by Drew and the [Bad Birdie live popup](https://badbirdiegolf.com/) were reviewed: a preference choice precedes email, with a split photographic layout, close control, and quiet decline path. Exact production timing could not be established from the browser observation; no claim is made that Mully's timing copies Bad Birdie's settings.

Mully uses cream, espresso, olive, Inter, and Playfair with existing course photography. No mystery discount, false urgency, or new incentive is invented. The pattern is preference → email with consent → optional SMS with separate consent → confirmation.

Timing is a deliberate starting hypothesis, not a claimed conversion optimum. [Klaviyo documents delay, scroll and exit-based targeting](https://help.klaviyo.com/hc/en-us/articles/4413544555547); this implementation uses:

- Main `/shop` page only. No popup on login, support pages, checkout, or subscription-entry landing pages.
- After 15 seconds plus 30% scroll, or desktop exit intent after 15 seconds and interaction.
- After 45 seconds for an interacted visitor as a fallback; no immediate arrival takeover.
- Never open over the password curtain, a native dialog, the cart, an active form input, or while the outfit builder is in view.
- One automatic impression per mount; dismissal suppressed for 14 days in that browser and successful email capture for 365 days. Private browsing or cleared storage resets this.
- Footer “Make it more personal” explicitly reopens the flow.
- Native dialog focus containment, Escape/backdrop dismissal, focus restoration, body scroll locking, reduced-motion support, and 44px-or-larger main controls.
- SMS carries no extra offer and is independently skippable. Email remains saved even when SMS is skipped or fails.

## Storage and consent

The server-side endpoint is `POST /api/shop/signup`.

- Firestore `shop_marketing_leads/{sha256(lowercase-email)}`: normalized email, category interest, optional normalized E.164 phone, separate email/SMS consent evidence, created/updated timestamps, and `sendingStatus: not_synced`.
- Nested `consent_events`: append-only event records for each explicit opt-in, including the exact disclosure/version, timestamp, channel, source and bounded user agent.
- A 30-minute opaque, one-use receipt binds SMS to the saved email step. Only its hash is stored in `shop_signup_sessions`; receipt expiration is checked in code.
- Shared Firestore rate limits allow 12 valid submissions per IP bucket per 10 minutes. The bucket identifier is hashed; raw IP is not stored in the profile.
- Same-origin checks, JSON/body validation, honeypot, atomic writes, dedupe, no PII/error-body logging and no email/phone in analytics events.
- Existing production Firebase rules were read and confirmed default-deny outside user-owned collections. Public read probes for the new lead and receipt collections returned `403 PERMISSION_DENIED`. No Firebase rules were changed.
- Session/rate-limit records include expiry timestamps. Firestore TTL cleanup has not been activated; expired receipts already fail closed in the application. Consent records are not automatically expired.
- No marketing email/SMS is sent, and no Klaviyo subscription, automation or suppression state is changed. A future sending integration must respect provider suppressions and the captured consent channel; capture does not verify ownership or constitute double opt-in.
- The SMS disclosure follows the site's current published cap of four messages/month and includes automated recurring texts, optionality, rates, STOP/HELP, privacy and terms.

## Verification

- 79 tests passed across 17 targeted suites, including invalid/missing consent, email-first persistence, receipt replay rejection, rate limits, errors, optional SMS and exact checkout properties.
- TypeScript and production build passed; scoped ESLint has no errors (two image-component optimization advisories).
- Browser QA confirmed modal CTA separation, real-image swatches, no horizontal overflow, no distorted images and no runtime errors.
- Reserve CTA and terms fit 390×844, 375×667, 320×568 and 1280×720. Popup tested at desktop, 390×844 and 320×568.
- Popup UI success testing used mocked responses to avoid creating false marketing-consent records; backend transactions were covered with unit fixtures. No real visitor was subscribed.

## Separate checkout content issue

Drew's Shopify checkout screenshot also contains “Ships in 2 days” and “96% of members renew”. These are not rendered by the newreserve shop code. They should be reconciled in the Shopify checkout customization before opening preorders publicly, because the shop's stated preorder estimate is about two weeks and no evidence for the renewal statistic was verified in this task.
