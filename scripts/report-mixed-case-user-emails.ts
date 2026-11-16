/**
 * scripts/report-mixed-case-user-emails.ts
 *
 * READ-ONLY report of `users/{uid}` docs whose `email` is not already
 * trimmed + lowercased, and of lowercased emails shared by more than one doc
 * (likely duplicate accounts created by the old case-sensitive orders-paid
 * lookup). It never writes anything — there is deliberately no --commit flag.
 *
 * Context: orders-paid now matches lowercased emails first and then the
 * exact Shopify email, and syncUserProfile rewrites the stored email in
 * lowercase on the user's next sign-in, so a backfill is optional. If one is
 * wanted, review this report and write the migration separately.
 *
 * Output: counts, plus uid + masked email per finding (pass --show-emails to
 * print full addresses; only do that in a trusted terminal).
 *
 * Usage (needs the usual FIREBASE_ADMIN_* env vars, or FIRESTORE_EMULATOR_HOST):
 *   npx tsx scripts/report-mixed-case-user-emails.ts
 *   npx tsx scripts/report-mixed-case-user-emails.ts --limit=5000 --show-emails
 */

import { adminDb } from "../src/lib/firebase-admin";

const SHOW_EMAILS = process.argv.includes("--show-emails");
const limitArg = process.argv.find((a) => a.startsWith("--limit="));
const LIMIT = limitArg ? Math.max(1, parseInt(limitArg.split("=")[1], 10)) : Number.POSITIVE_INFINITY;
const PAGE = 500;

function mask(email: string): string {
  if (SHOW_EMAILS) return email;
  const [local, domain = ""] = email.split("@");
  return `${local.slice(0, 2)}***@${domain}`;
}

async function main() {
  let scanned = 0;
  const mixed: Array<{ uid: string; email: string }> = [];
  const byLower = new Map<string, string[]>();
  let cursor: FirebaseFirestore.QueryDocumentSnapshot | undefined;

  while (scanned < LIMIT) {
    let q = adminDb.collection("users").orderBy("__name__").select("email").limit(PAGE);
    if (cursor) q = q.startAfter(cursor);
    const snap = await q.get();
    if (snap.empty) break;
    for (const doc of snap.docs) {
      scanned++;
      const email = doc.get("email");
      if (typeof email !== "string" || !email) continue;
      const lower = email.trim().toLowerCase();
      if (lower !== email) mixed.push({ uid: doc.id, email });
      const list = byLower.get(lower) ?? [];
      list.push(doc.id);
      byLower.set(lower, list);
      if (scanned >= LIMIT) break;
    }
    cursor = snap.docs[snap.docs.length - 1];
    if (snap.size < PAGE) break;
  }

  const duplicates = [...byLower.entries()].filter(([, uids]) => uids.length > 1);

  console.log(`[report] scanned users: ${scanned}`);
  console.log(`[report] emails not lowercase/trimmed: ${mixed.length}`);
  for (const m of mixed) console.log(`  mixed-case uid=${m.uid} email=${mask(m.email)}`);
  console.log(`[report] lowercased emails shared by >1 doc: ${duplicates.length}`);
  for (const [email, uids] of duplicates) console.log(`  duplicate email=${mask(email)} uids=${uids.join(",")}`);
  console.log("[report] read-only: no documents were modified.");
}

main().catch((err) => {
  console.error("[report] failed:", err);
  process.exit(1);
});
