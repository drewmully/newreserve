/**
 * Firestore-backed sync state for the Klaviyo signup sync.
 *
 * Every capture route writes `captureSyncFields(stage)` into its source doc in
 * the same write that stores the signup, then calls `scheduleKlaviyoSync()`
 * so the Klaviyo work runs in `after()` once the response has been sent.
 * The retry cron drains anything left `not_synced` or `failed`.
 *
 * State shape on each doc:
 *   sendingStatus: "not_synced" | "synced" | "failed" | "dead"
 *   klaviyoSync: { attempts, capturedAt, lastAttemptAt, nextAttemptAt,
 *                  syncedAt?, profileId?, lastErrorCode?, stages: {...} }
 *
 * Docs without a `klaviyoSync` map (pre-release captures) are ignored by
 * the cron and handled only by scripts/klaviyo-backfill-signups.ts.
 */

import { createHash } from "node:crypto";
import { after } from "next/server";
import { FieldValue, Timestamp, type DocumentReference } from "firebase-admin/firestore";
import { adminDb } from "@/lib/firebase-admin";
import { raiseAlert } from "@/lib/events/alert";
import { SHOP_REWARDS } from "@/lib/shopRewards";
import { normalizeSignupPhone } from "@/lib/shopSignup";
import {
  BACKOFF_MINUTES,
  MAX_ATTEMPTS,
  SUBSCRIBE_POPUP_SMS,
  isKlaviyoSyncEnabled,
  type SyncCollection,
} from "./config";
import { syncSignupToKlaviyo, type SignupSyncInput, type SignupSyncResult } from "./syncSignup";

export type SendingStatus = "not_synced" | "synced" | "failed" | "dead";
type Data = Record<string, unknown>;

export const sha = (v: string) => createHash("sha256").update(v).digest("hex");

/** editorial_drop_list ids are sanitized emails, so never expose them raw. */
export function safeDocKey(collection: SyncCollection, id: string): string {
  return collection === "editorial_drop_list" ? sha(id).slice(0, 32) : id;
}

