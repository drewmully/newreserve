# The Mully Letter: newsletter archive

Every editorial email Mully sends is republished as a permanent Journal post in
the collection at [/blog/letters](https://www.mymully.com/blog/letters).

## How it works

- Posts are normal rows in the Supabase `blog_posts` table. The `category`
  column has a check constraint (Gear, Travel, The Craft, Inside the Reserve,
  Guides, Partners), so there is no new category value and no migration.
  Issues are stored with `category = 'The Craft'` and belong to the
  collection because their slug is listed in `src/lib/letterIssues.ts`
  (code-level collection config). The site shows them as "The Mully Letter".
- `src/lib/newsletterCollection.ts` holds the collection config (path, title,
  meta description, intro, subscribe link) and the Article JSON-LD builder.
- `src/app/blog/letters/page.tsx` lists issues newest first
  (`getPublishedPostsByCategory`). It is in the sitemap; posts come in through
  the existing `blog_posts` sitemap query.
- `src/app/blog/[slug]/page.tsx` adds, for letter posts only: the
  "Originally sent to Mully subscribers on <date>." line, Article JSON-LD with
  `datePublished` = send time, a link back to the collection and the
  subscribe signup in two places: a compact line after the intro bullets and
  a card at the end. Both link to the existing `/join` signup with the button
  "Get the Mully Letter" and report `blog_cta_viewed` / `blog_cta_clicked`
  with `block: "letter_signup"` and `placement: "inline"` or `"end"`.
- Dates show one way on every letter surface: "November 8, 2026" (Eastern
  time, from `publish_date`).
- Images are copied into the repo at `public/newsletters/<slug>/` and served
  from mymully.com. Posts never hot-link the Klaviyo CDN. The first email
  photo becomes the post hero and is not repeated inside a section.
- Product mentions are inline links to `/shop/<handle>`. The blog commerce row
  (`src/lib/blogCommerce.ts`) picks them up and shows live prices, so the post
  never hard-codes a price.

## What goes in

Editorial issues only: "This Past Week in Golf" (Sundays), "The Mully Letter"
(Thursdays) and editorial Mully Edit sends such as the gift guide. Skip BFCM,
Members First, win-back, product tests, reactivation, payment, transactional
and any offer-led or member-only sends. Skip remainder resends of an issue
that is already archived. Publish only after Klaviyo shows the campaign sent.

## Adding an issue (about 10 minutes)

1. Draft from the sent campaign ID (read-only against Klaviyo; needs a private
   key with campaigns:read and templates:read):

   ```sh
   KLAVIYO_PRIVATE_API_KEY=pk_... npx tsx scripts/newsletter-to-post.ts <campaignId> \
     [--slug=the-mully-letter-november-19-2026]
   ```

   The script refuses campaigns that are not sent. It writes
   `content/newsletters/<slug>.json`, adds the slug to
   `src/lib/letterIssues.ts` and lists warnings. It already strips the
   preheader, footer and unsubscribe block, `{{ }}` and `{% %}` tags, emoji,
   em dashes, tracking parameters and Klaviyo link wrappers, turns mymully.com
   links into relative links, drops button rows and removes prices.

   No API key handy? Export the HTML from Klaviyo and run
   `--html=email.html --sent-at=<ISO send time> --subject="..." --preview="..." --campaign=<id>`.

2. Edit the JSON:
   - `title`: search-friendly, under about 65 characters (the page adds
     "| The Mully Letter").
   - `excerpt`: the meta description, 150 to 160 characters, no em dashes.
   - `slug`: descriptive, e.g. `this-past-week-in-golf-november-8-2026`.
     The default is series name plus the send date in Eastern time.
   - Cut reply asks, trivia prizes, codes, member-only offers, share blocks
     and time-bound lines that will read wrong next year. Put product names in
     as `[Product name](/shop/<handle>)` links.
   - Voice rules: `user:mully-editorial-system` (no em dashes, never
     "Mullybox", present tense).
   - Clear every `_warnings` entry.

3. Copy images, validate and print the insert:

   ```sh
   npx tsx scripts/newsletter-to-post.ts --sql content/newsletters/<slug>.json
   ```

   It downloads every Klaviyo or Shopify image into
   `public/newsletters/<slug>/`, rewrites the draft to those paths, then
   exits non-zero and lists problems if the row has a price, code, template
   tag, tracking link, footer copy, dash, absolute Mully link, TODO, a slug
   missing from `letterIssues.ts` or a meta description outside 150 to 160
   characters. `npx vitest run --project ui
   tests/ui/newsletterToPost.test.ts` runs the same check on every file in
   `content/newsletters/`.

4. Run the printed SQL in Supabase. It is insert-only
   (`on conflict (slug) do nothing`), so an existing post is never changed.
   Commit the JSON, the images and the `letterIssues.ts` change, and merge
   before running the insert so the local images are live.

The post page goes live as soon as the row is inserted (blog pages render
dynamically). It joins the /blog/letters list and shows as "The Mully Letter"
once the `letterIssues.ts` change is deployed; until then it appears under
The Craft. Listing a slug before its campaign sends is safe: nothing shows
until the row exists.

## Issues archived

| Slug | Klaviyo campaign | Sent |
| --- | --- | --- |
| `fall-ball-sloat-leaf-rule-greywalls-november-2026` | 01M6SGX53FF2Z4C9SH11VTXWZP | 2026-11-06 |
| `this-past-week-in-golf-november-8-2026` | 01M6VQ31938XRJV9PWDMGQ1811 | 2026-11-08 |
| `holiday-golf-gift-guide-mully-edit-november-2026` | 01M7656WMJ8MMYE65KB8HQX9W8 | 2026-11-11 (publish after send) |

Earlier campaigns (2021 to January 2026) were reviewed and not archived: they
are legacy Mullybox sends with discount codes, crowdfunding or membership and
price notices, so they are offer-led rather than editorial.
