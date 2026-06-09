/**
 * scripts/dedupe-member-drafts.ts
 *
 * Cleans up duplicate OPEN draft orders created by the legacy SlideCart bug
 * (where every cart mutation fired a new draft order POST).
 *
 * Strategy:
 *   1. Fetch all draft orders with status=open
 *   2. Group by customer email (drafts have an email field set in our flow)
 *   3. For each customer, keep the NEWEST draft, delete the rest
 *   4. For the survivor, optionally update its Firestore user record so the
 *      idempotent /api/shopify/checkout flow picks it up next time.
 *
 * Safety:
 *   - Pass --dry-run to print what would happen without deleting
 *   - Pass --execute to actually delete
 *   - Skips drafts older than 90 days (don't touch ancient stuff)
 *   - Skips any draft without an email (manual/concierge drafts)
 *
 * Usage:
 *   pnpm tsx scripts/dedupe-member-drafts.ts --dry-run
 *   pnpm tsx scripts/dedupe-member-drafts.ts --execute
 */

// Env is expected to be loaded externally (Vercel/CI/.env via the caller).
// We intentionally don't require dotenv here so the script has zero deps.

interface DraftOrder {
  id: number;
  email: string | null;
  status: string;
  created_at: string;
  updated_at: string;
  total_price: string;
  invoice_url: string | null;
  tags: string;
  line_items: Array<{ title: string; quantity: number; price: string }>;
}

const SHOPIFY_STORE_DOMAIN = process.env.SHOPIFY_STORE_DOMAIN;
const SHOPIFY_ADMIN_TOKEN =
  process.env.SHOPIFY_ADMIN_TOKEN ?? process.env.SHOPIFY_CLIENT_SECRET;
const API_VERSION = process.env.SHOPIFY_ADMIN_API_VERSION ?? "2024-10";

if (!SHOPIFY_STORE_DOMAIN || !SHOPIFY_ADMIN_TOKEN) {
  console.error("Missing SHOPIFY_STORE_DOMAIN or SHOPIFY_ADMIN_TOKEN env vars");
  process.exit(1);
}

const DRY_RUN = !process.argv.includes("--execute");
const MAX_AGE_DAYS = 90;
// Where to dump the survivor manifest for the recovery-email step. The path
// is also overridable via --survivors-out=<path>.
const survivorsOutArg = process.argv.find((a) => a.startsWith("--survivors-out="));
const SURVIVORS_OUT =
  survivorsOutArg?.split("=")[1]?.trim() || "/tmp/proshop-recovery-survivors.json";

async function fetchAllOpenDrafts(): Promise<DraftOrder[]> {
  const drafts: DraftOrder[] = [];
  let url:
    | string
    | null = `https://${SHOPIFY_STORE_DOMAIN}/admin/api/${API_VERSION}/draft_orders.json?status=open&limit=250`;

  while (url) {
    const res: Response = await fetch(url, {
      headers: { "X-Shopify-Access-Token": SHOPIFY_ADMIN_TOKEN! },
    });
    if (!res.ok) {
      throw new Error(`Fetch drafts failed ${res.status}: ${await res.text()}`);
    }
    const json = (await res.json()) as { draft_orders: DraftOrder[] };
    drafts.push(...json.draft_orders);

    // Parse Link header for pagination
    const link = res.headers.get("link");
    const nextMatch = link?.match(/<([^>]+)>;\s*rel="next"/);
    url = nextMatch ? nextMatch[1] : null;
  }
  return drafts;
}

async function deleteDraft(id: number): Promise<void> {
  const url = `https://${SHOPIFY_STORE_DOMAIN}/admin/api/${API_VERSION}/draft_orders/${id}.json`;
  const res = await fetch(url, {
    method: "DELETE",
    headers: { "X-Shopify-Access-Token": SHOPIFY_ADMIN_TOKEN! },
  });
  if (!res.ok) {
    throw new Error(`Delete draft ${id} failed ${res.status}: ${await res.text()}`);
  }
}

