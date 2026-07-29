/**
 * scripts/send-proshop-recovery.ts
 *
 * One-shot recovery email blast for customers whose Pro Shop draft order
 * survived the dedupe cleanup. Reads the survivor manifest emitted by
 * scripts/dedupe-member-drafts.ts and sends a Drew-voice recovery email
 * pointing at the Shopify invoice_url.
 *
 * Safety:
 *   --dry-run (default): prints what would be sent. No emails go out.
 *   --execute            : actually sends.
 *   --limit=N            : send to first N survivors only (smoke test).
 *   --in=<path>          : override input manifest path.
 *   --skip-internal      : skip @mullybox.com / drew@ / known internal emails.
 *
 * Each send carries idempotencyKey = "proshop-recovery-{draft_id}" so re-runs
 * won't double-send.
 *
 * Usage:
 *   pnpm tsx scripts/send-proshop-recovery.ts --dry-run
 *   pnpm tsx scripts/send-proshop-recovery.ts --execute --limit=3   # smoke
 *   pnpm tsx scripts/send-proshop-recovery.ts --execute              # full
 */

import fs from "node:fs";
import { sendPlainText } from "../src/lib/email/resend";
import { proShopRecoveryTemplate } from "../src/lib/email/templates/proshopRecovery";

interface SurvivorRecord {
  email: string;
  draft_id: number;
  total_price: string;
  invoice_url: string | null;
  line_items: Array<{ title: string; quantity: number; price: string }>;
  created_at: string;
  updated_at: string;
  had_duplicates: boolean;
  duplicates_removed: number;
}

interface Manifest {
  generated_at: string;
  mode: "dry-run" | "execute";
  survivor_count: number;
  survivors: SurvivorRecord[];
}

const DRY_RUN = !process.argv.includes("--execute");
const SKIP_INTERNAL = process.argv.includes("--skip-internal");
const limitArg = process.argv.find((a) => a.startsWith("--limit="));
const LIMIT = limitArg ? parseInt(limitArg.split("=")[1], 10) : Infinity;
const inArg = process.argv.find((a) => a.startsWith("--in="));
const INPUT_PATH = inArg?.split("=")[1]?.trim() || "/tmp/proshop-recovery-survivors.json";

const INTERNAL_PATTERNS = [
  /@mullybox\.com$/i,
  /^drew@/i,
  /@mymully\.com$/i,
];

function isInternal(email: string): boolean {
  return INTERNAL_PATTERNS.some((re) => re.test(email));
}

function inferFirstName(email: string): string | null {
  // Best-effort: pull the local part and capitalize the first chunk before any
  // dot/digit/separator. e.g. "jacob.spoon@gmail.com" → "Jacob".
  const local = email.split("@")[0] || "";
  const head = local.split(/[._\-+0-9]/)[0];
  if (!head || head.length < 2) return null;
  return head.charAt(0).toUpperCase() + head.slice(1).toLowerCase();
}

async function main() {
  if (!fs.existsSync(INPUT_PATH)) {
    console.error(`Input manifest not found: ${INPUT_PATH}`);
    console.error("Run scripts/dedupe-member-drafts.ts first.");
    process.exit(1);
  }
  const manifest = JSON.parse(fs.readFileSync(INPUT_PATH, "utf-8")) as Manifest;
  console.log(`Loaded ${manifest.survivor_count} survivors from ${INPUT_PATH}`);
  console.log(`Manifest generated: ${manifest.generated_at} (mode: ${manifest.mode})`);
  console.log(`Send mode: ${DRY_RUN ? "DRY RUN (no emails)" : "EXECUTE"}`);
  if (LIMIT !== Infinity) console.log(`Limit: ${LIMIT}`);

  let sent = 0;
  let skipped = 0;
  let errors = 0;

  for (const s of manifest.survivors) {
    if (sent + skipped + errors >= LIMIT) break;
    if (!s.invoice_url) {
      console.warn(`  skip ${s.email} — no invoice_url`);
      skipped += 1;
      continue;
    }
    if (SKIP_INTERNAL && isInternal(s.email)) {
      console.log(`  skip ${s.email} — internal`);
      skipped += 1;
      continue;
    }

    const firstName = inferFirstName(s.email);
    // Append our analytics UTM so we can attribute clicks back. utm_campaign
    // is also stamped by sendPlainText, but the explicit content tag helps us
    // separate the recovery campaign from regular drips in PostHog.
    const invoiceUrl = (() => {
      try {
        const u = new URL(s.invoice_url!);
        if (!u.searchParams.has("utm_source")) {
          u.searchParams.set("utm_source", "resend");
          u.searchParams.set("utm_medium", "email");
          u.searchParams.set("utm_campaign", "proshop_recovery");
          u.searchParams.set("utm_content", "invoice_link");
        }
        return u.toString();
      } catch {
        return s.invoice_url!;
      }
    })();

    const { subject, text } = proShopRecoveryTemplate({
      firstName,
      invoiceUrl,
      topItems: s.line_items.map((li) => ({
        title: li.title,
        quantity: li.quantity,
      })),
      totalPrice: parseFloat(s.total_price).toFixed(2),
    });

    if (DRY_RUN) {
      console.log(
        `[DRY] would send to ${s.email} (firstName=${firstName ?? "—"}, $${s.total_price}, draft=${s.draft_id})`
      );
      sent += 1;
      continue;
    }

    try {
      const id = await sendPlainText({
        to: s.email,
        subject,
        text,
        sendClass: "campaign",
        category: "proshop_recovery",
        idempotencyKey: `proshop-recovery-${s.draft_id}`,
        utmCampaign: "proshop_recovery",
        utmContent: "draft_revival",
        tags: [
          { name: "category", value: "proshop_recovery" },
          { name: "draft_id", value: String(s.draft_id) },
        ],
      });
      console.log(`  sent → ${s.email} (resend id: ${id ?? "—"})`);
      sent += 1;
    } catch (err) {
      console.error(`  ERROR ${s.email}:`, err);
      errors += 1;
    }
    // Pace under Resend's 5/sec free-tier ceiling. 250ms = 4/sec ceiling.
    if (!DRY_RUN) await new Promise((r) => setTimeout(r, 250));
  }

  console.log("\n=== Recovery summary ===");
  console.log(`Sent:    ${sent}`);
  console.log(`Skipped: ${skipped}`);
  console.log(`Errors:  ${errors}`);
  if (DRY_RUN) console.log("\nRe-run with --execute to actually send.");
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
