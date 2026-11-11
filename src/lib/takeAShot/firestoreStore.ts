/**
 * Firestore adapter for the Take a Shot service. Collections:
 *   take_a_shot_leads/{sha256(email key)}      lead, consent, reward (synced to Klaviyo)
 *     consent_events/{auto}                      append-only consent log
 *   take_a_shot_sessions/{sid}                 pin, wind, shots, results
 *   take_a_shot_identities/{sha256(kind:value)} phone or browser -> lead
 *   take_a_shot_rate_limits/{sha256}           hourly counters (expiresAt for TTL)
 *   take_a_shot_code_deletes/{discount id}     replaced codes to delete in Shopify
 */
import { randomBytes } from "node:crypto";
import { adminDb } from "@/lib/firebase-admin";
import { captureSyncFields, scheduleKlaviyoSync } from "@/lib/klaviyo/syncState";
import { shopifyCodes } from "./codes";
import { hasMailServer } from "./identity";
import { COLLECTIONS, createTakeAShotService, type TasStore, type TasTx } from "./service";

export const firestoreStore: TasStore = {
  transaction(fn) {
    return adminDb.runTransaction(async (t) => {
      const tx: TasTx = {
        async get(collection, id) {
          const snap = await t.get(adminDb.collection(collection).doc(id));
          return snap.exists ? (snap.data() as Record<string, unknown>) : null;
        },
        set(collection, id, data, opts) {
          const ref = adminDb.collection(collection).doc(id);
          if (opts?.merge) t.set(ref, data, { merge: true });
          else t.set(ref, data);
        },
        addConsentEvent(leadId, data) {
          t.set(adminDb.collection(COLLECTIONS.leads).doc(leadId).collection("consent_events").doc(), data);
        },
        markForSync(leadId, stages) {
          const fields = captureSyncFields(stages[0]);
          const all = Object.fromEntries(stages.map((s) => [s, "pending"]));
          t.set(adminDb.collection(COLLECTIONS.leads).doc(leadId), {
            ...fields, klaviyoSync: { ...fields.klaviyoSync, stages: all },
          }, { merge: true });
        },
      };
      return fn(tx);
    });
  },
  async findWhere(collection, field, value, limit) {
    const snap = await adminDb.collection(collection).where(field, "==", value).limit(limit).get();
    return snap.docs.map((d) => ({ id: d.id, data: d.data() as Record<string, unknown> }));
  },
};

let service: ReturnType<typeof createTakeAShotService> | null = null;
export function takeAShotService() {
  if (!service) {
    service = createTakeAShotService({
      store: firestoreStore,
      shopify: shopifyCodes(),
      mxCheck: (domain) => hasMailServer(domain),
      rand: () => randomBytes(4).readUInt32BE(0) / 4294967296,
      newId: () => randomBytes(16).toString("hex"),
      now: () => Date.now(),
      onSyncReady: (leadId, stages) => scheduleKlaviyoSync("take_a_shot_leads", leadId, stages),
    });
  }
  return service;
}
