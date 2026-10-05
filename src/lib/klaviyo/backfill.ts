/**
 * One-off backfill of pre-release signups (docs with no klaviyoSync map).
 *
 * Q3 decision: load them WITHOUT a welcome email. Consented popup leads and
 * consented editorial_drop_list docs are subscribed with
 * historical_import: true and consented_at = the stored consent time, which
 * skips "Added to list" flows. Everything else is profile + event only.
 * Docs already synced are skipped. Dry-run by default. Counts only.
 */

import { adminDb } from "@/lib/firebase-admin";
import type { SyncCollection } from "./config";
import { buildStageInputs, syncDocRef } from "./syncState";

const BACKFILL_COLLECTIONS: SyncCollection[] = ["shop_marketing_leads", "editorial_drop_list"];

export interface BackfillSummary {
  apply: boolean;
  collections: Record<
    string,
    { candidates: number; stages: number; emailSubscribes: number; smsSubscribes: number; synced: number; failed: number }
  >;
}

export async function runSignupBackfill(opts: { apply?: boolean; limit?: number } = {}): Promise<BackfillSummary> {
  const apply = opts.apply === true;
  const summary: BackfillSummary = { apply, collections: {} };
  for (const collection of BACKFILL_COLLECTIONS) {
    const rep = { candidates: 0, stages: 0, emailSubscribes: 0, smsSubscribes: 0, synced: 0, failed: 0 };
    summary.collections[collection] = rep;
    const snap = await adminDb.collection(collection).limit(opts.limit ?? 500).get();
    for (const doc of snap.docs) {
      const data = doc.data();
      if (data.klaviyoSync || data.sendingStatus === "synced") continue; // live-captured or done
      const inputs = buildStageInputs(collection, doc.id, data, { historical: true });
      const stages = Object.values(inputs);
      if (stages.length === 0) continue;
      rep.candidates++;
      rep.stages += stages.length;
      rep.emailSubscribes += stages.filter((s) => s.subscribe?.email).length;
      rep.smsSubscribes += stages.filter((s) => s.subscribe?.sms && s.phone).length;
      if (!apply) continue;
      const outcome = await syncDocRef(collection, doc.ref, { historical: true });
      if (outcome.status === "synced") rep.synced++;
      else rep.failed++;
    }
  }
  return summary;
}
