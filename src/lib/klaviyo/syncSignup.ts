/**
 * syncSignupToKlaviyo: push one on-site capture stage to Klaviyo.
 *
 *   1. Upsert the profile (every source).
 *   2. Subscribe, only for channels whose consent was captured in the
 *      submission this stage represents. Bulk Subscribe removes existing
 *      UNSUBSCRIBE / SPAM_REPORT / USER_SUPPRESSED suppressions, so callers
 *      must never pass inferred or stale consent.
 *   3. Track a "Mully Site Signup" event with a deterministic unique_id so
 *      retries and repeat submissions never create duplicates.
 *
 * Never throws. Never logs PII.
 */

import { KlaviyoError, klaviyoRequest } from "./client";
import { KLAVIYO_SIGNUP_LIST_ID, SIGNUP_METRIC } from "./config";

export interface SignupSyncInput {
  source: string;
  stage: string;
  /** Firestore doc id (or job key). Used only to build the event unique_id. */
  docKey: string;
  email: string;
  phone?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  capturedAt: Date;
  /** Extra mully_* profile properties. */
  properties?: Record<string, unknown>;
  /** Extra event properties (beyond source/stage). */
  eventProperties?: Record<string, unknown>;
  /** Channels with explicit consent in this submission. */
  subscribe?: { email?: boolean; sms?: boolean };
  /** Backfill only: historical import with the original consent time. */
  historical?: { consentedAt: Date };
}

export interface SignupSyncResult {
  status: "synced" | "failed";
  profileId?: string;
  /** Set on failure, or a non-fatal note such as "phone_conflict" on success. */
  errorCode?: string;
  retryAfterMs?: number | null;
}

type ProfileResponse = {
  data?: { id?: string; attributes?: { properties?: Record<string, unknown> } };
};

const clean = (obj: Record<string, unknown>) =>
  Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined));

export function signupEventUniqueId(source: string, docKey: string, stage: string): string {
  return `${source}:${docKey}:${stage}`;
}

async function upsertProfile(attributes: Record<string, unknown>) {
  const res = await klaviyoRequest<ProfileResponse>("/api/profile-import", {
    body: { data: { type: "profile", attributes } },
  });
  return res.body?.data;
}

export async function syncSignupToKlaviyo(input: SignupSyncInput): Promise<SignupSyncResult> {
  let note: string | undefined;
  try {
    const properties = clean({
      mully_last_signup_source: input.source,
      mully_last_signup_at: input.capturedAt.toISOString(),
      ...(input.properties ?? {}),
    });
    const base = clean({
      email: input.email,
      first_name: input.firstName || undefined,
      last_name: input.lastName || undefined,
      properties,
    });

    // 1. Profile upsert, with a single phone-less retry on phone conflicts.
    let phoneAttached = Boolean(input.phone);
    let profile: ProfileResponse["data"];
    try {
      profile = await upsertProfile(input.phone ? { ...base, phone_number: input.phone } : base);
    } catch (err) {
      const conflict =
        input.phone &&
        err instanceof KlaviyoError &&
        (err.code === "duplicate_profile" || err.code === "bad_request");
      if (!conflict) throw err;
      phoneAttached = false;
      note = "phone_conflict";
      profile = await upsertProfile(base);
    }
    const profileId = profile?.id;

    if (!profile?.attributes?.properties?.mully_first_signup_source) {
      await upsertProfile({ email: input.email, properties: { mully_first_signup_source: input.source } });
    }

    // 2. Subscribe only the channels consented in this submission.
    const wantEmail = input.subscribe?.email === true;
    const wantSms = input.subscribe?.sms === true && Boolean(input.phone);
    if (input.subscribe?.sms && !phoneAttached) note = "phone_conflict";
    const smsOk = wantSms && phoneAttached;
    if (wantEmail || smsOk) {
      if (!KLAVIYO_SIGNUP_LIST_ID) {
        return { status: "failed", profileId, errorCode: "list_not_configured" };
      }
      const consent = () =>
        input.historical
          ? { marketing: { consent: "SUBSCRIBED", consented_at: pastConsentTime(input.historical.consentedAt) } }
          : { marketing: { consent: "SUBSCRIBED" } };
      const subscriptions = clean({
        email: wantEmail ? consent() : undefined,
        sms: smsOk ? consent() : undefined,
      });
      await klaviyoRequest("/api/profile-subscription-bulk-create-jobs", {
        body: {
          data: {
            type: "profile-subscription-bulk-create-job",
            attributes: {
              custom_source: input.source,
              historical_import: Boolean(input.historical),
              profiles: {
                data: [
                  {
                    type: "profile",
                    attributes: clean({
                      email: wantEmail ? input.email : undefined,
                      phone_number: smsOk ? input.phone : undefined,
                      subscriptions,
                    }),
                  },
                ],
              },
            },
            relationships: { list: { data: { type: "list", id: KLAVIYO_SIGNUP_LIST_ID } } },
          },
        },
      });
    }

    // 2b. Readiness flags before the event, so the immediate welcome sees them.
    // Off unless LIFECYCLE_READINESS_WRITE_ENABLED=true; never blocks the sync.
    if (!input.historical && process.env.LIFECYCLE_READINESS_WRITE_ENABLED === "true") {
      const { refreshReadinessForSignup } = await import("@/lib/lifecycle/readinessSources");
      await refreshReadinessForSignup(input.email, wantEmail);
    }

    // 3. Signup event (idempotent via unique_id).
    await klaviyoRequest("/api/events", {
      body: {
        data: {
          type: "event",
          attributes: {
            metric: { data: { type: "metric", attributes: { name: SIGNUP_METRIC } } },
            profile: { data: { type: "profile", attributes: { email: input.email } } },
            properties: clean({ source: input.source, stage: input.stage, ...(input.eventProperties ?? {}) }),
            time: input.capturedAt.toISOString(),
            unique_id: signupEventUniqueId(input.source, input.docKey, input.stage),
          },
        },
      },
    });

    return clean({ status: "synced", profileId, errorCode: note }) as unknown as SignupSyncResult;
  } catch (err) {
    if (err instanceof KlaviyoError) {
      return { status: "failed", errorCode: err.message, retryAfterMs: err.retryAfterMs };
    }
    return { status: "failed", errorCode: "unexpected" };
  }
}

/** Klaviyo requires historical consented_at to be in the past; clamp to 1 minute ago. */
export function pastConsentTime(at: Date, now: Date = new Date()): string {
  const latest = now.getTime() - 60_000;
  const t = Number.isNaN(at.getTime()) ? latest : Math.min(at.getTime(), latest);
  return new Date(t).toISOString();
}
