/**
 * scripts/klaviyo-backfill-signups.ts
 *
 * Loads pre-release website signups into Klaviyo without triggering the
 * welcome flow (historical import). The work runs server-side in
 * /api/admin/klaviyo-sync/backfill so the Klaviyo key stays in Vercel.
 *
 * DRY RUN BY DEFAULT. Prints counts only.
 *
 * Usage:
 *   CRON_SECRET=... npx tsx scripts/klaviyo-backfill-signups.ts                 # dry run
 *   CRON_SECRET=... npx tsx scripts/klaviyo-backfill-signups.ts --apply         # writes
 *   ... --base=https://<preview-host>   (default https://www.mymully.com)
 */

export {};

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const base = (args.find((a) => a.startsWith("--base="))?.slice(7) || "https://www.mymully.com").replace(/\/$/, "");
const secret = process.env.CRON_SECRET;

async function main() {
  if (!secret) throw new Error("CRON_SECRET is required");
  const res = await fetch(`${base}/api/admin/klaviyo-sync/backfill`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${secret}` },
    body: JSON.stringify({ apply }),
  });
  const json = await res.json().catch(() => ({}));
  console.log(JSON.stringify({ status: res.status, ...json }, null, 2));
  if (!apply) console.log("\nDRY RUN: no writes made. Re-run with --apply to load into Klaviyo.");
  if (!res.ok) process.exit(1);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : "backfill failed");
  process.exit(1);
});
