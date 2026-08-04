/**
 * scripts/mirror-consent-to-suppression.ts
 *
 * Mirrors `public.customers` rows with `accepts_email_marketing = false`
 * into `public.suppression_list` with `scope = 'marketing'`, `channel =
 * 'email'`, so the send gate's suppression check (src/lib/email/gate.ts
 * isSuppressed) — which only reads suppression_list, not customers directly
 * — actually reflects marketing opt-outs recorded on the customer record.
 *
 * Baseline measured 2026-08-04 (read-only, production Supabase project
 * xnfjdbpjuaezxjgargto):
 *   suppression_list: 1,859 rows total, 0 with scope='marketing'
 *   customers: 33,012 with accepts_email_marketing=false
 *   of those 33,012, 1,280 already have *some* suppression_list row
 *     (e.g. scope='all', or a prior manual/'both'-channel entry) — this
 *     script does not duplicate those, it only inserts where no email+channel
 *     suppression row already exists.
 *
 * Idempotent: an email that already has a `suppression_list` row with
 * channel in ('email','both') is skipped, regardless of that row's scope —
 * inserting a second, narrower 'marketing' row alongside an existing 'all'
 * row would be redundant (an 'all' scope already covers marketing per
 * src/lib/email/gate.ts isSuppressed: `row.scope === "all" || marketing`).
 *
 * Safety:
 *   DRY RUN BY DEFAULT. Prints exact before/after row counts. Only writes
 *   with --commit. Not run with --commit as part of Phase 0 — see the
 *   report for the printed dry-run output.
 *
 * Usage:
 *   pnpm tsx scripts/mirror-consent-to-suppression.ts             # dry run
 *   pnpm tsx scripts/mirror-consent-to-suppression.ts --limit=500 # smoke
 *   pnpm tsx scripts/mirror-consent-to-suppression.ts --commit    # writes
 */

import { getSupabaseService } from "../src/app/api/_lib/supabaseService";

const COMMIT = process.argv.includes("--commit");
const limitArg = process.argv.find((a) => a.startsWith("--limit="));
const LIMIT = limitArg ? parseInt(limitArg.split("=")[1], 10) : Infinity;
const PAGE_SIZE = 1000;

interface CustomerRow {
  id: number;
  email: string | null;
}

interface SuppressionRow {
  email: string | null;
  channel: string | null;
}

async function countSuppressionByScope(): Promise<Record<string, number>> {
  const sb = getSupabaseService();
  const [{ count: total }, { count: marketing }, { count: all }] = await Promise.all([
    sb.from("suppression_list").select("id", { count: "exact", head: true }),
    sb.from("suppression_list").select("id", { count: "exact", head: true }).eq("scope", "marketing"),
    sb.from("suppression_list").select("id", { count: "exact", head: true }).eq("scope", "all"),
  ]);
  return { total: total ?? 0, marketing: marketing ?? 0, all: all ?? 0 };
}

async function countOptedOutCustomers(): Promise<number> {
  const sb = getSupabaseService();
  const { count, error } = await sb
    .from("customers")
    .select("id", { count: "exact", head: true })
    .eq("accepts_email_marketing", false)
    .not("email", "is", null);
  if (error) throw new Error(`customers count failed: ${error.message}`);
  return count ?? 0;
}

