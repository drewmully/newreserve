/**
 * Shared helpers for the Klaviyo sync cron, report and replay routes.
 */

import { Timestamp } from "firebase-admin/firestore";
import { adminDb } from "@/lib/firebase-admin";
import { SYNC_COLLECTIONS, type SyncCollection } from "./config";
import { syncDocRef, toDate, type SyncDocOutcome } from "./syncState";

/** CRON_SECRET bearer only. Vercel cron sends this header automatically. */
export function isCronAuthorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

export interface DrainSummary {
  scanned: number;
  due: number;
  synced: number;
  failed: number;
  dead: number;
  byCollection: Record<string, { due: number; synced: number; failed: number; dead: number }>;
}

/**
 * Process up to `limit` docs per collection that are not yet synced and whose
 * nextAttemptAt has passed. Pre-release docs (no klaviyoSync map) are left
 * to the backfill script.
 */
export async function drainSyncQueue(opts: { limit?: number; now?: Date; deadlineMs?: number } = {}): Promise<DrainSummary> {
  const limit = opts.limit ?? 50;
  const now = opts.now ?? new Date();
  const deadline = opts.deadlineMs ?? Date.now() + 50_000;
  const summary: DrainSummary = { scanned: 0, due: 0, synced: 0, failed: 0, dead: 0, byCollection: {} };

  for (const collection of SYNC_COLLECTIONS) {
    const bucket = { due: 0, synced: 0, failed: 0, dead: 0 };
    summary.byCollection[collection] = bucket;
    const snap = await adminDb
      .collection(collection)
      .where("sendingStatus", "in", ["not_synced", "failed"])
      .limit(limit)
      .get();
    summary.scanned += snap.size;
    for (const doc of snap.docs) {
      if (Date.now() > deadline) break;
      const state = doc.get("klaviyoSync") as Record<string, unknown> | undefined;
      if (!state) continue;
      if (toDate(state.nextAttemptAt, new Date(0)).getTime() > now.getTime()) continue;
      bucket.due++;
      summary.due++;
      const outcome: SyncDocOutcome = await syncDocRef(collection, doc.ref, { now });
      if (outcome.status === "synced") { bucket.synced++; summary.synced++; }
      else if (outcome.status === "dead") { bucket.dead++; summary.dead++; }
      else if (outcome.status === "failed") { bucket.failed++; summary.failed++; }
    }
  }
  return summary;
}

export interface CollectionReport {
  captured: number;
  synced: number;
  notSynced: number;
  failed: number;
  dead: number;
  bySource: Record<string, number>;
  oldestUnsyncedMinutes: number | null;
}

/** Counts only. Never returns emails, phones or raw doc ids. */
export async function buildSyncReport(now = new Date()) {
  const since = Timestamp.fromDate(new Date(now.getTime() - 24 * 3600_000));
  const collections: Record<string, CollectionReport> = {};
  let oldestUnsyncedMinutes: number | null = null;

  for (const collection of SYNC_COLLECTIONS) {
    const rep: CollectionReport = { captured: 0, synced: 0, notSynced: 0, failed: 0, dead: 0, bySource: {}, oldestUnsyncedMinutes: null };
    const recent = await adminDb.collection(collection).where("klaviyoSync.capturedAt", ">=", since).get();
    for (const doc of recent.docs) {
      rep.captured++;
      const status = doc.get("sendingStatus");
      if (status === "synced") rep.synced++;
      else if (status === "failed") rep.failed++;
      else if (status === "dead") rep.dead++;
      else rep.notSynced++;
      const source = sourceOf(collection, doc.data());
      rep.bySource[source] = (rep.bySource[source] ?? 0) + 1;
    }
    const pending = await adminDb.collection(collection).where("sendingStatus", "in", ["not_synced", "failed"]).limit(200).get();
    for (const doc of pending.docs) {
      const state = doc.get("klaviyoSync") as Record<string, unknown> | undefined;
      if (!state) continue; // pre-release, backfill only
      const age = Math.round((now.getTime() - toDate(state.capturedAt, now).getTime()) / 60_000);
      rep.oldestUnsyncedMinutes = Math.max(rep.oldestUnsyncedMinutes ?? 0, age);
    }
    if (rep.oldestUnsyncedMinutes !== null) {
      oldestUnsyncedMinutes = Math.max(oldestUnsyncedMinutes ?? 0, rep.oldestUnsyncedMinutes);
    }
    collections[collection] = rep;
  }

  const totals = Object.values(collections).reduce(
    (t, r) => ({ captured: t.captured + r.captured, synced: t.synced + r.synced, notSynced: t.notSynced + r.notSynced, failed: t.failed + r.failed, dead: t.dead + r.dead }),
    { captured: 0, synced: 0, notSynced: 0, failed: 0, dead: 0 },
  );
  return { windowStart: since.toDate().toISOString(), windowEnd: now.toISOString(), totals, oldestUnsyncedMinutes, collections };
}

function sourceOf(collection: SyncCollection, d: Record<string, unknown>): string {
  if (collection === "shop_marketing_leads") return "shop-edit-popup";
  if (collection === "back_in_stock_requests") return "back-in-stock";
  return typeof d.source === "string" ? d.source : "unknown";
}