export function toDate(value: unknown, fallback = new Date()): Date {
  if (value instanceof Timestamp) return value.toDate();
  if (value instanceof Date) return value;
  const v = value as { toDate?: () => Date; _seconds?: number; seconds?: number } | null;
  if (v && typeof v.toDate === "function") return v.toDate();
  const secs = v?._seconds ?? v?.seconds;
  if (typeof secs === "number") return new Date(secs * 1000);
  if (typeof value === "number") return new Date(value);
  if (typeof value === "string") {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  return fallback;
}

/** Minutes to wait after `attempts` failed attempts (1-based). */
export function backoffMinutes(attempts: number): number {
  return BACKOFF_MINUTES[Math.min(Math.max(attempts, 1), BACKOFF_MINUTES.length) - 1];
}

export function computeNextAttemptAt(attempts: number, now: Date, retryAfterMs?: number | null): Date {
  const backoff = backoffMinutes(attempts) * 60_000;
  return new Date(now.getTime() + Math.max(backoff, retryAfterMs ?? 0));
}

/** Fields to merge into a source doc on every capture write. */
export function captureSyncFields(stage: string) {
  return {
    sendingStatus: "not_synced" as SendingStatus,
    klaviyoSync: {
      attempts: 0,
      historical: false,
      capturedAt: FieldValue.serverTimestamp(),
      nextAttemptAt: FieldValue.serverTimestamp(),
      stages: { [stage]: "pending" },
    },
  };
}

// ---------------------------------------------------------------------------
// Builders: source doc -> per-stage Klaviyo input
// ---------------------------------------------------------------------------

export interface BuildOptions {
  /** Backfill: subscribe as historical import with the stored consent time. */
  historical?: boolean;
}

type StageInputs = Record<string, SignupSyncInput>;

function leadInputs(id: string, d: Data, opts: BuildOptions): StageInputs {
  const out: StageInputs = {};
  const email = typeof d.email === "string" ? d.email : "";
  if (!email) return out;
  const emailConsent = d.emailConsent as Data | undefined;
  const smsConsent = d.smsConsent as Data | undefined;
  const common = { source: "shop-edit-popup", docKey: id, email };
  if (emailConsent?.granted === true) {
    const at = toDate(emailConsent.capturedAt);
    out.email = {
      ...common,
      stage: "email",
      capturedAt: at,
      properties: {
        mully_interest: d.interest,
        mully_reward_percent: SHOP_REWARDS.email.percent,
        mully_reward_code: SHOP_REWARDS.email.code,
        mully_email_consent_captured: true,
        mully_signup_landing_path: "/",
      },
      eventProperties: {
        interest: d.interest,
        reward_percent: SHOP_REWARDS.email.percent,
        reward_code: SHOP_REWARDS.email.code,
        email_consent: true,
        sms_consent: false,
      },
      subscribe: { email: true },
      ...(opts.historical ? { historical: { consentedAt: at } } : {}),
    };
  }
  const phone = normalizeSignupPhone(d.phone);
  if (phone && smsConsent?.granted === true) {
    const at = toDate(smsConsent.capturedAt);
    out.sms = {
      ...common,
      stage: "sms",
      phone,
      capturedAt: at,
      properties: {
        mully_reward_percent: SHOP_REWARDS.sms.percent,
        mully_reward_code: SHOP_REWARDS.sms.code,
        mully_sms_consent_captured: true,
      },
      eventProperties: {
        reward_percent: SHOP_REWARDS.sms.percent,
        reward_code: SHOP_REWARDS.sms.code,
        email_consent: false,
        sms_consent: true,
      },
      // Never re-send the email subscription on the SMS stage.
      subscribe: { sms: SUBSCRIBE_POPUP_SMS },
      ...(opts.historical ? { historical: { consentedAt: at } } : {}),
    };
  }
  return out;
}

function dropListInputs(id: string, d: Data, opts: BuildOptions): StageInputs {
  const out: StageInputs = {};
  const email = typeof d.email === "string" ? d.email : "";
  if (!email) return out;
  const source = d.source === "shop-newsletter" ? "shop-newsletter" : "editorial-drop-bar";
  const docKey = safeDocKey("editorial_drop_list", id);
  // Live: consent must come from the submission that queued this sync.
  // Backfill: only docs that recorded explicit consent.
  const consented = opts.historical
    ? d.emailMarketingConsent === true
    : d.lastSubmissionConsent === true;
  const at = toDate(opts.historical ? d.emailMarketingConsentAt ?? d.lastSeenAt : d.lastSeenAt);
  out.email = {
    source,
    stage: "email",
    docKey,
    email,
    capturedAt: at,
    properties: {
      mully_email_consent_captured: consented,
      mully_signup_landing_path: source === "shop-newsletter" ? "/" : "/lp/editorial",
    },
    eventProperties: { email_consent: consented, sms_consent: false },
    subscribe: { email: consented },
    ...(opts.historical && consented ? { historical: { consentedAt: at } } : {}),
  };
  // Stylist follow-up: a phone for a stylist text is not SMS marketing consent.
  if (d.stylistOptIn === true) {
    out.stylist = {
      source,
      stage: "stylist",
      docKey,
      email,
      phone: normalizeSignupPhone(d.phone),
      capturedAt: toDate(d.stylistOptInAt),
      properties: { mully_stylist_opt_in: true },
      eventProperties: { stylist_opt_in: true, email_consent: false, sms_consent: false },
    };
  }
  return out;
}

function backInStockInputs(id: string, d: Data): StageInputs {
  const email = typeof d.email === "string" ? d.email : "";
  if (!email) return {};
  return {
    request: {
      source: "back-in-stock",
      stage: "request",
      docKey: id,
      email,
      capturedAt: toDate(d.createdAt),
      properties: { mully_last_back_in_stock_product: d.productSlug ?? undefined },
      eventProperties: {
        product_slug: d.productSlug ?? undefined,
        product_name: d.productName ?? undefined,
        variant_id: d.variantId ?? undefined,
        size: d.size ?? undefined,
        email_consent: false,
        sms_consent: false,
      },
    },
  };
}

function jobInputs(id: string, d: Data): StageInputs {
  const email = typeof d.email === "string" ? d.email : "";
  const source = typeof d.source === "string" ? d.source : "";
  if (!email || !source) return {};
  return {
    contact: {
      source,
      stage: "contact",
      docKey: id,
      email,
      firstName: typeof d.firstName === "string" ? d.firstName : null,
      lastName: typeof d.lastName === "string" ? d.lastName : null,
      capturedAt: toDate(d.capturedAt ?? (d.klaviyoSync as Data | undefined)?.capturedAt),
      properties: { ...((d.properties as Data) ?? {}), mully_email_consent_captured: false },
      eventProperties: { ...((d.eventProperties as Data) ?? {}), email_consent: false, sms_consent: false },
    },
  };
}

export function buildStageInputs(
  collection: SyncCollection,
  id: string,
  data: Data,
  opts: BuildOptions = {},
): StageInputs {
  switch (collection) {
    case "shop_marketing_leads":
      return leadInputs(id, data, opts);
    case "editorial_drop_list":
      return dropListInputs(id, data, opts);
    case "back_in_stock_requests":
      return backInStockInputs(id, data);
    case "klaviyo_sync_jobs":
      return jobInputs(id, data);
  }
}

// ---------------------------------------------------------------------------
// Sync one doc
// ---------------------------------------------------------------------------

export interface SyncDocOptions extends BuildOptions {
  /** Stages to (re)send even if already synced, e.g. the stage just submitted. */
  forceStages?: string[];
  now?: Date;
  /** Injected for tests. */
  syncImpl?: (input: SignupSyncInput) => Promise<SignupSyncResult>;
}

export interface SyncDocOutcome {
  status: SendingStatus | "skipped";
  errorCode?: string;
}

export async function syncDocRef(
  collection: SyncCollection,
  ref: DocumentReference,
  opts: SyncDocOptions = {},
): Promise<SyncDocOutcome> {
  if (!isKlaviyoSyncEnabled()) return { status: "skipped", errorCode: "disabled" };
  const syncImpl = opts.syncImpl ?? syncSignupToKlaviyo;
  const now = opts.now ?? new Date();
  const snap = await ref.get();
  if (!snap.exists) return { status: "skipped", errorCode: "missing_doc" };
  const data = (snap.data() ?? {}) as Data;
  const state = (data.klaviyoSync ?? {}) as Data;
  const stageState = { ...((state.stages as Record<string, string>) ?? {}) };
  // Backfilled docs stay historical on retry so they never trigger flows.
  const historical = opts.historical === true || state.historical === true;
  const inputs = buildStageInputs(collection, ref.id, data, { ...opts, historical });
  const force = new Set(opts.forceStages ?? []);
  const pending = Object.keys(inputs).filter((s) => force.has(s) || stageState[s] !== "synced");

  if (pending.length === 0) {
    await ref.set({ sendingStatus: "synced" }, { merge: true });
    return { status: "synced" };
  }

  let profileId = typeof state.profileId === "string" ? state.profileId : undefined;
  let lastError: string | undefined;
  let note: string | undefined;
  let retryAfterMs: number | null = null;
  for (const stage of pending) {
    const result = await syncImpl(inputs[stage]);
    if (result.status === "synced") {
      stageState[stage] = "synced";
      profileId = result.profileId ?? profileId;
      if (result.errorCode) note = result.errorCode;
    } else {
      stageState[stage] = "failed";
      lastError = result.errorCode ?? "unexpected";
      retryAfterMs = result.retryAfterMs ?? retryAfterMs;
    }
  }

  const attempts = (typeof state.attempts === "number" ? state.attempts : 0) + 1;
  const allSynced = Object.keys(inputs).every((s) => stageState[s] === "synced");
  const status: SendingStatus = allSynced ? "synced" : attempts >= MAX_ATTEMPTS ? "dead" : "failed";
  const update: Data = {
    sendingStatus: status,
    klaviyoSync: {
      attempts,
      lastAttemptAt: Timestamp.fromDate(now),
      nextAttemptAt: Timestamp.fromDate(
        allSynced ? now : computeNextAttemptAt(attempts, now, retryAfterMs),
      ),
      stages: stageState,
      ...(profileId ? { profileId } : {}),
      ...(allSynced ? { syncedAt: Timestamp.fromDate(now) } : {}),
      lastErrorCode: lastError ?? note ?? null,
      ...(historical ? { historical: true } : {}),
    },
  };
  await ref.set(update, { merge: true });

  const key = safeDocKey(collection, ref.id);
  if (status === "dead") {
    await raiseAlert({
      kind: "klaviyo_sync_failed",
      severity: "warning",
      summary: `Klaviyo signup sync gave up on ${collection}/${key} after ${attempts} attempts (${lastError})`,
      detail: { collection, doc: key, errorCode: lastError ?? null, attempts },
    });
  }
  if (status !== "synced") console.warn(`[klaviyo-sync] ${collection}/${key} ${status} ${lastError}`);
  return { status, errorCode: lastError ?? note };
}

export function syncDoc(collection: SyncCollection, id: string, opts: SyncDocOptions = {}) {
  return syncDocRef(collection, adminDb.collection(collection).doc(id), opts);
}

/**
 * Run the sync for a just-written doc after the response is sent. Safe to
 * call unconditionally: no-ops when the flag is off and never throws.
 */
export function scheduleKlaviyoSync(collection: SyncCollection, id: string, stages: string[]) {
  if (!isKlaviyoSyncEnabled() || !id) return;
  try {
    after(async () => {
      try {
        await syncDoc(collection, id, { forceStages: stages });
      } catch {
        console.error(`[klaviyo-sync] after() failed for ${collection}/${safeDocKey(collection, id)}`);
      }
    });
  } catch {
    // Outside a request scope; the retry cron will pick the doc up.
  }
}

/**
 * For routes without their own capture doc (account start, application
 * forms): write a small retryable job doc, then sync it. All of this runs in
 * after(), so the visitor's request is never slowed or failed by it.
 */
export function queueKlaviyoContact(input: {
  source: string;
  email: string;
  firstName?: string | null;
  lastName?: string | null;
  properties?: Data;
  eventProperties?: Data;
}) {
  const email = input.email.trim().toLowerCase();
  if (!email) return;
  const id = `${input.source}:${sha(email).slice(0, 32)}`;
  try {
  after(async () => {
    try {
      await adminDb
        .collection("klaviyo_sync_jobs")
        .doc(id)
        .set(
          {
            source: input.source,
            email,
            firstName: input.firstName ?? null,
            lastName: input.lastName ?? null,
            properties: input.properties ?? {},
            eventProperties: input.eventProperties ?? {},
            capturedAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
            ...captureSyncFields("contact"),
          },
          { merge: true },
        );
      if (isKlaviyoSyncEnabled()) await syncDoc("klaviyo_sync_jobs", id, { forceStages: ["contact"] });
    } catch {
      console.error(`[klaviyo-sync] job write failed for ${input.source}`);
    }
  });
  } catch {
    // Outside a request scope: nothing to do.
  }
}
