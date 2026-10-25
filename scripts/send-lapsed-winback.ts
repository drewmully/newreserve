/**
 * scripts/send-lapsed-winback.ts
 *
 * One-shot winback email blast for lapsed Reserve subscribers (June 2026
 * "Operation 266" campaign).
 *
 * Audience: customers in `customer_facts` with `is_subscriber_lapsed = true`
 * who still accept marketing email and aren't internal. ~9,616 as of the
 * audit run (Jun 10).
 *
 * Mechanics:
 *   - Single discount code WELCOMEBACK50 ($50 off Reserve quarterly or Mully
 *     Access annual), expires 2026-07-01, applies once per customer.
 *   - Each recipient also gets their personal sponsorship code surfaced so
 *     they can forward to a friend if they aren't ready themselves.
 *   - Each send uses an idempotency key of `lapsed-winback-jun26-{customer_id}`
 *     so re-runs never double-send.
 *   - Throttled to <= 5 requests/sec to stay under Resend's account-level
 *     rate cap (same constraint the proshop blast hit, see commit d0812cb).
 *
 * Safety:
 *   --dry-run (default): prints what would be sent. No emails go out.
 *   --execute           : actually sends.
 *   --limit=N           : send to first N recipients only (smoke test).
 *   --offset=N          : skip the first N recipients (for resuming after a
 *                         partial run).
 *
 * Usage:
 *   pnpm tsx scripts/send-lapsed-winback.ts --dry-run
 *   pnpm tsx scripts/send-lapsed-winback.ts --execute --limit=5   # smoke
 *   pnpm tsx scripts/send-lapsed-winback.ts --execute              # full
 *
 * Required env:
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY  - to query customer_facts
 *   RESEND_API_KEY                            - to send
 *   SPONSORSHIP_TOKEN_SECRET                  - to derive per-customer codes
 *   PUBLIC_SITE_ORIGIN                        - https://reserve.mullybox.com
 */

import { createClient } from "@supabase/supabase-js";
import { sendPlainText } from "../src/lib/email/resend";
import { lapsedWinbackTemplate } from "../src/lib/email/templates/lapsedWinback";
import { buildSponsorshipCode } from "../src/lib/sponsorship";

const DRY_RUN = !process.argv.includes("--execute");
const limitArg = process.argv.find((a) => a.startsWith("--limit="));
const offsetArg = process.argv.find((a) => a.startsWith("--offset="));
const LIMIT = limitArg ? parseInt(limitArg.split("=")[1] ?? "0", 10) : null;
const OFFSET = offsetArg ? parseInt(offsetArg.split("=")[1] ?? "0", 10) : 0;

const SITE_ORIGIN =
  process.env.PUBLIC_SITE_ORIGIN ??
  process.env.NEXT_PUBLIC_SITE_URL ??
  "https://reserve.mullybox.com";

// 5 req/sec is the Resend account default. Same as proshop blast.
const SEND_DELAY_MS = 220;

const INTERNAL_EMAIL_PATTERNS: RegExp[] = [
  /@mullybox\.com$/i,
  /@greensclub/i,
  /^drew@/i,
  /^joe@/i,
  /^test@/i,
];

function isInternal(email: string): boolean {
  return INTERNAL_EMAIL_PATTERNS.some((re) => re.test(email));
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

interface Recipient {
  customer_id: number;
  email: string;
  first_name: string | null;
}

async function fetchAudience(): Promise<Recipient[]> {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY required");
  }
  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false },
  });

  // Paginate to avoid the 1k default row cap.
  const PAGE = 1000;
  let from = 0;
  const all: Recipient[] = [];
  // We fetch the joined cohort via an RPC-free query. Service role bypasses
  // RLS so we can read both customer_facts and customers directly.
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { data, error } = await supabase
      .from("customer_facts")
      .select("customer_id, customers!inner(id, email, first_name, accepts_email_marketing)")
      .eq("is_subscriber_lapsed", true)
      .eq("customers.accepts_email_marketing", true)
      .not("customers.email", "is", null)
      .range(from, from + PAGE - 1);

    if (error) throw new Error(`Supabase fetch failed: ${error.message}`);
    if (!data || data.length === 0) break;

    type Row = {
      customer_id: number;
      customers:
        | { email: string | null; first_name: string | null }
        | Array<{ email: string | null; first_name: string | null }>
        | null;
    };
    for (const row of data as unknown as Row[]) {
      // Supabase returns the related row as an array when the FK isn't a
      // unique constraint Supabase can prove single-row — normalize.
      const c = Array.isArray(row.customers) ? row.customers[0] : row.customers;
      if (!c?.email) continue;
      if (isInternal(c.email)) continue;
      all.push({
        customer_id: row.customer_id,
        email: c.email,
        first_name: c.first_name ?? null,
      });
    }

    if (data.length < PAGE) break;
    from += PAGE;
  }

  // De-dupe by email (some customer rows share an email across multiple ids)
  const seen = new Set<string>();
  const deduped: Recipient[] = [];
  for (const r of all) {
    const k = r.email.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    deduped.push(r);
  }
  return deduped;
}

async function main(): Promise<void> {
  const start = Date.now();
  console.log(
    `[winback] mode=${DRY_RUN ? "DRY-RUN" : "EXECUTE"} limit=${LIMIT ?? "all"} offset=${OFFSET}`,
  );

  const audience = await fetchAudience();
  console.log(`[winback] fetched ${audience.length} sendable recipients`);

  const slice = audience.slice(OFFSET, LIMIT ? OFFSET + LIMIT : undefined);
  console.log(`[winback] will process ${slice.length} (offset=${OFFSET})`);

  let sent = 0;
  let skipped = 0;
  let failed = 0;

  for (let i = 0; i < slice.length; i++) {
    const r = slice[i]!;
    const sponsorshipCode = buildSponsorshipCode({
      customerId: r.customer_id,
      firstName: r.first_name,
    });
    const { subject, text } = lapsedWinbackTemplate({
      firstName: r.first_name,
      sponsorshipCode,
      siteOrigin: SITE_ORIGIN,
    });
    const idempotencyKey = `lapsed-winback-jun26-${r.customer_id}`;

    if (DRY_RUN) {
      if (i < 3 || i === slice.length - 1) {
        console.log(
          `[winback] [${i + 1}/${slice.length}] would send to ${r.email}  subject="${subject}"  key=${idempotencyKey}`,
        );
      }
      sent++;
      continue;
    }

    try {
      const id = await sendPlainText({
        to: r.email,
        subject,
        text,
        idempotencyKey,
      });
      if (id) {
        sent++;
        if (sent % 50 === 0) {
          console.log(`[winback] sent=${sent} failed=${failed} elapsed=${((Date.now() - start) / 1000).toFixed(0)}s`);
        }
      } else {
        skipped++;
      }
    } catch (err) {
      failed++;
      console.error(`[winback] FAIL ${r.email}:`, err instanceof Error ? err.message : err);
    }

    await sleep(SEND_DELAY_MS);
  }

  console.log(
    `[winback] DONE  mode=${DRY_RUN ? "DRY-RUN" : "EXECUTE"}  sent=${sent}  skipped=${skipped}  failed=${failed}  duration=${((Date.now() - start) / 1000).toFixed(1)}s`,
  );
}

main().catch((err) => {
  console.error("[winback] fatal:", err);
  process.exit(1);
});