async function main() {
  console.log(`Mode: ${DRY_RUN ? "DRY RUN (no deletes)" : "EXECUTE"}`);
  console.log("Fetching all open draft orders...");
  const all = await fetchAllOpenDrafts();
  console.log(`Total open drafts: ${all.length}`);

  const cutoff = Date.now() - MAX_AGE_DAYS * 24 * 60 * 60 * 1000;
  const eligible = all.filter((d) => {
    if (!d.email) return false;
    if (new Date(d.created_at).getTime() < cutoff) return false;
    return true;
  });
  console.log(
    `Eligible (has email, < ${MAX_AGE_DAYS} days old): ${eligible.length}`
  );

  // Group by email
  const byEmail = new Map<string, DraftOrder[]>();
  for (const d of eligible) {
    const key = d.email!.toLowerCase();
    const arr = byEmail.get(key) ?? [];
    arr.push(d);
    byEmail.set(key, arr);
  }

  let totalDuplicates = 0;
  let totalSurvivors = 0;
  let recoveredValue = 0;
  // Survivor manifest emitted at the end — one record per customer with the
  // single open draft we kept (or the only draft they had). The recovery-email
  // script reads this file. We intentionally write this even on --dry-run so
  // we can preview the audience before sending.
  type SurvivorRecord = {
    email: string;
    draft_id: number;
    total_price: string;
    invoice_url: string | null;
    line_items: Array<{ title: string; quantity: number; price: string }>;
    created_at: string;
    updated_at: string;
    had_duplicates: boolean;
    duplicates_removed: number;
  };
  const survivors: SurvivorRecord[] = [];

  console.log("\n=== Per-customer breakdown ===");
  for (const [email, drafts] of Array.from(byEmail.entries()).sort(
    (a, b) => b[1].length - a[1].length
  )) {
    if (drafts.length === 1) {
      totalSurvivors += 1;
      recoveredValue += parseFloat(drafts[0].total_price);
      const only = drafts[0];
      survivors.push({
        email,
        draft_id: only.id,
        total_price: only.total_price,
        invoice_url: only.invoice_url,
        line_items: only.line_items,
        created_at: only.created_at,
        updated_at: only.updated_at,
        had_duplicates: false,
        duplicates_removed: 0,
      });
      continue;
    }

    // Sort newest first
    const sorted = [...drafts].sort(
      (a, b) =>
        new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
    );
    const keep = sorted[0];
    const dupes = sorted.slice(1);
    totalDuplicates += dupes.length;
    totalSurvivors += 1;
    recoveredValue += parseFloat(keep.total_price);

    console.log(
      `${email}: keeping #${keep.id} ($${keep.total_price}), deleting ${dupes.length} dupes`
    );
    survivors.push({
      email,
      draft_id: keep.id,
      total_price: keep.total_price,
      invoice_url: keep.invoice_url,
      line_items: keep.line_items,
      created_at: keep.created_at,
      updated_at: keep.updated_at,
      had_duplicates: true,
      duplicates_removed: dupes.length,
    });

    if (!DRY_RUN) {
      for (const d of dupes) {
        try {
          await deleteDraft(d.id);
          console.log(`  deleted #${d.id}`);
        } catch (err) {
          console.error(`  FAILED to delete #${d.id}:`, err);
        }
      }
    }
  }

  console.log("\n=== Summary ===");
  console.log(`Customers with drafts: ${byEmail.size}`);
  console.log(`Survivors (one draft per customer): ${totalSurvivors}`);
  console.log(`Duplicates ${DRY_RUN ? "would delete" : "deleted"}: ${totalDuplicates}`);
  console.log(`Recoverable intent value: $${recoveredValue.toFixed(2)}`);
  // Persist survivor manifest for the downstream recovery email step.
  try {
    const fs = await import("node:fs");
    fs.writeFileSync(
      SURVIVORS_OUT,
      JSON.stringify(
        {
          generated_at: new Date().toISOString(),
          mode: DRY_RUN ? "dry-run" : "execute",
          survivor_count: survivors.length,
          survivors,
        },
        null,
        2
      )
    );
    console.log(`\nWrote survivor manifest to ${SURVIVORS_OUT}`);
  } catch (err) {
    console.error("Failed to write survivor manifest:", err);
  }

  console.log(
    DRY_RUN
      ? "\nRe-run with --execute to actually delete."
      : "\nDone. Next: send recovery emails to the survivors."
  );
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
