/**
 * scripts/send-sponsorship-announce.ts
 *
 * One-shot announcement to active Reserve / Access members that the
 * sponsorship program exists. Operation 266, June 2026.
 *
 * Audience: customers in `customer_facts` with `is_subscriber_active = true`
 * who still accept marketing email and aren't internal. ~1,533 as of the
 * audit run (Jun 10).
 *
 * Each recipient gets their personal HMAC-derived sponsorship code rendered
 * inline plus a /s/<code> share link they can forward.
 *
 * Idempotency key: `sponsorship-announce-jun26-{customer_id}`.
 *
 * Safety:
 *   --dry-run (default)
 *   --execute
 *   --limit=N
 *   --offset=N
 *
 * Usage:
 *   pnpm tsx scripts/send-sponsorship-announce.ts --dry-run
 *   pnpm tsx scripts/send-sponsorship-announce.ts --execute --limit=1   # smoke
 *   pnpm tsx scripts/send-sponsorship-announce.ts --execute              # full
 *
 * Required env:
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 *   RESEND_API_KEY
 *   SPONSORSHIP_TOKEN_SECRET
 *   PUBLIC_SITE_ORIGIN
 */

import { createClient } from "@supabase/supabase-js";
import { sendPlainText } from "../src/lib/email/resend";
import { sponsorshipAnnounceTemplate } from "../src/lib/email/templates/sponsorshipAnnounce";
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

// 5 req/sec under Resend's account default. Same as winback / proshop blast.
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

  const PAGE = 1000;
  let from = 0;
  const all: Recipient[] = [];
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { data, error } = await supabase
      .from("customer_facts")
      .select(
        "customer_id, customers!inner(id, email, first_name, accepts_email_marketing)",
      )
      .eq("is_subscriber_active", true)
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

  // De-dupe by email
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
    `[sponsor-announce] mode=${DRY_RUN ? "DRY-RUN" : "EXECUTE"} limit=${LIMIT ?? "all"} offset=${OFFSET}`,
  );

  const audience = await fetchAudience();
  console.log(`[sponsor-announce] fetched ${audience.length} sendable recipients`);

  const slice = audience.slice(OFFSET, LIMIT ? OFFSET + LIMIT : undefined);
  console.log(`[sponsor-announce] will process ${slice.length} (offset=${OFFSET})`);

  let sent = 0;
  let skipped = 0;
  let failed = 0;

  for (let i = 0; i < slice.length; i++) {
    const r = slice[i]!;
    const sponsorshipCode = buildSponsorshipCode({
      customerId: r.customer_id,
      firstName: r.first_name,
    });
    const { subject, text } = sponsorshipAnnounceTemplate({
      firstName: r.first_name,
      sponsorshipCode,
      siteOrigin: SITE_ORIGIN,
    });
    const idempotencyKey = `sponsorship-announce-jun26-${r.customer_id}`;

    if (DRY_RUN) {
      if (i < 3 || i === slice.length - 1) {
        console.log(
          `[sponsor-announce] [${i + 1}/${slice.length}] would send to ${r.email}  code=${sponsorshipCode}  subject="${subject}"  key=${idempotencyKey}`,
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
          console.log(
            `[sponsor-announce] sent=${sent} failed=${failed} elapsed=${((Date.now() - start) / 1000).toFixed(0)}s`,
          );
        }
      } else {
        skipped++;
      }
    } catch (err) {
      failed++;
      console.error(
        `[sponsor-announce] FAIL ${r.email}:`,
        err instanceof Error ? err.message : err,
      );
    }

    await sleep(SEND_DELAY_MS);
  }

  console.log(
    `[sponsor-announce] DONE  mode=${DRY_RUN ? "DRY-RUN" : "EXECUTE"}  sent=${sent}  skipped=${skipped}  failed=${failed}  duration=${((Date.now() - start) / 1000).toFixed(1)}s`,
  );
}

main().catch((err) => {
  console.error("[sponsor-announce] fatal:", err);
  process.exit(1);
});