/** Pages through every opted-out customer with a non-null email. */
async function loadOptedOutCustomers(): Promise<CustomerRow[]> {
  const sb = getSupabaseService();
  const rows: CustomerRow[] = [];
  let from = 0;

  while (rows.length < LIMIT) {
    const to = from + PAGE_SIZE - 1;
    const { data, error } = await sb
      .from("customers")
      .select("id,email")
      .eq("accepts_email_marketing", false)
      .not("email", "is", null)
      .order("id", { ascending: true })
      .range(from, to);
    if (error) throw new Error(`customers page load failed at offset ${from}: ${error.message}`);
    if (!data || data.length === 0) break;
    rows.push(...(data as CustomerRow[]));
    if (data.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }

  return LIMIT === Infinity ? rows : rows.slice(0, LIMIT);
}

/** Pages through every suppression_list row that covers the email channel. */
async function loadExistingSuppressedEmails(): Promise<Set<string>> {
  const sb = getSupabaseService();
  const suppressed = new Set<string>();
  let from = 0;

  for (;;) {
    const to = from + PAGE_SIZE - 1;
    const { data, error } = await sb
      .from("suppression_list")
      .select("email,channel")
      .in("channel", ["email", "both"])
      .range(from, to);
    if (error) throw new Error(`suppression_list page load failed at offset ${from}: ${error.message}`);
    if (!data || data.length === 0) break;
    for (const row of data as SuppressionRow[]) {
      if (row.email) suppressed.add(row.email.trim().toLowerCase());
    }
    if (data.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }

  return suppressed;
}

async function main(): Promise<void> {
  console.log(`[mirror-consent-to-suppression] mode=${COMMIT ? "COMMIT" : "DRY-RUN"} limit=${LIMIT === Infinity ? "none" : LIMIT}`);

  console.log("\n── BEFORE ──");
  const beforeSuppression = await countSuppressionByScope();
  const optedOutCount = await countOptedOutCustomers();
  console.log(`  suppression_list total:            ${beforeSuppression.total}`);
  console.log(`  suppression_list scope='marketing': ${beforeSuppression.marketing}`);
  console.log(`  suppression_list scope='all':       ${beforeSuppression.all}`);
  console.log(`  customers accepts_email_marketing=false (email not null): ${optedOutCount}`);

  const optedOutCustomers = await loadOptedOutCustomers();
  console.log(`\nLoaded ${optedOutCustomers.length} opted-out customer row(s) to consider.`);

  const alreadySuppressed = await loadExistingSuppressedEmails();
  console.log(`Loaded ${alreadySuppressed.size} distinct email(s) already covered by an existing suppression_list row.`);

  const seen = new Set<string>();
  const toInsert: { email: string; customerId: number }[] = [];
  let skippedAlreadySuppressed = 0;
  let skippedDuplicateInBatch = 0;

  for (const customer of optedOutCustomers) {
    const email = (customer.email ?? "").trim().toLowerCase();
    if (!email) continue;
    if (alreadySuppressed.has(email)) {
      skippedAlreadySuppressed++;
      continue;
    }
    if (seen.has(email)) {
      skippedDuplicateInBatch++;
      continue;
    }
    seen.add(email);
    toInsert.push({ email, customerId: customer.id });
  }

  console.log(`\n── PLAN ──`);
  console.log(`  would insert:                         ${toInsert.length}`);
  console.log(`  skipped (already suppressed):          ${skippedAlreadySuppressed}`);
  console.log(`  skipped (duplicate email in this batch): ${skippedDuplicateInBatch}`);
  console.log(`\n  Sample of rows to insert (up to 10):`);
  for (const row of toInsert.slice(0, 10)) {
    console.log(`    email=${row.email} (customer_id=${row.customerId}) -> scope='marketing' channel='email'`);
  }

  if (!COMMIT) {
    console.log(`\nDRY RUN — no writes made. Re-run with --commit to apply.`);
    return;
  }

  console.log(`\nCommitting in batches of ${PAGE_SIZE}...`);
  const sb = getSupabaseService();
  let inserted = 0;
  let errors = 0;

  for (let i = 0; i < toInsert.length; i += PAGE_SIZE) {
    const batch = toInsert.slice(i, i + PAGE_SIZE).map((row) => ({
      email: row.email,
      channel: "email",
      scope: "marketing",
      reason: "consent_mirror_backfill",
      source_campaign_id: null,
      source_flow_id: null,
      notes: `customer_id=${row.customerId}`,
    }));

    const { error, data } = await sb.from("suppression_list").insert(batch).select("id");
    if (error) {
      errors++;
      console.error(`[mirror-consent-to-suppression] batch insert failed at offset ${i}:`, error.message);
      continue;
    }
    inserted += data?.length ?? 0;
  }

  console.log(`Committed: inserted=${inserted} batchErrors=${errors}`);

  console.log("\n── AFTER ──");
  const afterSuppression = await countSuppressionByScope();
  const afterOptedOutCount = await countOptedOutCustomers();
  console.log(`  suppression_list total:            ${afterSuppression.total}`);
  console.log(`  suppression_list scope='marketing': ${afterSuppression.marketing}`);
  console.log(`  suppression_list scope='all':       ${afterSuppression.all}`);
  console.log(`  customers accepts_email_marketing=false (email not null): ${afterOptedOutCount}`);
}

main().catch((err) => {
  console.error("[mirror-consent-to-suppression] fatal error:", err);
  process.exit(1);
});
