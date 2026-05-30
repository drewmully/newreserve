# Site Health Bot

Autonomous monitoring for the storefront and account portal. Findings surface at
`/admin/site-health` and an executive digest with PDFs ships every Friday
morning to drew@ + jack@.

## Components

- `src/lib/siteHealth.ts` — types, dedupe hashing, Firestore upserts, window math.
- `src/lib/siteHealthDigest.ts` — pure renderers + per-finding PDF builder
  (pdf-lib, no Chromium).
- `src/app/api/admin/cron/site-health-sweep/route.ts` — **daily 06:00 UTC**
  (≈02:00 ET) synthetic sweep over the 7 journeys; ingests PostHog
  `$exception` events; passes screenshots + DOM excerpts to Claude UX judge.
- `src/app/api/admin/cron/site-health-digest/route.ts` — **Friday 10:00 + 11:00
  UTC** (gated so only the 06:00 ET fire actually sends — handles EDT/EST).
- `src/app/api/admin/site-health/route.ts` — GET (dashboard payload) /
  POST (update status).
- `src/app/admin/site-health/page.tsx` — KPI tiles, journey heatmap, findings
  table with screenshots and remediation actions.

## Firestore Schema

### Collection `site_health_findings`

Doc id = `dedupe_hash` (16-char sha256 prefix) so recurring issues land on the
same document and increment `occurrence_count`.

| Field              | Type        | Notes                                          |
| ------------------ | ----------- | ---------------------------------------------- |
| `id`               | string      | Same as doc id / dedupe_hash                   |
| `dedupe_hash`      | string      | Hash of `source + journey + pathname + title`  |
| `date`             | string      | ISO date (YYYY-MM-DD) of most recent sighting  |
| `severity`         | `P0\|P1\|P2`| P0 = revenue blocker, P1 = degraded, P2 = UX   |
| `source`           | enum        | `claude_judge \| playwright_sweep \| posthog_exception` |
| `journey`          | enum        | `home, signup, login, shop, account, upgrade, returns, checkout, global` |
| `title`            | string      | One-line summary                               |
| `description`     | string      | What's broken / what user sees                 |
| `evidence.url`     | string      | URL where finding was observed                 |
| `evidence.screenshot_url` | string? | Firebase Storage path (full-mode sweep)      |
| `evidence.console_excerpt` | string? | First 20 console errors                      |
| `evidence.network_excerpt` | string? | Failing requests (status + URL)              |
| `evidence.stack_excerpt`   | string? | JS error stack                                |
| `evidence.dom_excerpt`     | string? | Trimmed HTML for Claude's review              |
| `evidence.posthog_event_id`| string? | If sourced from PostHog                       |
| `suggested_fix`    | string?     | Claude's recommendation                       |
| `status`           | enum        | `new \| acknowledged \| fixed \| ignored`     |
| `first_seen_at`    | number (ms) | Unix ms when first reported                   |
| `last_seen_at`     | number (ms) | Unix ms when most recently reported           |
| `occurrence_count` | number      | Bumped each time `upsertFinding` matches       |
| `related_pr`       | string?     | GitHub PR URL once a fix is opened            |
| `last_sweep_id`    | string      | Sweep run that last touched it                |

### Indexes

Composite: `(last_seen_at desc, severity)` — used by dashboard query and
digest window query.

## Severity Rubric (used in the Claude judge prompt)

- **P0** — checkout/upgrade/login broken, payment errors, content missing on
  revenue-critical surfaces.
- **P1** — degraded UX (modal misalignment, broken images, partial outages,
  slow APIs > 3 s, non-revenue API failures).
- **P2** — copy / spacing / visual polish issues, deprecated content, minor
  inconsistencies.

## Digest rules (Friday 6 AM ET)

- Window: prior Fri 00:00 ET → Thu 23:59:59.999 ET (Detroit-local).
- Recipients: `drew@mullybox.com`, `jack@mullybox.com`.
- One PDF attached per P0, per P1, and per **new-this-window** P2.
- Recurring P2s rolled up as bullets in the email body (no PDF).
- "Clean week" subject + body if zero findings — confirms the bot is alive.

## Env vars

| Var                     | Used by                | Notes                                          |
| ----------------------- | ---------------------- | ---------------------------------------------- |
| `CRON_SECRET`           | both crons             | Already configured                            |
| `RESEND_API_KEY`        | digest cron            | Already configured                            |
| `ANTHROPIC_API_KEY`     | sweep cron             | For the Claude judge                          |
| `POSTHOG_HOST`          | sweep cron             | e.g. `https://us.i.posthog.com`               |
| `POSTHOG_PROJECT_ID`    | sweep cron             | For HogQL queries against `$exception` table  |
| `POSTHOG_PERSONAL_API_KEY` | sweep cron          | For HogQL queries                             |
| `BROWSER_WS_ENDPOINT`   | sweep cron *(optional)* | Browserless / playwright cloud endpoint; without it sweep falls back to lite mode (no screenshots) |
| `MULLY_BASE_URL`        | sweep cron             | Defaults to `https://mymully.com`             |

## Cron schedule (vercel.json)

```
0 6 * * *       site-health-sweep          (daily 06:00 UTC ≈ 02:00 ET)
0 10 * * 5      site-health-digest         (Fri 10:00 UTC = 06:00 EDT)
0 11 * * 5      site-health-digest         (Fri 11:00 UTC = 06:00 EST)
```

The digest route self-guards: it only sends when local hour in
America/Detroit == 6, so exactly one of the two Friday fires lands.

## Manual operations

```bash
# Dry-run the digest for the current Fri→Thu window
curl -H "Authorization: Bearer $CRON_SECRET" \
  "https://mymully.com/api/admin/cron/site-health-digest?force=1&dry=1"

# Force-send a digest (skips weekday/hour guard)
curl -H "Authorization: Bearer $CRON_SECRET" \
  "https://mymully.com/api/admin/cron/site-health-digest?force=1"

# Force-run the sweep
curl -H "Authorization: Bearer $CRON_SECRET" \
  "https://mymully.com/api/admin/cron/site-health-sweep"
```
